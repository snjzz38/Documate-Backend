import * as cheerio from 'cheerio';
import PdfParse from 'pdf-parse/lib/pdf-parse.js';

const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
];

/**
 * HELPER: Smart Chunk Extractor
 * Grabs text starting at 'index' and extends until it finds a sentence ending.
 * Looks for: Period/Question/Exclamation + Space/Quote.
 */
function getSmartChunk(fullText, startIndex, targetLength) {
    if (startIndex >= fullText.length) return "";
    
    // 1. Cut the rough slice
    let chunk = fullText.substr(startIndex, targetLength);
    
    // 2. Scan the NEXT 500 chars to find a clean stop
    const buffer = fullText.substr(startIndex + targetLength, 500);
    
    // Regex: Match [Letter/Digit/Quote] followed immediately by [.?!] and then [Space or End of String]
    const match = buffer.match(/([a-zA-Z0-9"”])([.?!])(?:\s|$)/);

    if (match) {
        // match.index is where the char before punctuation starts
        // match[0].length handles the punctuation + space
        // We want to cut right after the punctuation
        const cutIndex = match.index + 2; 
        return chunk + buffer.substring(0, cutIndex);
    }

    // Fallback: If no sentence end found, just add ellipsis
    return chunk + "...";
}

/**
 * HELPER: Metadata Extraction (JSON-LD > Meta Tags > Text Regex)
 */
function extractMetadata($, rawText) {
    let author = null;
    let date = null;

    // 1. JSON-LD (Best for News/Brookings)
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

    // 2. Meta Tags (Fallback)
    if (!author) {
        author = $('meta[name="author"]').attr('content') || 
                 $('meta[property="og:site_name"]').attr('content') ||
                 $('a[rel="author"]').first().text();
    }
    if (!date) {
        date = $('meta[property="article:published_time"]').attr('content') || 
               $('time').first().attr('datetime');
    }

    // 3. Text Forensics (Last Resort)
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
                
                // PDF Handling
                if (contentType.includes('application/pdf') || source.link.endsWith('.pdf')) {
                    const buffer = await res.arrayBuffer();
                    const pdfData = await PdfParse(Buffer.from(buffer));
                    return this._formatResult(pdfData.text, source);
                }

                // HTML Handling
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
        
        // 1. Remove Junk (Nav, Footer, Scripts)
        $('script, style, nav, footer, iframe, svg, header, aside, form, button, noscript').remove();
        $('.ad, .popup, .menu, .share, .social, .subscribe, .cookie, .banner, .related, .sidebar').remove();
        
        // 2. Get Raw Text & Cleanup Whitespace
        const rawText = $('body').text().replace(/\s+/g, ' ').trim();

        // 3. Extract Metadata
        const meta = extractMetadata($, rawText);

        return this._formatResult(rawText, originalSource, meta);
    },

    _formatResult(rawText, source, metaOverride = null) {
        const len = rawText.length;
        
        // --- THE STRATEGY ---
        // 1. Start: First 1000 chars (Intro/Summary)
        let finalContent = getSmartChunk(rawText, 0, 1000);

        if (len > 3000) {
            const mid = Math.floor(len / 2);

            // 2. Random Excerpt A: Somewhere between 1000 and Middle
            // Range: 1000 to (Mid - 300)
            const rangeA = mid - 1000 - 300;
            if (rangeA > 0) {
                const startA = 1000 + Math.floor(Math.random() * rangeA);
                finalContent += `\n\n... [Excerpt A] ...\n${getSmartChunk(rawText, startA, 300)}`;
            }

            // 3. Random Excerpt B: Somewhere between Middle and End
            // Range: Mid to (Len - 300)
            const rangeB = len - mid - 300;
            if (rangeB > 0) {
                const startB = mid + Math.floor(Math.random() * rangeB);
                finalContent += `\n\n... [Excerpt B] ...\n${getSmartChunk(rawText, startB, 300)}`;
            }
        }

        // Use override meta (from HTML scrape) or defaults (from PDF/Plain text)
        const meta = metaOverride || { 
            author: "PDF Document", 
            date: "n.d." 
        };

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
