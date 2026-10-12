// ==========================================================================
// FILE PATH: api/_utils/searx.js
// ==========================================================================

/**
 * api/_utils/searx.js
 * Dedicated DuckDuckGo Search Engine (Lite & HTML Endpoints)
 * 
 * Table of Contents:
 * 1. Configuration & Headers
 * 2. uddg Decoding & Text Sanitization
 * 3. HTML Parsers (Lite Table & Static HTML)
 * 4. Network Transport Core
 * 5. Exported SearxAPI Interface
 */

// ==========================================================================
// MODULE 1: CONFIGURATION & HEADERS
// ==========================================================================
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const TIMEOUT_MS = 10000;

// Minimal, clean headers that do not trigger Cloudflare TLS/header spoofing blocks
const REQUEST_HEADERS = {
    'User-Agent': USER_AGENT,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Content-Type': 'application/x-www-form-urlencoded'
};

// ==========================================================================
// MODULE 2: UDDG DECODING & TEXT SANITIZATION
// ==========================================================================

/**
 * Decodes DuckDuckGo's 'uddg' redirect wrapper to extract the real destination URL
 */
function decodeUddgUrl(rawHref) {
    if (!rawHref) return null;

    try {
        // 1. Unescape HTML ampersands
        let normalized = rawHref.trim().replace(/&amp;/gi, '&');

        // 2. Handle protocol-relative and path-relative URLs
        if (normalized.startsWith('//')) {
            normalized = 'https:' + normalized;
        } else if (normalized.startsWith('/')) {
            normalized = 'https://duckduckgo.com' + normalized;
        }

        // 3. Extract the 'uddg' query parameter using the standard URL parser
        if (normalized.includes('uddg=')) {
            const parsed = new URL(normalized);
            const target = parsed.searchParams.get('uddg');
            if (target) {
                return decodeURIComponent(target);
            }
        }

        // Regex fallback if URL construction fails on non-standard links
        const match = normalized.match(/[?&]uddg=([^&]+)/);
        if (match) {
            return decodeURIComponent(match[1]);
        }

        return normalized.startsWith('http') ? normalized : null;
    } catch (_) {
        return null;
    }
}

/**
 * Strips HTML tags and decodes common character entities
 */
function sanitizeText(rawHtml) {
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
 * Extracts human-readable domain/site name
 */
function extractDomain(urlStr) {
    try {
        const host = new URL(urlStr).hostname.replace(/^www\./i, '');
        const name = host.split('.')[0] || 'Web';
        return name.charAt(0).toUpperCase() + name.slice(1);
    } catch (_) {
        return 'Web Source';
    }
}

/**
 * Extracts a publication year from the snippet text if present
 */
function extractYear(snippet) {
    if (!snippet) return 'n.d.';
    const match = snippet.match(/\b(202[0-6]|201\d|200\d|19\d{2})\b/);
    return match ? match[0] : 'n.d.';
}

// ==========================================================================
// MODULE 3: HTML PARSERS (LITE TABLE & STATIC HTML)
// ==========================================================================

/**
 * Parses DuckDuckGo Lite HTML table format (lite.duckduckgo.com)
 */
function parseLiteHtml(html, limit) {
    const results = [];
    const linkRegex = /<a[^>]+class=['"]result-link['"][^>]+href=['"]([^'"]+)['"][^>]*>([\s\S]*?)<\/a>/gi;
    const snippetRegex = /<td[^>]+class=['"]result-snippet['"][^>]*>([\s\S]*?)<\/td>/gi;

    const links = [];
    let lMatch;
    while ((lMatch = linkRegex.exec(html)) !== null) {
        links.push({
            rawHref: lMatch[1],
            title: sanitizeText(lMatch[2])
        });
    }

    const snippets = [];
    let sMatch;
    while ((sMatch = snippetRegex.exec(html)) !== null) {
        snippets.push(sanitizeText(sMatch[1]));
    }

    for (let i = 0; i < links.length && results.length < limit; i++) {
        const realUrl = decodeUddgUrl(links[i].rawHref);
        const title = links[i].title;
        const snippet = snippets[i] || '';

        if (realUrl && !realUrl.includes('duckduckgo.com') && title.length > 1) {
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
                    siteName: extractDomain(realUrl)
                }
            });
        }
    }

    return results;
}

/**
 * Parses DuckDuckGo Static HTML format (html.duckduckgo.com)
 */
function parseStaticHtml(html, limit) {
    const results = [];
    const blockRegex = /<div[^>]+class=['"][^'"]*result__body[^'"]*['"][^>]*>([\s\S]*?)<\/div>\s*<\/div>/gi;

    let bMatch;
    while ((bMatch = blockRegex.exec(html)) !== null && results.length < limit) {
        const block = bMatch[1];
        const urlMatch = block.match(/<a[^>]+class=['"][^'"]*result__(?:url|title)[^'"]*['"][^>]+href=['"]([^'"]+)['"][^>]*>([\s\S]*?)<\/a>/i) ||
                         block.match(/<a[^>]+href=['"]([^'"]+)['"][^>]*>([\s\S]*?)<\/a>/i);
        const snipMatch = block.match(/<a[^>]+class=['"][^'"]*result__snippet[^'"]*['"][^>]*>([\s\S]*?)<\/a>/i);

        if (urlMatch) {
            const realUrl = decodeUddgUrl(urlMatch[1]);
            const title = sanitizeText(urlMatch[2]);
            const snippet = snipMatch ? sanitizeText(snipMatch[1]) : '';

            if (realUrl && !realUrl.includes('duckduckgo.com') && title.length > 1) {
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
                        siteName: extractDomain(realUrl)
                    }
                });
            }
        }
    }

    return results;
}

// ==========================================================================
// MODULE 4: NETWORK TRANSPORT CORE
// ==========================================================================

/**
 * Executes the HTTP request with detailed error reporting
 */
async function executeSearchRequest(targetUrl, bodyData) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
        const response = await fetch(targetUrl, {
            method: 'POST',
            signal: controller.signal,
            headers: REQUEST_HEADERS,
            body: bodyData
        });

        clearTimeout(timer);

        if (!response.ok) {
            throw new Error(`HTTP ${response.status} (${response.statusText})`);
        }

        const html = await response.text();

        if (html.includes('anomaly-modal') || html.includes('bots use DuckDuckGo too')) {
            throw new Error('DuckDuckGo anti-bot verification challenge triggered');
        }

        return html;
    } catch (err) {
        clearTimeout(timer);

        // Extract the low-level cause from Node's undici engine
        const causeDetail = err.cause ? ` [Cause: ${err.cause.code || err.cause.message || err.cause}]` : '';
        throw new Error(`${err.message}${causeDetail}`);
    }
}

// ==========================================================================
// MODULE 5: EXPORTED SEARXAPI INTERFACE
// ==========================================================================
export const SearxAPI = {
    /**
     * Searches DuckDuckGo using lite.duckduckgo.com with automatic html.duckduckgo.com fallback.
     * 
     * @param {string} query - The search query
     * @param {number} limit - Target number of results (default: 8)
     * @returns {Promise<Array<Object>>} Formatted search source records
     */
    async search(query, limit = 8) {
        if (!query || typeof query !== 'string' || query.trim().length === 0) {
            return [];
        }

        const cleanQuery = query
            .replace(/[^\w\s-]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();

        const formBody = `q=${encodeURIComponent(cleanQuery)}&kl=wt-wt`;

        // 1. Primary Attempt: DuckDuckGo Lite endpoint
        try {
            const html = await executeSearchRequest('https://lite.duckduckgo.com/lite/', formBody);
            const results = parseLiteHtml(html, limit);
            if (results && results.length > 0) {
                return results;
            }
        } catch (liteErr) {
            console.warn(`[DDG-Search] Lite endpoint failed: ${liteErr.message}. Attempting static HTML endpoint...`);
        }

        // 2. Secondary Attempt: DuckDuckGo Static HTML endpoint
        try {
            const html = await executeSearchRequest('https://html.duckduckgo.com/html/', `${formBody}&b=`);
            const results = parseStaticHtml(html, limit);
            if (results && results.length > 0) {
                return results;
            }
        } catch (htmlErr) {
            console.error(`[DDG-Search] Static HTML endpoint failed: ${htmlErr.message}`);
        }

        return [];
    }
};
