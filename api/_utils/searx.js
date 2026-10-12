// ==========================================================================
// FILE PATH: api/_utils/searx.js
// ==========================================================================

/**
 * api/_utils/searx.js
 * Dedicated DuckDuckGo Lite Search & Extraction Engine
 * 
 * Replaces SearX entirely with DuckDuckGo's static search pipelines.
 * Retains the filename and SearxAPI export for seamless backend integration.
 * 
 * Table of Contents:
 * 1. Configuration & Headers
 * 2. URL Unwrapping & Text Sanitization
 * 3. DuckDuckGo Parser Core (Lite & Static Endpoints)
 * 4. SearxAPI Export Interface
 */

// ==========================================================================
// MODULE 1: CONFIGURATION & HEADERS
// ==========================================================================
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const TIMEOUT_MS = 12000; // 12 seconds to prevent premature fetch aborts

// ==========================================================================
// MODULE 2: URL UNWRAPPING & TEXT SANITIZATION
// ==========================================================================

/**
 * Unwraps DuckDuckGo's redirection link to recover the real destination URL
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
 * Strips HTML tags and decodes common entities
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
 * Extracts a readable domain/site name
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
 * Extracts publication year from snippet if present
 */
function extractYear(snippet) {
    if (!snippet) return 'n.d.';
    const match = snippet.match(/\b(202[0-6]|201\d|200\d|19\d{2})\b/);
    return match ? match[0] : 'n.d.';
}

// ==========================================================================
// MODULE 3: DUCKDUCKGO PARSER CORE (LITE & STATIC ENDPOINTS)
// ==========================================================================

/**
 * Parses DuckDuckGo Lite HTML table structure
 */
function parseDDGLiteHtml(html, limit) {
    const results = [];
    const linkRegex = /<a[^>]+class=["']result-link["'][^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
    const snippetRegex = /<td[^>]+class=["']result-snippet["'][^>]*>([\s\S]*?)<\/td>/gi;

    const links = [];
    let lMatch;
    while ((lMatch = linkRegex.exec(html)) !== null) {
        links.push({
            href: lMatch[1],
            title: cleanText(lMatch[2])
        });
    }

    const snippets = [];
    let sMatch;
    while ((sMatch = snippetRegex.exec(html)) !== null) {
        snippets.push(cleanText(sMatch[1]));
    }

    for (let i = 0; i < links.length && results.length < limit; i++) {
        const decodedUrl = unwrapDDGUrl(links[i].href);
        const title = links[i].title;
        const snippet = snippets[i] || '';

        if (decodedUrl && !decodedUrl.includes('duckduckgo.com') && title.length > 1) {
            results.push({
                title,
                url: decodedUrl,
                link: decodedUrl,
                snippet,
                content: snippet,
                meta: {
                    isDOI: false,
                    author: null,
                    year: extractYear(snippet),
                    siteName: extractSiteName(decodedUrl)
                }
            });
        }
    }

    return results;
}

/**
 * Parses DuckDuckGo HTML endpoint structure (secondary fallback)
 */
function parseDDGStaticHtml(html, limit) {
    const results = [];
    const blockRegex = /<div[^>]+class=["'][^"']*result__body[^"']*["'][^>]*>([\s\S]*?)<\/div>\s*<\/div>/gi;

    let bMatch;
    while ((bMatch = blockRegex.exec(html)) !== null && results.length < limit) {
        const block = bMatch[1];
        const urlMatch = block.match(/<a[^>]+class=["'][^"']*result__(?:url|title)[^"']*["'][^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i) ||
                         block.match(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
        const snipMatch = block.match(/<a[^>]+class=["'][^"']*result__snippet[^"']*["'][^>]*>([\s\S]*?)<\/a>/i);

        if (urlMatch) {
            const decodedUrl = unwrapDDGUrl(urlMatch[1]);
            const title = cleanText(urlMatch[2]);
            const snippet = snipMatch ? cleanText(snipMatch[1]) : '';

            if (decodedUrl && !decodedUrl.includes('duckduckgo.com') && title.length > 1) {
                results.push({
                    title,
                    url: decodedUrl,
                    link: decodedUrl,
                    snippet,
                    content: snippet,
                    meta: {
                        isDOI: false,
                        author: null,
                        year: extractYear(snippet),
                        siteName: extractSiteName(decodedUrl)
                    }
                });
            }
        }
    }

    return results;
}

/**
 * Primary search using DuckDuckGo Lite via form POST
 */
async function queryDuckDuckGoLite(query, limit) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
        const res = await fetch('https://lite.duckduckgo.com/lite/', {
            method: 'POST',
            signal: controller.signal,
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'User-Agent': BROWSER_UA,
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
                'Origin': 'https://lite.duckduckgo.com',
                'Referer': 'https://lite.duckduckgo.com/'
            },
            body: `q=${encodeURIComponent(query)}&kl=wt-wt`
        });

        clearTimeout(timer);

        if (!res.ok) throw new Error(`DDG Lite HTTP ${res.status}`);
        const html = await res.text();

        if (html.includes('anomaly-modal') || html.includes('bots use DuckDuckGo too')) {
            throw new Error('DDG Lite bot challenge triggered');
        }

        return parseDDGLiteHtml(html, limit);

    } catch (err) {
        clearTimeout(timer);
        throw err;
    }
}

/**
 * Secondary search using DuckDuckGo Static HTML endpoint
 */
async function queryDuckDuckGoStatic(query, limit) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
        const res = await fetch('https://html.duckduckgo.com/html/', {
            method: 'POST',
            signal: controller.signal,
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'User-Agent': BROWSER_UA,
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
                'Origin': 'https://html.duckduckgo.com',
                'Referer': 'https://html.duckduckgo.com/'
            },
            body: `q=${encodeURIComponent(query)}&b=`
        });

        clearTimeout(timer);

        if (!res.ok) throw new Error(`DDG Static HTTP ${res.status}`);
        const html = await res.text();

        return parseDDGStaticHtml(html, limit);

    } catch (err) {
        clearTimeout(timer);
        throw err;
    }
}

// ==========================================================================
// MODULE 4: EXPORTED SEARXAPI INTERFACE
// ==========================================================================
export const SearxAPI = {
    /**
     * Executes DuckDuckGo web search using Lite (POST) with Static HTML fallback.
     * 
     * @param {string} query - The search query
     * @param {number} limit - Target number of results (default: 8)
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

        // 1. Primary Attempt: DuckDuckGo Lite POST
        try {
            const results = await queryDuckDuckGoLite(sanitizedQuery, limit);
            if (results && results.length > 0) {
                return results;
            }
        } catch (liteErr) {
            console.warn('[DDG-Lite] Primary POST failed, trying static HTML endpoint:', liteErr.message);
        }

        // 2. Secondary Attempt: DuckDuckGo HTML POST
        try {
            const staticResults = await queryDuckDuckGoStatic(sanitizedQuery, limit);
            if (staticResults && staticResults.length > 0) {
                return staticResults;
            }
        } catch (staticErr) {
            console.error('[DDG-Static] Secondary search failed:', staticErr.message);
        }

        return [];
    }
};
