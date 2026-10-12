// ==========================================================================
// FILE PATH: api/_utils/searx.js
// ==========================================================================

/**
 * api/_utils/searx.js
 * Universal Web Search & Metadata Extraction Engine (DuckDuckGo Lite System)
 * 
 * Table of Contents:
 * 1. Configuration & Request Headers
 * 2. URL & HTML Sanitization Helpers
 * 3. DuckDuckGo Lite Parser Core
 * 4. Resilient Academic Fallback (Crossref)
 * 5. Exported SearxAPI Interface
 */

// ==========================================================================
// MODULE 1: CONFIGURATION & REQUEST HEADERS
// ==========================================================================
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const TIMEOUT_MS = 6000;

// ==========================================================================
// MODULE 2: URL & HTML SANITIZATION HELPERS
// ==========================================================================

/**
 * Unwraps DuckDuckGo's internal redirection wrapper (uddg query parameter)
 */
function unwrapDDGUrl(rawHref) {
    if (!rawHref) return null;
    let target = rawHref.trim();

    if (target.includes('uddg=')) {
        try {
            const base = target.startsWith('//')
                ? `https:${target}`
                : (target.startsWith('/') ? `https://duckduckgo.com${target}` : target);
            const parsed = new URL(base);
            const decoded = parsed.searchParams.get('uddg');
            if (decoded) return decoded;
        } catch (_) {
            const match = target.match(/uddg=([^&]+)/);
            if (match) return decodeURIComponent(match[1]);
        }
    }

    if (target.startsWith('//')) return `https:${target}`;
    return target;
}

/**
 * Strips HTML tags and decodes common HTML entities
 */
function cleanText(rawHtml) {
    if (!rawHtml) return '';
    return rawHtml
        .replace(/<[^>]+>/g, '')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&nbsp;/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Derives a human-readable publisher/site name from a destination URL
 */
function extractSiteName(urlString) {
    try {
        const host = new URL(urlString).hostname.replace(/^www\./i, '');
        const main = host.split('.')[0] || 'Web';
        return main.charAt(0).toUpperCase() + main.slice(1);
    } catch (_) {
        return 'Web Source';
    }
}

/**
 * Heuristically extracts a publication year from the snippet text
 */
function extractYearFromSnippet(snippet) {
    if (!snippet) return 'n.d.';
    const match = snippet.match(/\b(202[0-6]|201\d|200\d|19\d{2})\b/);
    return match ? match[0] : 'n.d.';
}

// ==========================================================================
// MODULE 3: DUCKDUCKGO LITE PARSER CORE
// ==========================================================================

/**
 * Fetches and parses organic search results from DuckDuckGo Lite
 */
async function fetchDuckDuckGoLite(query, limit = 8) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
        const url = `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`;

        const response = await fetch(url, {
            method: 'GET',
            signal: controller.signal,
            headers: {
                'User-Agent': BROWSER_UA,
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
                'Referer': 'https://lite.duckduckgo.com/'
            }
        });

        clearTimeout(timeout);

        if (!response.ok) {
            throw new Error(`DDG Lite HTTP status ${response.status}`);
        }

        const html = await response.text();

        // Detect bot anomaly challenge
        if (html.includes('anomaly-modal') || html.includes('bots use DuckDuckGo too')) {
            throw new Error('DuckDuckGo Lite rate-limit/bot challenge encountered');
        }

        const results = [];
        // Pairs the result anchor and its corresponding snippet table cell
        const entryRegex = /<a[^>]+class=['"]result-link['"][^>]+href=['"]([^'"]+)['"][^>]*>([\s\S]*?)<\/a>[\s\S]*?<td[^>]+class=['"]result-snippet['"][^>]*>([\s\S]*?)<\/td>/gi;

        let match;
        while ((match = entryRegex.exec(html)) !== null && results.length < limit) {
            const rawHref = match[1];
            const rawTitle = match[2];
            const rawSnippet = match[3];

            const decodedUrl = unwrapDDGUrl(rawHref);
            const title = cleanText(rawTitle);
            const snippet = cleanText(rawSnippet);

            // Filter internal DDG loops and ads
            if (decodedUrl && !decodedUrl.includes('duckduckgo.com') && title.length > 2) {
                results.push({
                    title,
                    url: decodedUrl,
                    link: decodedUrl,
                    snippet,
                    content: snippet,
                    meta: {
                        isDOI: false,
                        author: null,
                        year: extractYearFromSnippet(snippet),
                        siteName: extractSiteName(decodedUrl)
                    }
                });
            }
        }

        return results;

    } catch (err) {
        clearTimeout(timeout);
        throw err;
    }
}

// ==========================================================================
// MODULE 4: RESILIENT ACADEMIC FALLBACK (CROSSREF)
// ==========================================================================

/**
 * Fallback to Crossref's open metadata index if DDG Lite is throttled
 */
async function fetchCrossrefFallback(query, limit = 6) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
        const url = `https://api.crossref.org/works?query=${encodeURIComponent(query)}&rows=${limit}&select=DOI,title,URL,abstract,author,published-print,published-online`;
        
        const response = await fetch(url, {
            signal: controller.signal,
            headers: {
                'User-Agent': 'DocuMate/1.0 (mailto:support@documate.app)'
            }
        });

        clearTimeout(timeout);
        if (!response.ok) return [];

        const data = await response.json();
        const items = data.message?.items || [];

        return items.map(item => {
            const title = Array.isArray(item.title) ? item.title[0] : (item.title || 'Academic Research');
            const doi = item.DOI;
            const link = item.URL || (doi ? `https://doi.org/${doi}` : '');
            const year = item['published-print']?.['date-parts']?.[0]?.[0] || 
                         item['published-online']?.['date-parts']?.[0]?.[0] || 'n.d.';
            
            const authors = (item.author || [])
                .map(a => `${a.given || ''} ${a.family || ''}`.trim())
                .filter(Boolean);
            const author = authors.length > 0 ? authors.join(', ') : null;
            const snippet = cleanText(item.abstract) || `${title} (${year}). Peer-reviewed findings.`;

            return {
                title,
                url: link,
                link,
                doi,
                snippet,
                content: snippet,
                meta: {
                    isDOI: !!doi,
                    author,
                    year: String(year),
                    siteName: 'Crossref Academic Index'
                }
            };
        });

    } catch (_) {
        clearTimeout(timeout);
        return [];
    }
}

// ==========================================================================
// MODULE 5: EXPORTED SEARXAPI INTERFACE
// ==========================================================================
export const SearxAPI = {
    /**
     * Executes DuckDuckGo Lite search with automatic Crossref fallback.
     * Perfectly mirrors the legacy SearX schema consumed by citation.js and quotes.js.
     * 
     * @param {string} query - Search prompt or extracted context query
     * @param {number} limit - Maximum number of search sources to resolve
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

        try {
            // Primary pass: Extract organic web results via DDG Lite
            const webResults = await fetchDuckDuckGoLite(sanitizedQuery, limit);
            if (webResults && webResults.length > 0) {
                return webResults;
            }
            throw new Error('DuckDuckGo Lite returned 0 records');

        } catch (primaryErr) {
            console.warn('[SearxAPI:DDG-Lite] Primary search failed, invoking academic fallback:', primaryErr.message);

            // Secondary pass: Resilient open DOI fallback prevents empty returns
            try {
                const fallbackResults = await fetchCrossrefFallback(sanitizedQuery, limit);
                return fallbackResults;
            } catch (fallbackErr) {
                console.error('[SearxAPI] Both primary and fallback search channels failed:', fallbackErr.message);
                return [];
            }
        }
    }
};
