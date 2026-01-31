// api/features/citation.js
import { GoogleSearchAPI } from '../utils/googleSearch.js';
import { ScraperAPI } from '../utils/scraper.js';
import { GroqAPI } from '../utils/groqAPI.js';
import { CitationPrompts } from '../utils/prompts.js'; // <--- NEW IMPORT

// ==========================================================================
// PIPELINE SERVICE (Logic & Processing)
// ==========================================================================
const PipelineService = {
    ensureAccessDate(text) {
        if (!text) return "";
        const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
        if (text.includes("Accessed")) return text;
        return `${text} (Accessed ${today})`;
    },

    // Fallback Generator (Same as before)
    generateFallback(source) {
        const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
        let author = source.meta.author;
        if (!author || author === "Unknown") author = source.meta.siteName || "Unknown Source";
        let date = source.meta.published || "n.d.";
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

        // 2. Sort Insertions (Descending)
        const validInsertions = (insertions || [])
            .map(item => {
                if (!item.anchor || !item.source_id) return null;
                const anchorWords = item.anchor.toLowerCase().match(/[a-z0-9]+/g);
                if (!anchorWords) return null;
                
                let bestIndex = -1;
                // Sliding window search
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
            
            let citString = formattedMap[source.id] || this.generateFallback(source);
            citString = this.ensureAccessDate(citString);

            let insertContent = "";
            if (outputType === 'footnotes') {
                const s = {'0':'⁰','1':'¹','2':'²','3':'³','4':'⁴','5':'⁵','6':'⁶','7':'⁷','8':'⁸','9':'⁹'};
                const numStr = footnoteCounter.toString();
                insertContent = numStr.split('').map(d => s[d]||'').join('');
                
                footnotesList.push(`${footnoteCounter}. ${citString}`);
                footnoteCounter++;
            } else {
                // In-Text Logic
                let inText = item.citation_text;
                // Basic validation: ensure it has parens and isn't empty
                if (!inText || inText.length < 3 || !inText.startsWith('(')) {
                     const auth = source.meta.author !== "Unknown" ? source.meta.author.split(' ')[0] : "Source";
                     const yr = source.meta.published !== "n.d." ? source.meta.published.substring(0,4) : "n.d.";
                     inText = `(${auth} ${yr})`;
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
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        const { context, style, outputType, apiKey, googleKey, preLoadedSources } = req.body;
        const GROQ_KEY = apiKey || process.env.GROQ_API_KEY;
        const SEARCH_KEY = googleKey || process.env.GOOGLE_SEARCH_API_KEY;
        const SEARCH_CX = process.env.SEARCH_ENGINE_ID;
        const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

        // 1. QUOTES
        if (preLoadedSources?.length > 0) {
            const prompt = CitationPrompts.buildQuotes(context, preLoadedSources);
            const result = await GroqAPI.chat([{ role: "user", content: prompt }], GROQ_KEY, false);
            return res.status(200).json({ success: true, text: result });
        }

        // 2. SEARCH & SCRAPE
        const rawSources = await GoogleSearchAPI.search(context, SEARCH_KEY, SEARCH_CX);
        const richSources = await ScraperAPI.scrape(rawSources);
        
        // 3. GENERATE (Using Modular Prompts)
        let prompt;
        const isJson = outputType !== 'bibliography';

        if (outputType === 'bibliography') {
            prompt = CitationPrompts.buildBibliography(style, richSources, today);
        } else {
            prompt = CitationPrompts.buildInsertion(style, context, richSources, today);
        }
        
        const aiResponse = await GroqAPI.chat([{ role: "user", content: prompt }], GROQ_KEY, isJson);

        let finalOutput = aiResponse;

        if (outputType === 'bibliography') {
            finalOutput = aiResponse.replace(/```json/g, '').replace(/```/g, '').trim();
        } 
        else {
            try {
                // ROBUST JSON EXTRACTION (The Fix for "Unrefined JSON")
                // 1. Find the first '{'
                const firstBrace = aiResponse.indexOf('{');
                // 2. Find the last '}'
                const lastBrace = aiResponse.lastIndexOf('}');
                
                if (firstBrace !== -1 && lastBrace !== -1) {
                    const jsonStr = aiResponse.substring(firstBrace, lastBrace + 1);
                    const data = JSON.parse(jsonStr);
                    
                    // Run the pipeline
                    finalOutput = PipelineService.processInsertions(context, data.insertions, richSources, data.formatted_citations, outputType);
                } else {
                    throw new Error("No JSON found in response");
                }
            } catch (e) {
                console.error("JSON Pipeline Failed:", e);
                // Last ditch fallback: Just return the raw text cleaned up
                finalOutput = aiResponse.replace(/```json/g, '').replace(/```/g, '');
            }
        }

        return res.status(200).json({ success: true, sources: richSources, text: finalOutput });

    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
}
