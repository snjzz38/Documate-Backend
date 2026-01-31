import * as cheerio from 'cheerio';
import PdfParse from 'pdf-parse/lib/pdf-parse.js';

const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
];

/**
 * HELPER: Find all valid sentence starts in the text.
 * Rule: A sentence starts at index 0, OR at a Capital Letter preceded by punctuation (.?!) and whitespace.
 */
function findSentenceStartIndices(text) {
    const indices = [0]; // The beginning is always a valid sentence start
    // Regex: Match Punctuation (.?!) + Optional Quote + Whitespace + Capture Capital Letter
    const regex = /[.!?]['"]?\s+([A-Z])/g;
    let match;
    
    while ((match = regex.exec(text)) !== null) {
        // The valid start is where the Capital Letter ([A-Z]) begins.
        // match.index = start of punctuation
        // match[0] = full match string (e.g., ". T")
        // The captured group 1 is the letter. Its position is at the end of the match.
        const letterIndex = match.index + match[0].indexOf(match[1]);
        indices.push(letterIndex);
    }
    return indices;
}

/**
 * HELPER: Extract a chunk starting at index, extended to the nearest sentence end.
 */
function extractSentenceChunk(text, startIndex, minLength) {
    if (startIndex >= text.length) return "";

    let endIndex = startIndex + minLength;
    
    // Look ahead up to 500 chars to find a clean sentence ending
    // Look for punctuation followed by space or end of string
    const buffer = text.substring(endIndex, endIndex + 500);
    const endMatch = buffer.match(/[.!?]['"]?(?:\s|$)/);

    if (endMatch) {
        endIndex += endMatch.index + 1; // Include the punctuation
    } else {
        // Fallback: stop at nearest space
        const space = buffer.indexOf(' ');
        if (space > -1) endIndex += space;
    }

    return text.substring(startIndex, endIndex);
}

export const ScraperAPI = {
    async scrape(sources) {
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
        
        // 1. Clean Garbage
        $('script, style, nav, footer, iframe, svg, header, aside, .ad, .popup, .menu, noscript').remove();
        $('[aria-hidden="true"]').remove();
        $('div:contains("Enable JavaScript")').remove();

        // 2. Extract Text
        const rawText = $('body').text().replace(/\s+/g, ' ').trim();

        // 3. Metadata Extraction
        let author = $('meta[name="author"]').attr('content') || 
                     $('meta[property="og:site_name"]').attr('content');
        let date = $('meta[property="article:published_time"]').attr('content') || 
                   $('time').first().attr('datetime');

        if (!author || author === "Unknown") {
            // Simple text scan fallback
            const authMatch = rawText.substring(0, 1000).match(/(?:By|Written by)\s+([A-Z][a-z]+(?:\s+[A-Z]\.?\s+|\s+)[A-Z][a-z]+)/);
            if (authMatch) author = authMatch[1];
        }

        return this._formatResult(rawText, originalSource, author || "Unknown", date || "n.d.");
    },

    _formatResult(rawText, source, author, date) {
        const len = rawText.length;
        
        // 1. Always get the Intro (0 to ~1000 chars)
        // This is crucial for Metadata extraction in the prompts
        let finalContent = extractSentenceChunk(rawText, 0, 1000);
        
        // 2. Add Random Middle/End Chunks if text is long enough
        if (len > 3000) {
            // Find ALL valid sentence starts in the remaining text
            // We start searching after the intro (index 1000)
            const remainingTextStart = 1000;
            const validStarts = findSentenceStartIndices(rawText)
                .filter(idx => idx > remainingTextStart && idx < len - 500); // Ensure meaningful length

            if (validStarts.length > 2) {
                // Pick 2 random starts
                const pick1 = validStarts[Math.floor(Math.random() * validStarts.length)];
                
                // Pick 2nd, ensure non-overlapping (at least 500 chars away)
                const validStarts2 = validStarts.filter(idx => Math.abs(idx - pick1) > 600);
                const pick2 = validStarts2.length > 0 
                    ? validStarts2[Math.floor(Math.random() * validStarts2.length)] 
                    : null;

                // Extract & Append
                finalContent += `\n... [Random Section A] ...\n${extractSentenceChunk(rawText, pick1, 400)}`;
                
                if (pick2) {
                    finalContent += `\n... [Random Section B] ...\n${extractSentenceChunk(rawText, pick2, 400)}`;
                }
            } else {
                // Fallback if not enough sentences found (weird formatting): Take middle
                finalContent += `\n... [Middle] ...\n${extractSentenceChunk(rawText, Math.floor(len/2), 500)}`;
            }
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
