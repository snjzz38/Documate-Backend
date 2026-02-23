// api/utils/googleSearch.js
// Uses FREE public SearXNG instances - NO API KEY OR SERVER REQUIRED

import { GroqAPI } from './groqAPI.js';

const INSTANCES = [
    'https://search.sapti.me',
    'https://searx.tiekoetter.com', 
    'https://search.bus-hit.me',
    'https://searx.be',
    'https://search.ononoki.org',
    'https://priv.au'
];

export const GoogleSearchAPI = {
    // Only ban the obvious non-academic sources
    BANNED_DOMAINS: [
        'reddit', 'quora', 'stackoverflow', 'stackexchange',
        'youtube', 'tiktok', 'instagram', 'facebook', 'twitter', 'pinterest',
        'amazon', 'ebay', 'etsy', 'alibaba'
    ],

    async search(query, apiKey, cx, groqKey = null) {
        // Build a proper academic search query
        const searchQuery = groqKey 
            ? await this._buildAcademicQuery(query, groqKey) 
            : this._buildFallbackQuery(query);
        
        console.log('[Search] Query:', searchQuery);
        
        // Try instances until one works
        const shuffled = [...INSTANCES].sort(() => Math.random() - 0.5);
        
        for (const instance of shuffled.slice(0, 3)) {
            try {
                console.log('[Search] Trying:', instance);
                const results = await this._fetch(instance, searchQuery);
                
                if (results.length > 0) {
                    console.log('[Search] Success:', results.length, 'results');
                    return this._dedupe(results);
                }
            } catch (e) {
                console.error('[Search] Failed:', instance, e.message);
            }
        }
        
        console.error('[Search] All instances failed');
        return [];
    },

    /**
     * Use AI to build a proper academic search query
     * Key insight: Add "research" or "study" to get academic results
     */
    async _buildAcademicQuery(text, groqKey) {
        try {
            const prompt = `You are building a search query to find ACADEMIC sources (research papers, university articles, medical journals) for a student paper.

TEXT TO CITE:
"${text.substring(0, 800)}"

TASK: Create ONE search query (4-8 words) that will find scholarly sources.

RULES:
1. Include the main TOPIC (e.g., "smartphone addiction", "climate change effects")
2. Add academic keywords like: research, study, effects, impact, mental health, behavior
3. DO NOT include generic words like: phone, device, people, things, way
4. DO NOT include solution words like: tips, help, how to, treatment, rehab

EXAMPLES:
- Text about phone overuse → "smartphone addiction mental health research"
- Text about global warming → "climate change environmental impact study"
- Text about sleep problems → "sleep deprivation cognitive effects research"

YOUR QUERY (just the search terms, nothing else):`;
            
            const response = await GroqAPI.chat([{ role: 'user', content: prompt }], groqKey, false);
            
            // Clean the response
            const query = response
                .replace(/["'\n]/g, '')
                .replace(/^(query:|search:|your query:)/gi, '')
                .trim()
                .substring(0, 100);
            
            // Validate - should have at least 3 words
            if (query.split(/\s+/).length >= 3) {
                return query;
            }
            
            return this._buildFallbackQuery(text);
        } catch (e) {
            console.error('[Search] Query building failed:', e.message);
            return this._buildFallbackQuery(text);
        }
    },

    /**
     * Fallback: Extract topic + add "research study"
     */
    _buildFallbackQuery(text) {
        // Words to ignore completely
        const stopWords = new Set([
            'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
            'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
            'should', 'may', 'might', 'must', 'can', 'this', 'that', 'these',
            'those', 'i', 'you', 'he', 'she', 'it', 'we', 'they', 'my', 'your',
            'his', 'her', 'its', 'our', 'their', 'what', 'which', 'who', 'whom',
            'where', 'when', 'why', 'how', 'all', 'each', 'every', 'both', 'few',
            'more', 'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only',
            'own', 'same', 'so', 'than', 'too', 'very', 'just', 'also', 'now',
            'people', 'things', 'way', 'many', 'much', 'often', 'even', 'well',
            'make', 'made', 'take', 'get', 'put', 'use', 'used', 'using'
        ]);
        
        // Extract meaningful words (5+ chars, not in stop list)
        const words = text.toLowerCase().match(/\b[a-z]{5,}\b/g) || [];
        const meaningful = [...new Set(words)]
            .filter(w => !stopWords.has(w))
            .slice(0, 4);
        
        // Add "research" to make it academic
        const query = meaningful.join(' ') + ' research study';
        
        return query || text.substring(0, 40) + ' research';
    },

    async _fetch(instance, query) {
        const url = `${instance}/search?q=${encodeURIComponent(query)}&categories=general,science&language=en`;
        
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000);
        
        try {
            const res = await fetch(url, {
                signal: controller.signal,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Accept': 'text/html'
                }
            });
            clearTimeout(timeout);
            
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            
            const html = await res.text();
            return this._parseResults(html);
        } catch (e) {
            clearTimeout(timeout);
            throw e;
        }
    },

    _parseResults(html) {
        const results = [];
        
        // Parse <article class="result"> blocks
        const articleRegex = /<article[^>]*class="[^"]*result[^"]*"[^>]*>([\s\S]*?)<\/article>/gi;
        let match;
        
        while ((match = articleRegex.exec(html)) !== null) {
            const block = match[1];
            
            const urlMatch = block.match(/href="(https?:\/\/[^"]+)"/);
            const titleMatch = block.match(/<h3[^>]*>([\s\S]*?)<\/h3>/) || 
                              block.match(/<a[^>]*>([\s\S]*?)<\/a>/);
            const snippetMatch = block.match(/<p[^>]*class="[^"]*content[^"]*"[^>]*>([\s\S]*?)<\/p>/);
            
            if (urlMatch && titleMatch) {
                const url = urlMatch[1];
                const title = this._clean(titleMatch[1]);
                const snippet = snippetMatch ? this._clean(snippetMatch[1]) : '';
                
                if (title && url && !url.includes('searx')) {
                    results.push({ title, link: url, snippet });
                }
            }
        }
        
        // Fallback parsing
        if (results.length < 3) {
            const divRegex = /<div[^>]*class="[^"]*result[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/gi;
            while ((match = divRegex.exec(html)) !== null) {
                const block = match[1];
                const urlMatch = block.match(/href="(https?:\/\/[^"]+)"/);
                const titleMatch = block.match(/<h[34][^>]*>([\s\S]*?)<\/h[34]>/);
                
                if (urlMatch && titleMatch) {
                    const url = urlMatch[1];
                    const title = this._clean(titleMatch[1]);
                    if (title && !url.includes('searx') && !results.some(r => r.link === url)) {
                        results.push({ title, link: url, snippet: '' });
                    }
                }
            }
        }
        
        return results.slice(0, 30);
    },

    _clean(html) {
        return (html || '')
            .replace(/<[^>]+>/g, '')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/&nbsp;/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .substring(0, 300);
    },

    _dedupe(items) {
        const seen = new Set();
        return items.filter(item => {
            try {
                const domain = new URL(item.link).hostname.replace('www.', '').toLowerCase();
                
                // Only ban the obvious non-academic sources
                if (this.BANNED_DOMAINS.some(b => domain.includes(b))) return false;
                
                // One result per domain
                if (seen.has(domain)) return false;
                seen.add(domain);
                return true;
            } catch { return false; }
        }).slice(0, 20);
    }
};
