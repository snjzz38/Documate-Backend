// api/features/citation.js
import { GoogleSearchAPI } from '../utils/googleSearch.js';
import { ScraperAPI } from '../utils/scraper.js';
import { GroqAPI } from '../utils/groqAPI.js';

// ==========================================================================
// MODULE: FORMAT SERVICE (The Prompt Logic)
// ==========================================================================
const FormatService = {
    buildPrompt(type, style, context, sources) {
        const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
        
        // Enhanced context builder with better metadata extraction
        const sourceContext = sources.map(s => {
            // Pre-extract date from content if DETECTED_DATE is n.d.
            let enhancedDate = s.meta.published;
            if (!enhancedDate || enhancedDate === "n.d.") {
                // Look for date patterns in the content
                const datePatterns = [
                    /(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}/i,
                    /\b(20\d{2})\b/,  // Years 2000-2099
                    /\d{1,2}\/\d{1,2}\/\d{4}/,
                    /\d{4}-\d{2}-\d{2}/
                ];
                
                for (const pattern of datePatterns) {
                    const match = s.content.match(pattern);
                    if (match) {
                        enhancedDate = match[0];
                        break;
                    }
                }
            }
            
            // Pre-extract author from content if DETECTED_AUTHOR is Unknown
            let enhancedAuthor = s.meta.author;
            if (!enhancedAuthor || enhancedAuthor === "Unknown") {
                const authorPatterns = [
                    /By\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/,
                    /Author:\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/i,
                    /Written by\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/i
                ];
                
                for (const pattern of authorPatterns) {
                    const match = s.content.match(pattern);
                    if (match) {
                        enhancedAuthor = match[1];
                        break;
                    }
                }
            }
            
            return `[ID:${s.id}] TITLE: ${s.title}
             URL: ${s.link}
             DETECTED_AUTHOR: ${enhancedAuthor || s.meta.author} 
             DETECTED_DATE: ${enhancedDate || s.meta.published}
             SITE_NAME: ${s.meta.siteName || 'Unknown'}
             TEXT_SNIPPET: ${s.content.substring(0, 500).replace(/\n/g, ' ')}...`;
        }).join('\n\n');

        // --- 1. QUOTES ---
        if (type === 'quotes') {
            return `
                TASK: Extract quotes. CONTEXT: "${context.substring(0, 300)}..."
                SOURCES:\n${sourceContext}
                RULES: Output strictly in order ID 1 to ${sources.length}. Format: **[ID] Title** - URL \n > "Quote..."
            `;
        }

        // --- 2. CITATIONS ---
        
        // Define strict style templates to prevent MLA/Chicago mix-ups
        let styleRules = "";
        if (style.toLowerCase().includes("chicago")) {
            styleRules = `
                STYLE: Chicago Manual of Style (Notes & Bibliography).
                BIBLIOGRAPHY FORMAT: Author Last, First. "Title of Article." *Publisher/Site Name*, Publication Date. URL.
                IN-TEXT FORMAT: (Author, Year) or (Author, n.d.) if date unknown.
            `;
        } else if (style.toLowerCase().includes("mla")) {
            styleRules = `
                STYLE: MLA 9th Edition.
                BIBLIOGRAPHY FORMAT: Author Last, First. "Title of Article." *Container Title*, Publication Date, URL.
                IN-TEXT FORMAT: (Author) or (Author, Year) -- PREFER (Author, Year) for clarity.
            `;
        } else if (style.toLowerCase().includes("apa")) {
            styleRules = `
                STYLE: APA 7th Edition.
                BIBLIOGRAPHY FORMAT: Author, A. A. (Year, Month Day). Title of article. *Site Name*. URL
                IN-TEXT FORMAT: (Author, Year).
            `;
        }

        return `
            TASK: Insert citations into the text.
            ${styleRules}
            
            SOURCE DATA:
            ${sourceContext}
            
            TEXT: "${context}"
            
            CRITICAL INSTRUCTIONS:
            1. **IN-TEXT CITATION**: The "citation_text" field MUST contain the Date whenever possible.
               - CORRECT: (West, 2018)
               - CORRECT: (Smith, 2024)
               - ONLY IF NO DATE FOUND: (Smith, n.d.)
               - WRONG: (Smith) without date when date is available
            
            2. **METADATA FORENSICS - FOLLOW THIS EXACT PROCESS**:
               Step A - Check DETECTED_AUTHOR:
                 - If "Unknown", look at TEXT_SNIPPET for patterns like "By [Name]", "Author: [Name]", or proper names
                 - Use the first credible author name you find
               
               Step B - Check DETECTED_DATE:
                 - If "n.d.", look carefully at TEXT_SNIPPET for ANY year (2024, 2023, 2018, etc.)
                 - Look for full dates like "April 24, 2018" or "January 2024"
                 - Extract the YEAR and use it in the citation
                 - If you find a date in TEXT_SNIPPET, YOU MUST USE IT - do NOT leave it as "n.d."
               
               Step C - Double-check:
                 - Before finalizing each citation, verify you've extracted all available metadata
                 - A date in TEXT_SNIPPET means the citation should have a year, not "n.d."
            
            3. **FORMATTED CITATIONS**:
               - The value in "formatted_citations" must be the FULL bibliographic entry.
               - **MANDATORY**: End every entry with: "URL (Accessed ${today})".
            
            4. **EXAMPLE OF CORRECT DATE EXTRACTION**:
               If TEXT_SNIPPET contains "April 24, 2018" and DETECTED_DATE is "n.d.", 
               you should extract "2018" and use:
               - citation_text: "(West, 2018)"
               - formatted_citations: "West, Darrell M. 'Title.' Brookings, April 24, 2018. URL (Accessed ${today})"
            
            OUTPUT: Return strictly JSON.
            {
              "insertions": [
                { "anchor": "phrase from text", "source_id": 1, "citation_text": "(Author, Year)" }
              ],
              "formatted_citations": { "1": "Author, Name. \"Title.\" Publisher, Date. URL (Accessed ${today})" }
            }
        `;
    }
};

// ==========================================================================
// MODULE: TEXT PROCESSOR (The Pipeline)
// ==========================================================================
const PipelineService = {
    ensureAccessDate(text) {
        if (!text) return "";
        const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
        if (text.includes("Accessed")) return text;
        return `${text} (Accessed ${today})`;
    },

    // Generates a backup citation if AI returns "Unknown" or fails
    generateFallback(source) {
        const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
        
        let author = source.meta.author;
        if (!author || author === "Unknown") author = source.meta.siteName || "Unknown Source";
        
        let date = source.meta.published;
        if (!date || date === "n.d.") date = "n.d.";

        // Default to a generic clean format: Author. (Date). Title. Site. URL
        return `${author}. (${date}). "${source.title}". ${source.meta.siteName}. ${source.link} (Accessed ${today})`;
    },

    processInsertions(context, insertions, sources, formattedMap, outputType) {
        let resultText = context;
        let footnoteCounter = 1;
        let usedSourceIds = new Set();
        let footnotesList = [];

        // 1. Tokenize Text
        const tokens = [];
        const tokenRegex = /[a-z0-9]+/gi;
        let match;
        while ((match = tokenRegex.exec(context)) !== null) {
            tokens.push({ word: match[0].toLowerCase(), start: match.index, end: match.index + match[0].length });
        }

        // 2. Sort Insertions
        const validInsertions = (insertions || [])
            .map(item => {
                if (!item.anchor || !item.source_id) return null;
                const anchorWords = item.anchor.toLowerCase().match(/[a-z0-9]+/g);
                if (!anchorWords) return null;
                let bestIndex = -1;
                for (let i = 0; i <= tokens.length - anchorWords.length; i++) {
                    let matchFound = true;
                    for (let j = 0; j < anchorWords.length; j++) {
                        if (tokens[i + j].word !== anchorWords[j]) { matchFound = false; break; }
                    }
                    if (matchFound) { bestIndex = tokens[i + anchorWords.length - 1].end; break; }
                }
                return bestIndex !== -1 ? { ...item, insertIndex: bestIndex } : null;
            })
            .filter(Boolean)
            .sort((a, b) => b.insertIndex - a.insertIndex);

        // 3. Apply Insertions
        validInsertions.forEach(item => {
            const source = sources.find(s => s.id === item.source_id);
            if (!source) return;
            
            usedSourceIds.add(source.id);
            
            // Get Citation String
            let citString = formattedMap[source.id];
            
            // Validation: If AI returned a lazy citation, overwrite it with fallback
            if (!citString || citString.length < 10) {
                citString = this.generateFallback(source);
            }
            citString = this.ensureAccessDate(citString);

            let insertContent = "";
            if (outputType === 'footnotes') {
                const s = { '0':'⁰','1':'¹','2':'²','3':'³','4':'⁴','5':'⁵','6':'⁶','7':'⁷','8':'⁸','9':'⁹' };
                const numStr = footnoteCounter.toString();
                insertContent = numStr.split('').map(d => s[d]||'').join('');
                
                footnotesList.push(`${footnoteCounter}. ${citString}`);
                footnoteCounter++;
            } else {
                // IN-TEXT LOGIC
                // We trust the AI's "citation_text" (e.g., (Smith, 2024)), 
                // but if it looks empty, we generate a basic one.
                let inText = item.citation_text;
                if (!inText || inText.length < 3) {
                    const auth = source.meta.author !== "Unknown" ? source.meta.author.split(' ')[0] : "Unknown";
                    const yr = source.meta.published !== "n.d." ? source.meta.published.substring(0,4) : "n.d.";
                    inText = `(${auth}, ${yr})`;
                }
                insertContent = " " + inText;
            }
            resultText = resultText.substring(0, item.insertIndex) + insertContent + resultText.substring(item.insertIndex);
        });

        // 4. Build Footer
        let footer = "";
        
        if (outputType === 'footnotes') {
            footer += "\n\n### Footnotes (Used)\n" + footnotesList.join('\n\n');
        } else {
            footer += "\n\n### References Cited (Used)\n";
            sources.forEach(s => {
                if (usedSourceIds.has(s.id)) {
                    let cit = formattedMap[s.id] || this.generateFallback(s);
                    footer += this.ensureAccessDate(cit) + "\n\n";
                }
            });
        }

        if (usedSourceIds.size < sources.length) {
            footer += "\n\n### Further Reading (Unused)\n";
            sources.forEach(s => {
                if (!usedSourceIds.has(s.id)) {
                    let cit = formattedMap[s.id] || this.generateFallback(s);
                    footer += this.ensureAccessDate(cit) + "\n\n";
                }
            });
        }

        return resultText + footer;
    }
};

// ==========================================================================
// MAIN HANDLER
// ==========================================================================
export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        const { context, style, outputType, apiKey, googleKey, preLoadedSources } = req.body;
        const GROQ_KEY = apiKey || process.env.GROQ_API_KEY;
        const SEARCH_KEY = googleKey || process.env.GOOGLE_SEARCH_API_KEY;
        const SEARCH_CX = process.env.SEARCH_ENGINE_ID;

        // 1. QUOTES
        if (preLoadedSources?.length > 0) {
            const prompt = FormatService.buildPrompt('quotes', null, context, preLoadedSources);
            const result = await GroqAPI.chat([{ role: "user", content: prompt }], GROQ_KEY, false);
            return res.status(200).json({ success: true, text: result });
        }

        // 2. SEARCH & SCRAPE
        const rawSources = await GoogleSearchAPI.search(context, SEARCH_KEY, SEARCH_CX);
        const richSources = await ScraperAPI.scrape(rawSources);
        
        // 3. GENERATE
        const prompt = FormatService.buildPrompt(outputType, style, context, richSources);
        const isJson = outputType !== 'bibliography';
        
        const aiResponse = await GroqAPI.chat([{ role: "user", content: prompt }], GROQ_KEY, isJson);

        let finalOutput = aiResponse;

        if (outputType === 'bibliography') {
            finalOutput = aiResponse.replace(/```json/g, '').replace(/```/g, '').trim();
        } 
        else {
            try {
                const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
                const jsonStr = jsonMatch ? jsonMatch[0] : aiResponse;
                const data = JSON.parse(jsonStr);
                finalOutput = PipelineService.processInsertions(context, data.insertions, richSources, data.formatted_citations, outputType);
            } catch (e) {
                finalOutput = aiResponse.replace(/```json/g, '').replace(/```/g, '');
            }
        }

        return res.status(200).json({ success: true, sources: richSources, text: finalOutput });

    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
}
