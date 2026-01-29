import * as cheerio from 'cheerio';
import PdfParse from 'pdf-parse/lib/pdf-parse.js';

const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
];

export const ScraperAPI = {
    async scrape(sources) {
        const promises = sources.map(async (source) => {
            try {
                // 1. Try to fetch the full page
                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), 5000); 

                const res = await fetch(source.link, {
                    signal: controller.signal,
                    headers: { 
                        'User-Agent': USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)],
                        'Accept': 'text/html,application/xhtml+xml,application/pdf'
                    }
                });
                clearTimeout(timeout);

                if (!res.ok) throw new Error(`HTTP ${res.status}`);

                // 2. Handle PDF
                const contentType = res.headers.get('content-type') || '';
                if (contentType.includes('application/pdf') || source.link.endsWith('.pdf')) {
                    const buffer = await res.arrayBuffer();
                    const pdfData = await PdfParse(Buffer.from(buffer));
                    return this._formatResult(pdfData.text, source, "PDF Document", "n.d.");
                }

                // 3. Handle HTML
                const html = await res.text();
                return this._parseHtml(html, source);

            } catch (e) {
                // --- CRITICAL FALLBACK ---
                // If scrape fails, use the Google Search Snippet so the AI has SOMETHING to read.
                console.warn(`Scrape failed for ${source.link}, using snippet.`);
                return {
                    ...source,
                    title: source.title || "Source",
                    // Combine snippet + title to give context
                    content: `[Summary from Search Result]: ${source.snippet} \n\n (Full text could not be scraped, use this summary for citation).`,
                    meta: { 
                        author: "Unknown", 
                        published: "n.d.", 
                        siteName: new URL(source.link).hostname.replace('www.', '') 
                    }
                };
            }
        });

        const results = await Promise.all(promises);
        return results.map((r, i) => ({ ...r, id: i + 1 }));
    },

    _parseHtml(html, originalSource) {
        const $ = cheerio.load(html);
        $('script, style, nav, footer, iframe, svg, header, aside, .ad, .popup').remove();

        // Metadata Heuristics
        let author = $('meta[name="author"]').attr('content') || 
                     $('meta[property="og:site_name"]').attr('content') || 
                     "Unknown";
        
        let date = $('meta[property="article:published_time"]').attr('content') || 
                   $('time').first().attr('datetime') || 
                   "n.d.";

        const rawText = $('body').text().replace(/\s+/g, ' ').trim();
        return this._formatResult(rawText, originalSource, author, date);
    },

    _formatResult(rawText, source, author, date) {
        // Start + Mid + End Chunking
        let finalContent = rawText.substring(0, 1500);
        if (rawText.length > 3000) {
            const mid = Math.floor(rawText.length / 2);
            finalContent += `\n... [Middle] ...\n${rawText.substring(mid, mid + 600)}`;
            finalContent += `\n... [End] ...\n${rawText.substring(rawText.length - 600)}`;
        }

        return {
            ...source,
            content: finalContent || source.snippet, // Backup check
            meta: { 
                author: author.trim(), 
                published: date, 
                siteName: new URL(source.link).hostname.replace('www.', '') 
            }
        };
    }
};
