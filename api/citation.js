import * as cheerio from 'cheerio';

// =============================================================================
// 1. CONFIGURATION & CONSTANTS
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
        'glassdoor.com', 'indeed.com', 'linkedin.com'
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
                        temperature: 0.3
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
// 3. SEARCH SERVICE
// =============================================================================
const SearchService = {
    async perform(query, googleKey, cx) {
        if (!googleKey || !cx) return [];
        try {
            const url = `https://www.googleapis.com/customsearch/v1?key=${googleKey}&cx=${cx}&q=${encodeURIComponent(query)}&num=10`;
            const res = await fetch(url);
            const data = await res.json();
            if (!data.items) return [];

            return data.items.filter(item => {
                const domain = new URL(item.link).hostname.toLowerCase();
                return !CONFIG.BANNED_DOMAINS.some(b => domain.includes(b));
            }).map(item => ({
                title: item.title,
                link: item.link,
                snippet: item.snippet
            }));
        } catch (e) { return []; }
    }
};

// =============================================================================
// 4. SCRAPE SERVICE
// =============================================================================
const ScrapeService = {
    async processUrls(urls) {
        const targetUrls = urls.slice(0, 10);
        const results = await Promise.all(targetUrls.map(async (url) => {
            try {
                const controller = new AbortController();
                // REDUCED TIMEOUT: 3.5s to prevent Vercel 10s limit
                const timeoutId = setTimeout(() => controller.abort(), 3500); 
                
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
                
                return { id: 0, title, link: url, content, meta: { author } };
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
    getStyleRules(style) {
        const s = (style || "").toLowerCase();
        if (s.includes('apa')) return `STYLE: APA 7. In-text: (Author, Year). Footnotes: Full Biblio.`;
        if (s.includes('mla')) return `STYLE: MLA 9. In-text: (Author, Year). Footnotes: Full Biblio.`;
        if (s.includes('chicago')) return `STYLE: Chicago 17. In-text: (Author Year). Footnotes: Full Note.`;
        return `STYLE: Standard Academic.`;
    },

    build(type, style, context, sourceContext) {
        const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
        const specificRules = this.getStyleRules(style);

        if (type === 'bibliography') {
            return {
                isJson: false,
                text: `
                    TASK: Create a bibliography.
                    ${specificRules}
                    SOURCES: ${sourceContext}
                    RULES:
                    1. Format strictly according to style.
                    2. **ACCESS DATE:** Include "Accessed ${today}" at the end of every entry.
                    3. **DO NOT NUMBER THE LIST.**
                    4. Return plain text list.
                `
            };
        } else if (type === 'quotes') {
            return {
                isJson: false,
                text: `
                    TASK: Extract Quotes for Sources 1-10.
                    CONTEXT: "${context.substring(0, 300)}..."
                    SOURCE DATA: ${sourceContext}
                    RULES: Output strictly in order ID 1 to 10.
                    Format: [ID] Title - URL \n > "Quote..."
                `
            };
        } else {
            return {
                isJson: true,
                text: `
                    TASK: Insert citations into the text.
                    ${specificRules}
                    SOURCE DATA: ${sourceContext}
                    TEXT: "${context}"
                    
                    CRITICAL INSTRUCTIONS:
                    1. **USE EVERY SOURCE:** You have multiple sources. Use as many as relevant.
                    2. **MULTI-CITATION:** You may cite multiple sources per sentence.
                    
                    FORMATTING REQUIREMENTS:
                    1. "insertions": Array of citation points.
                    2. "formatted_citations": Dictionary mapping Source ID to Full Bibliographic String.
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
        const { context, style, outputType, apiKey, googleKey, preLoadedSources } = req.body;
        
        // --- FIX: NORMALIZE INPUT (Handle 'text' vs 'context') ---
        const userText = context || req.body.text || "";
        if (!userText || userText.length < 5) throw new Error("Text too short.");

        const GROQ_KEY = apiKey || process.env.GROQ_API_KEY;
        const GOOGLE_KEY = googleKey || process.env.GOOGLE_SEARCH_API_KEY;
        const SEARCH_CX = process.env.SEARCH_ENGINE_ID; 

        let sources = [];

        // 1. GET SOURCES
        if (preLoadedSources && preLoadedSources.length > 0) {
            sources = preLoadedSources;
        } else {
            const queryPrompt = `
                TASK: Create a Google search query for this text.
                TEXT: "${userText.substring(0, 400)}"
                RULES: Return ONLY the query string. Max 8 words.
            `;
            const queryRaw = await GroqService.call([{ role: "user", content: queryPrompt }], GROQ_KEY, false);
            let q = queryRaw.replace(/[\r\n]+/g, ' ').replace(/^\d+\.\s*/, '').replace(/["`]/g, '').trim();

            const searchResults = await SearchService.perform(q, GOOGLE_KEY, SEARCH_CX);
            if (searchResults.length === 0) throw new Error("No search results found.");

            sources = await ScrapeService.processUrls(searchResults.map(s => s.link));
        }

        const sourceContext = JSON.stringify(sources);

        // 2. FORMAT
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
