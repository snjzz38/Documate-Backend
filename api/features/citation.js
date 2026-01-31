// api/features/citation.js
import { GoogleSearchAPI } from '../utils/googleSearch.js';
import { ScraperAPI } from '../utils/scraper.js';
import { GroqAPI } from '../utils/groqAPI.js';
import { CitationPrompts } from '../utils/prompts.js';

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

    // Superscript converter for footnotes
    toSuperscript(num) {
        const superscriptMap = {
            '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴',
            '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹'
        };
        return num.toString().split('').map(d => superscriptMap[d] || d).join('');
    },

    processInsertions(context, insertions, sources, formattedMap, outputType) {
        let resultText = context;
        let footnoteCounter = 1;
        let usedSourceIds = new Set();
        let footnotesList = [];
        
        // Track which sources have been used and how many times (for footnotes)
        let sourceUsageMap = new Map(); // source_id -> array of footnote numbers

        // 1. Tokenize Text for anchor matching
        const tokens = [];
        const tokenRegex = /[a-z0-9]+/gi;
        let match;
        while ((match = tokenRegex.exec(context)) !== null) {
            tokens.push({ 
                word: match[0].toLowerCase(), 
                start: match.index, 
                end: match.index + match[0].length 
            });
        }

        // 2. Process and validate all insertions
        const validInsertions = (insertions || [])
            .map(item => {
                if (!item.anchor || !item.source_id) return null;
                
                const anchorWords = item.anchor.toLowerCase().match(/[a-z0-9]+/g);
                if (!anchorWords || anchorWords.length === 0) return null;
                
                // Sliding window search for anchor phrase
                let bestIndex = -1;
                for (let i = 0; i <= tokens.length - anchorWords.length; i++) {
                    let matchFound = true;
                    for (let j = 0; j < anchorWords.length; j++) {
                        if (tokens[i + j].word !== anchorWords[j]) { 
                            matchFound = false; 
                            break; 
                        }
                    }
                    if (matchFound) { 
                        bestIndex = tokens[i + anchorWords.length - 1].end; 
                        break; 
                    }
                }
                
                return bestIndex !== -1 ? { ...item, insertIndex: bestIndex } : null;
            })
            .filter(Boolean)
            // Sort by position descending (insert from end to preserve indices)
            .sort((a, b) => b.insertIndex - a.insertIndex);

        // 3. Apply Insertions
        validInsertions.forEach(item => {
            const source = sources.find(s => s.id === item.source_id);
            if (!source) return;
            
            usedSourceIds.add(source.id);
            
            // Get formatted citation for this source
            let citString = formattedMap[source.id] || this.generateFallback(source);
            citString = this.ensureAccessDate(citString);

            let insertContent = "";
            
            if (outputType === 'footnotes') {
                // FOOTNOTES: Each insertion gets a unique number, even for same source
                const currentFootnote = footnoteCounter;
                insertContent = this.toSuperscript(currentFootnote);
                
                // Track this footnote for the source
                if (!sourceUsageMap.has(source.id)) {
                    sourceUsageMap.set(source.id, []);
                }
                sourceUsageMap.get(source.id).push(currentFootnote);
                
                // Add to footnotes list with unique number
                footnotesList.push({
                    number: currentFootnote,
                    sourceId: source.id,
                    citation: citString
                });
                
                footnoteCounter++;
            } else {
                // IN-TEXT: Use the citation text from AI or generate fallback
                let inText = item.citation_text;
                
                // Validate citation format
                if (!inText || inText.length < 3 || !inText.startsWith('(')) {
                    const auth = source.meta.author !== "Unknown" 
                        ? source.meta.author.split(' ')[0] 
                        : (source.meta.siteName || "Source");
                    const yr = source.meta.year || 
                        (source.meta.published !== "n.d." ? source.meta.published.substring(0, 4) : "n.d.");
                    inText = `(${auth}, ${yr})`;
                }
                insertContent = " " + inText;
            }
            
            resultText = resultText.substring(0, item.insertIndex) + insertContent + resultText.substring(item.insertIndex);
        });

        // 4. Build Footer
        let footer = "";
        
        if (outputType === 'footnotes') {
            // FOOTNOTES: List each footnote with its number (duplicates allowed)
            footer += "\n\n---\n\n### Footnotes\n\n";
            
            // Sort footnotes by number and display
            footnotesList.sort((a, b) => a.number - b.number);
            footnotesList.forEach(fn => {
                footer += `${fn.number}. ${fn.citation}\n\n`;
            });
            
            // Add a consolidated references section for unique sources
            footer += "\n---\n\n### References (Consolidated)\n\n";
            const uniqueSourcesUsed = [...usedSourceIds];
            uniqueSourcesUsed.forEach(sourceId => {
                const source = sources.find(s => s.id === sourceId);
                if (source) {
                    let cit = formattedMap[sourceId] || this.generateFallback(source);
                    const footnoteNums = sourceUsageMap.get(sourceId) || [];
                    const footnotesStr = footnoteNums.length > 0 
                        ? ` [Cited in footnotes: ${footnoteNums.join(', ')}]` 
                        : '';
                    footer += this.ensureAccessDate(cit) + footnotesStr + "\n\n";
                }
            });
            
        } else {
            // IN-TEXT: Standard references cited section
            footer += "\n\n---\n\n### References Cited\n\n";
            sources.forEach(s => {
                if (usedSourceIds.has(s.id)) {
                    let cit = formattedMap[s.id] || this.generateFallback(s);
                    footer += this.ensureAccessDate(cit) + "\n\n";
                }
            });
        }

        // Unused Sources (should be minimal with improved prompts)
        const unusedSources = sources.filter(s => !usedSourceIds.has(s.id));
        if (unusedSources.length > 0) {
            footer += "\n---\n\n### Further Reading (Unused)\n\n";
            unusedSources.forEach(s => {
                let cit = formattedMap[s.id] || this.generateFallback(s);
                footer += this.ensureAccessDate(cit) + "\n\n";
            });
        }

        // Add usage statistics
        footer += `\n---\n*Citation Statistics: ${usedSourceIds.size}/${sources.length} sources used, ${validInsertions.length} total insertions*`;

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

        // 1. QUOTES MODE
        if (preLoadedSources?.length > 0) {
            const prompt = CitationPrompts.buildQuotes(context, preLoadedSources);
            const result = await GroqAPI.chat([{ role: "user", content: prompt }], GROQ_KEY, false);
            return res.status(200).json({ success: true, text: result });
        }

        // 2. SEARCH & SCRAPE
        const rawSources = await GoogleSearchAPI.search(context, SEARCH_KEY, SEARCH_CX);
        const richSources = await ScraperAPI.scrape(rawSources);
        
        // 3. GENERATE (Using Modular Prompts with outputType)
        let prompt;
        const isJson = outputType !== 'bibliography';

        if (outputType === 'bibliography') {
            prompt = CitationPrompts.buildBibliography(style, richSources, today);
        } else {
            // Pass outputType to buildInsertion for footnote-specific rules
            prompt = CitationPrompts.buildInsertion(style, context, richSources, today, outputType);
        }
        
        const aiResponse = await GroqAPI.chat([{ role: "user", content: prompt }], GROQ_KEY, isJson);

        let finalOutput = aiResponse;

        if (outputType === 'bibliography') {
            finalOutput = aiResponse.replace(/```json/g, '').replace(/```/g, '').trim();
        } 
        else {
            try {
                // ROBUST JSON EXTRACTION
                const firstBrace = aiResponse.indexOf('{');
                const lastBrace = aiResponse.lastIndexOf('}');
                
                if (firstBrace !== -1 && lastBrace !== -1) {
                    const jsonStr = aiResponse.substring(firstBrace, lastBrace + 1);
                    const data = JSON.parse(jsonStr);
                    
                    // Log insertion count for debugging
                    console.log(`[Citation] Received ${data.insertions?.length || 0} insertions from AI`);
                    
                    // Run the pipeline
                    finalOutput = PipelineService.processInsertions(
                        context, 
                        data.insertions, 
                        richSources, 
                        data.formatted_citations, 
                        outputType
                    );
                } else {
                    throw new Error("No JSON found in response");
                }
            } catch (e) {
                console.error("JSON Pipeline Failed:", e);
                // Fallback: return cleaned raw text
                finalOutput = aiResponse.replace(/```json/g, '').replace(/```/g, '');
            }
        }

        return res.status(200).json({ success: true, sources: richSources, text: finalOutput });

    } catch (error) {
        console.error("Citation Handler Error:", error);
        return res.status(500).json({ success: false, error: error.message });
    }
}
