import * as cheerio from 'cheerio';

// --- 1. CONFIGURATION: EXACT MODELS REQUESTED ---
const DEFAULT_GROQ_MODELS = [
  "qwen/qwen3-32b",
  "llama-3.1-8b-instant",
  "meta-llama/llama-4-maverick-17b-128e-instruct",
  "meta-llama/llama-4-scout-17b-16e-instruct",
  "meta-llama/llama-guard-4-12b",
  "meta-llama/llama-prompt-guard-2-22m",
  "meta-llama/llama-prompt-guard-2-86m",
  "moonshotai/kimi-k2-instruct-0905"
];

// --- 2. HELPER: SEARCH (Google Custom Search) ---
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

// --- 3. HELPER: SCRAPE ---
async function scrapeUrls(urls) {
    const results = await Promise.all(urls.slice(0, 10).map(async (url) => {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 6000); 
            
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
            
            // Aggressive cleaning to save tokens
            let content = $('body').text().replace(/\s+/g, ' ').trim().substring(0, 2500);
            
            return { id: 0, title, link: url, content };
        } catch (e) {
            return null;
        }
    }));
    return results.filter(r => r !== null).map((r, i) => ({ ...r, id: i + 1 }));
}

// --- 4. HELPER: GROQ CALL WITH ROTATION ---
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
                    response_format: jsonMode ? { type: "json_object" } : undefined,
                    temperature: 0.3 // Low temp for strict formatting
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
        
        // KEYS: Prefer User Key -> Fallback to Server Key
        const GROQ_KEY = apiKey || process.env.GROQ_API_KEY;
        const GOOGLE_KEY = googleKey || process.env.GOOGLE_SEARCH_API_KEY;
        const SEARCH_CX = process.env.SEARCH_ENGINE_ID; 

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

        // 4. FORMAT (Restoring the EXACT working prompt logic)
        const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
        
        let prompt = "";
        
        if (outputType === 'bibliography') {
            prompt = `
                TASK: Create a bibliography.
                STYLE: ${style}
                SOURCES: ${sourceContext}
                
                RULES:
                1. Format strictly according to ${style}.
                2. **ACCESS DATE:** You MUST include "Accessed ${today}" at the end of every entry.
                3. **DO NOT NUMBER THE LIST.**
                4. Return a plain text list. Double newline separation.
            `;
        } else {
            // THE "MAGIC" PROMPT THAT WORKED BEFORE
            prompt = `
                TASK: Insert citations into the text.
                STYLE: ${style}
                SOURCE DATA: ${sourceContext}
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
                    "1": "Smith, J. (2023). Title. Publisher. URL (Accessed ${today})."
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
