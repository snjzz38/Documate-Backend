// ==========================================================================
// FILE PATH: api/_utils/searx.js
// ==========================================================================

/**
 * api/_utils/searx.js
 * Serverless-Compatible Search Engine (Wikimedia & Crossref Open Indexes)
 * 
 * Replaces datacenter-blocked scrapers with open APIs that never trigger ECONNRESET.
 * Compatible with both named { SearxAPI } and default imports.
 * 
 * Table of Contents:
 * 1. Configuration & Constants
 * 2. General Knowledge Search (Wikimedia / Wikipedia API)
 * 3. Academic Open Index Search (Crossref API)
 * 4. SearxAPI Export Interface (Dual Named & Default Export)
 */

// ==========================================================================
// MODULE 1: CONFIGURATION & CONSTANTS
// ==========================================================================
const USER_AGENT = 'DocuMate/1.0 (https://documate.app; contact@documate.app)';
const TIMEOUT_MS = 6000;

// ==========================================================================
// MODULE 2: GENERAL KNOWLEDGE SEARCH (WIKIMEDIA API)
// ==========================================================================

/**
 * Queries Wikimedia/Wikipedia API for authoritative general web topics.
 * 100% free, returns clean JSON, and never blocks AWS/Vercel datacenter IPs.
 */
async function searchWikimedia(query, limit = 4) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
        const url = `https://en.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(query)}&limit=${limit}&namespace=0&format=json`;

        const res = await fetch(url, {
            signal: controller.signal,
            headers: {
                'User-Agent': USER_AGENT,
                'Accept': 'application/json'
            }
        });

        clearTimeout(timer);
        if (!res.ok) return [];

        const data = await res.json();
        // OpenSearch returns: [query, [titles], [descriptions], [urls]]
        const titles = data[1] || [];
        const snippets = data[2] || [];
        const urls = data[3] || [];

        const results = [];
        for (let i = 0; i < titles.length; i++) {
            if (urls[i] && titles[i]) {
                results.push({
                    title: titles[i],
                    url: urls[i],
                    link: urls[i],
                    snippet: snippets[i] || titles[i],
                    content: snippets[i] || '',
                    meta: {
                        isDOI: false,
                        author: 'Wikipedia Contributors',
                        year: String(new Date().getFullYear()),
                        siteName: 'Wikipedia Encyclopedia'
                    }
                });
            }
        }
        return results;

    } catch (err) {
        clearTimeout(timer);
        console.warn('[SearxAPI:Wikimedia] Query failed:', err.message);
        return [];
    }
}

// ==========================================================================
// MODULE 3: ACADEMIC OPEN INDEX SEARCH (CROSSREF API)
// ==========================================================================

/**
 * Queries Crossref for registered peer-reviewed DOI works.
 * 100% free, official academic pool, zero bot challenges.
 */
async function searchCrossref(query, limit = 4) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
        const url = `https://api.crossref.org/works?query=${encodeURIComponent(query)}&rows=${limit}&select=DOI,title,URL,abstract,author,published-print,published-online`;

        const res = await fetch(url, {
            signal: controller.signal,
            headers: {
                'User-Agent': USER_AGENT,
                'Accept': 'application/json'
            }
        });

        clearTimeout(timer);
        if (!res.ok) return [];

        const json = await res.json();
        const items = json.message?.items || [];

        return items.map(item => {
            const title = Array.isArray(item.title) ? item.title[0] : (item.title || 'Academic Publication');
            const doi = item.DOI;
            const link = item.URL || (doi ? `https://doi.org/${doi}` : '');
            const year = item['published-print']?.['date-parts']?.[0]?.[0] || 
                         item['published-online']?.['date-parts']?.[0]?.[0] || 'n.d.';

            const authors = (item.author || [])
                .map(a => `${a.given || ''} ${a.family || ''}`.trim())
                .filter(Boolean);
            const author = authors.length > 0 ? authors.join(', ') : null;
            const snippet = (item.abstract || `${title} (${year}). Crossref Academic Index.`).replace(/<[^>]+>/g, '').trim();

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
                    siteName: 'Crossref / Peer-Reviewed Index'
                }
            };
        });

    } catch (err) {
        clearTimeout(timer);
        console.warn('[SearxAPI:Crossref] Query failed:', err.message);
        return [];
    }
}

// ==========================================================================
// MODULE 4: SEARXAPI EXPORT INTERFACE
// ==========================================================================
export const SearxAPI = {
    /**
     * Executes general + academic search queries across open APIs.
     * Guaranteed never to throw uncaught exceptions or block Vercel datacenter IPs.
     * 
     * @param {string} query - The search query from citation.js
     * @param {number} limit - Maximum number of results to return
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

        const halfLimit = Math.max(2, Math.floor(limit / 2));

        // Query both open providers concurrently
        const [wikiResults, crossrefResults] = await Promise.allSettled([
            searchWikimedia(cleanQuery, halfLimit),
            searchCrossref(cleanQuery, halfLimit)
        ]);

        const combined = [];
        if (wikiResults.status === 'fulfilled') combined.push(...wikiResults.value);
        if (crossrefResults.status === 'fulfilled') combined.push(...crossrefResults.value);

        // Deduplicate results by URL or DOI
        const seen = new Set();
        return combined.filter(item => {
            const key = item.doi || item.url;
            if (!key || seen.has(key)) return false;
            seen.add(key);
            return true;
        }).slice(0, limit);
    }
};

// Dual-export ensures compatibility with both:
// 1. import { SearxAPI } from '../_utils/searx.js';
// 2. import SearxAPI from '../_utils/searx.js';
export default SearxAPI;
