// api/utils/scraper.js
import * as cheerio from 'cheerio';

export const ScraperAPI = {
    async scrape(sources) {
        const promises = sources.map(async (source) => {
            try {
                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), 5000); // 5s for deep scrape

                const res = await fetch(source.link, {
                    signal: controller.signal,
                    headers: { 
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
                    }
                });
                clearTimeout(timeout);

                if (!res.ok) throw new Error("Fetch failed");
                const html = await res.text();
                
                return this._parseHtml(html, source);
            } catch (e) {
                return { 
                    ...source, 
                    content: source.snippet || "Content unavailable.",
                    meta: { author: "Unknown", published: "n.d.", siteName: "" }
                };
            }
        });

        const results = await Promise.all(promises);
        return results.map((r, i) => ({ ...r, id: i + 1 }));
    },

    _parseHtml(html, originalSource) {
        const $ = cheerio.load(html);

        // 1. Clean Garbage
        $('script, style, nav, footer, iframe, svg, header, aside, .ad, .advertisement, .popup, .cookie-banner, .social-share').remove();

        // 2. Extract Raw Text
        const rawText = $('body').text().replace(/\s+/g, ' ').trim();
        const len = rawText.length;

        // 3. SMART CHUNKING (Start 1250 + Middle 500 + End 500)
        let finalContent = rawText.substring(0, 1250); // Start
        
        if (len > 2000) {
            // Middle
            const midStart = Math.floor(len / 2) - 250;
            const midChunk = rawText.substring(midStart, midStart + 500);
            finalContent += `\n... [Middle Section] ...\n${midChunk}`;
            
            // End
            const endChunk = rawText.substring(len - 500, len);
            finalContent += `\n... [End Section] ...\n${endChunk}`;
        } else if (len > 1250) {
            // Just append the rest if it's small enough
            finalContent += rawText.substring(1250);
        }

        // 4. Basic Cheerio Metadata (Fallback)
        let author = $('meta[name="author"]').attr('content') || $('meta[property="article:author"]').attr('content') || "Unknown";
        let date = $('meta[property="article:published_time"]').attr('content') || $('time').first().attr('datetime') || "n.d.";
        let site = $('meta[property="og:site_name"]').attr('content') || new URL(originalSource.link).hostname.replace('www.', '');

        return {
            ...originalSource,
            title: ($('meta[property="og:title"]').attr('content') || $('title').text() || originalSource.title).trim(),
            content: finalContent, // Sends the composite text to AI
            meta: { author, published: date, siteName: site }
        };
    }
};
