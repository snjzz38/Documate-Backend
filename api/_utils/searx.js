// ==========================================================================
// FILE PATH: api/_utils/searx.js
// ==========================================================================

/**
 * api/_utils/searx.js
 * Web Search Provider with Groq AI 3-5 Word Keyword Reduction & Cheerio Extraction
 * 
 * Table of Contents:
 * 1. Configuration & Imports
 * 2. Groq AI Keyword Reduction Module
 * 3. Cheerio DuckDuckGo Lite Extractor Module
 * 4. Serverless Web Fallback Module (Wikimedia OpenSearch)
 * 5. SearxAPI Export Interface
 */

import * as cheerio from 'cheerio';
import { GroqAPI } from './groqAPI.js';

// ==========================================================================
// MODULE 1: CONFIGURATION & IMPORTS
// ==========================================================================
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const TIMEOUT_MS = 6000;

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
// MODULE 2: GROQ AI KEYWORD REDUCTION MODULE
// ==========================================================================

/**
 * Fast token fallback if Groq key is absent or request fails
 */
function fallbackKeywordSlice(text) {
    if (!text) return '';
    const words = text
        .replace(/[^\w\s-]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length > 2);
    return words.slice(0, 5).join(' ');
}

/**
 * Uses Groq AI to distill an essay, context, or long prompt down to 3-5 core search terms.
 */
async function reduceToKeywordsWithGroq(text, apiKey = null) {
    const key = apiKey || process.env.GROQ_API_KEY;
    if (!key || !text || text.trim().length === 0) {
        return fallbackKeywordSlice(text);
    }

    // Skip AI call if query is already short (1-5 words and under 40 chars)
    const wordCount = text.trim().split(/\s+/).length;
    if (wordCount <= 5 && text.length < 40) {
        return text.replace(/[^\w\s-]/g, '').trim();
    }

    const truncatedContext = text.slice(0, 1000).trim();
    const prompt = `Extract a concise, targeted 3 to 5 word web search query based on the following text or topic.
Return ONLY the 3 to 5 search words and absolutely nothing else. Do not use quotes, punctuation, or explanations.

TEXT:
"${truncatedContext}"`;

    try {
        const response = await GroqAPI.chat(
            [{ role: 'user', content: prompt }],
            key,
            false
        );

        if (!response || typeof response !== 'string') {
            return fallbackKeywordSlice(text);
        }

        // Clean output and enforce strictly 3 to 5 words
        const cleaned = response
            .replace(/["'’`]/g, '')
            .replace(/[^\w\s-]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();

        const words = cleaned.split(' ').filter(Boolean);
        if (words.length >= 2) {
            return words.slice(0, 5).join(' ');
        }

        return fallbackKeywordSlice(text);
    } catch (err) {
        console.warn('[SearxAPI:Groq] Failed to distill keywords with Groq:', err.message);
        return fallbackKeywordSlice(text);
    }
}

// ==========================================================================
// MODULE 3: CHEERIO DUCKDUCKGO LITE EXTRACTOR MODULE
// ==========================================================================
async function searchDDGLite(query, limit = 5) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

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

        // Parse result links and adjacent snippet cells using Cheerio
        $('a.result-link').each((i, el) => {
            if (results.length >= limit) return;

            const $link = $(el);
            const rawHref = $link.attr('href') || '';
            const title = $link.text().replace(/\s+/g, ' ').trim();
            const realUrl = decodeUddg(rawHref);

            const snippet = $link.closest('tr').next('tr').find('td.result-snippet').text().replace(/\s+/g, ' ').trim();

            if (realUrl && !realUrl.includes('duckduckgo.com') && title.length > 2) {
                results.push({
                    title,
                    url: realUrl,
                    link: realUrl,
                    snippet: snippet || title,
                    meta: {
                        siteName: extractDomain(realUrl),
                        isDOI: false
                    }
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
// MODULE 4: SERVERLESS WEB FALLBACK MODULE (WIKIMEDIA OPEN SEARCH)
// ==========================================================================
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
                    snippet: snippets[i] || titles[i],
                    meta: {
                        siteName: 'Wikipedia Encyclopedia',
                        isDOI: false
                    }
                });
            }
        }
        return results;
    } catch (_) {
        return [];
    }
}

// ==========================================================================
// MODULE 5: SEARXAPI EXPORT INTERFACE
// ==========================================================================
export const SearxAPI = {
    /**
     * Reduces input to 3-5 keywords using Groq AI, then searches DuckDuckGo Lite.
     * 
     * @param {string} query - Full context, essay, or topic
     * @param {number} limit - Target number of sources
     * @param {string|null} apiKey - Optional custom Groq API key override
     * @returns {Promise<Array<Object>>} Formatted search results
     */
    async search(query, limit = 6, apiKey = null) {
        if (!query || typeof query !== 'string' || !query.trim()) return [];

        // 1. Distill context into strictly 3 to 5 keywords with Groq AI
        const distilledKeywords = await reduceToKeywordsWithGroq(query, apiKey);
        console.log(`[WebSearch] Groq distilled query to 3-5 words: "${distilledKeywords}"`);

        // 2. Query DuckDuckGo Lite with the short keyword string
        try {
            const ddgResults = await searchDDGLite(distilledKeywords, limit);
            if (ddgResults && ddgResults.length > 0) {
                return ddgResults;
            }
        } catch (err) {
            console.warn(`[WebSearch] DDG Lite failed (${err.message}). Using web fallback.`);
        }

        // 3. Guaranteed fallback on network error/block
        return await searchWebFallback(distilledKeywords, limit);
    }
};

export default SearxAPI;
