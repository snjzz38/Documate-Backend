// api/utils/googleSearch.js

export const GoogleSearchAPI = {

    // Explicit junk blocklist (NO pdf blocking)
    BLOCKLIST: `
        -site:instagram.com 
        -site:facebook.com 
        -site:tiktok.com 
        -site:twitter.com 
        -site:x.com 
        -site:pinterest.com 
        -site:reddit.com 
        -site:quora.com 
        -site:wikipedia.org 
        -site:youtube.com
        -blog -opinion
    `.replace(/\s+/g, ' ').trim(),

    BANNED_DOMAINS: [
        'instagram', 'facebook', 'tiktok', 'twitter', 'x.com',
        'pinterest', 'reddit', 'quora', 'youtube', 'vimeo', 'linkedin'
    ],

    // ------------------------------------------------------------------
    // PUBLIC ENTRY
    // ------------------------------------------------------------------
    async search(context, apiKey, cx) {
        if (!apiKey || !cx) throw new Error("Missing Google Search Configuration");

        const finalQuery = `${this._buildBalancedQuery(context)} ${this.BLOCKLIST}`;

        // Same cost as before: 2 pages = 20 results
        const [page1, page2] = await Promise.all([
            this._fetchPage(finalQuery, 1, apiKey, cx),
            this._fetchPage(finalQuery, 11, apiKey, cx)
        ]);

        const allItems = [...page1, ...page2];

        if (!allItems.length) return [];

        // 🔑 Sort BEFORE deduplication
        const prioritized = allItems.sort((a, b) =>
            this._estimateAcademicWeight(b.link) -
            this._estimateAcademicWeight(a.link)
        );

        return this._deduplicate(prioritized);
    },

    // ------------------------------------------------------------------
    // QUERY BUILDER (ONE QUERY, MANY SIGNALS)
    // ------------------------------------------------------------------
    _buildBalancedQuery(context) {
        const sentence = context
            .split(/[.!?]/)
            .map(s => s.trim())
            .find(s => s.length > 60) || context;

        return `
            "${sentence}"
            (doi OR "journal" OR "study" OR "research")
            (site:.gov OR site:.edu OR WHO OR OECD OR CDC OR NIH)
            (pdf OR "full text")
        `.replace(/\s+/g, ' ').trim();
    },

    // ------------------------------------------------------------------
    // GOOGLE FETCH
    // ------------------------------------------------------------------
    async _fetchPage(q, start, key, cx) {
        try {
            const url =
                `https://www.googleapis.com/customsearch/v1` +
                `?key=${key}` +
                `&cx=${cx}` +
                `&q=${encodeURIComponent(q)}` +
                `&num=10` +
                `&start=${start}`;

            const res = await fetch(url);
            const data = await res.json();
            return data.items || [];
        } catch {
            return [];
        }
    },

    // ------------------------------------------------------------------
    // ACADEMIC PRIORITIZATION HEURISTIC
    // ------------------------------------------------------------------
    _estimateAcademicWeight(url) {
        if (!url) return 0;

        // Tier 1 signals
        if (/doi\.org|springer|sciencedirect|wiley|ieee|acm|nature\.com/.test(url))
            return 3;

        // Tier 2 signals
        if (/\.gov|\.edu|who\.int|oecd\.org|cdc\.gov|nih\.gov|rand\.org|nber\.org/.test(url))
            return 2;

        // Everything else
        return 1;
    },

    // ------------------------------------------------------------------
    // DOMAIN-LEVEL DEDUP + HARD LIMIT
    // ------------------------------------------------------------------
    _deduplicate(items) {
        const unique = [];
        const seenDomains = new Set();

        for (const item of items) {
            try {
                const domain = new URL(item.link)
                    .hostname
                    .replace('www.', '')
                    .toLowerCase();

                if (this.BANNED_DOMAINS.some(b => domain.includes(b))) continue;

                if (!seenDomains.has(domain)) {
                    seenDomains.add(domain);
                    unique.push({
                        title: item.title,
                        link: item.link,
                        snippet: item.snippet
                    });
                }

                if (unique.length === 10) break;

            } catch {}
        }

        return unique;
    }
};
