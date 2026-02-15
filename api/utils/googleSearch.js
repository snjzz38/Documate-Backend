// api/utils/googleSearch.js
import { GroqAPI } from './groqAPI.js';

export const GoogleSearchAPI = {
    BLOCKLIST: " -site:stackoverflow.com -site:stackexchange.com -site:mathoverflow.net -site:reddit.com -site:quora.com -site:amazon.com -site:ebay.com -site:facebook.com -site:twitter.com -site:instagram.com -site:tiktok.com -site:pinterest.com -site:youtube.com -site:wikipedia.org",
    
    BANNED_DOMAINS: [
        'stackoverflow', 'stackexchange', 'mathoverflow', 'superuser', 'serverfault', 'askubuntu',
        'reddit', 'quora', 'answers.com',
        'amazon', 'ebay', 'alibaba', 'etsy', 'walmart', 'target',
        'facebook', 'twitter', 'x.com', 'instagram', 'tiktok', 'pinterest', 'linkedin',
        'youtube', 'vimeo', 'dailymotion',
        'wikipedia', 'fandom.com', 'wikia.com'
    ],

    async search(query, apiKey, cx, groqKey = null) {
        if (!apiKey || !cx) throw new Error("Missing Google Search Configuration");
        
        const searchQuery = groqKey ? await this._extractKeywords(query, groqKey) : this._fallbackExtract(query);
        const finalQuery = `${searchQuery} ${this.BLOCKLIST}`;
        
        const [page1, page2] = await Promise.all([
            this._fetch(finalQuery, 1, apiKey, cx),
            this._fetch(finalQuery, 11, apiKey, cx)
        ]);
        
        return this._dedupe([...page1, ...page2]);
    },

    async _extractKeywords(text, groqKey) {
        try {
            const prompt = `Extract 4-6 academic search keywords from this text. Return ONLY keywords separated by spaces.
Text: "${text.substring(0, 1000)}"
Keywords:`;
            const response = await GroqAPI.chat([{ role: 'user', content: prompt }], groqKey, false);
            const keywords = response.replace(/["'\n]/g, '').trim().split(/\s+/).filter(w => w.length > 2).slice(0, 6).join(' ');
            return keywords.length > 10 ? keywords : this._fallbackExtract(text);
        } catch { return this._fallbackExtract(text); }
    },

    _fallbackExtract(text) {
        const stops = new Set(['this','that','the','and','for','are','but','not','you','all','can','had','her','was','one','our','out','with','have','from','that','been','they','will','would','there','their','what','about','which','when','make','like','just','over','such','into','than','them','then','these','some','could','other']);
        return [...new Set(text.toLowerCase().match(/\b[a-z]{4,}\b/g) || [])]
            .filter(w => !stops.has(w))
            .sort((a, b) => b.length - a.length)
            .slice(0, 6)
            .join(' ');
    },

    async _fetch(q, start, key, cx) {
        try {
            const res = await fetch(`https://www.googleapis.com/customsearch/v1?key=${key}&cx=${cx}&q=${encodeURIComponent(q)}&num=10&start=${start}`);
            return (await res.json()).items || [];
        } catch { return []; }
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
        }).slice(0, 10).map(item => ({ title: item.title, link: item.link, snippet: item.snippet }));
    }
};
