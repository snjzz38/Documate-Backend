import * as cheerio from 'cheerio';

// =============================================================================
// 1. CONFIGURATION
// =============================================================================
const CONFIG = {
    GROQ_MODELS: [
        "qwen/qwen3-32b",
        "llama-3.1-8b-instant",
        "meta-llama/llama-4-maverick-17b-128e-instruct",
        "meta-llama/llama-4-scout-17b-16e-instruct",
        "meta-llama/llama-guard-4-12b",
        "meta-llama/llama-prompt-guard-2-22m",
        "meta-llama/llama-prompt-guard-2-86m",
        "moonshotai/kimi-k2-instruct-0905"
    ],
    BANNED_DOMAINS: [
        'instagram.com', 'facebook.com', 'tiktok.com', 'twitter.com', 'x.com',
        'pinterest.com', 'reddit.com', 'quora.com', 'youtube.com', 'vimeo.com',
        'wikipedia.org', 'bible.com', 'redeeminggod.com', 'preplounge.com',
        'glassdoor.com', 'indeed.com', 'linkedin.com', 'stackexchange.com'
    ]
};

// =============================================================================
// 2. GROQ SERVICE
// =============================================================================
const GroqService = {
    async call(messages, apiKey, jsonMode = false) {
        let lastError = null;
        for (const model of CONFIG.GROQ_MODELS) {
            try {
                const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
                    method: "POST",
                    headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
                    body: JSON.stringify({
                        model: model,
                        messages: messages,
                        response_format: jsonMode ? { type: "json_object" } : undefined,
                        temperature: 0.2
                    })
                });

                if (!res.ok) throw new Error(`Status ${res.status}`);
                const data = await res.json();
                return data.choices[0].message.content;
            } catch (e) {
                lastError = e;
            }
        }
        throw lastError || new Error("All Groq models failed");
    }
};

// =============================================================================
// 3. SEARCH SERVICE (Enhanced for 10 Sources)
// =============================================================================
const SearchService = {
    async perform(query, googleKey, cx) {
        if (!googleKey || !cx) return [];
        
        const fetchPage = async (start) => {
            try {
                const url = `https://www.googleapis.com/customsearch/v1?key=${googleKey}&cx=${cx}&q=${encodeURIComponent(query)}&num=10&start=${start}`;
                const res = await fetch(url);
                const data = await res.json();
                return data.items || [];
            } catch (e) { return []; }
        };

        try {
            // Fetch Page 1 (Results 1-10)
            let rawResults = await fetchPage(1);
            
            // If we don't have enough, Fetch Page 2 (Results 11-20)
            if (rawResults.length < 15) {
                const page2 = await fetchPage(11);
                rawResults = rawResults.concat(page2);
            }

            const seenLinks = new Set();
            
            // Filter & Deduplicate
            const cleanResults = rawResults.filter(item => {
                try {
                    const domain = new URL(item.link).hostname.toLowerCase();
                    
                    // Filter Banned
                    if (CONFIG.BANNED_DOMAINS.some(b => domain.includes(b))) return false;
                    
                    // Filter Duplicates
                    if (seenLinks.has(item.link)) return false;
                    seenLinks.add(item.link);
                    
                    return true;
                } catch(e) { return false; }
            }).map(item => ({
                title: item.title,
                link: item.link,
                snippet: item.snippet
            }));

            // Return exactly 10 if possible, or as many as we found
            return cleanResults.slice(0, 10);
            
        } catch (e) { return []; }
    }
};

// =============================================================================
// 4. SCRAPE SERVICE
// =============================================================================
const ScrapeService = {
    async processUrls(urls) {
        const results = await Promise.all(urls.map(async (url) => {
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 3000); 
                
                const res = await fetch(url, { 
                    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; DocuMate/1.0)' },
                    signal: controller.signal 
                });
                clearTimeout(timeoutId);
                
                if (!res.ok) throw new Error('Failed');
                const html = await res.text();
                const $ = cheerio.load(html);
                
                $('script, style, nav, footer, svg, header, iframe, .ad').remove();
                
                let title = $('meta[property="og:title"]').attr('content') || $('title').text().trim() || "Untitled";
                let author = $('meta[name="author"]').attr('content') || "";
                let content = $('body').text().replace(/\s+/g, ' ').trim().substring(0, 2000);
                
                return { id: 0, title, link: url, content, meta: { author, title } };
            } catch (e) { return null; }
        }));
        
        const validResults = results.filter(r => r !== null);
        validResults.sort((a, b) => a.title.localeCompare(b.title));
        return validResults.map((r, i) => ({ ...r, id: i + 1 }));
    }
};

// =============================================================================
// 5. PROMPT FACTORY
// =============================================================================
const PromptFactory = {
    build(type, style, context, sourceContext) {
        const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
        
        if (type === 'quotes') {
            return {
                isJson: false,
                text: `
                    TASK: Extract Quotes for Sources 1-10.
                    CONTEXT: "${context.substring(0, 300)}..."
                    SOURCE DATA: ${sourceContext}
                    
                    RULES:
                    1. Output strictly in order ID 1 to 10.
                    2. Format: 
                       **[ID] Source Title** - URL
                       > "Direct quote from text..."
                    3. If a source has no relevant content, skip it.
                `
            };
        } else if (type === 'bibliography') {
            return {
                isJson: true,
                text: `
                    TASK: Extract metadata for bibliography.
                    SOURCES: ${sourceContext}
                    RETURN JSON OBJECT:
                    {
                        "bibliography": [
                            { "id": 1, "author": "Smith, John", "date": "2023", "title": "Page Title", "publisher": "Site Name" }
                        ]
                    }
                    Rules:
                    - If author unknown, use "Unknown".
                    - If date unknown, use "n.d.".
                `
            };
        } else {
            // Citations
            return {
                isJson: true,
                text: `
                    TASK: Map citations to text.
                    TEXT: "${context}"
                    SOURCES: ${sourceContext}
                    
                    MANDATORY:
                    1. Cite EVERY sentence.
                    2. Use multiple sources per sentence if needed.
                    3. Extract metadata for formatting.
                    
                    RETURN JSON:
                    {
                      "insertions": [
                        { "anchor": "3-5 word phrase", "source_id": 1 }
                      ],
                      "metadata_map": {
                        "1": { "author": "Smith", "date": "2023", "title": "Title", "publisher": "Site" }
                      }
                    }
                `
            };
        }
    }
};

// =============================================================================
// 6. MAIN HANDLER
// =============================================================================
export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        let { context, style, outputType, apiKey, googleKey, preLoadedSources } = req.body;
        
        // --- FIX: AUTO-DETECT QUOTES MODE ---
        // If sources are preloaded but outputType wasn't sent correctly, assume quotes
        if ((!outputType || outputType === 'undefined') && preLoadedSources && preLoadedSources.length > 0) {
            outputType = 'quotes';
        }

        const userText = context || req.body.text || "";
        if (!userText || userText.length < 5) throw new Error("Text too short.");

        const GROQ_KEY = apiKey || process.env.GROQ_API_KEY;
        const GOOGLE_KEY = googleKey || process.env.GOOGLE_SEARCH_API_KEY;
        const SEARCH_CX = process.env.SEARCH_ENGINE_ID; 

        let sources = [];

        // 1. GET SOURCES
        if (preLoadedSources && Array.isArray(preLoadedSources) && preLoadedSources.length > 0) {
            sources = preLoadedSources;
        } else {
            if (outputType === 'quotes') throw new Error("Please generate citations first.");

            const queryPrompt = `
                TASK: Create a Google search query for this text.
                TEXT: "${userText.substring(0, 400)}"
                RULES: Return ONLY the query string. Max 8 words.
            `;
            const queryRaw = await GroqService.call([{ role: "user", content: queryPrompt }], GROQ_KEY, false);
            let q = queryRaw.replace(/[\r\n]+/g, ' ').replace(/^\d+\.\s*/, '').replace(/["`]/g, '').trim();

            // Fetch more results to ensure we hit 10 valid ones
            const searchResults = await SearchService.perform(q, GOOGLE_KEY, SEARCH_CX);
            if (searchResults.length === 0) throw new Error("No search results found.");

            sources = await ScrapeService.processUrls(searchResults.map(s => s.link));
        }

        const sourceContext = JSON.stringify(sources);
        const promptData = PromptFactory.build(outputType, style, userText, sourceContext);
        const result = await GroqService.call([{ role: "user", content: promptData.text }], GROQ_KEY, promptData.isJson);

        return res.status(200).json({
            success: true,
            sources: sources,
            result: promptData.isJson ? JSON.parse(result) : result
        });

    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
}
