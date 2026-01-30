// api/utils/scraper.js
import * as cheerio from 'cheerio';
import PdfParse from 'pdf-parse/lib/pdf-parse.js';

const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
];

export const ScraperAPI = {
    async scrape(sources) {
        // Limit to top 8 sources to save tokens
        const targetSources = sources.slice(0, 8);

        const promises = targetSources.map(async (source) => {
            try {
                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), 4000); // 4s timeout

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
                // FALLBACK: Use Google Snippet if scrape fails
                return {
                    ...source,
                    content: `[Summary]: ${source.snippet || "No content available."}`,
                    meta: { author: "Unknown", published: "n.d.", siteName: "Unknown" }
                };
            }
        });

        const results = await Promise.all(promises);
        return results.map((r, i) => ({ ...r, id: i + 1 }));
    },

    _parseHtml(html, originalSource) {
        const $ = cheerio.load(html);
        // Aggressive Cleaning
        $('script, style, nav, footer, iframe, svg, header, aside, .ad, .popup, .menu, #comments').remove();

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
        // SAFETY LIMIT: 1500 chars max per source
        // This prevents Groq 400 errors caused by token overflow
        let finalContent = rawText.substring(0, 1000); 
        
        if (rawText.length > 2000) {
             // Add a middle chunk for better context
            const mid = Math.floor(rawText.length / 2);
            finalContent += ` ... ${rawText.substring(mid, mid + 500)}`;
        }

        return {
            ...source,
            content: finalContent,
            meta: { 
                author: author.trim().substring(0, 50), // Cap metadata length too
                published: date.substring(0, 20),
                siteName: new URL(source.link).hostname.replace('www.', '') 
            }
        };
    }
};
