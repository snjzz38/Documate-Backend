// api/utils/googleSearch.js
// Uses FREE public SearXNG instances - NO API KEY OR SERVER REQUIRED

import { GroqAPI } from './groqAPI.js';

// Reliable public SearXNG instances (from searx.space)
const INSTANCES = [
    'https://search.sapti.me',
    'https://searx.tiekoetter.com', 
    'https://search.bus-hit.me',
    'https://searx.be',
    'https://search.ononoki.org',
    'https://priv.au'
];

export const GoogleSearchAPI = {
    BANNED_DOMAINS: [
        'reddit', 'quora', 'amazon', 'ebay', 'facebook', 'twitter', 
        'instagram', 'tiktok', 'pinterest', 'linkedin', 'youtube',
        // Filter non-English and low-quality domains
        'drk.de', 'sucht', 'beratung', // German
        'recovered.org', 'therecover', 'laopcenter', // Rehab marketing sites
        'answers.com', 'wiki.answers'
    ],

    async search(query, apiKey, cx, groqKey = null) {
        // apiKey and cx ignored - using free SearXNG instead
        
        const keywords = groqKey 
            ? await this._extractKeywords(query, groqKey) 
            : this._fallbackExtract(query);
        
        console.log('[Search] Keywords:', keywords);
        
        // Try instances until one works
        const shuffled = [...INSTANCES].sort(() => Math.random() - 0.5);
        
        for (const instance of shuffled.slice(0, 3)) {
            try {
                console.log('[Search] Trying:', instance);
                const results = await this._fetch(instance, keywords);
                
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

    async _fetch(instance, query) {
        const url = `${instance}/search?q=${encodeURIComponent(query)}&categories=general&language=en`;
        
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
        
        // Method 1: Parse <article class="result"> blocks
        const articleRegex = /<article[^>]*class="[^"]*result[^"]*"[^>]*>([\s\S]*?)<\/article>/gi;
        let match;
        
        while ((match = articleRegex.exec(html)) !== null) {
            const block = match[1];
            
            // Get URL
            const urlMatch = block.match(/href="(https?:\/\/[^"]+)"/);
            // Get title from <h3> or <a>
            const titleMatch = block.match(/<h3[^>]*>([\s\S]*?)<\/h3>/) || 
                              block.match(/<a[^>]*>([\s\S]*?)<\/a>/);
            // Get snippet from <p class="content">
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
        
        // Method 2: Fallback - parse any result-like structure
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
        
        return results.slice(0, 15);
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

    async _extractKeywords(text, groqKey) {
        try {
            const prompt = `Extract 4-6 search keywords from this text. Return ONLY keywords separated by spaces.

Text: "${text.substring(0, 600)}"

Keywords:`;
            
            const response = await GroqAPI.chat([{ role: 'user', content: prompt }], groqKey, false);
            
            const kw = response
                .replace(/["'\n]/g, '')
                .replace(/keywords:?/gi, '')
                .trim()
                .split(/[,\s]+/)
                .filter(k => k.length > 2)
                .slice(0, 6)
                .join(' ');
            
            return kw.length > 5 ? kw : this._fallbackExtract(text);
        } catch {
            return this._fallbackExtract(text);
        }
    },

    _fallbackExtract(text) {
        const stops = new Set(['this','that','the','and','for','are','but','not','you','all',
            'can','had','was','one','our','with','have','from','been','they','will','would',
            'there','their','what','about','which','when','make','like','just','over']);
        
        const words = text.toLowerCase().match(/\b[a-z]{4,}\b/g) || [];
        return [...new Set(words)].filter(w => !stops.has(w)).slice(0, 6).join(' ') 
            || text.substring(0, 50);
    },

    _dedupe(items) {
        const seen = new Set();
        return items.filter(item => {
            try {
                const domain = new URL(item.link).hostname.replace('www.', '');
                if (this.BANNED_DOMAINS.some(b => domain.includes(b))) return false;
                if (seen.has(domain)) return false;
                seen.add(domain);
                return true;
            } catch { return false; }
        }).slice(0, 10);
    }
};
