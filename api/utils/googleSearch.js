// api/utils/googleSearch.js
// Uses FREE public SearXNG instances - NO API KEY OR SERVER REQUIRED

import { GroqAPI } from './groqAPI.js';

const INSTANCES = [
    'https://search.sapti.me',
    'https://searx.tiekoetter.com', 
    'https://search.bus-hit.me',
    'https://searx.be',
    'https://search.ononoki.org',
    'https://priv.au',
    'https://searx.work',
    'https://search.mdosch.de',
    'https://searx.ramondia.net'
];

export const GoogleSearchAPI = {
    BANNED_DOMAINS: [
        'reddit', 'quora', 'stackoverflow', 'stackexchange',
        'youtube', 'tiktok', 'instagram', 'facebook', 'twitter', 'pinterest',
        'amazon', 'ebay', 'etsy', 'alibaba'
    ],

    async search(query, apiKey, cx, groqKey = null) {
        // Build multiple queries for different topics
        const queries = groqKey 
            ? await this._buildQueries(query, groqKey) 
            : [this._buildFallbackQuery(query)];
        
        console.log('[Search] Queries:', queries);
        
        let allResults = [];
        const shuffled = [...INSTANCES].sort(() => Math.random() - 0.5);
        
        // Search for each query separately
        for (const q of queries) {
            for (const instance of shuffled.slice(0, 4)) {
                try {
                    console.log('[Search] Trying:', instance, 'for:', q);
                    const results = await this._fetch(instance, q);
                    
                    if (results.length > 0) {
                        console.log('[Search] Got', results.length, 'results for:', q);
                        allResults = allResults.concat(results);
                        break;
                    }
                } catch (e) {
                    console.error('[Search] Failed:', instance, e.message);
                }
            }
        }
        
        // If still no results, try a simpler query
        if (allResults.length === 0) {
            console.log('[Search] Trying fallback query...');
            const fallback = this._buildFallbackQuery(query);
            for (const instance of shuffled.slice(0, 4)) {
                try {
                    const results = await this._fetch(instance, fallback);
                    if (results.length > 0) {
                        allResults = results;
                        break;
                    }
                } catch (e) {
                    console.error('[Search] Fallback failed:', instance);
                }
            }
        }
        
        if (allResults.length === 0) {
            console.error('[Search] All queries failed');
            return [];
        }
        
        return this._dedupe(allResults);
    },

    async _buildQueries(text, groqKey) {
        try {
            const prompt = `Identify 2-3 main topics in this text. Create one search query per topic.

TEXT:
"${text.substring(0, 1200)}"

Output format - one query per line (3-6 words each):
topic one research study
topic two academic analysis`;
            
            const response = await GroqAPI.chat([{ role: 'user', content: prompt }], groqKey, false);
            
            const queries = response
                .split('\n')
                .map(q => q.replace(/^[\d\.\-\*\•]+\s*/, '').replace(/["']/g, '').trim())
                .filter(q => q.length > 5 && q.split(/\s+/).length >= 2 && q.split(/\s+/).length <= 8)
                .slice(0, 3);
            
            console.log('[Search] Parsed queries:', queries);
            return queries.length > 0 ? queries : [this._buildFallbackQuery(text)];
        } catch (e) {
            console.error('[Search] Query building failed:', e.message);
            return [this._buildFallbackQuery(text)];
        }
    },

    _buildFallbackQuery(text) {
        const stopWords = new Set([
            'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
            'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
            'should', 'may', 'might', 'must', 'can', 'this', 'that', 'these',
            'those', 'i', 'you', 'he', 'she', 'it', 'we', 'they', 'my', 'your',
            'people', 'things', 'way', 'many', 'much', 'often', 'even', 'well'
        ]);
        
        const words = text.toLowerCase().match(/\b[a-z]{5,}\b/g) || [];
        const meaningful = [...new Set(words)].filter(w => !stopWords.has(w)).slice(0, 4);
        return meaningful.join(' ') + ' research study';
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
                
                if (this.BANNED_DOMAINS.some(b => domain.includes(b))) return false;
                if (seen.has(domain)) return false;
                seen.add(domain);
                return true;
            } catch { return false; }
        }).slice(0, 20);
    }
};
