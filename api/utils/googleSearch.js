// api/utils/googleSearch.js
export const GoogleSearchAPI = {
    BLOCKLIST: " -filetype:pdf -site:instagram.com -site:facebook.com -site:tiktok.com -site:twitter.com -site:pinterest.com -site:reddit.com -site:quora.com -site:wikipedia.org -site:youtube.com",
    BANNED_DOMAINS: ['instagram', 'facebook', 'tiktok', 'twitter', 'x.com', 'pinterest', 'reddit', 'quora', 'youtube', 'vimeo', 'linkedin'],

    async search(query, apiKey, cx) {
        if (!apiKey || !cx) throw new Error("Missing Google Search Configuration");

        const cleanQuery = query.split(/\s+/).slice(0, 8).join(' '); 
        const finalQuery = `${cleanQuery} ${this.BLOCKLIST}`;
        
        // Fetch 2 pages (20 results) to ensure we have enough after filtering
        const [page1, page2] = await Promise.all([
            this._fetchPage(finalQuery, 1, apiKey, cx),
            this._fetchPage(finalQuery, 11, apiKey, cx)
        ]);

        const allItems = [...page1, ...page2];
        if (allItems.length === 0) return [];

        return this._deduplicate(allItems);
    },

    async _fetchPage(q, start, key, cx) {
        try {
            const url = `https://www.googleapis.com/customsearch/v1?key=${key}&cx=${cx}&q=${encodeURIComponent(q)}&num=10&start=${start}`;
            const res = await fetch(url);
            const data = await res.json();
            return data.items || [];
        } catch (e) { return []; }
    },

    _deduplicate(items) {
        const unique = [];
        const seenDomains = new Set();
        
        items.forEach(item => {
            try {
                const domain = new URL(item.link).hostname.replace('www.', '').toLowerCase();
                if (this.BANNED_DOMAINS.some(b => domain.includes(b))) return;
                
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
        
        // Return 10 sources (Fixed from 8)
        return unique.slice(0, 10);
    }
};
