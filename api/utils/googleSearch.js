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
            const prompt = `Identify the CORE ACADEMIC TOPICS from this text for a scholarly search.

TEXT: "${text.substring(0, 1500)}"

RULES:
1. Extract specific theories, concepts, proper nouns, researcher names
2. Ignore generic words like "history", "knowledge", "truth", "discovery"
3. Focus on: named theories, methodologies, specific studies, researcher names, technical terms
4. Return 4-8 keywords/phrases separated by commas

EXAMPLES:
- Text about Pompeii DNA → "Pompeii DNA analysis, ancient genetics"
- Text about Peter Turchin → "cliodynamics, Peter Turchin, secular cycles, Seshat"
- Text about mathematical platonism → "mathematical platonism, philosophy of mathematics, abstract objects"

KEYWORDS:`;
            const response = await GroqAPI.chat([{ role: 'user', content: prompt }], groqKey, false);
            
            // Clean response - split by comma or space, filter junk
            let keywords = response
                .replace(/["'\n]/g, '')
                .replace(/KEYWORDS:?/gi, '')
                .trim()
                .split(/[,\n]+/)
                .map(k => k.trim())
                .filter(k => k.length > 2 && k.length < 50)
                .slice(0, 6)
                .join(' ');
            
            return keywords.length > 10 ? keywords : this._fallbackExtract(text);
        } catch { return this._fallbackExtract(text); }
    },

    _fallbackExtract(text) {
        // Prioritize proper nouns, technical terms, and longer words
        const stops = new Set([
            'this','that','the','and','for','are','but','not','you','all','can','had','her','was',
            'one','our','out','with','have','from','been','they','will','would','there','their',
            'what','about','which','when','make','like','just','over','such','into','than','them',
            'then','these','some','could','other','more','also','being','through','where','after',
            'most','only','come','made','find','know','take','people','into','year','your','good',
            'some','them','see','time','very','when','come','could','now','than','first','been',
            'call','who','its','way','may','down','side','work','back','even','new','want','because',
            'any','give','day','most','historical','knowledge','history','truth','objective','process',
            'discovered','discovery','understanding','interpretation','suggests','implies','proves'
        ]);
        
        // Extract potential proper nouns (capitalized words not at sentence start)
        const properNouns = text.match(/(?<=[.!?]\s+\w+\s+)[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*/g) || [];
        
        // Extract long words (likely technical terms)
        const longWords = [...new Set(text.toLowerCase().match(/\b[a-z]{8,}\b/g) || [])]
            .filter(w => !stops.has(w));
        
        // Combine and prioritize
        const combined = [...new Set([...properNouns, ...longWords])]
            .slice(0, 6)
            .join(' ');
        
        return combined.length > 10 ? combined : text.substring(0, 100);
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
