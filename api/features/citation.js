// api/features/citation.js
import { GoogleSearchAPI } from '../utils/googleSearch.js';
import { ScraperAPI } from '../utils/scraper.js';
import { GroqAPI } from '../utils/groqAPI.js';

const PromptBuilder = {
    build(type, style, context, sources) {
        const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
        
        // Map sources to a cleaner format for the AI to save tokens but keep context
        const sourceContext = sources.map(s => 
            `ID: ${s.id}
             META_AUTHOR: ${s.meta.author}
             META_DATE: ${s.meta.published}
             TITLE: ${s.title}
             URL: ${s.link}
             CONTENT_START: ${s.content.substring(0, 500).replace(/\n/g, ' ')}`
        ).join('\n\n');

        // --- BRANCH A: QUOTES ---
        if (type === 'quotes') {
            return `
                TASK: Extract quotes.
                CONTEXT: "${context.substring(0, 300)}..."
                SOURCES:
                ${sourceContext}
                
                RULES:
                1. Output strictly in order ID 1 to ${sources.length}.
                2. Format: **[ID] Title** - URL \n > "Quote..."
                3. If no relevant text, skip.
            `;
        }

        // --- BRANCH B: CITATIONS ---
        // Instructions for extracting metadata from raw text if meta tags failed
        const forensicInstructions = `
            CRITICAL METADATA EXTRACTION RULES:
            1. The "META_AUTHOR" field might say "Unknown". This is often WRONG.
            2. You MUST check "CONTENT_START" for bylines like "By John Doe" or "Written by...". 
            3. If you find a name in "CONTENT_START", USE IT as the author.
            4. If "META_DATE" is "n.d.", check "CONTENT_START" for a date (e.g., "April 24, 2018").
            5. If absolutely no author is found, use the Publisher/Website Name.
        `;

        let formatGuide = "";
        if (style.includes("Chicago")) {
            formatGuide = `Format: Author First Last. "Title." Publisher, Date. URL.`;
        } else if (style.includes("MLA")) {
            formatGuide = `Format: Last, First. "Title." *Publisher*, Date, URL.`;
        } else {
            formatGuide = `Format: Author. (Date). Title. Publisher. URL.`;
        }

        return `
            TASK: Insert citations into the text.
            STYLE: ${style}
            USER TEXT: "${context}"
            
            SOURCE DATA:
            ${sourceContext}
            
            ${forensicInstructions}
            
            OUTPUT RULES:
            1. **Cite Every Claim**: Insert citations [1], [2] etc. where appropriate.
            2. **Full Bibliography**: In "formatted_citations", provide the COMPLETE entry.
            3. **Formatting**: ${formatGuide}
            4. **Access Date**: Append "(Accessed ${today})" to every citation.
            5. **Strict JSON**: Return ONLY JSON.
            
            JSON STRUCTURE:
            {
              "insertions": [
                { "anchor": "3-5 words identifying sentence", "source_id": 1, "citation_text": "(Smith)" }
              ],
              "formatted_citations": {
                "1": "West, Darrell M. \"How AI transforms the world.\" Brookings, 2018. https://brookings.edu... (Accessed ${today})"
              }
            }
        `;
    }
};

const TextProcessor = {
    merge(context, insertions, sources, formattedMap, outputType) {
        let resultText = context;
        let footnoteCounter = 1;
        let usedSourceIds = new Set();
        let footnotesList = [];

        // 1. Fuzzy Match Tokenizer
        const tokens = [];
        const tokenRegex = /[a-z0-9]+/gi;
        let match;
        while ((match = tokenRegex.exec(context)) !== null) {
            tokens.push({ word: match[0].toLowerCase(), start: match.index, end: match.index + match[0].length });
        }

        // 2. Map & Sort Insertions
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
            
            let insertContent = "";
            // Fallback if AI didn't return a formatted string for this ID
            const citationString = formattedMap[source.id] || `${source.title}. ${source.link}`;

            if (outputType === 'footnotes') {
                const s = { '0':'⁰','1':'¹','2':'²','3':'³','4':'⁴','5':'⁵','6':'⁶','7':'⁷','8':'⁸','9':'⁹' };
                const numStr = footnoteCounter.toString();
                insertContent = numStr.split('').map(d => s[d]||'').join('');
                
                footnotesList.push(`${footnoteCounter}. ${citationString}`);
                footnoteCounter++;
            } else {
                insertContent = " " + (item.citation_text || `(${source.title})`);
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
                    footer += (formattedMap[s.id] || s.link) + "\n\n";
                }
            });
        }

        // Unused Sources
        if (usedSourceIds.size < sources.length) {
            footer += "\n\n### Further Reading (Unused)\n";
            sources.forEach(s => {
                if (!usedSourceIds.has(s.id)) {
                    // Use the formatted map if available (AI often formats unused sources too), else fallback
                    const cit = formattedMap[s.id] || `${s.title}. ${s.link}`;
                    footer += `${cit}\n\n`; 
                }
            });
        }

        return resultText + footer;
    }
};

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

        // --- 1. QUOTES MODE ---
        if (preLoadedSources?.length > 0) {
            const prompt = PromptBuilder.build('quotes', null, context, preLoadedSources);
            const result = await GroqAPI.chat([{ role: "user", content: prompt }], GROQ_KEY, false);
            return res.status(200).json({ success: true, text: result });
        }

        // --- 2. CITATION MODE ---
        
        // Step A: Search (Returns 10 items now)
        const rawSources = await GoogleSearchAPI.search(context, SEARCH_KEY, SEARCH_CX);
        
        // Step B: Scrape (Processes 10 items)
        // We ensure we don't crash if scraper takes too long on 10 items
        const richSources = await ScraperAPI.scrape(rawSources); 
        
        // Step C: Generate
        const prompt = PromptBuilder.build(outputType, style, context, richSources);
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
                finalOutput = TextProcessor.merge(context, data.insertions, richSources, data.formatted_citations, outputType);
            } catch (e) {
                console.warn("JSON Parse Failed, returning raw text");
                finalOutput = aiResponse.replace(/```json/g, '').replace(/```/g, '');
            }
        }

        return res.status(200).json({ success: true, sources: richSources, text: finalOutput });

    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
}
