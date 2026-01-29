// api/scraper.js
import * as cheerio from 'cheerio';

export const ScraperAPI = {
    async scrape(sources) {
        // Run scrapes in parallel
        const promises = sources.map(async (source) => {
            try {
                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), 2500); // 2.5s hard timeout

                const res = await fetch(source.link, {
                    signal: controller.signal,
                    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; DocuMate/1.0)' }
                });
                clearTimeout(timeout);

                if (!res.ok) throw new Error("Fetch failed");
                
                const html = await res.text();
                return this._parseHtml(html, source);
            } catch (e) {
                // Fallback to snippet if scrape fails
                return { 
                    ...source, 
                    content: source.snippet || "No content available.",
                    meta: { author: "Unknown", siteName: "" }
                };
            }
        });

        const results = await Promise.all(promises);
        // Add IDs (1-indexed) for reference
        return results.map((r, i) => ({ ...r, id: i + 1 }));
    },

    _parseHtml(html, originalSource) {
        const $ = cheerio.load(html);

        // Remove noise
        $('script, style, nav, footer, iframe, svg, header, .ad, .advertisement').remove();

        // Extract Metadata
        const title = $('meta[property="og:title"]').attr('content') || $('title').text() || originalSource.title;
        const author = $('meta[name="author"]').attr('content') || "Unknown";
        const siteName = $('meta[property="og:site_name"]').attr('content') || "";

        // Extract Text
        let content = $('body').text()
            .replace(/\s+/g, ' ') // Collapse whitespace
            .trim()
            .substring(0, 2000); // Limit context size

        if (content.length < 50) content = originalSource.snippet;

        return {
            ...originalSource,
            title: title.trim(),
            content: content,
            meta: { author, siteName }
        };
    }
};
