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
            // console.warn(`Model ${model} failed: ${e.message}`);
            lastError = e;
        }
    }
    throw lastError || new Error("All Groq models failed");
}

// --- 3. HELPER: SEARCH (Replicating SearchService) ---
async function searchWeb(query, googleKey, cx) {
    if (!googleKey || !cx) return [];
    try {
        // Logic from SearchService: Blocklist
        const blocklist = "-filetype:pdf -site:instagram.com -site:facebook.com -site:tiktok.com -site:twitter.com -site:pinterest.com -site:reddit.com -site:quora.com -site:wikipedia.org -site:youtube.com";
        const finalQuery = `${query} ${blocklist}`;
        
        const url = `https://www.googleapis.com/customsearch/v1?key=${googleKey}&cx=${cx}&q=${encodeURIComponent(finalQuery)}&num=10`;
        const res = await fetch(url);
        const data = await res.json();
        
        if (!data.items) return [];

        // Logic from SearchService: Deduplicate & Filter
        const uniqueSources = [];
        const seenDomains = new Set();
        const bannedDomains = ['instagram', 'facebook', 'tiktok', 'twitter', 'x.com', 'pinterest', 'reddit', 'quora', 'youtube', 'vimeo'];

        data.items.forEach(s => {
            try {
                const domain = new URL(s.link).hostname.replace('www.', '').toLowerCase();
                if (bannedDomains.some(b => domain.includes(b))) return;
                if (s.link.endsWith('.pdf')) return;

                if (!seenDomains.has(domain)) {
                    seenDomains.add(domain);
                    uniqueSources.push({ title: s.title, link: s.link, snippet: s.snippet });
                }
            } catch (e) {}
        });

        return uniqueSources.slice(0, 10); // Ensure max 10
    } catch (e) { return []; }
}

// --- 4. HELPER: SCRAPE (Replicating ScrapeService) ---
async function scrapeUrls(urls) {
    const results = await Promise.all(urls.map(async (url) => {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 6000); 
            const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: controller.signal });
            clearTimeout(timeoutId);
            if (!res.ok) throw new Error('Failed');
            const html = await res.text();
            const $ = cheerio.load(html);
            
            $('script, style, nav, footer, svg, header, iframe, .ad').remove();
            
            // Logic from ScrapeService: Metadata
            let title = $('meta[property="og:title"]').attr('content') || $('title').text().trim() || "Untitled";
            let author = $('meta[name="author"]').attr('content') || "";
            let content = $('body').text().replace(/\s+/g, ' ').trim().substring(0, 2000); // Limit context
            
            // Logic from ScrapeService: Clean Link
            let cleanLink = url.replace(/[.,;:]$/, "");
            if (!cleanLink.startsWith('http')) cleanLink = 'https://' + cleanLink;

            return { 
                id: 0, 
                title: title, 
                link: cleanLink, 
                content: content, 
                meta: { author: author, title: title } 
            };
        } catch (e) { return null; }
    }));
    
    const validResults = results.filter(r => r !== null);
    
    // Logic from ScrapeService: Sort Alphabetically
    validResults.sort((a, b) => {
        const nameA = (a.meta.author || a.title || "").trim().toLowerCase();
        const nameB = (b.meta.author || b.title || "").trim().toLowerCase();
        return nameA.localeCompare(nameB);
    });
    
    return validResults.map((r, i) => ({ ...r, id: i + 1 }));
}

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        const { context, style, outputType, apiKey, googleKey, preLoadedSources } = req.body;
        
        const GROQ_KEY = apiKey || process.env.GROQ_API_KEY;
        const GOOGLE_KEY = googleKey || process.env.GOOGLE_SEARCH_API_KEY;
        const SEARCH_CX = process.env.SEARCH_ENGINE_ID; 

        let sources = [];

        // 1. QUERY GEN (Logic from SearchService)
        if (preLoadedSources && preLoadedSources.length > 0) {
            sources = preLoadedSources;
        } else {
            // Logic from SearchService: Query Gen Prompt
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
            
            // Logic from SearchService: Fallback
            if (!q || q.length < 3) {
                const properNouns = context.match(/[A-Z][a-z]+/g) || [];
                const uniqueNouns = [...new Set(properNouns)].filter(w => w.length > 3).slice(0, 6);
                q = uniqueNouns.join(' ');
                if (!q) q = context.split(/\s+/).slice(0, 6).join(' ');
            }

            // 2. SEARCH
            const searchResults = await searchWeb(q, GOOGLE_KEY, SEARCH_CX);
            if (searchResults.length === 0) throw new Error("No search results found.");

            // 3. SCRAPE
            sources = await scrapeUrls(searchResults.map(s => s.link));
        }

        const sourceContext = JSON.stringify(sources);

        // 4. FORMAT (Logic from FormatService)
        const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
        let prompt = "";
        let isJsonMode = true;

        if (outputType === 'bibliography') {
            isJsonMode = false;
            // Logic from FormatService: Bibliography Prompt
            prompt = `
                TASK: Create Bibliography.
                STYLE: ${style}
                SOURCE DATA (JSON): ${sourceContext}
                
                RULES:
                1. Format strictly according to ${style}.
                2. **ACCESS DATE:** You MUST include "Accessed ${today}" at the end of every entry.
                3. **DO NOT NUMBER THE LIST.**
                4. Return a plain text list. Double newline separation.
            `;
        } else if (outputType === 'quotes') {
            isJsonMode = false;
            // Logic from FormatService: Quotes Prompt
            prompt = `
                TASK: Extract Quotes for Sources 1-10.
                CONTEXT: "${context.substring(0, 300)}..."
                SOURCE DATA (JSON): ${sourceContext}
                RULES: Output strictly in order ID 1 to 10.
                Format: [ID] Title - URL \n > "Quote..."
            `;
        } else {
            // Logic from FormatService: Citation Prompt
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
                    "1": "Smith, J. (2023). Title. Publisher. URL (accessed ${today})."
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
