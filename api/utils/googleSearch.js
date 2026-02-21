// api/utils/googleSearch.js
import { GroqAPI } from './groqAPI.js';

export const GoogleSearchAPI = {
    BLOCKLIST: " -site:reddit.com -site:quora.com -site:amazon.com -site:youtube.com",
    
    BANNED_DOMAINS: [
        'stackoverflow', 'stackexchange', 'reddit', 'quora', 'answers.com',
        'amazon', 'ebay', 'facebook', 'twitter', 'instagram', 'tiktok', 
        'pinterest', 'linkedin', 'youtube', 'vimeo'
    ],

    async search(query, apiKey, cx, groqKey = null) {
        if (!apiKey || !cx) {
            throw new Error("Missing Google API key or Search Engine ID");
        }
        
        // Extract keywords (use Groq if available, otherwise fallback)
        const keywords = groqKey 
            ? await this._extractKeywords(query, groqKey) 
            : this._fallbackExtract(query);
        
        console.log('[Search] Keywords:', keywords);
        
        // SINGLE QUERY ONLY - to save quota
        const finalQuery = `${keywords} ${this.BLOCKLIST}`;
        
        const results = await this._fetch(finalQuery, 1, apiKey, cx);
        
        if (!results || results.length === 0) {
            console.error('[Search] No results returned from Google API');
            return [];
        }
        
        return this._dedupe(results);
    },

    async _extractKeywords(text, groqKey) {
        try {
            const prompt = `Extract 4-6 academic search keywords from this text. Return ONLY the keywords separated by spaces, nothing else.

Text: "${text.substring(0, 800)}"

Keywords:`;
            
            const response = await GroqAPI.chat([{ role: 'user', content: prompt }], groqKey, false);
            
            const keywords = response
                .replace(/["'\n]/g, '')
                .replace(/keywords:?/gi, '')
                .trim()
                .split(/[,\s]+/)
                .filter(k => k.length > 2 && k.length < 30)
                .slice(0, 6)
                .join(' ');
            
            return keywords.length > 5 ? keywords : this._fallbackExtract(text);
        } catch (e) {
            console.error('[Search] Keyword extraction failed:', e.message);
            return this._fallbackExtract(text);
        }
    },

    _fallbackExtract(text) {
        const stops = new Set([
            'this','that','the','and','for','are','but','not','you','all','can','had',
            'was','one','our','with','have','from','been','they','will','would','there',
            'their','what','about','which','when','make','like','just','over','such',
            'into','than','them','then','these','some','could','other','more','also'
        ]);
        
        const words = text.toLowerCase().match(/\b[a-z]{5,}\b/g) || [];
        const meaningful = [...new Set(words)]
            .filter(w => !stops.has(w))
            .slice(0, 6);
        
        return meaningful.join(' ') || text.split(/\s+/).slice(0, 6).join(' ');
    },

    async _fetch(q, start, key, cx) {
        const url = `https://www.googleapis.com/customsearch/v1?key=${key}&cx=${cx}&q=${encodeURIComponent(q)}&num=10&start=${start}`;
        
        console.log('[Search] Fetching:', q.substring(0, 50));
        
        try {
            const res = await fetch(url);
            const data = await res.json();
            
            // Log full error for debugging
            if (data.error) {
                console.error('[Search] Google API Error:', JSON.stringify(data.error));
                throw new Error(`Google API: ${data.error.message || 'Unknown error'}`);
            }
            
            console.log('[Search] Results:', data.items?.length || 0);
            return data.items || [];
            
        } catch (e) {
            console.error('[Search] Fetch failed:', e.message);
            throw e; // Re-throw to surface the error
        }
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
        }).slice(0, 10).map(item => ({ 
            title: item.title, 
            link: item.link, 
            snippet: item.snippet 
        }));
    }
};
