import * as cheerio from 'cheerio';

// --- 1. CONFIGURATION: USER DEFINED MODELS ---
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

// --- 2. HELPER: CALL GROQ WITH ROTATION ---
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
                    temperature: 0.3 
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

// --- 3. HELPER: SEARCH (Google Custom Search) ---
async function searchWeb(query, googleKey, cx) {
    console.log(`[Backend] Searching Google for: ${query}`);
    
    if (!googleKey || !cx) {
        console.warn("Missing Google API Keys.");
        return [];
    }

    try {
        // Fetch 10 results (num=10) to satisfy the "Cite 10 Sources" requirement
        const url = `https://www.googleapis.com/customsearch/v1?key=${googleKey}&cx=${cx}&q=${encodeURIComponent(query)}&num=10`;
        const res = await fetch(url);
        
        if (!res.ok) throw new Error(`Google API Error: ${res.status}`);
        
        const data = await res.json();
        if (!data.items) return [];

        // Javascript Domain Filter (CRAAP Filter Logic)
        const bannedDomains = ['instagram', 'facebook', 'tiktok', 'twitter', 'x.com', 'pinterest', 'reddit', 'quora', 'youtube', 'vimeo', 'wikipedia'];
        
        const cleanResults = data.items.filter(item => {
            const domain = new URL(item.link).hostname.toLowerCase();
            return !bannedDomains.some(b => domain.includes(b));
        });

        return cleanResults.map(item => ({
            title: item.title,
            link: item.link,
            snippet: item.snippet
        }));
    } catch (e) {
        console.error("Search failed:", e.message);
        return [];
    }
}

// --- 4. HELPER: SCRAPE ---
async function scrapeUrls(urls) {
    // Limit to 10 sources
    const targetUrls = urls.slice(0, 10);
    
    const results = await Promise.all(targetUrls.map(async (url) => {
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
            
            // Metadata Extraction Logic from Frontend
            let title = $('meta[property="og:title"]').attr('content') || $('title').text().trim() || "Untitled";
            let author = $('meta[name="author"]').attr('content') || "";
            
            // Aggressive cleaning
            let content = $('body').text().replace(/\s+/g, ' ').trim().substring(0, 2500);
            
            return { 
                id: 0, 
                title: title, 
                link: url, 
                content: content,
                meta: { author: author }
            };
        } catch (e) {
            return null;
        }
    }));
    
    // Sort Alphabetically (Frontend Logic)
    const validResults = results.filter(r => r !== null);
    validResults.sort((a, b) => a.title.localeCompare(b.title));
    
    return validResults.map((r, i) => ({ ...r, id: i + 1 }));
}

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        const { context, style, outputType, apiKey, googleKey } = req.body;
        
        const GROQ_KEY = apiKey || process.env.GROQ_API_KEY;
        const GOOGLE_KEY = googleKey || process.env.GOOGLE_SEARCH_API_KEY;
        const SEARCH_CX = process.env.SEARCH_ENGINE_ID; 

        // --- STEP 1: QUERY GENERATION (Logic from SearchService) ---
        const queryPrompt = `
            TASK: Create a Google search query for this text.
            TEXT: "${context.substring(0, 400)}"
            RULES:
            1. PRIORITIZE Proper Nouns and Key Concepts.
            2. Combine them into a SINGLE line string.
            3. Max 8 words.
            4. Return ONLY the query string.
        `;
        const queryRaw = await callGroq([{ role: "user", content: queryPrompt }], GROQ_KEY, false);
        let q = queryRaw.replace(/[\r\n]+/g, ' ').replace(/^\d+\.\s*/, '').replace(/["`]/g, '').trim();

        // Apply Blocklist (CRAAP Filter)
        const blocklist = " -filetype:pdf -site:instagram.com -site:facebook.com -site:tiktok.com -site:twitter.com -site:pinterest.com -site:reddit.com -site:quora.com -site:wikipedia.org -site:youtube.com";
        const finalQuery = `${q} ${blocklist}`;

        // --- STEP 2: SEARCH ---
        const searchResults = await searchWeb(finalQuery, GOOGLE_KEY, SEARCH_CX);
        if (searchResults.length === 0) throw new Error("No search results found.");

        // --- STEP 3: SCRAPE ---
        const sources = await scrapeUrls(searchResults.map(s => s.link));
        const sourceContext = JSON.stringify(sources);

        // --- STEP 4: FORMAT (Logic from FormatService) ---
        const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
        
        let prompt = "";
        
        if (outputType === 'bibliography') {
            prompt = `
                TASK: Create a bibliography.
                STYLE: ${style}
                SOURCE DATA (JSON): ${sourceContext}
                
                RULES:
                1. Format strictly according to ${style}.
                2. **ACCESS DATE:** You MUST include "Accessed ${today}" at the end of every entry.
                3. **DO NOT NUMBER THE LIST.**
                4. Return a plain text list. Double newline separation.
            `;
        } else {
            // MAX DENSITY + FULL BIBLIO PROMPT
            prompt = `
                TASK: Insert citations into the text.
                STYLE: ${style}
                SOURCE DATA (JSON): ${sourceContext}
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
