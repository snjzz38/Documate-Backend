import * as cheerio from 'cheerio';

// =============================================================================
// 1. CONFIGURATION
// =============================================================================
const CONFIG = {
    // Blocks social media & PDF noise
    BLOCKLIST_QUERY: " -filetype:pdf -site:instagram.com -site:facebook.com -site:tiktok.com -site:twitter.com -site:pinterest.com -site:reddit.com -site:quora.com -site:wikipedia.org -site:youtube.com",
    BANNED_DOMAINS: ['instagram', 'facebook', 'tiktok', 'twitter', 'x.com', 'pinterest', 'reddit', 'quora', 'youtube', 'vimeo'],
    
    // UPDATED MODEL: Llama 3.3 is the newest/most stable on Groq right now
    GROQ_MODEL: "llama-3.3-70b-versatile",
    
    // SAFETY: Limit scraped content size to prevent 400 (Token Overflow)
    MAX_CHARS_PER_SOURCE: 1500 
};

const getTodayDate = () => new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

// =============================================================================
// 2. SERVICES
// =============================================================================
const SearchService = {
    async perform(text, googleKey, cx) {
        if (!googleKey || !cx) throw new Error("Missing Google Search Configuration (Key or CX ID)");
        
        let q = text.split(/\s+/).slice(0, 6).join(' '); 
        const finalQuery = `${q} ${CONFIG.BLOCKLIST_QUERY}`;
        const url = `https://www.googleapis.com/customsearch/v1?key=${googleKey}&cx=${cx}&q=${encodeURIComponent(finalQuery)}&num=10`;
        
        const res = await fetch(url);
        const data = await res.json();
        
        if (data.error) {
            console.error("Google Search API Error:", data.error);
            throw new Error(`Google Search Error: ${data.error.message}`);
        }
        
        if (!data.items) return [];
        return this.deduplicate(data.items);
    },

    deduplicate(sources) {
        const unique = [];
        const seenDomains = new Set();
        sources.forEach(s => {
            try {
                const domain = new URL(s.link).hostname.replace('www.', '').toLowerCase();
                if (CONFIG.BANNED_DOMAINS.some(b => domain.includes(b))) return;
                if (!seenDomains.has(domain)) {
                    seenDomains.add(domain);
                    unique.push({ title: s.title, link: s.link, snippet: s.snippet });
                }
            } catch (e) {}
        });
        return unique.slice(0, 8); // Limit to 8 sources to save tokens
    }
};

const ScrapeService = {
    async getRichData(sources) {
        const promises = sources.map(async (s) => {
            try {
                const controller = new AbortController();
                setTimeout(() => controller.abort(), 2000); // 2s Timeout

                const res = await fetch(s.link, { 
                    signal: controller.signal,
                    headers: { 'User-Agent': 'Mozilla/5.0 (DocuMate_Bot)' } 
                });
                
                if (!res.ok) throw new Error("Failed");
                const html = await res.text();
                const $ = cheerio.load(html);

                $('script, style, nav, footer, iframe, svg, header, .ad').remove();
                
                // Aggressive cleaning to prevent token overflow
                const content = $('body').text().replace(/\s+/g, ' ').substring(0, CONFIG.MAX_CHARS_PER_SOURCE);
                const title = $('meta[property="og:title"]').attr('content') || $('title').text() || s.title;
                
                return { ...s, title: title.trim(), content: content.length > 50 ? content : s.snippet };
            } catch (e) {
                return { ...s, content: s.snippet || "No content." };
            }
        });
        const results = await Promise.all(promises);
        return results.map((s, index) => ({ ...s, id: index + 1 }));
    }
};

const FormatService = {
    buildPrompt(type, style, context, srcData) {
        const today = getTodayDate();
        if (type === 'quotes') {
            return `TASK: Extract Quotes. CONTEXT: "${context.substring(0, 300)}..." DATA: ${srcData} RULES: Output strictly in order ID 1 to 10. Format: **[ID] Title** - URL \n > "Quote..."`;
        }
        if (type === 'bibliography') {
            return `TASK: Create Bibliography. STYLE: ${style} SOURCE DATA: ${srcData} RULES: Format strictly. Include "Accessed ${today}". Return plain text.`;
        }
        // Strict JSON prompt for citations
        return `
            TASK: Insert citations.
            STYLE: ${style}
            SOURCE DATA: ${srcData}
            TEXT: "${context}"
            
            MANDATORY:
            1. Cite every sentence.
            2. RETURN JSON object with keys: "insertions" (array), "formatted_citations" (object).
            3. "formatted_citations" values must end with "(Accessed ${today})".
            
            Example JSON Structure:
            {
              "insertions": [{ "anchor": "text segment", "source_id": 1, "citation_text": "(Smith 2024)" }],
              "formatted_citations": { "1": "Smith. Title. URL (Accessed ${today})" }
            }
        `;
    }
};

const GroqService = {
    async call(messages, apiKey, jsonMode = false) {
        // DEBUG: Check if Key exists
        if (!apiKey || apiKey.length < 10) throw new Error("Missing or Invalid Groq API Key.");

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
                // Only use json_object if requested. This often fixes 400 errors.
                response_format: jsonMode ? { type: "json_object" } : undefined
            })
        });

        const data = await response.json();

        // DEBUG: Catch API Errors
        if (!response.ok) {
            console.error("Groq API Error Details:", JSON.stringify(data));
            throw new Error(`Groq API ${response.status}: ${data.error?.message || 'Unknown Error'}`);
        }
        return data.choices[0].message.content;
    }
};

const TextProcessor = {
    applyInsertions(context, insertions, sources, formattedMap, outputType) {
        let resultText = context;
        let footnoteCounter = 1;
        let usedSourceIds = new Set();

        const tokens = [];
        const tokenRegex = /[a-z0-9]+/gi;
        let match;
        while ((match = tokenRegex.exec(context)) !== null) {
            tokens.push({ word: match[0].toLowerCase(), start: match.index, end: match.index + match[0].length });
        }

        const validInsertions = (insertions || []).map(item => {
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
            if (bestIndex !== -1) return { ...item, insertIndex: bestIndex };
            return null;
        }).filter(Boolean).sort((a, b) => b.insertIndex - a.insertIndex);

        validInsertions.forEach(item => {
            const source = sources.find(s => s.id === item.source_id);
            if (!source) return;
            usedSourceIds.add(source.id);
            
            let insertContent = outputType === 'footnotes' 
                ? (() => { const s = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹' }; const n = footnoteCounter.toString().split('').map(d => s[d] || '').join(''); footnoteCounter++; return n; })()
                : " " + (item.citation_text || `(${source.id})`);

            resultText = resultText.substring(0, item.insertIndex) + insertContent + resultText.substring(item.insertIndex);
        });

        let footer = outputType === 'footnotes' ? "\n\n### Footnotes\n" : "\n\n### Sources Used\n";
        sources.forEach((s, i) => {
            if (usedSourceIds.has(s.id)) footer += `${outputType === 'footnotes' ? (i+1) + '. ' : ''}${formattedMap[s.id] || s.link}\n\n`;
        });

        return resultText + footer;
    }
};

// =============================================================================
// 3. MAIN HANDLER
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
        
        // 1. RESOLVE KEYS
        const GROQ_KEY = apiKey || process.env.GROQ_API_KEY;
        const GOOGLE_KEY = googleKey || process.env.GOOGLE_SEARCH_API_KEY;
        const SEARCH_CX = process.env.SEARCH_ENGINE_ID;

        // DEBUG LOGGING
        console.log(`[Request] Groq Key Present: ${!!GROQ_KEY}, Google Key Present: ${!!GOOGLE_KEY}`);

        if (!GROQ_KEY) throw new Error("Groq API Key is missing. Please add it to Vercel Env Vars or the Frontend settings.");

        // --- BRANCH A: QUOTES ---
        if (preLoadedSources && preLoadedSources.length > 0) {
            const prompt = FormatService.buildPrompt('quotes', null, context, JSON.stringify(preLoadedSources));
            const result = await GroqService.call([{ role: "user", content: prompt }], GROQ_KEY, false);
            return res.status(200).json({ success: true, text: result });
        }

        // --- BRANCH B: CITATIONS ---
        const rawSources = await SearchService.perform(context, GOOGLE_KEY, SEARCH_CX);
        if (!rawSources.length) throw new Error("No academic sources found.");

        const richSources = await ScrapeService.getRichData(rawSources);
        const prompt = FormatService.buildPrompt(outputType, style, context, JSON.stringify(richSources));
        
        const isJson = outputType !== 'bibliography';
        const aiResponse = await GroqService.call([{ role: "user", content: prompt }], GROQ_KEY, isJson);

        let finalOutput;
        if (outputType === 'bibliography') {
            finalOutput = aiResponse;
        } else {
            // Safe JSON Parse
            let data;
            try {
                data = JSON.parse(aiResponse);
            } catch (e) {
                // If model fails JSON mode, treat as raw text
                console.warn("JSON Parse Failed, returning raw text");
                return res.status(200).json({ success: true, sources: richSources, text: aiResponse });
            }
            finalOutput = TextProcessor.applyInsertions(context, data.insertions, richSources, data.formatted_citations, outputType);
        }

        return res.status(200).json({ success: true, sources: richSources, text: finalOutput });

    } catch (error) {
        console.error("Handler Failure:", error);
        return res.status(500).json({ success: false, error: error.message });
    }
}
