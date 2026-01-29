// api/utils/scraper.js
import * as cheerio from 'cheerio';

export const ScraperAPI = {
    async scrape(sources) {
        const promises = sources.map(async (source) => {
            try {
                // 1. Fetch with Timeout & Spoofed Headers
                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), 4000); // 4s timeout (slightly longer for deeper reading)

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
                // Return basic info if scrape fails
                return { 
                    ...source, 
                    content: source.snippet || "Content unavailable.",
                    quote_chunk: source.snippet, // Fallback for quotes
                    meta: { author: "Unknown", published: "n.d.", siteName: "" }
                };
            }
        });

        const results = await Promise.all(promises);
        return results.map((r, i) => ({ ...r, id: i + 1 }));
    },

    _parseHtml(html, originalSource) {
        const $ = cheerio.load(html);

        // 2. Remove Junk
        $('script, style, nav, footer, iframe, svg, header, .ad, .advertisement, .popup, .cookie-banner').remove();

        // 3. Extract Metadata (The "Deep" Scrape)
        let author = $('meta[name="author"]').attr('content') || 
                     $('meta[property="article:author"]').attr('content') ||
                     $('a[rel="author"]').first().text();

        let date = $('meta[property="article:published_time"]').attr('content') ||
                   $('meta[name="date"]').attr('content') ||
                   $('time').first().attr('datetime');

        let siteName = $('meta[property="og:site_name"]').attr('content') || 
                       $('meta[name="application-name"]').attr('content');

        // 4. JSON-LD Fallback (Crucial for modern sites)
        if (!author || !date) {
            try {
                const jsonLd = $('script[type="application/ld+json"]').html();
                if (jsonLd) {
                    const data = JSON.parse(jsonLd);
                    // Handle array or object
                    const obj = Array.isArray(data) ? data[0] : data;
                    
                    if (!author && obj.author) {
                        if (typeof obj.author === 'string') author = obj.author;
                        else if (Array.isArray(obj.author)) author = obj.author[0].name;
                        else if (obj.author.name) author = obj.author.name;
                    }
                    if (!date && obj.datePublished) date = obj.datePublished;
                    if (!siteName && obj.publisher && obj.publisher.name) siteName = obj.publisher.name;
                }
            } catch (e) {}
        }

        // Clean Metadata
        author = author ? author.trim().replace(/^By\s+/i, '') : "Unknown";
        date = date ? new Date(date).getFullYear() : "n.d.";
        siteName = siteName || new URL(originalSource.link).hostname.replace('www.', '');

        // 5. Extract Content & Middle Chunk
        const rawText = $('body').text().replace(/\s+/g, ' ').trim();
        
        // Limit total context for AI to save tokens
        const cleanContent = rawText.substring(0, 2500);

        // **Middle Chunk Logic for Quotes**
        // Get a 500-char slice from the middle of the text to ensure variety
        let quoteChunk = "";
        if (rawText.length > 600) {
            const start = Math.floor(rawText.length / 2) - 250;
            const safeStart = start < 0 ? 0 : start;
            quoteChunk = "..." + rawText.substring(safeStart, safeStart + 600) + "...";
        } else {
            quoteChunk = rawText;
        }

        return {
            ...originalSource,
            title: ($('meta[property="og:title"]').attr('content') || $('title').text() || originalSource.title).trim(),
            content: cleanContent,
            quote_chunk: quoteChunk, // <--- New Field for specific use in Quote Logic
            meta: { author, published: date, siteName }
        };
    }
};
