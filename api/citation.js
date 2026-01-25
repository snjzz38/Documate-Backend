import * as cheerio from 'cheerio';

// --- 1. CONFIGURATION ---
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

// --- 2. HELPER: CALL GROQ ---
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

// --- 3. HELPER: SEARCH ---
async function searchWeb(query, googleKey, cx) {
    console.log(`[Backend] Searching Google for: ${query}`);
    
    if (!googleKey || !cx) {
        console.warn("Missing Google API Keys.");
        return [];
    }

    try {
        const url = `https://www.googleapis.com/customsearch/v1?key=${googleKey}&cx=${cx}&q=${encodeURIComponent(query)}&num=10`;
        const res = await fetch(url);
        
        if (!res.ok) throw new Error(`Google API Error: ${res.status}`);
        
        const data = await res.json();
        if (!data.items) return [];

        // EXPANDED BLOCKLIST (Relevance Filter)
        const bannedDomains = [
            'instagram.com', 'facebook.com', 'tiktok.com', 'twitter.com', 'x.com',
            'pinterest.com', 'reddit.com', 'quora.com', 'youtube.com', 'vimeo.com',
            'linkedin.com', 'wikipedia.org', 'bible.com', 'redeeminggod.com'
        ];
        
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
            
            let title = $('meta[property="og:title"]').attr('content') || $('title').text().trim() || "Untitled";
            let author = $('meta[name="author"]').attr('content') || "";
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
    
    const validResults = results.filter(r => r !== null);
    // Sort Alphabetically by Title to keep things organized
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

        // 1. GENERATE QUERY (Improved for Relevance)
        const queryPrompt = `
            TASK: Create a Google search query for this text.
            TEXT: "${context.substring(0, 400)}"
            RULES:
            1. Extract the main topic.
            2. Add keywords like "article", "report", "study" to find high-quality sources.
            3. Return ONLY the query string.
        `;
        const queryRaw = await callGroq([{ role: "user", content: queryPrompt }], GROQ_KEY, false);
        let q = queryRaw.replace(/[\r\n]+/g, ' ').replace(/^\d+\.\s*/, '').replace(/["`]/g, '').trim();

        // 2. SEARCH
        const searchResults = await searchWeb(q, GOOGLE_KEY, SEARCH_CX);
        if (searchResults.length === 0) throw new Error("No search results found.");

        // 3. SCRAPE
        const sources = await scrapeUrls(searchResults.map(s => s.link));
        const sourceContext = JSON.stringify(sources);

        // 4. FORMATTING LOGIC
        const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
        const s = style.toLowerCase();
        let specificRules = "";

        // --- DYNAMIC STYLE RULES (Handles Footnotes for APA/MLA) ---
        if (s.includes('apa')) {
            specificRules = `
            STYLE: APA 7
            - IN-TEXT: (Author, Year). Example: (Smith, 2023).
            - FOOTNOTES: If outputType is footnotes, use the Full Bibliographic Entry: Author, A. A. (Year). Title. Site. URL
            - BIBLIOGRAPHY: Author, A. A. (Year). Title. Site. URL
            `;
        } else if (s.includes('mla')) {
            specificRules = `
            STYLE: MLA 9
            - IN-TEXT: (Author). Example: (Smith).
            - FOOTNOTES: If outputType is footnotes, use the Full Bibliographic Entry: Author. "Title." Container, Date, URL.
            - BIBLIOGRAPHY: Author. "Title." Container, Date, URL.
            `;
        } else if (s.includes('chicago')) {
            specificRules = `
            STYLE: Chicago 17
            - IN-TEXT: (Author Year). Example: (Smith 2023).
            - FOOTNOTES: Full Note style: First Last, "Title," Site, Date, URL.
            - BIBLIOGRAPHY: Last, First. "Title." Site. Date. URL.
            `;
        } else {
            specificRules = `STYLE: ${style}. Follow standard formatting.`;
        }

        let prompt = "";
        
        if (outputType === 'bibliography') {
            prompt = `
                TASK: Create a bibliography.
                ${specificRules}
                SOURCES: ${sourceContext}
                RULES:
                1. Format strictly according to style.
                2. **ACCESS DATE:** Include "Accessed ${today}" at the end of every entry.
                3. **DO NOT NUMBER THE LIST.**
                4. Return plain text list.
            `;
        } else {
            // --- AGGRESSIVE USAGE + RELEVANCE FILTER ---
            prompt = `
                TASK: Insert citations into the text.
                ${specificRules}
                SOURCE DATA: ${sourceContext}
                TEXT: "${context}"
                
                CRITICAL INSTRUCTIONS:
                1. **RELEVANCE CHECK:** Only use sources that are actually relevant to the text. Ignore scams, login pages, or off-topic results.
                2. **MAXIMIZE USAGE:** Try to cite as many *relevant* sources as possible (aim for 5-10).
                3. **MULTI-CITATION:** You may cite multiple sources per sentence if they are relevant.
                
                FORMATTING REQUIREMENTS:
                1. "insertions": Array of citation points.
                2. "formatted_citations": Dictionary mapping Source ID to the string that goes at the bottom (or in the footnote).
                   - **IF FOOTNOTES:** This string MUST be the Full Bibliographic Entry (Author, Title, Date, URL).
                   - **IF IN-TEXT:** This string MUST be the Full Bibliographic Entry (for the reference list).
                3. **ACCESS DATE:** You MUST include "Accessed ${today}" at the end of every full citation.
                
                RETURN JSON ONLY:
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
