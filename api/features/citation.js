import * as cheerio from 'cheerio';
import PdfParse from 'pdf-parse/lib/pdf-parse.js';

const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
];

/**
 * UTILITY: Smart Sentence Extractor
 * Grabs a chunk of text but extends it until it finds a sentence ending.
 * Rule: Ends when a letter/quote is followed by a dot.
 */
function getSmartChunk(fullText, startIndex, targetLength) {
    if (startIndex >= fullText.length) return "";

    // 1. Grab the rough chunk
    let chunk = fullText.substr(startIndex, targetLength);
    
    // 2. Look ahead up to 500 chars to find a clean sentence end
    // We look for a Letter (a-z) or Quote (") followed immediately by a Dot (.)
    const buffer = fullText.substr(startIndex + targetLength, 500);
    
    // Regex: Match [Letter or Quote] followed by [Dot]
    // ([a-zA-Z"”]) captures the char before the dot
    // \. matches the dot
    const match = buffer.match(/([a-zA-Z"”])\./);

    if (match) {
        // Extend chunk to include the buffer up to the match index + 2 (char + dot)
        return chunk + buffer.substring(0, match.index + 2);
    }

    // Fallback: If no sentence end found, just return chunk with ellipsis
    return chunk + "...";
}

/**
 * UTILITY: Metadata Regex Fallback
 * If Cheerio fails, look for patterns in the raw text.
 */
function extractTextMetadata(text) {
    let author = null;
    let date = null;

    // Author: Look for "By [Name]" or "Written by [Name]"
    // Matches "By John Doe" or "By J. Doe"
    const authorMatch = text.match(/(?:By|Written by)\s+([A-Z][a-z]+(?:\s+[A-Z]\.?\s+|\s+)[A-Z][a-z]+)/);
    if (authorMatch) author = authorMatch[1];

    // Date: Look for "April 24, 2018" or "Jan 12, 2024"
    const dateMatch = text.match(/([A-Z][a-z]{2,8}\s+\d{1,2},\s+\d{4})/);
    if (dateMatch) date = dateMatch[1];

    return { author, date };
}

export const ScraperAPI = {
    async scrape(sources) {
        // Limit sources to avoid timeouts
        const targetSources = sources.slice(0, 8);

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
                // FAIL SAFE: Use Snippet if blocked/failed
                return {
                    ...source,
                    content: `[Summary]: ${source.snippet} (Full content unavailable)`,
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
        $('script, style, nav, footer, iframe, svg, header, aside, .ad, .popup, .menu').remove();

        // 2. Extract Text
        const rawText = $('body').text().replace(/\s+/g, ' ').trim();

        // 3. Metadata Extraction (Meta Tags + Regex Fallback)
        let author = $('meta[name="author"]').attr('content') || 
                     $('meta[property="og:site_name"]').attr('content');
        
        let date = $('meta[property="article:published_time"]').attr('content') || 
                   $('time').first().attr('datetime');

        // If Meta tags failed, check the text content using Regex (Brookings fix)
        if (!author || author === "Unknown" || !date || date === "n.d.") {
            const textMeta = extractTextMetadata(rawText.substring(0, 1000));
            if (!author || author === "Unknown") author = textMeta.author || "Unknown";
            if (!date || date === "n.d.") date = textMeta.date || "n.d.";
        }

        // 4. Smart Chunking Strategy
        const len = rawText.length;
        
        // Chunk A: Intro (Metadata heavy) - 1000 chars
        let finalContent = getSmartChunk(rawText, 0, 1000);

        if (len > 3000) {
            // Chunk B: 33% mark - 250 chars
            const p1 = Math.floor(len * 0.33);
            finalContent += `\n... [Section 2] ...\n${getSmartChunk(rawText, p1, 250)}`;

            // Chunk C: 66% mark - 250 chars
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

    // PDF Helper
    _formatResult(rawText, source, author, date) {
        // Reuse the same smart chunking for PDFs
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
