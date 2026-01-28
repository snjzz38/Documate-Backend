import * as cheerio from 'cheerio';

// =============================================================================
// 1. CONFIGURATION & UTILS
// =============================================================================
const CONFIG = {
    // Exact blocklist from your frontend code
    BLOCKLIST_QUERY: " -filetype:pdf -site:instagram.com -site:facebook.com -site:tiktok.com -site:twitter.com -site:pinterest.com -site:reddit.com -site:quora.com -site:wikipedia.org -site:youtube.com",
    BANNED_DOMAINS: ['instagram', 'facebook', 'tiktok', 'twitter', 'x.com', 'pinterest', 'reddit', 'quora', 'youtube', 'vimeo'],
    GROQ_MODEL: "llama-3.1-70b-versatile" // High intelligence needed for citation logic
};

const getTodayDate = () => new Date().toLocaleDateString('en-US', { 
    year: 'numeric', month: 'long', day: 'numeric' 
});

// =============================================================================
// 2. SERVICES
// =============================================================================

const SearchService = {
    async perform(text, googleKey, cx) {
        // 1. Replicate Frontend Query Construction
        let q = text.split(/\s+/).slice(0, 6).join(' '); 
        const finalQuery = `${q} ${CONFIG.BLOCKLIST_QUERY}`;

        const url = `https://www.googleapis.com/customsearch/v1?key=${googleKey}&cx=${cx}&q=${encodeURIComponent(finalQuery)}&num=10`;
        
        try {
            const res = await fetch(url);
            const data = await res.json();
            if (!data.items) return [];
            return this.deduplicate(data.items);
        } catch (e) {
            console.error("Search Error", e);
            return [];
        }
    },

    deduplicate(sources) {
        const unique = [];
        const seenDomains = new Set();
        const backup = [];

        sources.forEach(s => {
            try {
                const domain = new URL(s.link).hostname.replace('www.', '').toLowerCase();
                if (CONFIG.BANNED_DOMAINS.some(b => domain.includes(b))) return;
                if (s.link.endsWith('.pdf')) return;

                if (!seenDomains.has(domain)) {
                    seenDomains.add(domain);
                    unique.push({ title: s.title, link: s.link, snippet: s.snippet });
                } else {
                    backup.push({ title: s.title, link: s.link, snippet: s.snippet });
                }
            } catch (e) {}
        });

        // Fill up to 10
        while (unique.length < 10 && backup.length > 0) unique.push(backup.shift());
        return unique;
    }
};

const ScrapeService = {
    async getRichData(sources) {
        // Parallel scraping with timeout
        const promises = sources.map(async (s) => {
            try {
                const controller = new AbortController();
                setTimeout(() => controller.abort(), 2500); // 2.5s Timeout per page

                const res = await fetch(s.link, { 
                    signal: controller.signal,
                    headers: { 'User-Agent': 'Mozilla/5.0 (DocuMate_Bot)' } 
                });
                
                if (!res.ok) throw new Error("Failed");
                const html = await res.text();
                const $ = cheerio.load(html);

                // Clean clutter
                $('script, style, nav, footer, iframe, svg').remove();

                const content = $('body').text().replace(/\s+/g, ' ').substring(0, 2000);
                const title = $('meta[property="og:title"]').attr('content') || $('title').text() || s.title;
                
                return {
                    ...s,
                    title: title.trim(),
                    content: content.length > 100 ? content : s.snippet // Fallback to Google snippet if scrape fails
                };
            } catch (e) {
                // Return original Google source if scrape fails
                return { ...s, content: s.snippet || "No content available." };
            }
        });

        const results = await Promise.all(promises);
        
        // Sort alphabetically and assign IDs (just like frontend)
        return results
            .sort((a, b) => (a.title || "").localeCompare(b.title || ""))
            .map((s, index) => ({ ...s, id: index + 1 }));
    }
};

const FormatService = {
    buildPrompt(type, style, context, srcData) {
        const today = getTodayDate();

        if (type === 'quotes') {
            return `
                TASK: Extract Quotes for Sources 1-10.
                CONTEXT: "${context.substring(0, 300)}..."
                DATA: ${srcData}
                RULES: Output strictly in order ID 1 to 10.
                Format: [ID] Title - URL \n > "Quote..."
            `;
        }
        
        // Bibliography Logic
        if (type === 'bibliography') {
            return `
                TASK: Create Bibliography.
                STYLE: ${style}
                SOURCE DATA: ${srcData}
                RULES:
                1. Format strictly according to ${style}.
                2. **ACCESS DATE:** You MUST include "Accessed ${today}" at the end of every entry.
                3. **DO NOT NUMBER THE LIST.**
                4. Return a plain text list. Double newline separation.
            `;
        }

        // Citation Logic (In-Text / Footnotes)
        return `
            TASK: Insert citations into the text.
            STYLE: ${style}
            SOURCE DATA: ${srcData}
            TEXT: "${context}"
            
            MANDATORY INSTRUCTIONS:
            1. **CITE EVERY SENTENCE:** You MUST assign a source to every single sentence.
            2. **FORMATTING:**
               - "insertions": Array of where to put citations.
               - "formatted_citations": Dictionary mapping Source ID to Full Bibliographic String.
            3. **ACCESS DATE:** You MUST include "Accessed ${today}" at the end of every full citation in "formatted_citations".
            
            RETURN JSON ONLY:
            {
              "insertions": [
                { "anchor": "unique 3-5 word phrase", "source_id": 1, "citation_text": "(Smith, 2023)" }
              ],
              "formatted_citations": {
                "1": "Smith, J. (2023). Title. Publisher. URL (accessed ${today})."
              }
            }
        `;
    }
};

const GroqService = {
    async call(messages, apiKey, jsonMode = false) {
        const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: { 
                "Authorization": `Bearer ${apiKey}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                model: CONFIG.GROQ_MODEL,
                messages: messages,
                temperature: 0.1,
                response_format: jsonMode ? { type: "json_object" } : undefined
            })
        });

        if (!response.ok) throw new Error(`Groq API Error: ${response.status}`);
        const data = await response.json();
        return data.choices[0].message.content;
    }
};

// =============================================================================
// 3. TEXT PROCESSING (Ported from Frontend)
// =============================================================================
const TextProcessor = {
    applyInsertions(context, insertions, sources, formattedMap, outputType) {
        let resultText = context;
        let footnoteCounter = 1;
        let usedSourceIds = new Set();

        // 1. Tokenize Text
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

        // 2. Sort Insertions & Calculate Indices
        const validInsertions = insertions.map(item => {
            if (!item.anchor || !item.source_id) return null;
            const anchorWords = item.anchor.toLowerCase().match(/[a-z0-9]+/g);
            if (!anchorWords || anchorWords.length === 0) return null;

            let bestIndex = -1;
            
            // Strict Match
            for (let i = 0; i <= tokens.length - anchorWords.length; i++) {
                let matchFound = true;
                for (let j = 0; j < anchorWords.length; j++) {
                    if (tokens[i + j].word !== anchorWords[j]) { matchFound = false; break; }
                }
                if (matchFound) { bestIndex = tokens[i + anchorWords.length - 1].end; break; }
            }
            
            // Fuzzy Match (Last 2 words)
            if (bestIndex === -1 && anchorWords.length > 2) {
                const shortAnchor = anchorWords.slice(-2);
                for (let i = 0; i <= tokens.length - shortAnchor.length; i++) {
                    if (tokens[i].word === shortAnchor[0] && tokens[i+1].word === shortAnchor[1]) {
                        bestIndex = tokens[i+1].end; break;
                    }
                }
            }

            if (bestIndex !== -1) return { ...item, insertIndex: bestIndex };
            return null;
        }).filter(i => i !== null).sort((a, b) => b.insertIndex - a.insertIndex);

        // 3. Apply Insertions
        validInsertions.forEach(item => {
            const source = sources.find(s => s.id === item.source_id);
            if (!source) return;

            usedSourceIds.add(source.id);
            let insertContent = "";

            if (outputType === 'footnotes') {
                const supers = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹' };
                insertContent = footnoteCounter.toString().split('').map(d => supers[d] || '').join('');
                footnoteCounter++;
            } else {
                insertContent = " " + (item.citation_text || `(Source ${source.id})`);
            }

            const pos = item.insertIndex;
            resultText = resultText.substring(0, pos) + insertContent + resultText.substring(pos);
        });

        // 4. Build Footer
        let usedSection = outputType === 'footnotes' ? "\n\n### Footnotes\n" : "\n\n### Sources Used\n";
        let unusedSection = "\n\n### Unused Sources\n";
        let listCounter = 1;

        sources.forEach(s => {
            let citation = formattedMap[s.id] || `${s.title}. ${s.link}`;
            if (usedSourceIds.has(s.id)) {
                if (outputType === 'footnotes') {
                    usedSection += `${listCounter}. ${citation}\n`;
                    listCounter++;
                } else {
                    usedSection += `${citation}\n\n`;
                }
            } else {
                unusedSection += `${citation}\n\n`;
            }
        });

        resultText += usedSection;
        if (usedSourceIds.size < sources.length) resultText += unusedSection;

        return resultText;
    }
};

// =============================================================================
// 4. MAIN HANDLER
// =============================================================================
export default async function handler(req, res) {
    // CORS Setup
    if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        return res.status(200).end();
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    try {
        const { context, style, outputType, apiKey, googleKey, preLoadedSources } = req.body;
        
        const GROQ_KEY = apiKey || process.env.GROQ_API_KEY;
        const GOOGLE_KEY = googleKey || process.env.GOOGLE_SEARCH_API_KEY;
        const SEARCH_CX = process.env.SEARCH_ENGINE_ID;

        // --- BRANCH 1: QUOTES ---
        // If we already have sources (from a previous citation run), just do quotes
        if (preLoadedSources && preLoadedSources.length > 0) {
            const sourceContext = JSON.stringify(preLoadedSources, null, 2);
            const prompt = FormatService.buildPrompt('quotes', null, context, sourceContext);
            const result = await GroqService.call([{ role: "user", content: prompt }], GROQ_KEY, false);
            
            return res.status(200).json({ success: true, text: result });
        }

        // --- BRANCH 2: CITATIONS / BIBLIOGRAPHY ---
        
        // 1. Search
        const rawSources = await SearchService.perform(context, GOOGLE_KEY, SEARCH_CX);
        if (rawSources.length === 0) throw new Error("No academic sources found.");

        // 2. Scrape
        const richSources = await ScrapeService.getRichData(rawSources);
        const sourceContext = JSON.stringify(richSources, null, 2);

        // 3. Prompt Construction
        const prompt = FormatService.buildPrompt(outputType, style, context, sourceContext);
        const isJson = outputType !== 'bibliography';

        // 4. AI Request
        const aiResponse = await GroqService.call([{ role: "user", content: prompt }], GROQ_KEY, isJson);

        // 5. Processing
        let finalOutput = "";

        if (outputType === 'bibliography') {
            // Bibliography is just plain text returned from AI
            finalOutput = aiResponse;
        } else {
            // Citations require JSON parsing + Text Insertion
            let data;
            try {
                data = JSON.parse(aiResponse);
            } catch (e) {
                // Fallback if AI returns bad JSON
                console.error("JSON Parse Error", e);
                data = { insertions: [], formatted_citations: {} };
            }
            
            finalOutput = TextProcessor.applyInsertions(
                context, 
                data.insertions, 
                richSources, 
                data.formatted_citations, 
                outputType
            );
        }

        return res.status(200).json({
            success: true,
            sources: richSources, // Return sources so frontend can cache them for quotes
            text: finalOutput
        });

    } catch (error) {
        console.error("Handler Error:", error);
        res.status(500).json({ success: false, error: error.message });
    }
}
