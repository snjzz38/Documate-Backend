// api/features/citation.js
import { GoogleSearch } from '../utils/googleSearch.js'; // Note the ..
import { ScraperAPI } from '../utils/scraper.js';       // Note the ..
import { GroqAPI } from '../utils/groqAPI.js';          // Note the ..

// Helper: Prompt Construction
const PromptBuilder = {
    build(type, style, context, sources) {
        const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
        const srcData = JSON.stringify(sources);

        if (type === 'quotes') {
            return `TASK: Extract Quotes. CONTEXT: "${context.substring(0, 300)}..." DATA: ${srcData} RULES: Output strictly in order ID 1 to 10. Format: **[ID] Title** - URL \n > "Quote..."`;
        }

        // Citations
        return `
            TASK: Insert citations into text.
            STYLE: ${style}
            SOURCE DATA: ${srcData}
            TEXT: "${context}"
            
            INSTRUCTIONS:
            1. Cite EVERY sentence with factual claims.
            2. "formatted_citations": Key=SourceID, Value=Full Citation String.
            3. CRITICAL: End every "formatted_citation" value with "(Accessed ${today})".
            4. Include URL in citations.
            
            RETURN JSON ONLY:
            {
              "insertions": [{ "anchor": "phrase", "source_id": 1, "citation_text": "(Smith, 2024)" }],
              "formatted_citations": { "1": "Smith. Title. URL. (Accessed ${today})" }
            }
        `;
    }
};

const TextProcessor = {
    merge(context, insertions, sources, formattedMap, outputType) {
        let resultText = context;
        let footnoteCounter = 1;
        let usedSourceIds = new Set();
        
        // Tokenizer for fuzzy match
        const tokens = [];
        const tokenRegex = /[a-z0-9]+/gi;
        let match;
        while ((match = tokenRegex.exec(context)) !== null) {
            tokens.push({ word: match[0].toLowerCase(), start: match.index, end: match.index + match[0].length });
        }

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

        validInsertions.forEach(item => {
            const source = sources.find(s => s.id === item.source_id);
            if (!source) return;
            usedSourceIds.add(source.id);
            
            let insertContent = outputType === 'footnotes' 
                ? (() => { const s = { '0':'⁰','1':'¹','2':'²','3':'³','4':'⁴','5':'⁵','6':'⁶','7':'⁷','8':'⁸','9':'⁹' }; const n = footnoteCounter.toString().split('').map(d => s[d]||'').join(''); footnoteCounter++; return n; })() 
                : " " + (item.citation_text || `(${source.id})`);
            
            resultText = resultText.substring(0, item.insertIndex) + insertContent + resultText.substring(item.insertIndex);
        });

        let usedSection = outputType === 'footnotes' ? "\n\n### References Cited\n" : "\n\n### Works Cited\n";
        let unusedSection = "\n\n### Further Reading\n";

        sources.forEach(s => {
            const cit = formattedMap[s.id] || `${s.title}. ${s.link} (Accessed Today)`;
            if (usedSourceIds.has(s.id)) usedSection += `${cit}\n\n`;
            else unusedSection += `${cit}\n\n`;
        });

        return resultText + usedSection + (usedSourceIds.size < sources.length ? unusedSection : "");
    }
};

// =============================================================================
// MAIN HANDLER
// =============================================================================
export default async function handler(req, res) {
    // 1. CRITICAL: Handle CORS Preflight First
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    try {
        if (req.method !== 'POST') throw new Error("Method not allowed");

        const { context, style, outputType, apiKey, googleKey, preLoadedSources } = req.body;
        
        // Environment Variables
        const GROQ_KEY = apiKey || process.env.GROQ_API_KEY;
        const SEARCH_KEY = googleKey || process.env.GOOGLE_SEARCH_API_KEY;
        const SEARCH_CX = process.env.SEARCH_ENGINE_ID;

        // --- Branch 1: Quotes (Cached Sources) ---
        if (preLoadedSources && preLoadedSources.length > 0) {
            const prompt = PromptBuilder.build('quotes', null, context, preLoadedSources);
            // Uses Groq Rotation automatically
            const result = await GroqAPI.chat([{ role: "user", content: prompt }], GROQ_KEY, false);
            return res.status(200).json({ success: true, text: result });
        }

        // --- Branch 2: Citations (Full Search) ---
        if (!SEARCH_KEY || !SEARCH_CX) throw new Error("Missing Google Search Config (Key or CX)");
        
        // 1. Search
        const rawSources = await GoogleSearch.search(context, SEARCH_KEY, SEARCH_CX);
        if (!rawSources.length) throw new Error("No academic sources found.");

        // 2. Scrape
        const richSources = await ScrapeAPI.scrape(rawSources);

        // 3. Reason (with Groq Rotation)
        const prompt = PromptBuilder.build(outputType, style, context, richSources);
        const isJson = outputType !== 'bibliography';
        
        const aiResponse = await GroqAPI.chat([{ role: "user", content: prompt }], GROQ_KEY, isJson);

        // 4. Format
        let finalOutput = aiResponse;
        if (isJson) {
            try {
                const data = JSON.parse(aiResponse);
                finalOutput = TextProcessor.merge(context, data.insertions, richSources, data.formatted_citations, outputType);
            } catch (e) {
                // Fallback to raw text if JSON parses fail
                console.warn("JSON Parse failed, returning raw");
            }
        }

        return res.status(200).json({ success: true, sources: richSources, text: finalOutput });

    } catch (error) {
        console.error("Feature Error:", error);
        return res.status(500).json({ success: false, error: error.message });
    }
}
