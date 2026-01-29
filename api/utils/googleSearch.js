// api/utils/googleSearch.js
export const GoogleSearch = {
    BLOCKLIST: " -filetype:pdf -site:instagram.com -site:facebook.com -site:tiktok.com -site:twitter.com -site:pinterest.com -site:reddit.com -site:quora.com -site:wikipedia.org -site:youtube.com",
    BANNED_DOMAINS: ['instagram', 'facebook', 'tiktok', 'twitter', 'x.com', 'pinterest', 'reddit', 'quora', 'youtube', 'vimeo'],

    async search(query, apiKey, cx) {
        if (!apiKey || !cx) throw new Error("Missing Google Search Configuration");

        const cleanQuery = query.split(/\s+/).slice(0, 8).join(' '); 
        const finalQuery = `${cleanQuery} ${this.BLOCKLIST}`;
        const url = `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${cx}&q=${encodeURIComponent(finalQuery)}&num=10`;

        try {
            const res = await fetch(url);
            const data = await res.json();
            if (data.error) throw new Error(data.error.message);
            if (!data.items) return [];
            return this._deduplicate(data.items);
        } catch (e) {
            throw e; // Let main handler catch it
        }
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
                    unique.push({ title: item.title, link: item.link, snippet: item.snippet });
                }
            } catch (e) {}
        });
        return unique.slice(0, 8);
    }
};
