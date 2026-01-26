import * as cheerio from 'cheerio';

// --- CONFIGURATION ---
const ALL_GROQ_MODELS = [
  "qwen/qwen3-32b",
  "llama-3.1-8b-instant",
  "meta-llama/llama-4-maverick-17b-128e-instruct",
  "meta-llama/llama-4-scout-17b-16e-instruct",
  "meta-llama/llama-guard-4-12b",
  "meta-llama/llama-prompt-guard-2-22m",
  "meta-llama/llama-prompt-guard-2-86m",
  "moonshotai/kimi-k2-instruct-0905"
];

// --- HELPER: CALL GROQ ---
async function callGroq(messages, apiKey, jsonMode = false) {
    let lastError = null;
    for (const model of ALL_GROQ_MODELS) {
        try {
            const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
                method: "POST",
                headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
                body: JSON.stringify({
                    model: model,
                    messages: messages,
                    response_format: jsonMode ? { type: "json_object" } : undefined,
                    temperature: 0.2 // Low temp for precision
                })
            });
            if (!res.ok) throw new Error(`Status ${res.status}`);
            const data = await res.json();
            return data.choices[0].message.content;
        } catch (e) { lastError = e; }
    }
    throw lastError || new Error("All Groq models failed");
}

// --- HELPER: SEARCH ---
async function searchWeb(query, googleKey, cx) {
    if (!googleKey || !cx) return [];
    try {
        const url = `https://www.googleapis.com/customsearch/v1?key=${googleKey}&cx=${cx}&q=${encodeURIComponent(query)}&num=10`;
        const res = await fetch(url);
        const data = await res.json();
        if (!data.items) return [];
        
        const banned = ['instagram', 'facebook', 'tiktok', 'twitter', 'pinterest', 'reddit', 'quora', 'youtube'];
        return data.items.filter(item => {
            const domain = new URL(item.link).hostname.toLowerCase();
            return !banned.some(b => domain.includes(b));
        }).map(item => ({ title: item.title, link: item.link, snippet: item.snippet }));
    } catch (e) { return []; }
}

// --- HELPER: SCRAPE ---
async function scrapeUrls(urls) {
    const results = await Promise.all(urls.slice(0, 10).map(async (url) => {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000); // 5s Timeout
            const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: controller.signal });
            clearTimeout(timeoutId);
            if (!res.ok) throw new Error('Failed');
            const html = await res.text();
            const $ = cheerio.load(html);
            $('script, style, nav, footer, svg, header, iframe').remove();
            
            // Extract Metadata
            let author = $('meta[name="author"]').attr('content') || "";
            let date = $('meta[property="article:published_time"]').attr('content') || "";
            let site = $('meta[property="og:site_name"]').attr('content') || "";
            let content = $('body').text().replace(/\s+/g, ' ').trim().substring(0, 2000);
            
            return { id: 0, title: $('title').text().trim(), link: url, content, meta: { author, date, site } };
        } catch (e) { return null; }
    }));
    return results.filter(r => r !== null).map((r, i) => ({ ...r, id: i + 1 }));
}

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        const { context, outputType, apiKey, googleKey, preLoadedSources } = req.body;
        const GROQ_KEY = apiKey || process.env.GROQ_API_KEY;
        const GOOGLE_KEY = googleKey || process.env.GOOGLE_SEARCH_API_KEY;
        const SEARCH_CX = process.env.SEARCH_ENGINE_ID;

        let sources = [];

        // 1. GET SOURCES (Use Cached if available to prevent timeout)
        if (preLoadedSources && Array.isArray(preLoadedSources) && preLoadedSources.length > 0) {
            console.log("[Backend] Using Pre-loaded Sources");
            sources = preLoadedSources;
        } else {
            console.log("[Backend] Performing New Search");
            const queryPrompt = `Generate a google search query for: "${context.substring(0, 200)}". Return ONLY the query string.`;
            const queryRaw = await callGroq([{ role: "user", content: queryPrompt }], GROQ_KEY, false);
            const query = queryRaw.replace(/"/g, '').trim();
            
            const searchResults = await searchWeb(query, GOOGLE_KEY, SEARCH_CX);
            if (searchResults.length === 0) throw new Error("No search results found.");
            sources = await scrapeUrls(searchResults.map(s => s.link));
        }

        const sourceContext = JSON.stringify(sources);
        let prompt = "";
        let isJsonMode = true;

        // 2. BUILD PROMPT BASED ON TASK
        if (outputType === 'quotes') {
            isJsonMode = false;
            prompt = `
                TASK: Extract quotes.
                USER TEXT: "${context.substring(0, 500)}..."
                SOURCES: ${sourceContext}
                RULES:
                1. Output strictly in order ID 1 to 10.
                2. Format: [ID] Title - URL \n > "Quote..."
                3. If no relevant quote, skip source.
            `;
        } else if (outputType === 'bibliography') {
            // For bibliography, we just need the metadata cleaned up by AI
            prompt = `
                TASK: Extract metadata for bibliography.
                SOURCES: ${sourceContext}
                RETURN JSON ARRAY:
                [
                  { "id": 1, "author": "Smith, John", "date": "2023", "title": "Page Title", "publisher": "Site Name" }
                ]
                Rules:
                - If author unknown, use "Unknown".
                - If date unknown, use "n.d.".
            `;
        } else {
            // Citations (In-Text / Footnotes)
            prompt = `
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
            `;
        }

        const result = await callGroq([{ role: "user", content: prompt }], GROQ_KEY, isJsonMode);

        return res.status(200).json({
            success: true,
            sources: sources,
            result: isJsonMode ? JSON.parse(result) : result
        });

    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
}
