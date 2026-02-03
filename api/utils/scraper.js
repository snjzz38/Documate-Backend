// api/utils/scraper.js
import * as cheerio from 'cheerio';
import PdfParse from 'pdf-parse/lib/pdf-parse.js';

const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
];

/**
 * HELPER: Find the nearest valid sentence start.
 * Logic: Search for [Letter/Number/Quote] + [./!/?] + [Space] + [Capital Letter].
 * Returns the index of the Capital Letter.
 */
function findSentenceStart(text, searchFromIndex) {
    if (searchFromIndex >= text.length) return -1;

    // Scan a buffer of 500 chars to find a start
    const buffer = text.substring(searchFromIndex, searchFromIndex + 500);
    
    // Regex explanation:
    // ([a-z0-9"”'])   -> Capture group 1: Ends with letter, number, or quote
    // [.!?]           -> Literal punctuation
    // \s+             -> Whitespace
    // ([A-Z])         -> Capture group 2: Starts with Capital Letter
    const match = buffer.match(/([a-z0-9"”'])[.!?]\s+([A-Z])/);

    if (match) {
        // match.index = start of the pattern (the ending letter of prev sentence)
        // We want the index of Capture Group 2 (The Capital Letter)
        // match[0] is the whole string "d. The"
        // We calculate offset to the Capital Letter
        const splitIndex = match[0].lastIndexOf(match[2]);
        return searchFromIndex + match.index + splitIndex;
    }

    return -1; // No valid start found in buffer
}

/**
 * HELPER: Extract a semantic chunk.
 * 1. Adjusts start to nearest sentence beginning.
 * 2. Extends end to nearest sentence completion.
 */
function getSmartChunk(fullText, approxStart, targetLength) {
    // 1. Find a clean start
    let start = findSentenceStart(fullText, approxStart);
    
    // If no sentence start found (or we are at 0), just fallback to approxStart
    if (start === -1) {
        if (approxStart === 0) start = 0; // Allow index 0 for Intro
        else return ""; // Skip if we can't find a sentence in the middle
    }

    // 2. Cut the rough slice
    let chunk = fullText.substr(start, targetLength);
    
    // 3. Find a clean end (Letter/Quote + Punctuation + Space/EOF)
    const buffer = fullText.substr(start + targetLength, 300);
    const endMatch = buffer.match(/([a-z0-9"”'])[.!?](?:\s|$)/);

    if (endMatch) {
        const cutIndex = endMatch.index + endMatch[1].length + 1; // Include punctuation
        chunk += buffer.substring(0, cutIndex);
    } else {
        chunk += "...";
    }

    return chunk;
}

/**
 * HELPER: Extract metadata using JSON-LD & Meta Tags.
 */
function extractMetadata($, rawText) {
    let author = null;
    let date = null;

    // 1. JSON-LD
    try {
        const jsonLd = $('script[type="application/ld+json"]').html();
        if (jsonLd) {
            const data = JSON.parse(jsonLd);
            const obj = Array.isArray(data) ? data[0] : data;
            if (obj.author) {
                author = typeof obj.author === 'string' ? obj.author : (obj.author.name || obj.author[0]?.name);
            }
            date = obj.datePublished || obj.dateCreated;
        }
    } catch (e) {}

    // 2. Meta Tags
    if (!author) {
        author = $('meta[name="author"]').attr('content') || 
                 $('meta[property="og:site_name"]').attr('content') ||
                 $('a[rel="author"]').first().text();
    }
    if (!date) {
        date = $('meta[property="article:published_time"]').attr('content') || 
               $('time').first().attr('datetime');
    }

    // 3. Text Forensics
    if (!date || date === "n.d.") {
        const dateMatch = rawText.substring(0, 1500).match(/([A-Z][a-z]{2,8}\.?\s+\d{1,2},\s+\d{4})/);
        if (dateMatch) date = dateMatch[1];
    }

    return { 
        author: author ? author.trim() : "Unknown", 
        date: date || "n.d." 
    };
}

export const ScraperAPI = {
    async scrape(sources) {
        const targetSources = sources.slice(0, 10);

        const promises = targetSources.map(async (source) => {
            try {
                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), 6000); 

                const res = await fetch(source.link, {
                    signal: controller.signal,
                    headers: { 
                        'User-Agent': USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)],
                        'Accept': 'text/html,application/xhtml+xml,application/pdf'
                    }
                });
                clearTimeout(timeout);

                if (!res.ok) throw new Error(`HTTP ${res.status}`);

                const contentType = res.headers.get('content-type') || '';
                
                if (contentType.includes('application/pdf') || source.link.endsWith('.pdf')) {
                    const buffer = await res.arrayBuffer();
                    const pdfData = await PdfParse(Buffer.from(buffer));
                    return this._formatResult(pdfData.text, source);
                }

                const html = await res.text();
                return this._parseHtml(html, source);

            } catch (e) {
                return {
                    ...source,
                    content: `[Summary]: ${source.snippet || "No content available."}`,
                    meta: { author: "Unknown", published: "n.d.", siteName: new URL(source.link).hostname }
                };
            }
        });

        const results = await Promise.all(promises);
        return results.map((r, i) => ({ ...r, id: i + 1 }));
    },

    _parseHtml(html, originalSource) {
        const $ = cheerio.load(html);
        
        // Remove Junk
        $('script, style, nav, footer, iframe, svg, header, aside, form, button, noscript').remove();
        $('.ad, .popup, .menu, .share, .social, .subscribe, .cookie, .banner, .related, .sidebar').remove();
        
        const rawText = $('body').text().replace(/\s+/g, ' ').trim();
        const meta = extractMetadata($, rawText);

        return this._formatResult(rawText, originalSource, meta);
    },

    _formatResult(rawText, source, metaOverride = null) {
        const len = rawText.length;
        
        // 1. Intro: Always 0-1000 (Best for metadata/thesis)
        let finalContent = getSmartChunk(rawText, 0, 1000);

        // 2. Central Chunks (Avoid Footer Junk)
        if (len > 3000) {
            // Define the "Safe Zone" (End at 85% to avoid footers/references)
            const safeEnd = Math.floor(len * 0.85);
            const bodyStart = 1200; // Skip intro overlap

            if (safeEnd > bodyStart + 500) {
                const zoneSize = safeEnd - bodyStart;
                const midPoint = bodyStart + Math.floor(zoneSize / 2);

                // Excerpt A: Random point in First Half of Safe Zone
                const rangeA = midPoint - bodyStart;
                if (rangeA > 200) {
                    const startA = bodyStart + Math.floor(Math.random() * (rangeA - 100));
                    const chunkA = getSmartChunk(rawText, startA, 350);
                    if (chunkA) finalContent += `\n\n... [Excerpt A] ...\n${chunkA}`;
                }

                // Excerpt B: Random point in Second Half of Safe Zone
                const rangeB = safeEnd - midPoint;
                if (rangeB > 200) {
                    const startB = midPoint + Math.floor(Math.random() * (rangeB - 100));
                    const chunkB = getSmartChunk(rawText, startB, 350);
                    if (chunkB) finalContent += `\n\n... [Excerpt B] ...\n${chunkB}`;
                }
            }
        }

        const meta = metaOverride || { author: "PDF Document", date: "n.d." };

        return {
            ...source,
            content: finalContent,
            meta: { 
                author: meta.author, 
                published: meta.date, 
                siteName: new URL(source.link).hostname.replace('www.', '') 
            }
        };
    }
};
