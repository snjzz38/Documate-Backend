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
        
        // CRITICAL FIX: Increased substring to 1000 chars. 
        // Brookings/News sites often put the date in the first 2 paragraphs.
        // The AI needs to see this text to extract the date if metadata fails.
        const sourceContext = sources.map(s => 
            `[ID:${s.id}] 
             TITLE: ${s.title}
             URL: ${s.link}
             META_AUTHOR: ${s.meta.author} 
             META_DATE: ${s.meta.published}
             TEXT_CONTENT: ${s.content.substring(0, 1000).replace(/\n/g, ' ')}...`
        ).join('\n\n');

        // --- 1. QUOTES ---
        if (type === 'quotes') {
            return `
                TASK: Extract quotes. CONTEXT: "${context.substring(0, 300)}..."
                SOURCES:\n${sourceContext}
                RULES: Output strictly in order ID 1 to ${sources.length}. Format: **[ID] Title** - URL \n > "Quote..."
            `;
        }

        // --- 2. CITATIONS ---
        
        // STRICT STYLE TEMPLATES (Fixes the MLA/Chicago mixing)
        let styleInstructions = "";
        if (style.toLowerCase().includes("chicago")) {
            styleInstructions = `
                STYLE: Chicago (Notes & Bibliography).
                FORMAT: Author First Last. "Title." Publisher, Date. URL.
                IN-TEXT: (Author, Year).
            `;
        } else if (style.toLowerCase().includes("mla")) {
            styleInstructions = `
                STYLE: MLA 9th Edition.
                FORMAT: Author Last, First. "Title." *Container*, Date, URL.
                IN-TEXT: (Author, Year).
            `;
        } else {
            styleInstructions = `STYLE: APA 7th Edition. Format: Author. (Year). Title. URL.`;
        }

        return `
            TASK: Insert citations into the text.
            ${styleInstructions}
            
            SOURCE DATA:
            ${sourceContext}
            
            TEXT: "${context}"
            
            CRITICAL METADATA RULES (TEXT FORENSICS):
            1. **IGNORE "n.d."**: If the "TEXT_CONTENT" contains a date (e.g., "April 24, 2018" or "Jan 2025"), USE THAT YEAR.
            2. **FIND THE AUTHOR**: If "META_AUTHOR" is an Organization (e.g. "Brookings", "Microsoft"), look at "TEXT_CONTENT". 
               - If it says "By Darrell M. West", the author is "West, Darrell M."
               - If it says "Written by John Doe", the author is "Doe, John".
            
            OUTPUT RULES:
            1. **Cite Every Claim**: Insert citations [1], [2] etc.
            2. **Full Bibliography**: In "formatted_citations", provide the COMPLETE entry.
            3. **Access Date**: MANDATORY. End every citation with "URL (Accessed ${today})".
            4. **Strict JSON**: Return ONLY valid JSON.
            
            JSON STRUCTURE:
            {
              "insertions": [
                { "anchor": "phrase from text", "source_id": 1, "citation_text": "(West, 2018)" }
              ],
              "formatted_citations": { "1": "West, Darrell M. \"How AI transforms the world.\" Brookings, 2018. https://brookings.edu... (Accessed ${today})" }
            }
        `;
    }
};

// ==========================================================================
// MODULE: PIPELINE SERVICE (Processing & Fallbacks)
// ==========================================================================
const PipelineService = {
    ensureAccessDate(text) {
        if (!text) return "";
        const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
        if (text.includes("Accessed")) return text;
        return `${text} (Accessed ${today})`;
    },

    // Generates a clean fallback citation if AI fails
    generateFallback(source) {
        const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
        
        let author = source.meta.author;
        // Logic: If author is "Unknown" or looks like a filename, try Site Name
        if (!author || author === "Unknown" || author.includes(".com")) {
            author = source.meta.siteName || "Unknown Source";
        }
        
        let date = source.meta.published;
        if (!date || date === "n.d.") date = "n.d.";

        return `${author}. (${date}). "${source.title}". ${source.link} (Accessed ${today})`;
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

        // 2. Map Insertions
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
            
            // Get citation string (AI provided OR Programmatic Fallback)
            let citationString = formattedMap[source.id];
            
            // Validity Check: If AI gave a junk citation, use fallback
            if (!citationString || citationString.length < 10 || citationString.includes("Unknown")) {
                citationString = this.generateFallback(source);
            }
            citationString = this.ensureAccessDate(citationString);

            let insertContent = "";
            if (outputType === 'footnotes') {
                const s = { '0':'⁰','1':'¹','2':'²','3':'³','4':'⁴','5':'⁵','6':'⁶','7':'⁷','8':'⁸','9':'⁹' };
                const numStr = footnoteCounter.toString();
                insertContent = numStr.split('').map(d => s[d]||'').join('');
                
                footnotesList.push(`${footnoteCounter}. ${citationString}`);
                footnoteCounter++;
            } else {
                // In-Text Logic: Use AI text or fallback to (Author, Year)
                let inText = item.citation_text;
                if (!inText || !inText.match(/\d{4}/)) { // If no year found
                     const auth = source.meta.author !== "Unknown" ? source.meta.author.split(' ')[0] : source.meta.siteName;
                     const yr = source.meta.published !== "n.d." ? source.meta.published.substring(0,4) : "n.d.";
                     inText = `(${auth}, ${yr})`;
                }
                insertContent = " " + inText;
            }
            resultText = resultText.substring(0, item.insertIndex) + insertContent + resultText.substring(item.insertIndex);
        });

        // 4. Build Footer (Used -> Unused)
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

        // Unused Sources
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
