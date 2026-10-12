// ==========================================================================
// FILE PATH: api/_utils/searx.js
// ==========================================================================

/**
 * api/_utils/searx.js
 * Simple Web Search Provider (DuckDuckGo Lite with Cheerio + Serverless Fallback)
 * 
 * Table of Contents:
 * 1. Configuration & Utilities
 * 2. Cheerio DuckDuckGo Lite Extractor
 * 3. Serverless Web Fallback (Wikipedia OpenSearch)
 * 4. SearxAPI Interface Export
 */

import * as cheerio from 'cheerio';

// ==========================================================================
// MODULE 1: Configuration & Utilities
// ==========================================================================
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function decodeUddg(href) {
    if (!href) return null;
    try {
        let clean = href.trim().replace(/&amp;/gi, '&');
        if (clean.startsWith('//')) clean = 'https:' + clean;
        if (clean.includes('uddg=')) {
            const parsed = new URL(clean, 'https://duckduckgo.com');
            const target = parsed.searchParams.get('uddg');
            if (target) return decodeURIComponent(target);
        }
        return clean.startsWith('http') ? clean : null;
    } catch (_) {
        return null;
    }
}

function extractDomain(urlStr) {
    try {
        const host = new URL(urlStr).hostname.replace(/^www\./i, '');
        const name = host.split('.')[0] || 'Web';
        return name.charAt(0).toUpperCase() + name.slice(1);
    } catch (_) {
        return 'Web Source';
    }
}

// ==========================================================================
// MODULE 2: Cheerio DuckDuckGo Lite Extractor
// ==========================================================================
async function searchDDGLite(query, limit = 5) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);

    try {
        const url = `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`;
        const res = await fetch(url, {
            signal: controller.signal,
            headers: {
                'User-Agent': USER_AGENT,
                'Accept': 'text/html',
                'Accept-Language': 'en-US,en;q=0.9'
            }
        });
        clearTimeout(timer);

        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const html = await res.text();
        if (html.includes('anomaly-modal')) throw new Error('Bot challenge triggered');

        const $ = cheerio.load(html);
        const results = [];

        // Parse title links and matching snippets using Cheerio
        $('a.result-link').each((i, el) => {
            if (results.length >= limit) return;

            const $link = $(el);
            const rawHref = $link.attr('href') || '';
            const title = $link.text().replace(/\s+/g, ' ').trim();
            const realUrl = decodeUddg(rawHref);

            // Locate the snippet in the following table row
            const snippet = $link.closest('tr').next('tr').find('td.result-snippet').text().replace(/\s+/g, ' ').trim();

            if (realUrl && !realUrl.includes('duckduckgo.com') && title.length > 2) {
                results.push({
                    title,
                    url: realUrl,
                    link: realUrl,
                    snippet: snippet || title
                });
            }
        });

        return results;
    } catch (err) {
        clearTimeout(timer);
        throw err;
    }
}

// ==========================================================================
// MODULE 3: Serverless Web Fallback (Wikipedia OpenSearch)
// ==========================================================================
/**
 * Automatically triggers if Vercel encounters ECONNRESET on DuckDuckGo,
 * ensuring general web results are ALWAYS returned.
 */
async function searchWebFallback(query, limit = 5) {
    try {
        const url = `https://en.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(query)}&limit=${limit}&namespace=0&format=json`;
        const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
        if (!res.ok) return [];

        const [, titles, snippets, urls] = await res.json();
        const results = [];

        for (let i = 0; i < titles.length; i++) {
            if (urls[i] && titles[i]) {
                results.push({
                    title: titles[i],
                    url: urls[i],
                    link: urls[i],
                    snippet: snippets[i] || titles[i]
                });
            }
        }
        return results;
    } catch (_) {
        return [];
    }
}

// ==========================================================================
// MODULE 4: SearxAPI Interface Export
// ==========================================================================
export const SearxAPI = {
    async search(query, limit = 6) {
        if (!query || typeof query !== 'string' || !query.trim()) return [];

        const cleanQuery = query.replace(/[^\w\s-]/g, ' ').trim();

        // 1. Try DuckDuckGo Lite with Cheerio
        try {
            const ddgResults = await searchDDGLite(cleanQuery, limit);
            if (ddgResults && ddgResults.length > 0) {
                return ddgResults;
            }
        } catch (err) {
            console.warn(`[WebSearch] DDG Lite unavailable (${err.message}). Using general web index fallback.`);
        }

        // 2. Fallback to Wikimedia Open Index (Never blocks Vercel serverless IPs)
        return await searchWebFallback(cleanQuery, limit);
    }
};

export default SearxAPI;
