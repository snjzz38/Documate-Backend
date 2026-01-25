import * as cheerio from 'cheerio';

// --- CONFIGURATION ---
const DEFAULT_GROQ_MODELS = [
    'llama-3.3-70b-versatile', 
    'llama-3.1-8b-instant', 
    'meta-llama/llama-4-maverick-17b-128e-instruct'
];

// --- HELPER: REAL GOOGLE SEARCH ---
async function searchWeb(query, googleKey, cx) {
    console.log(`[Backend] Searching Google for: ${query}`);
    
    if (!googleKey || !cx) {
        console.warn("Missing Google API Keys. Returning Mock Data.");
        return [];
    }

    try {
        const url = `https://www.googleapis.com/customsearch/v1?key=${googleKey}&cx=${cx}&q=${encodeURIComponent(query)}&num=5`;
        const res = await fetch(url);
        
        if (!res.ok) throw new Error(`Google API Error: ${res.status}`);
        
        const data = await res.json();
        if (!data.items) return [];

        return data.items.map(item => ({
            title: item.title,
            link: item.link,
            snippet: item.snippet
        }));
    } catch (e) {
        console.error("Search failed:", e.message);
        return [];
    }
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
            
            $('script, style, nav, footer, svg, header, iframe, .ad').remove();
            const title = $('title').text().trim() || "Untitled";
            
            let content = $('body').text()
                .replace(/\s+/g, ' ')
                .trim()
                .substring(0, 3000);
            
            return { id: 0, title, link: url, content };
        } catch (e) {
            return null;
        }
    }));
    return results.filter(r => r !== null).map((r, i) => ({ ...r, id: i + 1 }));
}

// --- HELPER: CALL GROQ ---
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
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        const { context, style, outputType, apiKey, googleKey } = req.body;
        
        // KEYS: Prefer User Key, Fallback to Server Key
        const GROQ_KEY = apiKey || process.env.GROQ_API_KEY;
        const GOOGLE_KEY = googleKey || process.env.GOOGLE_SEARCH_API_KEY;
        const SEARCH_CX = process.env.SEARCH_ENGINE_ID; // Always use Server CX unless you add a UI field for it

        // 1. GENERATE QUERY
        const queryPrompt = `Generate a google search query for: "${context.substring(0, 200)}". Return ONLY the query string.`;
        const queryRaw = await callGroq([{ role: "user", content: queryPrompt }], GROQ_KEY, false);
        const query = queryRaw.replace(/"/g, '').trim();

        // 2. SEARCH
        const searchResults = await searchWeb(query, GOOGLE_KEY, SEARCH_CX);
        if (searchResults.length === 0) throw new Error("No search results found.");

        // 3. SCRAPE
        const sources = await scrapeUrls(searchResults.map(s => s.link));
        const sourceContext = JSON.stringify(sources);

        // 4. FORMAT
        const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
        
        // STRICT STYLE DEFINITIONS
        const styleGuide = `
            STRICT CITATION RULES for ${style}:
            - MLA: In-text: (Author Page). Biblio: Author. "Title." Container, Date, URL.
            - APA: In-text: (Author, Year). Biblio: Author. (Year). Title. Source. URL.
            - Chicago: In-text: Superscript number. Footnote: Author, Title (City: Publisher, Year), URL.
            - Harvard: In-text: (Author Year). Biblio: Author (Year) Title. Available at: URL.
        `;

        let prompt = "";
        if (outputType === 'bibliography') {
            prompt = `
                TASK: Create a bibliography.
                ${styleGuide}
                SOURCES: ${sourceContext}
                MANDATORY: Include "Accessed ${today}" at the end of every entry.
                OUTPUT: Plain text list. Double newline separation.
            `;
        } else {
            prompt = `
                TASK: Insert citations into text: "${context}".
                ${styleGuide}
                SOURCES: ${sourceContext}
                
                MANDATORY:
                1. Cite EVERY sentence.
                2. Return JSON:
                {
                  "insertions": [
                    { "anchor": "unique 3-5 word phrase", "source_id": 1, "citation_text": "..." }
                  ],
                  "formatted_citations": {
                    "1": "Full Bibliographic Entry (Accessed ${today})"
                  }
                }
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
