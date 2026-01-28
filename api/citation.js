// /api/citation.js
import * as cheerio from 'cheerio';

// =============================================================================
// 1. CONFIGURATION & UTILS
// =============================================================================
const CONFIG = {
    // Blocks social media, PDF, and non-academic noise
    BLOCKLIST_QUERY: " -filetype:pdf -site:instagram.com -site:facebook.com -site:tiktok.com -site:twitter.com -site:pinterest.com -site:reddit.com -site:quora.com -site:wikipedia.org -site:youtube.com",
    BANNED_DOMAINS: ['instagram', 'facebook', 'tiktok', 'twitter', 'x.com', 'pinterest', 'reddit', 'quora', 'youtube', 'vimeo'],
    // Use a model with strong logical reasoning
    GROQ_MODEL: "llama-3.1-70b-versatile"
};

const getTodayDate = () => new Date().toLocaleDateString('en-US', { 
    year: 'numeric', month: 'long', day: 'numeric' 
});

// =============================================================================
// 2. SERVICES
// =============================================================================

const SearchService = {
    async perform(text, googleKey, cx) {
        // Construct optimized query
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
                
                if (!seenDomains.has(domain)) {
                    seenDomains.add(domain);
                    unique.push({ title: s.title, link: s.link, snippet: s.snippet });
                } else {
                    backup.push({ title: s.title, link: s.link, snippet: s.snippet });
                }
            } catch (e) {}
        });

        // Ensure we get up to 10 unique domains
        while (unique.length < 10 && backup.length > 0) unique.push(backup.shift());
        return unique;
    }
};

const ScrapeService = {
    async getRichData(sources) {
        const promises = sources.map(async (s) => {
            try {
                const controller = new AbortController();
                setTimeout(() => controller.abort(), 3000); // 3s Timeout

                const res = await fetch(s.link, { 
                    signal: controller.signal,
                    headers: { 'User-Agent': 'Mozilla/5.0 (DocuMate_Bot)' } 
                });
                
                if (!res.ok) throw new Error("Failed");
                const html = await res.text();
                const $ = cheerio.load(html);

                $('script, style, nav, footer, iframe, svg').remove();

                const content = $('body').text().replace(/\s+/g, ' ').substring(0, 2500);
                const title = $('meta[property="og:title"]').attr('content') || $('title').text() || s.title;
                
                return {
                    ...s,
                    title: title.trim(),
                    content: content.length > 100 ? content : s.snippet 
                };
            } catch (e) {
                return { ...s, content: s.snippet || "No content available." };
            }
        });

        const results = await Promise.all(promises);
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
                Format: **[ID] Title** - URL \n > "Quote..."
            `;
        }
        
        if (type === 'bibliography') {
            return `
                TASK: Create Bibliography.
                STYLE: ${style}
                SOURCE DATA: ${srcData}
                RULES:
                1. Format strictly according to ${style}.
                2. Include "Accessed ${today}".
                3. Return plain text list.
            `;
        }

        // Complex Citation Logic
        return `
            TASK: Insert citations into the text.
            STYLE: ${style}
            SOURCE DATA: ${srcData}
            TEXT: "${context}"
            
            MANDATORY INSTRUCTIONS:
            1. Cite EVERY sentence.
            2. "insertions": Array of { anchor, source_id, citation_text }.
            3. "formatted_citations": Dictionary { "1": "Full Citation (Accessed ${today})" }.
            
            RETURN JSON ONLY.
        `;
    }
};

const GroqService = {
    async call(messages, apiKey, jsonMode = false) {
        const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
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
// 3. TEXT PROCESSOR (The Brain)
// =============================================================================
const TextProcessor = {
    applyInsertions(context, insertions, sources, formattedMap, outputType) {
        let resultText = context;
        let footnoteCounter = 1;
        let usedSourceIds = new Set();

        // 1. Tokenize Text for Fuzzy Matching
        const tokens = [];
        const tokenRegex = /[a-z0-9]+/gi;
        let match;
        while ((match = tokenRegex.exec(context)) !== null) {
            tokens.push({ word: match[0].toLowerCase(), start: match.index, end: match.index + match[0].length });
        }

        // 2. Sort Insertions
        const validInsertions = insertions.map(item => {
            if (!item.anchor || !item.source_id) return null;
            const anchorWords = item.anchor.toLowerCase().match(/[a-z0-9]+/g);
            if (!anchorWords) return null;

            let bestIndex = -1;
            // Strict Match
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
            resultText = resultText.substring(0, item.insertIndex) + insertContent + resultText.substring(item.insertIndex);
        });

        // 4. Append Sources
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

        return resultText + usedSection + (usedSourceIds.size < sources.length ? unusedSection : "");
    }
};

// =============================================================================
// 4. MAIN HANDLER
// =============================================================================
export default async function handler(req, res) {
    if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'POST');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        return res.status(200).end();
    }
    
    // Set headers for actual response
    res.setHeader('Access-Control-Allow-Origin', '*');

    try {
        const { context, style, outputType, apiKey, googleKey, preLoadedSources } = req.body;
        
        // Use provided keys or server env variables
        const GROQ_KEY = apiKey || process.env.GROQ_API_KEY;
        const GOOGLE_KEY = googleKey || process.env.GOOGLE_SEARCH_API_KEY;
        const SEARCH_CX = process.env.SEARCH_ENGINE_ID;

        // --- BRANCH A: QUOTES (Fast) ---
        if (preLoadedSources && preLoadedSources.length > 0) {
            const prompt = FormatService.buildPrompt('quotes', null, context, JSON.stringify(preLoadedSources));
            const result = await GroqService.call([{ role: "user", content: prompt }], GROQ_KEY, false);
            return res.status(200).json({ success: true, text: result });
        }

        // --- BRANCH B: CITATIONS (Deep) ---
        // 1. Search
        const rawSources = await SearchService.perform(context, GOOGLE_KEY, SEARCH_CX);
        if (!rawSources.length) throw new Error("No valid sources found.");

        // 2. Scrape
        const richSources = await ScrapeService.getRichData(rawSources);

        // 3. AI Reasoning
        const prompt = FormatService.buildPrompt(outputType, style, context, JSON.stringify(richSources));
        const isJson = outputType !== 'bibliography';
        const aiResponse = await GroqService.call([{ role: "user", content: prompt }], GROQ_KEY, isJson);

        // 4. Process
        let finalOutput;
        if (outputType === 'bibliography') {
            finalOutput = aiResponse;
        } else {
            let data = JSON.parse(aiResponse);
            finalOutput = TextProcessor.applyInsertions(context, data.insertions, richSources, data.formatted_citations, outputType);
        }

        return res.status(200).json({
            success: true,
            sources: richSources,
            text: finalOutput
        });

    } catch (error) {
        console.error(error);
        return res.status(500).json({ success: false, error: error.message });
    }
}
