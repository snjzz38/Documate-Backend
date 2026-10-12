// ==========================================================================
// FILE PATH: api/_utils/searx.js
// ==========================================================================

/**
 * api/_utils/searx.js
 * Dedicated DuckDuckGo Lite Backend Scraping & Decoding Engine
 * 
 * Intercepts, unmasks, and transforms DuckDuckGo Lite search tables
 * directly on the backend without requiring external client calls.
 */

const BROWSER_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Content-Type': 'application/x-www-form-urlencoded',
    'Origin': 'https://lite.duckduckgo.com',
    'Referer': 'https://lite.duckduckgo.com/',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'same-origin',
    'Sec-Fetch-User': '?1',
    'Upgrade-Insecure-Requests': '1',
    'Cache-Control': 'max-age=0'
};

const TIMEOUT_MS = 10000;

// ============================================
// DECODING & SANITIZATION HELPERS
// ============================================

/**
 * Unwraps DuckDuckGo's internal 'uddg' redirect link to recover the real URL
 */
function decodeTargetUrl(rawHref) {
    if (!rawHref) return null;

    let cleanHref = rawHref.trim();
    if (cleanHref.startsWith('//')) cleanHref = 'https:' + cleanHref;
    cleanHref = cleanHref.replace(/&amp;/g, '&');

    try {
        const parsed = new URL(cleanHref, 'https://duckduckgo.com');
        const targetParam = parsed.searchParams.get('uddg');
        if (targetParam) return targetParam;
    } catch (_) {
        const match = cleanHref.match(/[?&]uddg=([^&]+)/);
        if (match) return decodeURIComponent(match[1]);
    }

    return cleanHref;
}

/**
 * Cleans HTML entities and structural tags
 */
function cleanEntities(rawHtml) {
    if (!rawHtml) return '';
    return rawHtml
        .replace(/<[^>]+>/g, '')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#x27;|&#39;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&nbsp;/g, ' ')
        .replace(/&deg;/g, '°')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Derives a readable site name from the destination hostname
 */
function extractSiteName(urlString) {
    try {
        const host = new URL(urlString).hostname.replace(/^www\./i, '');
        const base = host.split('.')[0] || 'Web';
        return base.charAt(0).toUpperCase() + base.slice(1);
    } catch (_) {
        return 'Web Source';
    }
}

/**
 * Extracts publication year from snippet text if available
 */
function extractYear(snippet) {
    if (!snippet) return 'n.d.';
    const match = snippet.match(/\b(202[0-6]|201\d|200\d|19\d{2})\b/);
    return match ? match[0] : 'n.d.';
}

// ============================================
// CORE EXTRACTION ENGINE
// ============================================

/**
 * Parses DuckDuckGo Lite HTML table rows into clean JSON records
 */
function parseDDGLiteTable(html, limit = 8) {
    const results = [];

    // Captures each result title anchor and its following snippet row
    const resultBlockPattern = /<a[^>]+class=['"]result-link['"][^>]+href=['"]([^'"]+)['"][^>]*>([\s\S]*?)<\/a>[\s\S]*?<td[^>]+class=['"]result-snippet['"][^>]*>([\s\S]*?)<\/td>/gi;

    let match;
    while ((match = resultBlockPattern.exec(html)) !== null && results.length < limit) {
        const rawHref = match[1];
        const rawTitle = match[2];
        const rawSnippet = match[3];

        const realUrl = decodeTargetUrl(rawHref);
        const title = cleanEntities(rawTitle);
        const snippet = cleanEntities(rawSnippet);

        // Ignore internal DDG navigation and empty titles
        if (realUrl && !realUrl.includes('duckduckgo.com') && title.length > 2) {
            results.push({
                title,
                url: realUrl,
                link: realUrl,
                snippet,
                content: snippet,
                meta: {
                    isDOI: false,
                    author: null,
                    year: extractYear(snippet),
                    siteName: extractSiteName(realUrl)
                }
            });
        }
    }

    return results;
}

// ============================================
// EXPORTED SEARXAPI INTERFACE
// ============================================
export const SearxAPI = {
    /**
     * Executes DuckDuckGo Lite search from the backend and returns decoded records.
     * 
     * @param {string} query - The search query
     * @param {number} limit - Maximum number of results (default: 8)
     * @returns {Promise<Array<Object>>} Formatted search source records
     */
    async search(query, limit = 8) {
        if (!query || typeof query !== 'string' || query.trim().length === 0) {
            return [];
        }

        const sanitizedQuery = query
            .replace(/[^\w\s-]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

        try {
            // Form POST directly to DuckDuckGo Lite
            const response = await fetch('https://lite.duckduckgo.com/lite/', {
                method: 'POST',
                signal: controller.signal,
                headers: BROWSER_HEADERS,
                body: `q=${encodeURIComponent(sanitizedQuery)}&kl=wt-wt`
            });

            clearTimeout(timeout);

            if (!response.ok) {
                throw new Error(`DDG Lite HTTP ${response.status}`);
            }

            const html = await response.text();

            // Detect if rate-limiting anti-bot page was served
            if (html.includes('anomaly-modal') || html.includes('bots use DuckDuckGo too')) {
                throw new Error('DuckDuckGo Lite bot challenge triggered');
            }

            return parseDDGLiteTable(html, limit);

        } catch (err) {
            clearTimeout(timeout);
            console.error('[SearxAPI:DDG-Backend] Query execution failed:', err.message);
            return [];
        }
    }
};
