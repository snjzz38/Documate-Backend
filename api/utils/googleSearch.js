// api/utils/googleSearch.js
import { GroqAPI } from './groqAPI.js';

export const GoogleSearchAPI = {
    BLOCKLIST: " -site:reddit.com -site:quora.com -site:amazon.com -site:ebay.com -site:facebook.com -site:twitter.com -site:instagram.com -site:tiktok.com -site:pinterest.com -site:youtube.com",

    async search(query, apiKey, cx, groqKey = null) {
        if (!apiKey || !cx) throw new Error("Missing Google Search Config");
        
        const keywords = groqKey 
            ? await this._extractKeywords(query, groqKey) 
            : this._fallback(query);
        
        const q = `${keywords} ${this.BLOCKLIST}`;
        
        // Fetch 2 pages in parallel
        const [p1, p2] = await Promise.all([
            this._fetch(q, 1, apiKey, cx),
            this._fetch(q, 11, apiKey, cx)
        ]);
        
        return this._dedupe([...p1, ...p2]);
    },

    async _extractKeywords(text, groqKey) {
        try {
            const prompt = `Extract 5 academic search keywords from this text. Return ONLY keywords separated by commas.\n\nText: "${text.substring(0, 600)}"\n\nKeywords:`;
            const response = await GroqAPI.chat([{ role: 'user', content: prompt }], groqKey, false);
            const kw = response.replace(/["'\n]/g, '').split(',').map(k => k.trim()).filter(k => k.length > 2).slice(0, 5).join(' ');
            return kw.length > 5 ? kw : this._fallback(text);
        } catch { return this._fallback(text); }
    },

    _fallback(text) {
        const stops = new Set(['this','that','the','and','for','are','but','not','with','from','have','been','will','would','their','what','about','which','when','also','more','into','only']);
        return [...new Set(text.toLowerCase().match(/\b[a-z]{5,}\b/g) || [])]
            .filter(w => !stops.has(w))
            .slice(0, 6)
            .join(' ');
    },

    async _fetch(q, start, key, cx) {
        try {
            const url = `https://www.googleapis.com/customsearch/v1?key=${key}&cx=${cx}&q=${encodeURIComponent(q)}&num=10&start=${start}`;
            console.log('[Search] Fetching:', q.substring(0, 50));
            const res = await fetch(url);
            const data = await res.json();
            
            if (data.error) {
                console.error('[Search] API Error:', data.error.message);
                return [];
            }
            
            console.log('[Search] Got results:', data.items?.length || 0);
            return data.items || [];
        } catch (e) {
            console.error('[Search] Fetch error:', e.message);
            return [];
        }
    },

    _dedupe(items) {
        const seen = new Set();
        const banned = ['stackoverflow','reddit','quora','amazon','youtube','facebook','twitter'];
        return items.filter(item => {
            try {
                const domain = new URL(item.link).hostname.replace('www.', '').toLowerCase();
                if (banned.some(b => domain.includes(b))) return false;
                if (seen.has(domain)) return false;
                seen.add(domain);
                return true;
            } catch { return false; }
        }).slice(0, 10).map(item => ({ title: item.title, link: item.link, snippet: item.snippet }));
    }
};
