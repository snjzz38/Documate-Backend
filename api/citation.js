import * as cheerio from 'cheerio';

// --- CONFIGURATION ---
const DEFAULT_GROQ_MODELS = [
  "qwen/qwen3-32b",
  "llama-3.1-8b-instant",
  "meta-llama/llama-4-maverick-17b-128e-instruct",
  "meta-llama/llama-4-scout-17b-16e-instruct",
  "meta-llama/llama-guard-4-12b",
  "meta-llama/llama-prompt-guard-2-22m",
  "meta-llama/llama-prompt-guard-2-86m",
  "moonshotai/kimi-k2-instruct-0905”,
];

// --- HELPER: SEARCH WEB ---
async function searchWeb(query, apiKey) {
    console.log(`[Backend] Searching for: ${query}`);
    // TODO: Integrate Serper.dev or Google Custom Search API here for production
    return [
        { title: "Example Source 1", link: "https://example.com/1" },
        { title: "Example Source 2", link: "https://example.com/2" }
    ];
}

// --- HELPER: SCRAPE URLS ---
async function scrapeUrls(urls) {
    const results = await Promise.all(urls.slice(0, 10).map(async (url) => {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 6000); // 6s Timeout
            
            const res = await fetch(url, { 
                headers: { 'User-Agent': 'Mozilla/5.0 (compatible; DocuMate/1.0)' },
                signal: controller.signal 
            });
            clearTimeout(timeoutId);
            
            if (!res.ok) throw new Error('Failed');
            const html = await res.text();
            const $ = cheerio.load(html);
            
            $('script, style, nav, footer, svg, header').remove();
            const title = $('title').text().trim() || "Untitled";
            const content = $('body').text().replace(/\s+/g, ' ').trim().substring(0, 3000);
            
            return { id: 0, title, link: url, content };
        } catch (e) {
            return null;
        }
    }));
    return results.filter(r => r !== null).map((r, i) => ({ ...r, id: i + 1 }));
}

// --- HELPER: CALL GROQ WITH ROTATION ---
async function callGroq(messages, apiKey, jsonMode = false) {
    let lastError = null;
    for (const model of DEFAULT_GROQ_MODELS) {
        try {
            const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
                method: "POST",
                headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
                body: JSON.stringify({
                    model: model,
                    messages: messages,
                    response_format: jsonMode ? { type: "json_object" } : undefined
                })
            });

            if (!res.ok) throw new Error(`Status ${res.status}`);
            const data = await res.json();
            return data.choices[0].message.content;
        } catch (e) {
            console.warn(`Model ${model} failed: ${e.message}`);
            lastError = e;
        }
    }
    throw lastError || new Error("All Groq models failed");
}

export default async function handler(req, res) {
    // CORS HEADERS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        const { context, style, outputType, apiKey } = req.body;
        const GROQ_KEY = apiKey || process.env.GROQ_API_KEY;

        // 1. GENERATE QUERY
        const queryPrompt = `Generate a google search query for: "${context.substring(0, 200)}". Return ONLY the query string.`;
        const queryRaw = await callGroq([{ role: "user", content: queryPrompt }], GROQ_KEY, false);
        const query = queryRaw.replace(/"/g, '').trim();

        // 2. SEARCH
        const searchResults = await searchWeb(query, GROQ_KEY);

        // 3. SCRAPE
        const sources = await scrapeUrls(searchResults.map(s => s.link));
        const sourceContext = JSON.stringify(sources);

        // 4. FORMAT
        const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
        let prompt = "";
        
        if (outputType === 'bibliography') {
            prompt = `Create a bibliography in ${style} style for these sources. Include "Accessed ${today}". Return plain text list. Sources: ${sourceContext}`;
        } else {
            prompt = `
                Insert citations into text: "${context}".
                Style: ${style}. Sources: ${sourceContext}.
                Rules: Cite EVERY sentence. Return JSON: { "insertions": [{ "anchor": "phrase", "source_id": 1, "citation_text": "..." }], "formatted_citations": { "1": "Full Citation (Accessed ${today})" } }
            `;
        }

        const result = await callGroq([{ role: "user", content: prompt }], GROQ_KEY, outputType !== 'bibliography');

        return res.status(200).json({
            success: true,
            sources: sources,
            result: outputType === 'bibliography' ? result : JSON.parse(result)
        });

    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
}
