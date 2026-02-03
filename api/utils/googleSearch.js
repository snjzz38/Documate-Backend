// api/utils/googleSearch.js
import { GroqAPI } from './groqAPI.js';

export const GoogleSearchAPI = {
    // Block social media and non-academic noise
    BLOCKLIST: " -filetype:pdf -site:instagram.com -site:facebook.com -site:tiktok.com -site:twitter.com -site:pinterest.com -site:reddit.com -site:quora.com -site:wikipedia.org -site:youtube.com",
    BANNED_DOMAINS: ['instagram', 'facebook', 'tiktok', 'twitter', 'x.com', 'pinterest', 'reddit', 'quora', 'youtube', 'vimeo', 'linkedin'],

    /**
     * Main search method with AI-powered query extraction
     * @param {string} query - User's text to find sources for
     * @param {string} apiKey - Google Search API key
     * @param {string} cx - Google Search Engine ID
     * @param {string} groqKey - Groq API key for AI extraction (optional)
     */
    async search(query, apiKey, cx, groqKey = null) {
        if (!apiKey || !cx) throw new Error("Missing Google Search Configuration");
        
        // Use AI to extract search terms if groqKey provided
        let searchQuery;
        if (groqKey) {
            searchQuery = await this._extractWithAI(query, groqKey);
        } else {
            searchQuery = this._extractFallback(query);
        }
        
        console.log("[Search] Extracted keywords:", searchQuery);
        
        const finalQuery = `${searchQuery} ${this.BLOCKLIST}`;
        
        // Fetch 2 pages (20 results) for deduplication buffer
        const [page1, page2] = await Promise.all([
            this._fetchPage(finalQuery, 1, apiKey, cx),
            this._fetchPage(finalQuery, 11, apiKey, cx)
        ]);
        
        const allItems = [...page1, ...page2];
        if (allItems.length === 0) return [];
        return this._deduplicate(allItems);
    },

    /**
     * AI-powered keyword extraction using Groq
     */
    async _extractWithAI(text, groqKey) {
        const prompt = `Extract 4-6 academic search keywords from this text.

TEXT:
"${text.substring(0, 1500)}"

RULES:
1. Identify the CORE ACADEMIC TOPIC (e.g., "epistemology", "climate change", "rationalism")
2. Include key theories, philosophers, scientists, or technical terms
3. Include the relevant field (philosophy, science, economics, etc.)
4. IGNORE mundane objects (whiteboard, desk, computer) - focus on the SUBJECT being discussed
5. Return ONLY keywords separated by spaces - no explanations, no punctuation

EXAMPLES:
- Text about whiteboard and epistemology → "epistemology rationalism Descartes a priori knowledge"
- Text about climate policy → "climate change mitigation Paris Agreement IPCC policy"
- Text about economic theory → "macroeconomics Keynesian monetary policy inflation"

YOUR KEYWORDS:`;

        try {
            const response = await GroqAPI.chat(
                [{ role: "user", content: prompt }],
                groqKey,
                false
            );
            
            // Clean response: remove quotes, newlines, extra spaces
            const keywords = response
                .replace(/["'\n\r]/g, '')
                .replace(/\s+/g, ' ')
                .trim()
                .split(' ')
                .filter(w => w.length > 2 && !w.includes(':'))
                .slice(0, 8)
                .join(' ');
            
            // Validate we got something useful
            if (keywords && keywords.length > 10) {
                return keywords;
            }
            
            return this._extractFallback(text);
        } catch (e) {
            console.error("[Search] AI extraction failed:", e.message);
            return this._extractFallback(text);
        }
    },

    /**
     * Fallback extraction without AI - uses stop word filtering
     */
    _extractFallback(text) {
        const stopWords = new Set([
            'this', 'that', 'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be',
            'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will',
            'would', 'could', 'should', 'may', 'might', 'must', 'can', 'to', 'of',
            'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through',
            'my', 'your', 'his', 'her', 'its', 'our', 'their', 'i', 'me', 'we',
            'you', 'he', 'she', 'it', 'they', 'object', 'use', 'using', 'home',
            'work', 'tool', 'help', 'helps', 'because', 'also', 'just', 'very',
            'about', 'which', 'what', 'when', 'where', 'who', 'how', 'why',
            'more', 'some', 'such', 'than', 'then', 'there', 'these', 'those'
        ]);
        
        // Extract words 4+ chars, filter stop words, prioritize longer words
        const words = text.toLowerCase().match(/\b[a-z]{4,}\b/g) || [];
        const meaningful = [...new Set(words)]
            .filter(w => !stopWords.has(w))
            .sort((a, b) => b.length - a.length)
            .slice(0, 8);
        
        return meaningful.join(' ') || text.split(/\s+/).slice(0, 8).join(' ');
    },

    /**
     * Fetch a single page of Google results
     */
    async _fetchPage(q, start, key, cx) {
        try {
            const url = `https://www.googleapis.com/customsearch/v1?key=${key}&cx=${cx}&q=${encodeURIComponent(q)}&num=10&start=${start}`;
            const res = await fetch(url);
            const data = await res.json();
            return data.items || [];
        } catch (e) {
            console.error("[Search] Fetch failed:", e.message);
            return [];
        }
    },

    /**
     * Deduplicate results by domain
     */
    _deduplicate(items) {
        const unique = [];
        const seenDomains = new Set();
        
        items.forEach(item => {
            try {
                const domain = new URL(item.link).hostname.replace('www.', '').toLowerCase();
                
                // Skip banned domains
                if (this.BANNED_DOMAINS.some(b => domain.includes(b))) return;
                
                // One result per domain
                if (!seenDomains.has(domain)) {
                    seenDomains.add(domain);
                    unique.push({ 
                        title: item.title, 
                        link: item.link, 
                        snippet: item.snippet 
                    });
                }
            } catch (e) {}
        });
        
        return unique.slice(0, 10);
    }
};
