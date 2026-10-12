// ==========================================================================
// FILE PATH: api/_utils/searx.js (Upgraded to Universal Web/Academic Engine)
// ==========================================================================

/**
 * api/_utils/searx.js - Resilient Multi-Provider Fallback Engine
 * Combines Crossref (Open Academic DOI Index) and DuckDuckGo Lite
 * to replace broken public SearXNG instances.
 */

const USER_AGENT = 'DocuMate/1.0 (https://documate.app; mailto:contact@documate.app)';

export const SearxAPI = {
    async search(query, limit = 6) {
        if (!query || query.trim().length === 0) return [];
        const cleanQuery = query.replace(/[^\w\s-]/g, ' ').trim();

        // Run Crossref (Academic) and DuckDuckGo Lite (General Web) concurrently
        const [crossrefResults, webResults] = await Promise.allSettled([
            this.searchCrossref(cleanQuery, limit),
            this.searchDuckDuckGo(cleanQuery, limit)
        ]);

        const combined = [];
        if (crossrefResults.status === 'fulfilled') combined.push(...crossrefResults.value);
        if (webResults.status === 'fulfilled') combined.push(...webResults.value);

        // Deduplicate by URL
        const seen = new Set();
        return combined.filter(item => {
            const id = item.doi || item.url;
            if (!id || seen.has(id)) return false;
            seen.add(id);
            return true;
        }).slice(0, limit);
    },

    /**
     * Crossref API: 100% Free open peer-reviewed papers with complete citation metadata
     */
    async searchCrossref(query, limit) {
        try {
            const url = `https://api.crossref.org/works?query=${encodeURIComponent(query)}&rows=${limit}&select=DOI,title,URL,abstract,author,published-print,published-online`;
            const res = await fetch(url, {
                headers: { 'User-Agent': USER_AGENT }
            });

            if (!res.ok) return [];
            const data = await res.json();
            const items = data.message?.items || [];

            return items.map(item => {
                const title = Array.isArray(item.title) ? item.title[0] : (item.title || 'Untitled Academic Paper');
                const doi = item.DOI;
                const link = item.URL || (doi ? `https://doi.org/${doi}` : '');
                const year = item['published-print']?.['date-parts']?.[0]?.[0] || 
                             item['published-online']?.['date-parts']?.[0]?.[0] || 'n.d.';
                
                const authorList = (item.author || []).map(a => `${a.given || ''} ${a.family || ''}`.trim()).filter(Boolean);
                const author = authorList.length ? authorList.join(', ') : 'Academic Contributor';

                return {
                    title,
                    url: link,
                    link,
                    doi,
                    content: item.abstract || `${title} (${year}). Published in peer-reviewed proceedings.`,
                    snippet: item.abstract || title,
                    meta: {
                        isDOI: !!doi,
                        author,
                        year,
                        siteName: 'Crossref / Academic Index'
                    }
                };
            });
        } catch (e) {
            console.warn('[Crossref] Failed:', e.message);
            return [];
        }
    },

    /**
     * DuckDuckGo Lite: Parses clean organic web search results without API keys
     */
    async searchDuckDuckGo(query, limit) {
        try {
            const url = `https://lite.duckduckgo.com/lite/`;
            const res = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
                },
                body: `q=${encodeURIComponent(query)}`
            });

            if (!res.ok) return [];
            const html = await res.text();

            // Extract links and snippets from DuckDuckGo Lite table format
            const results = [];
            const linkRegex = /<a[^>]+class=['"]result-link['"][^>]+href=['"]([^'"]+)['"][^>]*>([\s\S]*?)<\/a>/gi;
            const snippetRegex = /<td[^>]+class=['"]result-snippet['"][^>]*>([\s\S]*?)<\/td>/gi;

            const links = [];
            let match;
            while ((match = linkRegex.exec(html)) && links.length < limit) {
                // Decode DDG redirect URL if applicable
                let targetUrl = match[1];
                if (targetUrl.includes('uddg=')) {
                    const parsed = new URL('https://lite.duckduckgo.com' + targetUrl);
                    targetUrl = decodeURIComponent(parsed.searchParams.get('uddg') || targetUrl);
                }
                const title = match[2].replace(/<[^>]+>/g, '').trim();
                links.push({ url: targetUrl, title });
            }

            const snippets = [];
            while ((match = snippetRegex.exec(html)) && snippets.length < limit) {
                snippets.push(match[1].replace(/<[^>]+>/g, '').trim());
            }

            for (let i = 0; i < links.length; i++) {
                if (links[i].url && !links[i].url.includes('duckduckgo.com')) {
                    results.push({
                        title: links[i].title,
                        url: links[i].url,
                        link: links[i].url,
                        snippet: snippets[i] || links[i].title,
                        content: snippets[i] || '',
                        meta: {
                            isDOI: false,
                            siteName: new URL(links[i].url).hostname.replace(/^www\./, '')
                        }
                    });
                }
            }

            return results;
        } catch (e) {
            console.warn('[DDG Lite] Failed:', e.message);
            return [];
        }
    }
};
