// api/features/citation.js
import { GoogleSearchAPI } from '../utils/googleSearch.js';
import { ScraperAPI } from '../utils/scraper.js';
import { GroqAPI } from '../utils/groqAPI.js';

const PromptBuilder = {
    build(type, style, context, sources) {
        const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
        const srcData = JSON.stringify(sources);

        // --- BRANCH A: QUOTES ---
        if (type === 'quotes') {
            return `TASK: Extract Quotes. CONTEXT: "${context.substring(0, 300)}..." DATA: ${srcData} RULES: Output strictly in order ID 1 to 10. Format: **[ID] Title** - URL \n > "Quote..."`;
        }

        // --- BRANCH B: BIBLIOGRAPHY ONLY (Plain Text) ---
        if (type === 'bibliography') {
            return `
                TASK: Create a Bibliography / Works Cited page.
                STYLE: ${style}
                SOURCE DATA: ${srcData}
                
                RULES:
                1. Include ALL sources from the provided data.
                2. Sort alphabetically by author/title.
                3. Format strictly according to ${style}.
                4. **MANDATORY**: End every entry with: "URL (Accessed ${today})".
                5. **OUTPUT**: Return a clean PLAIN TEXT list. Do NOT return JSON. Do NOT use markdown code blocks.
            `;
        }

        // --- BRANCH C: CITATION INSERTION (Strict JSON) ---
        return `
            TASK: Insert citations into the text.
            STYLE: ${style} (Prefer Footnotes/Chicago style)
            SOURCE DATA: ${srcData}
            TEXT: "${context}"
            
            RULES:
            1. **MANDATORY**: Cite every factual claim.
            2. If Author is missing, use the Publisher. If Date is missing, use "n.d.".
            3. **FORMATTING**: In "formatted_citations", the value MUST be the full bibliographic entry ending with "URL (Accessed ${today})".
            4. **STRICT JSON**: Do not include markdown \`\`\`json tags. Return ONLY the JSON object.
            
            JSON STRUCTURE:
            {
              "insertions": [
                { "anchor": "specific phrase from text", "source_id": 1, "citation_text": "(Smith, 2024)" }
              ],
              "formatted_citations": {
                "1": "Smith, John. *Title*. Publisher, 2024. https://example.com (Accessed ${today})"
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

        // 1. Tokenize
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
            
            let insertContent = "";
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

        // 4. Build Footer
        let footer = "";
        
        if (outputType === 'footnotes') {
            footer += "\n\n### Footnotes\n" + footnotesList.join('\n\n');
        } else {
            footer += "\n\n### Works Cited\n";
            sources.forEach(s => {
                if (usedSourceIds.has(s.id)) {
                    footer += (formattedMap[s.id] || s.link) + "\n\n";
                }
            });
        }

        if (usedSourceIds.size < sources.length) {
            footer += "\n\n### Further Reading\n";
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

        // --- 1. QUOTES MODE ---
        if (preLoadedSources?.length > 0) {
            const prompt = PromptBuilder.build('quotes', null, context, preLoadedSources);
            const result = await GroqAPI.chat([{ role: "user", content: prompt }], GROQ_KEY, false);
            return res.status(200).json({ success: true, text: result });
        }

        // --- 2. SEARCH & SCRAPE ---
        const rawSources = await GoogleSearchAPI.search(context, SEARCH_KEY, SEARCH_CX);
        const richSources = await ScraperAPI.scrape(rawSources);
        
        // --- 3. GENERATE ---
        const prompt = PromptBuilder.build(outputType, style, context, richSources);
        
        // Logic: Only use JSON Mode if we are doing In-text or Footnotes
        const isJson = (outputType !== 'bibliography');
        
        const aiResponse = await GroqAPI.chat([{ role: "user", content: prompt }], GROQ_KEY, isJson);

        let finalOutput = aiResponse;

        // --- 4. FORMAT RESPONSE ---
        if (outputType === 'bibliography') {
            // Cleanup: Sometimes AI puts markdown code blocks even when asked not to
            finalOutput = aiResponse.replace(/```json/g, '').replace(/```/g, '').trim();
        } 
        else {
            // Citation Insertion Logic
            try {
                const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
                const jsonStr = jsonMatch ? jsonMatch[0] : aiResponse;
                const data = JSON.parse(jsonStr);
                finalOutput = TextProcessor.merge(context, data.insertions, richSources, data.formatted_citations, outputType);
            } catch (e) {
                console.error("JSON Parse Error", e);
                // Fallback: Just return the raw text if JSON fails
                finalOutput = aiResponse.replace(/```json/g, '').replace(/```/g, '');
            }
        }

        return res.status(200).json({ success: true, sources: richSources, text: finalOutput });

    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
}
