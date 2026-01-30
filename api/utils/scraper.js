import * as cheerio from 'cheerio';
import PdfParse from 'pdf-parse/lib/pdf-parse.js';

const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
];

function getSmartChunk(fullText, startIndex, targetLength) {
    if (startIndex >= fullText.length) return "";
    let chunk = fullText.substr(startIndex, targetLength);
    const buffer = fullText.substr(startIndex + targetLength, 500);
    const match = buffer.match(/([a-zA-Z"”])\./);
    if (match) return chunk + buffer.substring(0, match.index + 2);
    return chunk + (chunk.endsWith('.') ? '' : '...');
}

function extractTextMetadata(text) {
    let author = null;
    let date = null;
    const authorMatch = text.match(/(?:By|Written by)\s+([A-Z][a-z]+(?:\s+[A-Z]\.?\s+|\s+)[A-Z][a-z]+)/);
    if (authorMatch) author = authorMatch[1];
    const dateMatch = text.match(/([A-Z][a-z]{2,8}\.?\s+\d{1,2},\s+\d{4})/);
    if (dateMatch) date = dateMatch[1];
    return { author, date };
}

export const ScraperAPI = {
    async scrape(sources) {
        // Process up to 10 sources
        const targetSources = sources.slice(0, 10);

        const promises = targetSources.map(async (source) => {
            try {
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

                const contentType = res.headers.get('content-type') || '';
                if (contentType.includes('application/pdf') || source.link.endsWith('.pdf')) {
                    const buffer = await res.arrayBuffer();
                    const pdfData = await PdfParse(Buffer.from(buffer));
                    return this._formatResult(pdfData.text, source, "PDF Document", "n.d.");
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
        
        // 1. aggressive Junk Removal
        $('script, style, nav, footer, iframe, svg, header, aside, .ad, .popup, .menu, noscript').remove();
        $('[aria-hidden="true"]').remove();
        $('div[style*="display:none"]').remove();
        
        // Remove "Enable JavaScript" warnings specifically
        $('div, p, span').filter((i, el) => {
            const t = $(el).text().toLowerCase();
            return t.includes('please enable javascript') || t.includes('browser does not support');
        }).remove();

        const rawText = $('body').text().replace(/\s+/g, ' ').trim();

        // 2. Metadata Extraction
        let author = $('meta[name="author"]').attr('content') || 
                     $('meta[property="og:site_name"]').attr('content');
        
        let date = $('meta[property="article:published_time"]').attr('content') || 
                   $('time').first().attr('datetime');

        if (!author || author === "Unknown" || !date || date === "n.d.") {
            const textMeta = extractTextMetadata(rawText.substring(0, 1000));
            if (!author || author === "Unknown") author = textMeta.author || "Unknown";
            if (!date || date === "n.d.") date = textMeta.date || "n.d.";
        }

        // 3. Smart Chunking
        const len = rawText.length;
        let finalContent = getSmartChunk(rawText, 0, 1000); // Intro

        if (len > 3000) {
            finalContent += `\n... ${getSmartChunk(rawText, Math.floor(len * 0.33), 300)}`;
            finalContent += `\n... ${getSmartChunk(rawText, Math.floor(len * 0.66), 300)}`;
        }

        return {
            ...originalSource,
            content: finalContent,
            meta: { 
                author: author ? author.trim() : "Unknown", 
                published: date ? date.substring(0, 20) : "n.d.", 
                siteName: new URL(originalSource.link).hostname.replace('www.', '') 
            }
        };
    },

    _formatResult(rawText, source, author, date) {
        const safeText = rawText.replace(/\s+/g, ' ').trim();
        let finalContent = getSmartChunk(safeText, 0, 1000);
        
        if (safeText.length > 3000) {
             const p1 = Math.floor(safeText.length * 0.5);
             finalContent += `\n... ${getSmartChunk(safeText, p1, 500)}`;
        }

        return {
            ...source,
            content: finalContent,
            meta: { author, published: date, siteName: "PDF Document" }
        };
    }
};
