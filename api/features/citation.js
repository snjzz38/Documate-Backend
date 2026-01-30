import { GoogleSearchAPI } from '../utils/googleSearch.js';
import { ScraperAPI } from '../utils/scraper.js';
import { GroqAPI } from '../utils/groqAPI.js';

// ==========================================================================
// 1. SEARCH SERVICE
// ==========================================================================
const SearchService = {
    async performSmartSearch(text, apiKey, cx) {
        return await GoogleSearchAPI.search(text, apiKey, cx);
    }
};

// ==========================================================================
// 2. SCRAPE SERVICE
// ==========================================================================
const ScrapeService = {
    async getRichData(sources) {
        return await ScraperAPI.scrape(sources);
    }
};

// ==========================================================================
// 3. FORMAT SERVICE (The Brain)
// ==========================================================================
const FormatService = {
    buildPrompt(type, style, context, sources) {
        const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
        
        // Build efficient context string
        const sourceContext = sources.map(s => 
            `[ID:${s.id}] TITLE: ${s.title}
             URL: ${s.link}
             META_AUTHOR: ${s.meta.author} | META_DATE: ${s.meta.published}
             TEXT_CONTENT: ${s.content.replace(/\n/g, ' ')}`
        ).join('\n\n');

        // --- QUOTES PROMPT ---
        if (type === 'quotes') {
            return `
                TASK: Extract quotes. CONTEXT: "${context.substring(0, 300)}..."
                SOURCES:\n${sourceContext}
                RULES: Output strictly in order ID 1 to ${sources.length}. Format: **[ID] Title** - URL \n > "Quote..."
            `;
        }

        // --- CITATION PROMPT ---
        return `
            TASK: Insert citations into the text.
            STYLE: ${style} (Prefer Footnotes/Chicago)
            
            SOURCE DATA:
            ${sourceContext}
            
            TEXT: "${context}"
            
            METADATA INSTRUCTIONS:
            1. **Look at the TEXT_CONTENT**. Even if META_AUTHOR is "Unknown", the text often starts with "By [Name]" or dates. USE THAT.
            2. If no author found, use the Publisher/Site Name.
            3. Do not use "Unknown" if you can infer the publisher (e.g. Brookings, Deloitte).
            
            OUTPUT RULES:
            1. Cite EVERY factual claim using source IDs.
            2. "formatted_citations": Dictionary Key=SourceID, Value=Full Bibliographic Entry.
            3. **MANDATORY**: End every citation with "URL (Accessed ${today})".
            4. **STRICT JSON**: Return ONLY valid JSON.
            
            JSON STRUCTURE:
            {
              "insertions": [
                { "anchor": "phrase from text", "source_id": 1, "citation_text": "(Smith)" }
              ],
              "formatted_citations": { "1": "Smith. Title. Publisher. URL (Accessed ${today})" }
            }
        `;
    }
};

// ==========================================================================
// 4. PIPELINE SERVICE (Text Processor)
// ==========================================================================
const PipelineService = {
    ensureAccessDate(text) {
        if (!text) return "";
        const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
        if (text.includes("Accessed")) return text;
        return `${text} (Accessed ${today})`;
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
            
            let citString = formattedMap[source.id] || `${source.title}. ${source.link}`;
            citString = this.ensureAccessDate(citString);

            let insertContent = "";
            if (outputType === 'footnotes') {
                const s = { '0':'⁰','1':'¹','2':'²','3':'³','4':'⁴','5':'⁵','6':'⁶','7':'⁷','8':'⁸','9':'⁹' };
                const numStr = footnoteCounter.toString();
                insertContent = numStr.split('').map(d => s[d]||'').join('');
                // Allow duplicates in Footnotes list
                footnotesList.push(`${footnoteCounter}. ${citString}`);
                footnoteCounter++;
            } else {
                insertContent = " " + (item.citation_text || `(${source.title})`);
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
                    let cit = formattedMap[s.id] || `${s.title}. ${s.link}`;
                    footer += this.ensureAccessDate(cit) + "\n\n";
                }
            });
        }

        if (usedSourceIds.size < sources.length) {
            footer += "\n\n### Further Reading (Unused)\n";
            sources.forEach(s => {
                if (!usedSourceIds.has(s.id)) {
                    let cit = formattedMap[s.id] || `${s.title}. ${s.link}`;
                    footer += this.ensureAccessDate(cit) + "\n\n";
                }
            });
        }

        return resultText + footer;
    }
};

// ==========================================================================
// MAIN HANDLER (The Router)
// ==========================================================================
export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        const { context, style, outputType, apiKey, googleKey, preLoadedSources } = req.body;
        const GROQ_KEY = apiKey || process.env.GROQ_API_KEY;
        const SEARCH_KEY = googleKey || process.env.GOOGLE_SEARCH_API_KEY;
        const SEARCH_CX = process.env.SEARCH_ENGINE_ID;

        // --- BRANCH A: QUOTES ---
        if (preLoadedSources?.length > 0) {
            const prompt = FormatService.buildPrompt('quotes', null, context, preLoadedSources);
            const result = await GroqAPI.chat([{ role: "user", content: prompt }], GROQ_KEY, false);
            return res.status(200).json({ success: true, text: result });
        }

        // --- BRANCH B: CITATION PIPELINE ---
        
        // 1. Search (10 Sources)
        const rawSources = await SearchService.performSmartSearch(context, SEARCH_KEY, SEARCH_CX);
        
        // 2. Scrape (Smart Chunking)
        const richSources = await ScrapeService.getRichData(rawSources);
        
        // 3. Format (AI)
        const prompt = FormatService.buildPrompt(outputType, style, context, richSources);
        const isJson = outputType !== 'bibliography';
        const aiResponse = await GroqAPI.chat([{ role: "user", content: prompt }], GROQ_KEY, isJson);

        let finalOutput = aiResponse;

        // 4. Pipeline Process
        if (isJson) {
            try {
                const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
                const jsonStr = jsonMatch ? jsonMatch[0] : aiResponse;
                const data = JSON.parse(jsonStr);
                finalOutput = PipelineService.processInsertions(context, data.insertions, richSources, data.formatted_citations, outputType);
            } catch (e) {
                finalOutput = aiResponse.replace(/```json/g, '').replace(/```/g, '');
            }
        } else {
            finalOutput = aiResponse.replace(/```json/g, '').replace(/```/g, '').trim();
        }

        return res.status(200).json({ success: true, sources: richSources, text: finalOutput });

    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
}
