import * as cheerio from 'cheerio';
import PdfParse from 'pdf-parse/lib/pdf-parse.js';

const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
];

/**
 * UTILITY: Smart Sentence Extractor
 * Grabs a chunk of text but extends it until it finds a sentence ending.
 */
function getSmartChunk(fullText, startIndex, targetLength) {
    if (startIndex >= fullText.length) return "";

    let chunk = fullText.substr(startIndex, targetLength);
    const buffer = fullText.substr(startIndex + targetLength, 500);
    
    // Look for a letter/quote followed by a dot
    const match = buffer.match(/([a-zA-Z"”])\./);

    if (match) {
        return chunk + buffer.substring(0, match.index + 2);
    }
    return chunk + (chunk.endsWith('.') ? '' : '...');
}

/**
 * UTILITY: Metadata Regex Fallback
 * Scans raw text for "By [Name]" and "Date".
 */
function extractTextMetadata(text) {
    let author = null;
    let date = null;

    // Improved Author Regex: Matches "By Darrell M. West" or "By John Doe"
    // Allows optional middle initial (A.)
    const authorMatch = text.match(/(?:By|Written by)\s+([A-Z][a-z]+(?:\s+[A-Z]\.?\s+|\s+)[A-Z][a-z]+)/);
    if (authorMatch) author = authorMatch[1];

    // Date Regex: Matches "April 24, 2018" or "Jan. 12, 2024"
    const dateMatch = text.match(/([A-Z][a-z]{2,8}\.?\s+\d{1,2},\s+\d{4})/);
    if (dateMatch) date = dateMatch[1];

    return { author, date };
}

export const ScraperAPI = {
    async scrape(sources) {
        const targetSources = sources.slice(0, 8);

        const promises = targetSources.map(async (source) => {
            try {
                // Sanitize URL (Fixes the double URL issue)
                let cleanLink = source.link.trim();
                if (cleanLink.includes('http') && cleanLink.lastIndexOf('http') > 0) {
                    cleanLink = cleanLink.substring(cleanLink.lastIndexOf('http'));
                }

                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), 6000); 

                const res = await fetch(cleanLink, {
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
                if (contentType.includes('application/pdf') || cleanLink.endsWith('.pdf')) {
                    const buffer = await res.arrayBuffer();
                    const pdfData = await PdfParse(Buffer.from(buffer));
                    return this._formatResult(pdfData.text, source, "PDF Document", "n.d.");
                }

                // HTML Handler
                const html = await res.text();
                return this._parseHtml(html, source);

            } catch (e) {
                // FAIL SAFE: Use Snippet if blocked/failed
                // Fallback to empty string if snippet is undefined (Debug Mode fix)
                const safeSnippet = source.snippet || "No preview available.";
                
                return {
                    ...source,
                    content: `[Summary]: ${safeSnippet} (Full content unavailable)`,
                    meta: { author: "Unknown", published: "n.d.", siteName: "Unknown" }
                };
            }
        });

        const results = await Promise.all(promises);
        return results.map((r, i) => ({ ...r, id: i + 1 }));
    },

    _parseHtml(html, originalSource) {
        const $ = cheerio.load(html);
        
        // 1. Clean Garbage
        $('script, style, nav, footer, iframe, svg, header, aside, .ad, .popup, .menu, #cookie-banner').remove();

        // 2. Extract Text
        const rawText = $('body').text().replace(/\s+/g, ' ').trim();

        // 3. Metadata Extraction (Meta Tags + Regex Fallback)
        let author = $('meta[name="author"]').attr('content') || 
                     $('meta[property="og:site_name"]').attr('content') ||
                     $('a[rel="author"]').first().text();
        
        let date = $('meta[property="article:published_time"]').attr('content') || 
                   $('time').first().attr('datetime');

        // Regex Fallback
        if (!author || author.length < 3 || author === "Unknown") {
            const textMeta = extractTextMetadata(rawText.substring(0, 1500));
            if (textMeta.author) author = textMeta.author;
            if (!date && textMeta.date) date = textMeta.date;
        }

        // 4. Smart Chunking (1000 Start + 2x 250 Mid)
        const len = rawText.length;
        
        // Chunk A: Intro (Metadata heavy) - 1000 chars
        let finalContent = getSmartChunk(rawText, 0, 1000);

        if (len > 3000) {
            // Chunk B: 33% mark
            const p1 = Math.floor(len * 0.33);
            finalContent += `\n... [Section 2] ...\n${getSmartChunk(rawText, p1, 250)}`;

            // Chunk C: 66% mark
            const p2 = Math.floor(len * 0.66);
            finalContent += `\n... [Section 3] ...\n${getSmartChunk(rawText, p2, 250)}`;
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
             const p1 = Math.floor(safeText.length * 0.33);
             finalContent += `\n... [Mid] ...\n${getSmartChunk(safeText, p1, 250)}`;
        }

        return {
            ...source,
            content: finalContent,
            meta: { author, published: date, siteName: "PDF Document" }
        };
    }
};
