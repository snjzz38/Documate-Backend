import * as cheerio from 'cheerio';
import PdfParse from 'pdf-parse/lib/pdf-parse.js';

const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
];

/**
 * HELPER: Extract metadata from raw HTML before cleaning.
 * This ensures we capture Bylines/Dates that might be in <div> or <span> tags 
 * which get stripped by the main content cleaner.
 */
function extractMetadata($) {
    // 1. Meta Tags (Standard)
    let author = $('meta[name="author"]').attr('content') || 
                 $('meta[property="og:site_name"]').attr('content');
    let date = $('meta[property="article:published_time"]').attr('content') || 
               $('time').first().attr('datetime');

    // 2. Text Forensics (Fallbacks)
    // Scan headers/bylines specifically
    if (!author || author === "Unknown") {
        const byline = $('[class*="author"], [class*="byline"]').first().text().trim();
        if (byline.length > 3 && byline.length < 50) {
            author = byline.replace(/^By\s+/i, '');
        }
    }
    
    // 3. Date Regex fallback on the whole body (for "April 24, 2018")
    if (!date || date === "n.d.") {
        const bodyText = $('body').text().substring(0, 1500); // Check header area
        const dateMatch = bodyText.match(/([A-Z][a-z]{2,8}\.?\s+\d{1,2},\s+\d{4})/);
        if (dateMatch) date = dateMatch[1];
    }

    return { 
        author: author || "Unknown", 
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

                // PDF Handler
                const contentType = res.headers.get('content-type') || '';
                if (contentType.includes('application/pdf') || source.link.endsWith('.pdf')) {
                    const buffer = await res.arrayBuffer();
                    const pdfData = await PdfParse(Buffer.from(buffer));
                    // PDFs don't have HTML structure, so we use the smart chunker on raw text
                    return this._formatPdfResult(pdfData.text, source);
                }

                // HTML Handler
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
        
        // 1. Metadata Extraction (Do this BEFORE destructive cleaning)
        const meta = extractMetadata($);

        // 2. Garbage Removal (UI elements)
        $('script, style, nav, footer, iframe, svg, header, aside, form, button').remove();
        $('.ad, .popup, .menu, .share-buttons, .subscribe, .newsletter, .cookie-banner').remove();
        $('[aria-hidden="true"]').remove();

        // 3. MAIN CONTENT FINDER
        // We look for specific containers to avoid scraping sidebars/footers
        let contentObj = $('article');
        if (contentObj.length === 0) contentObj = $('[role="main"]');
        if (contentObj.length === 0) contentObj = $('.main-content, .entry-content, #content');
        if (contentObj.length === 0) contentObj = $('body'); // Fallback

        // 4. SEMANTIC PARAGRAPH EXTRACTION
        // Instead of grabbing raw text, we grab <p> tags. 
        // This ensures we get actual sentences and skip navigation links/lists.
        const paragraphs = [];
        contentObj.find('p').each((i, el) => {
            const text = $(el).text().trim();
            // Filter out short garbage (e.g. "Read more", "Share", dates in lists)
            if (text.length > 50) {
                paragraphs.push(text);
            }
        });

        // 5. CONTENT ASSEMBLY (Intro + 2 Random Core Chunks)
        let finalContent = "";

        if (paragraphs.length > 0) {
            // A. Intro: First 2-3 paragraphs (approx 1000 chars)
            // Usually contains the thesis/summary
            let charCount = 0;
            let introParas = [];
            for (let i = 0; i < paragraphs.length; i++) {
                introParas.push(paragraphs[i]);
                charCount += paragraphs[i].length;
                if (charCount > 1000) break;
            }
            finalContent = introParas.join('\n\n');

            // B. Random Central Chunks (if content is long enough)
            if (paragraphs.length > 6) {
                const remainingParas = paragraphs.slice(introParas.length);
                if (remainingParas.length > 2) {
                    // Pick 2 random distinct paragraphs from the body
                    const idx1 = Math.floor(Math.random() * remainingParas.length);
                    let idx2 = Math.floor(Math.random() * remainingParas.length);
                    // Ensure they aren't the same
                    while (idx2 === idx1 && remainingParas.length > 1) {
                        idx2 = Math.floor(Math.random() * remainingParas.length);
                    }

                    finalContent += `\n\n... [Excerpt A] ...\n${remainingParas[idx1]}`;
                    finalContent += `\n\n... [Excerpt B] ...\n${remainingParas[idx2]}`;
                }
            }
        } else {
            // Fallback: If no <p> tags found, use raw body text logic
            const rawBody = $('body').text().replace(/\s+/g, ' ').trim();
            finalContent = rawBody.substring(0, 1500);
        }

        return {
            ...originalSource,
            content: finalContent,
            meta: { 
                author: meta.author ? meta.author.trim() : "Unknown", 
                published: meta.date ? meta.date.substring(0, 20) : "n.d.", 
                siteName: new URL(originalSource.link).hostname.replace('www.', '') 
            }
        };
    },

    _formatPdfResult(rawText, source) {
        // PDF Chunking Logic
        const safeText = rawText.replace(/\s+/g, ' ').trim();
        let finalContent = safeText.substring(0, 1200); // Intro
        
        if (safeText.length > 3000) {
             const mid = Math.floor(safeText.length * 0.4);
             finalContent += `\n... [PDF Excerpt] ...\n${safeText.substring(mid, mid + 600)}`;
        }

        return {
            ...source,
            content: finalContent,
            meta: { author: "PDF Document", published: "n.d.", siteName: "PDF" }
        };
    }
};
