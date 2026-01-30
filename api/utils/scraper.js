// api/utils/scraper.js
import * as cheerio from 'cheerio';
import PdfParse from 'pdf-parse/lib/pdf-parse.js';

const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
];

/**
 * UTILITY: Smart Sentence Extractor
 * Extends chunk until it hits a period following a letter or quote.
 */
function getSmartChunk(fullText, startIndex, targetLength) {
    if (startIndex >= fullText.length) return "";
    let chunk = fullText.substr(startIndex, targetLength);
    const buffer = fullText.substr(startIndex + targetLength, 500);
    
    // Regex: Matches [Letter or Quote] followed immediately by [Dot]
    const match = buffer.match(/([a-zA-Z"”])\./);

    if (match) {
        return chunk + buffer.substring(0, match.index + 2);
    }
    return chunk + (chunk.endsWith('.') ? '' : '...');
}

export const ScraperAPI = {
    async scrape(sources) {
        // Ensure we process 10 sources
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
                    return this._formatResult(pdfData.text, source, "PDF Document", "n.d.");
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
        
        // 1. SPECIFIC CLEANUP (Requested by User)
        $('script, style, nav, footer, iframe, svg, header, aside, .ad, .popup, .menu, noscript').remove();
        // Remove red error banner divs often found in scrapes
        $('div[style*="color: red"]').remove(); 
        $('div:contains("Enable JavaScript")').remove();

        // 2. Extract Text
        const rawText = $('body').text().replace(/\s+/g, ' ').trim();

        // 3. Metadata Extraction (Meta Tags)
        let author = $('meta[name="author"]').attr('content') || 
                     $('meta[property="og:site_name"]').attr('content');
        
        let date = $('meta[property="article:published_time"]').attr('content') || 
                   $('time').first().attr('datetime');

        return this._formatResult(rawText, originalSource, author, date);
    },

    _formatResult(rawText, source, author, date) {
        const len = rawText.length;
        
        // 4. MODULAR CHUNKING STRATEGY
        // Start: 1000 chars (Contains title, intro, authors)
        let finalContent = getSmartChunk(rawText, 0, 1000);

        if (len > 3000) {
            // Mid 1: 33% mark
            const p1 = Math.floor(len * 0.33);
            finalContent += `\n... [Section 2] ...\n${getSmartChunk(rawText, p1, 250)}`;

            // Mid 2: 66% mark
            const p2 = Math.floor(len * 0.66);
            finalContent += `\n... [Section 3] ...\n${getSmartChunk(rawText, p2, 250)}`;
        }

        return {
            ...source,
            content: finalContent,
            meta: { 
                author: author ? author.trim() : "Unknown", 
                published: date ? date.substring(0, 20) : "n.d.", 
                siteName: new URL(source.link).hostname.replace('www.', '') 
            }
        };
    }
};
