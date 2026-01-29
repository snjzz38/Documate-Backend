import * as cheerio from 'cheerio';
import PdfParse from 'pdf-parse/lib/pdf-parse.js'; // Ensure correct import for Vercel

// 1. User Agent Rotation (Avoids 403 blocks)
const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0'
];

const getRandomAgent = () => USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];

export const ScraperAPI = {
    async scrape(sources) {
        const promises = sources.map(async (source) => {
            try {
                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), 6000); // 6s timeout

                const res = await fetch(source.link, {
                    signal: controller.signal,
                    headers: { 
                        'User-Agent': getRandomAgent(), // Rotate Agent
                        'Accept': 'text/html,application/pdf,application/xhtml+xml,*/*;q=0.8'
                    }
                });
                clearTimeout(timeout);

                if (!res.ok) throw new Error(`HTTP ${res.status}`);

                const contentType = res.headers.get('content-type') || '';

                // 2. PDF Handling
                if (contentType.includes('application/pdf') || source.link.endsWith('.pdf')) {
                    const buffer = await res.arrayBuffer();
                    const pdfData = await PdfParse(Buffer.from(buffer));
                    return this._formatResult(pdfData.text, source, "PDF Document", "n.d.");
                }

                // 3. HTML Handling
                const html = await res.text();
                return this._parseHtml(html, source);

            } catch (e) {
                return this._formatResult(source.snippet || "Content unavailable", source, "Unknown", "n.d.");
            }
        });

        const results = await Promise.all(promises);
        return results.map((r, i) => ({ ...r, id: i + 1 }));
    },

    _parseHtml(html, originalSource) {
        const $ = cheerio.load(html);
        $('script, style, nav, footer, iframe, svg, header, aside, .ad, .popup').remove();

        const rawText = $('body').text().replace(/\s+/g, ' ').trim();
        
        // Metadata extraction (same as before)
        let author = $('meta[name="author"]').attr('content') || "Unknown";
        let date = $('meta[property="article:published_time"]').attr('content') || "n.d.";
        
        return this._formatResult(rawText, originalSource, author, date);
    },

    _formatResult(rawText, source, author, date) {
        const len = rawText.length;
        
        // 4. Advanced Chunking (1250 Start + 500 Mid + 500 End)
        let compositeText = rawText.substring(0, 1250);
        
        if (len > 2500) {
            const mid = Math.floor(len / 2) - 250;
            const end = len - 500;
            
            if (mid > 1250) compositeText += `\n... [Middle] ...\n${rawText.substring(mid, mid + 500)}`;
            compositeText += `\n... [End] ...\n${rawText.substring(end, len)}`;
        } else if (len > 1250) {
            compositeText += rawText.substring(1250);
        }

        return {
            ...source,
            title: source.title || "Untitled",
            content: compositeText,
            meta: { author, published: date, siteName: new URL(source.link).hostname }
        };
    }
};
