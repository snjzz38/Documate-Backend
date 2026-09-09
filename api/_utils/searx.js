// ==========================================================================
// FILE PATH: api/_utils/searx.js
// ==========================================================================

/**
 * api/_utils/searx.js
 * DocuMate SearXNG Web Search Utility
 * 
 * Table of Contents:
 * 1. SearXNG Query Builder Module
 * 2. SearXNG Client & Fetcher Module
 */

// ==========================================================================
// MODULE 1: SearXNG Query Builder
// ==========================================================================
export const SearxQueryBuilder = {
    /**
     * Clean and format query for general web searches (excluding dry academic indexes)
     */
    buildGeneralQuery(text) {
        if (!text) return 'general research';
        
        // Remove scholarly terms to reduce duplicate academic results
        const cleaned = text
            .replace(/\b(academic|scholarly|literature|scientific|journal|publication|thesis|paper)\b/gi, '')
            .replace(/\s+/g, ' ')
            .trim();
            
        return cleaned || 'general research';
    }
};

// ==========================================================================
// MODULE 2: SearXNG Client & Fetcher
// ==========================================================================
export const SearxAPI = {
    // Comprehensive public SearXNG instance pool synchronized with reliable nodes
    INSTANCES: [
        "https://priv.au",
        "https://searx.ononoki.org",
        "https://searxng.site",
        "https://searxng.website",
        "https://searx.linxx.net",
        "https://search.yuri.llc",
        "https://searx.tiekoetter.com",
        "https://searxng.deggo.fyi",
        "https://search.mdosch.de",
        "https://searx.oloke.xyz",
        "https://search.mectov.my.id",
        "https://search.serpensin.com",
        "https://search.femboy.ad",
        "https://search.inetol.net",
        "https://search.lumy.live",
        "https://etsi.me",
        "https://sx.xo.st",
        "https://search.pereira.is",
        "https://search.pi.vps.pw",
        "https://opnxng.com",
        "https://searxng.buffon.cloud",
        "https://searx.redgarden.cv",
        "https://searx.dresden.network",
        "https://paulgo.io",
        "https://search.2b9t.xyz",
        "https://baresearch.org",
        "https://sx.catgirl.cloud",
        "https://search.ctq.ro",
        "https://libresearch.space",
        "https://searx.party",
        "https://searx.ro",
        "https://search.catboy.house",
        "https://searx.rhscz.eu",
        "https://search.bladerunn.in",
        "https://searx.thefloatinglab.world",
        "https://sear.lurx.net",
        "https://search.spiralab.org",
        "https://searxng.shreven.org",
        "https://search.undertale.uk",
        "https://searx.perennialte.ch",
        "https://search.hbubli.cc",
        "https://kantan.cat",
        "https://anonsearch.win",
        "https://failsearx.culturanerd.it",
        "https://find.xenorio.xyz",
        "https://grep.vim.wtf",
        "https://search.chocolatemoo53.com",
        "https://search.ethibox.fr",
        "https://search.im-in.space",
        "https://search.indst.eu",
        "https://search.liuzj.net",
        "https://search.minus27315.dev",
        "https://search.rhscz.eu",
        "https://search.rowie.at",
        "https://searx.namejeff.xyz",
        "https://searxng.gdebest.net",
        "https://www.gruble.de",
        "https://xka.cz",
        "https://searxng.eshnetwork.space",
        "https://searx.ankha.ac",
        "https://searxng.moonshadow.dev",
        "https://search.unredacted.org",
        "https://searx.mxchange.org",
        "https://search.zina.dev",
        "https://search.einfachzocken.eu",
        "https://search.jns.net.ar",
        "https://searx.tsmdt.de",
        "https://searxng.cups.moe",
        "https://searxng.gr",
        "https://searxng.tr",
        "https://searxng.wuemeli.com",
        "https://search.anoni.net",
        "https://searx.mbuf.net"
    ],

    /**
     * Internal helper to fetch results from a single instance with timeout safeguards
     */
    async _fetchInstance(baseUrl, searchQuery, options = {}) {
        const {
            category = 'general',
            timeRange = '',
            timeoutMs = 3500
        } = options;

        const cleanBaseUrl = baseUrl.replace(/\/+$/, '');
        const params = new URLSearchParams({
            q: searchQuery,
            format: 'json',
            categories: category
        });

        if (timeRange) {
            params.set('time_range', timeRange);
        }

        const url = `${cleanBaseUrl}/search?${params.toString()}`;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

        try {
            const res = await fetch(url, {
                signal: controller.signal,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                    'Accept': 'application/json'
                }
            });

            if (!res.ok) {
                throw new Error(`HTTP ${res.status}`);
            }

            const data = await res.json();

            if (data.error || !data.results || !Array.isArray(data.results)) {
                throw new Error('Non-JSON response or JSON API disabled');
            }

            return { instance: cleanBaseUrl, results: data.results };
        } finally {
            clearTimeout(timeoutId);
        }
    },

    /**
     * Executes a web search across the instance pool until valid results are returned.
     * 
     * @param {string} query Search terms.
     * @param {number} limit Maximum results to return (default: 10).
     * @param {Object} options Configuration parameters.
     * @param {string} options.category Category type (general, news, science, it, images).
     * @param {string} options.timeRange Time range restriction (day, week, month, year).
     */
    async search(query, limit = 10, options = {}) {
        if (!query) return [];

        const searchQuery = SearxQueryBuilder.buildGeneralQuery(query);
        const customUrl = process.env.SEARX_INSTANCE_URL;

        // Custom environment override takes single priority
        if (customUrl) {
            try {
                const response = await this._fetchInstance(customUrl, searchQuery, options);
                return this._formatResults(response.results, limit);
            } catch (err) {
                console.error(`[SearX] Custom instance failed (${customUrl}):`, err.message);
                return [];
            }
        }

        // Shuffle fallback pool
        const pool = [...this.INSTANCES].sort(() => Math.random() - 0.5);
        
        // Process pool sequentially in attempts
        for (let i = 0; i < pool.length; i++) {
            const baseUrl = pool[i];
            try {
                const response = await this._fetchInstance(baseUrl, searchQuery, options);
                
                if (response.results.length === 0) {
                    console.warn(`[SearX] 0 results returned from ${baseUrl}. Trying next node...`);
                    continue;
                }

                console.log(`[SearX] Successful search via ${baseUrl} (${response.results.length} items)`);
                return this._formatResults(response.results, limit);
            } catch (err) {
                console.warn(`[SearX] Failed node (${baseUrl}): ${err.message}`);
            }
        }

        console.error('[SearX] All public SearXNG instances in the fallback pool failed or rate-limited.');
        return [];
    },

    /**
     * Standardizes SearXNG API schema outputs to DocuMate metadata format
     */
    _formatResults(results, limit) {
        return results.slice(0, limit).map(item => {
            let year = 'n.d.';
            if (item.published_date) {
                const match = String(item.published_date).match(/\b(20\d{2})\b/);
                if (match) year = match[1];
            }

            let siteName = 'Web Source';
            try {
                const hostname = new URL(item.url).hostname.replace(/^www\./, '');
                const parts = hostname.split('.');
                if (parts.length > 0 && parts[0]) {
                    siteName = parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
                }
            } catch {}

            return {
                title: item.title || item.url || 'Untitled Web Source',
                link: item.url,
                snippet: item.content || item.snippet || 'No summary available.',
                source: 'searx',
                meta: {
                    author: null,
                    year: year,
                    published: year,
                    siteName: siteName,
                    engines: item.engines || []
                }
            };
        });
    }
};
