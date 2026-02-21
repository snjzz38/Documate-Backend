// api/utils/googleSearch.js
import { GroqAPI } from './groqAPI.js';

export const GoogleSearchAPI = {
    // Only block forums and shopping - keep Wikipedia for some topics
    BLOCKLIST: " -site:reddit.com -site:quora.com -site:amazon.com -site:ebay.com -site:facebook.com -site:twitter.com -site:instagram.com -site:tiktok.com -site:pinterest.com -site:youtube.com",
    
    BANNED_DOMAINS: [
        'stackoverflow', 'stackexchange', 'mathoverflow', 'superuser', 'askubuntu',
        'reddit', 'quora', 'answers.com', 'answers.yahoo',
        'amazon', 'ebay', 'alibaba', 'etsy', 'walmart', 'target', 'shopping',
        'facebook', 'twitter', 'x.com', 'instagram', 'tiktok', 'pinterest', 'linkedin',
        'youtube', 'vimeo', 'dailymotion', 'tiktok'
    ],

    async search(query, apiKey, cx, groqKey = null) {
        if (!apiKey || !cx) {
            console.error('[Search] Missing API key or CX');
            throw new Error("Missing Google Search Configuration");
        }
        
        // Extract keywords
        const keywords = groqKey 
            ? await this._extractKeywords(query, groqKey) 
            : this._fallbackExtract(query);
        
        console.log('[Search] Keywords:', keywords);
        
        // Split keywords into groups for multiple searches
        const keywordList = keywords.split(/[,\s]+/).filter(k => k.length > 2);
        
        // Create search queries
        const queries = [];
        queries.push(keywordList.slice(0, 4).join(' '));
        
        if (keywordList.length > 2) {
            queries.push(keywordList.slice(0, Math.ceil(keywordList.length / 2)).join(' '));
        }
        
        if (keywordList.length > 3) {
            queries.push(keywordList.slice(Math.ceil(keywordList.length / 2)).join(' '));
        }
        
        queries.push(keywordList.slice(0, 2).join(' ') + ' philosophy academic');
        
        // Run searches
        const allResults = [];
        for (const q of queries.slice(0, 3)) {
            const finalQuery = `${q} ${this.BLOCKLIST}`;
            try {
                const results = await this._fetch(finalQuery, 1, apiKey, cx);
                allResults.push(...results);
            } catch (e) {
                console.error('[Search] Query failed:', e.message);
            }
        }
        
        // Second page of first query
        try {
            const finalQuery = `${queries[0]} ${this.BLOCKLIST}`;
            const page2 = await this._fetch(finalQuery, 11, apiKey, cx);
            allResults.push(...page2);
        } catch {}
        
        console.log('[Search] Total results before dedupe:', allResults.length);
        return this._dedupe(allResults);
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
        } catch (e) {
            console.error('[Search] Keyword extraction failed:', e.message);
            return this._fallbackExtract(text);
        }
    },

    _fallbackExtract(text) {
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
        
        const properNouns = text.match(/(?<=[.!?]\s+\w+\s+)[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*/g) || [];
        const longWords = [...new Set(text.toLowerCase().match(/\b[a-z]{8,}\b/g) || [])]
            .filter(w => !stops.has(w));
        
        const combined = [...new Set([...properNouns, ...longWords])]
            .slice(0, 6)
            .join(' ');
        
        return combined.length > 10 ? combined : text.substring(0, 100);
    },

    async _fetch(q, start, key, cx) {
        try {
            const url = `https://www.googleapis.com/customsearch/v1?key=${key}&cx=${cx}&q=${encodeURIComponent(q)}&num=10&start=${start}`;
            console.log('[Search] Fetching:', q.substring(0, 60));
            
            const res = await fetch(url);
            const data = await res.json();
            
            // Check for Google API errors
            if (data.error) {
                console.error('[Search] Google API Error:', data.error.code, data.error.message);
                // Return specific error info
                if (data.error.code === 403) {
                    console.error('[Search] API key may be invalid or quota exceeded');
                }
                if (data.error.code === 400) {
                    console.error('[Search] Bad request - check Search Engine ID (cx)');
                }
                return [];
            }
            
            console.log('[Search] Got', data.items?.length || 0, 'results');
            return data.items || [];
        } catch (e) {
            console.error('[Search] Fetch error:', e.message);
            return [];
        }
    },

    _dedupe(items) {
        const seen = new Set();
        const results = items.filter(item => {
            try {
                const domain = new URL(item.link).hostname.replace('www.', '').toLowerCase();
                if (this.BANNED_DOMAINS.some(b => domain.includes(b))) return false;
                if (seen.has(domain)) return false;
                seen.add(domain);
                return true;
            } catch { return false; }
        }).slice(0, 10).map(item => ({ title: item.title, link: item.link, snippet: item.snippet }));
        
        console.log('[Search] Final results after dedupe:', results.length);
        return results;
    }
};
