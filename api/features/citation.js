// api/citation.js
import { GoogleAPI } from './utils/googleAPI.js';
import { ScraperAPI } from './utils/scraper.js';
import { GroqAPI } from './utils/groqAPI.js';

// =============================================================================
// HELPER: PROMPT ENGINEERING (Specific to Citation)
// =============================================================================
const PromptBuilder = {
    build(type, style, context, sources) {
        const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
        const srcData = JSON.stringify(sources);

        // --- QUOTES ---
        if (type === 'quotes') {
            return `TASK: Extract Quotes. CONTEXT: "${context.substring(0, 300)}..." DATA: ${srcData} RULES: Output strictly in order ID 1 to 10. Format: **[ID] Title** - URL \n > "Quote..."`;
        }

        // --- BIBLIOGRAPHY ---
        if (type === 'bibliography') {
            return `TASK: Create Bibliography. STYLE: ${style}. DATA: ${srcData}. RULES: Include "Accessed ${today}". Return plain text list.`;
        }

        // --- CITATIONS (COMPLEX) ---
        let styleNote = "Use (Author, Date) format.";
        if (style.includes('Chicago')) styleNote = "Use Superscript numbers for footnotes.";
        
        return `
            TASK: Insert citations into text.
            STYLE: ${style} (${styleNote})
            SOURCE DATA: ${srcData}
            TEXT: "${context}"
            
            INSTRUCTIONS:
            1. Cite EVERY sentence with factual claims.
            2. "formatted_citations": Dictionary where Key=SourceID, Value=Full Citation String.
            3. CRITICAL: End every "formatted_citation" value with "(Accessed ${today})".
            4. CRITICAL: Include the URL in every citation.
            
            RETURN JSON:
            {
              "insertions": [{ "anchor": "unique 3-5 word phrase in text", "source_id": 1, "citation_text": "(Smith, 2024)" }],
              "formatted_citations": { "1": "Smith, J. (2024). Title. URL. (Accessed ${today})" }
            }
        `;
    }
};

// =============================================================================
// HELPER: TEXT PROCESSING (Specific to Citation)
// =============================================================================
const TextProcessor = {
    merge(context, insertions, sources, formattedMap, outputType) {
        let resultText = context;
        let footnoteCounter = 1;
        let usedSourceIds = new Set();

        // 1. Tokenize for Fuzzy Matching
        const tokens = [];
        const tokenRegex = /[a-z0-9]+/gi;
        let match;
        while ((match = tokenRegex.exec(context)) !== null) {
            tokens.push({ word: match[0].toLowerCase(), start: match.index, end: match.index + match[0].length });
        }

        // 2. Sort Insertions (Reverse order to avoid index drift)
        const validInsertions = (insertions || [])
            .map(item => {
                if (!item.anchor || !item.source_id) return null;
                const anchorWords = item.anchor.toLowerCase().match(/[a-z0-9]+/g);
                if (!anchorWords) return null;

                let bestIndex = -1;
                // Scan tokens for match
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

            if (outputType === 'footnotes') {
                const s = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹' };
                insertContent = footnoteCounter.toString().split('').map(d => s[d] || '').join('');
                footnoteCounter++;
            } else {
                insertContent = " " + (item.citation_text || `(${source.id})`);
            }

            resultText = resultText.substring(0, item.insertIndex) + insertContent + resultText.substring(item.insertIndex);
        });

        // 4. Build Sections (Used vs Unused)
        let usedSection = outputType === 'footnotes' ? "\n\n### References Cited\n" : "\n\n### Works Cited\n";
        let unusedSection = "\n\n### Further Reading\n";

        sources.forEach(s => {
            const citation = formattedMap[s.id] || `${s.title}. ${s.link} (Accessed Today)`;
            if (usedSourceIds.has(s.id)) {
                usedSection += `${citation}\n\n`;
            } else {
                unusedSection += `${citation}\n\n`;
            }
        });

        return resultText + usedSection + (usedSourceIds.size < sources.length ? unusedSection : "");
    }
};

// =============================================================================
// MAIN HANDLER
// =============================================================================
export default async function handler(req, res) {
    if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'POST');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        return res.status(200).end();
    }
    res.setHeader('Access-Control-Allow-Origin', '*');

    try {
        const { context, style, outputType, apiKey, googleKey, preLoadedSources } = req.body;
        
        // 1. Config Check
        const groqKey = apiKey || process.env.GROQ_API_KEY;
        const searchKey = googleKey || process.env.GOOGLE_SEARCH_API_KEY;
        const cx = process.env.SEARCH_ENGINE_ID;

        if (!groqKey) throw new Error("Missing Groq API Key");

        // 2. Logic Branching
        let sources = [];

        if (preLoadedSources && preLoadedSources.length > 0) {
            // A. Cached Mode (Quotes)
            sources = preLoadedSources;
        } else {
            // B. Search Mode (Citations)
            if (!searchKey || !cx) throw new Error("Missing Google Search Keys");
            const rawItems = await GoogleAPI.search(context, searchKey, cx);
            if (rawItems.length === 0) throw new Error("No academic sources found.");
            sources = await ScrapeAPI.scrape(rawItems);
        }

        // 3. AI Generation
        const prompt = PromptBuilder.build(outputType, style, context, sources);
        const isJson = outputType !== 'bibliography' && outputType !== 'quotes'; // Only citation needs JSON
        
        const aiResponse = await GroqAPI.chat([{ role: "user", content: prompt }], groqKey, isJson);

        // 4. Response Formatting
        let finalOutput = aiResponse;
        
        if (isJson) {
            try {
                const data = JSON.parse(aiResponse);
                finalOutput = TextProcessor.merge(context, data.insertions, sources, data.formatted_citations, outputType);
            } catch (e) {
                console.warn("JSON Parse Failed, returning raw text");
            }
        }

        return res.status(200).json({ success: true, sources: sources, text: finalOutput });

    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
}
