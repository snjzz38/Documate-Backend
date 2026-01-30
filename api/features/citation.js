import { GoogleSearchAPI } from '../utils/googleSearch.js';
import { ScraperAPI } from '../utils/scraper.js';
import { GroqAPI } from '../utils/groqAPI.js';

const PromptBuilder = {
    build(type, style, context, sources) {
        const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
        const srcData = JSON.stringify(sources);

        // --- BRANCH A: QUOTES ---
        // Explicitly asking to preserve ID mapping so it lines up with citations
        if (type === 'quotes') {
            return `
                TASK: Extract a short, relevant quote for each source.
                CONTEXT: "${context.substring(0, 300)}..."
                SOURCE DATA: ${srcData}
                
                RULES:
                1. **STRICTLY MATCH IDs**: If the source has ID 1, your output MUST start with [1].
                2. If a source has no relevant text, output "[ID] No relevant quote found."
                3. **ORDER**: Output strictly in numerical order 1 to 10.
                
                FORMAT:
                [ID] Title - URL
                > "Direct quote from text..."
            `;
        }

        // --- BRANCH B: BIBLIOGRAPHY ONLY ---
        // Changed sorting to "By ID" to ensure alignment with Quotes
        if (type === 'bibliography') {
            return `
                TASK: Create a Bibliography / Works Cited list.
                STYLE: ${style}
                SOURCE DATA: ${srcData}
                
                RULES:
                1. Include ALL sources from the provided data.
                2. **ORDERING**: Sort list by ID (Source 1, Source 2, etc.) so it matches the search order.
                3. **FORMATTING**: Format strictly according to ${style}.
                4. **ACCESS DATE**: Ensure the URL is included, followed by "(Accessed ${today})". 
                   (Do not write the word "URL", just put the actual link).
                5. **OUTPUT**: Return a clean PLAIN TEXT list. Do NOT return JSON.
            `;
        }

        // --- BRANCH C: CITATION INSERTION (JSON) ---
        return `
            TASK: Insert citations into the text.
            STYLE: ${style} (Prefer Footnotes/Chicago style)
            SOURCE DATA: ${srcData}
            TEXT: "${context}"
            
            RULES:
            1. **MANDATORY**: Cite every factual claim.
            2. If Author is missing, use the Publisher. If Date is missing, use "n.d.".
            3. **FORMATTING**: In "formatted_citations", the value MUST be the full bibliographic entry.
            4. **ACCESS DATE**: Ensure the URL is included at the end, followed by "(Accessed ${today})".
            5. **STRICT JSON**: Return ONLY the JSON object.
            
            JSON STRUCTURE:
            {
              "insertions": [
                { "anchor": "specific phrase from text", "source_id": 1, "citation_text": "(Smith, 2024)" }
              ],
              "formatted_citations": {
                "1": "Smith, John. *Title*. Publisher, 2024. https://link.com (Accessed ${today})"
              }
            }
        `;
    }
};

const TextProcessor = {
    merge(context, insertions, sources, formattedMap, outputType) {
        let resultText = context;
        let footnoteCounter = 1;
        
        // Track order of usage
        let usedSourceIds = new Set();
        let footnotesList = [];

        // 1. Tokenize for Fuzzy Matching
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
            .sort((a, b) => b.insertIndex - a.insertIndex); // Descending sort

        // 3. Apply Insertions
        validInsertions.forEach(item => {
            const source = sources.find(s => s.id === item.source_id);
            if (!source) return;
            
            // Add to Used Set (keeps insertion order for tracking, though Set doesn't guarantee order, we handle list below)
            usedSourceIds.add(source.id);
            
            let insertContent = "";
            // Use AI formatted string, or fallback to Title + Link
            const citationString = formattedMap[source.id] || `${source.title}. ${source.link}`;

            if (outputType === 'footnotes') {
                const s = { '0':'⁰','1':'¹','2':'²','3':'³','4':'⁴','5':'⁵','6':'⁶','7':'⁷','8':'⁸','9':'⁹' };
                const numStr = footnoteCounter.toString();
                insertContent = numStr.split('').map(d => s[d]||'').join('');
                
                // Add to footnote list in order of appearance
                footnotesList.push(`${footnoteCounter}. ${citationString}`);
                footnoteCounter++;
            } else {
                insertContent = " " + (item.citation_text || `(${source.title})`);
            }
            resultText = resultText.substring(0, item.insertIndex) + insertContent + resultText.substring(item.insertIndex);
        });

        // 4. Build Footer (Used Order -> Unused Order)
        let footer = "";
        
        if (outputType === 'footnotes') {
            footer += "\n\n### Footnotes (Used)\n" + footnotesList.join('\n\n');
        } else {
            footer += "\n\n### References Cited (Used)\n";
            // For in-text, list them in ID order OR appearance order. 
            // We iterate through SOURCES (1..10) and check if used.
            // If you want strict "Appearance Order", we would need a different logic, 
            // but standard is usually Alphabetical or ID based. 
            // Here we list Used IDs first (in numerical order 1..10) then Unused.
            sources.forEach(s => {
                if (usedSourceIds.has(s.id)) {
                    footer += (formattedMap[s.id] || s.link) + "\n\n";
                }
            });
        }

        // 5. Unused Sources (Further Reading)
        if (usedSourceIds.size < sources.length) {
            footer += "\n\n### Further Reading (Unused)\n";
            sources.forEach(s => {
                if (!usedSourceIds.has(s.id)) {
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

        // --- QUOTES MODE ---
        if (preLoadedSources?.length > 0) {
            const prompt = PromptBuilder.build('quotes', null, context, preLoadedSources);
            const result = await GroqAPI.chat([{ role: "user", content: prompt }], GROQ_KEY, false);
            return res.status(200).json({ success: true, text: result });
        }

        // --- CITATION MODE ---
        const rawSources = await GoogleSearchAPI.search(context, SEARCH_KEY, SEARCH_CX);
        const richSources = await ScraperAPI.scrape(rawSources);
        
        const prompt = PromptBuilder.build(outputType, style, context, richSources);
        
        // Only use JSON mode if we need to parse Insertions
        const isJson = (outputType !== 'bibliography');
        
        const aiResponse = await GroqAPI.chat([{ role: "user", content: prompt }], GROQ_KEY, isJson);

        let finalOutput = aiResponse;

        if (outputType === 'bibliography') {
            // Clean up Markdown if present
            finalOutput = aiResponse.replace(/```json/g, '').replace(/```/g, '').trim();
        } 
        else {
            try {
                const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
                const jsonStr = jsonMatch ? jsonMatch[0] : aiResponse;
                const data = JSON.parse(jsonStr);
                finalOutput = TextProcessor.merge(context, data.insertions, richSources, data.formatted_citations, outputType);
            } catch (e) {
                console.error("JSON Parse Error", e);
                // Fallback: Return raw text
                finalOutput = aiResponse.replace(/```json/g, '').replace(/```/g, '');
            }
        }

        return res.status(200).json({ success: true, sources: richSources, text: finalOutput });

    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
}
