// api/utils/googleSearch.js
import { GroqAPI } from './groqAPI.js';

const INSTANCES = [
    'https://search.sapti.me',
    'https://searx.tiekoetter.com', 
    'https://search.bus-hit.me',
    'https://searx.be',
    'https://search.ononoki.org',
    'https://priv.au'
];

// Domains that should never appear in academic citations
const BANNED_DOMAINS = [
    'reddit', 'quora', 'stackoverflow', 'stackexchange',
    'youtube', 'tiktok', 'instagram', 'facebook', 'twitter', 'pinterest',
    'amazon', 'ebay', 'etsy', 'alibaba'
];

// File extensions that are never citable sources
const BANNED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.mp4', '.mp3', '.pdf.jpg'];

// Domains that get a quality boost (more likely to be credible)
const PREFERRED_DOMAINS = [
    'edu', 'gov', 'org', 'pubmed', 'ncbi.nlm.nih.gov', 'jstor', 
    'scholar.google', 'arxiv', 'nature.com', 'science.org', 
    'springer', 'wiley', 'tandfonline', 'sagepub', 'oup.com',
    'cambridge.org', 'pnas.org', 'cell.com', 'bmj.com', 'thelancet.com'
];

export const GoogleSearchAPI = {

    /**
     * Main entry point. Extracts specific claims, searches for each,
     * then returns the best deduplicated results.
     */
    async search(query, apiKey, cx, groqKey = null) {
        const queries = groqKey
            ? await this._extractClaimQueries(query, groqKey)
            : [this._buildFallbackQuery(query)];

        console.log('[Search] Claim queries:', queries);

        const allResults = [];

        for (const q of queries) {
            console.log('[Search] Searching for:', q);
            const results = await this._searchWithFallback(q);
            allResults.push(...results);
        }

        const filtered = this._filterAndScore(allResults);
        console.log('[Search] Final results:', filtered.length);
        return filtered;
    },

    /**
     * NEW: Extract 2-4 specific, searchable claims from the text.
     * Each claim becomes its own targeted search query.
     */
    async _extractClaimQueries(text, groqKey) {
        try {
            const prompt = `You are helping find academic sources for a student essay. 

ESSAY TEXT:
"${text.substring(0, 1200)}"

TASK: Identify the 2-4 most specific, verifiable CLAIMS or FACTS in this text that need citations. For each claim, write a precise search query (4-8 words) that would find the original source or supporting academic evidence.

RULES:
- Focus on SPECIFIC claims: named researchers, studies, statistics, events, named theories
- If a researcher or study is named, include their name in the query
- If a specific event is described (e.g. "Pompeii DNA analysis"), search for THAT event
- Prefer queries that would find peer-reviewed sources, .edu, .gov, or major publications
- Do NOT write generic queries like "history research study"

EXAMPLES OF GOOD QUERIES:
- "Peter Turchin cliodynamics secular cycles Seshat"
- "Pompeii victims DNA analysis misidentification 2024"
- "smartphone adolescent mental health longitudinal study"
- "climate change sea level rise Arctic ice 2023"

OUTPUT FORMAT - return ONLY a JSON array of query strings, nothing else:
["query one", "query two", "query three"]`;

            const response = await GroqAPI.chat([{ role: 'user', content: prompt }], groqKey, false);
            
            // Parse JSON array from response
            const jsonMatch = response.match(/\[[\s\S]*?\]/);
            if (!jsonMatch) throw new Error('No JSON array found');
            
            const queries = JSON.parse(jsonMatch[0]);
            
            if (!Array.isArray(queries) || queries.length === 0) throw new Error('Empty query array');
            
            // Validate and clean each query
            return queries
                .filter(q => typeof q === 'string' && q.split(/\s+/).length >= 3)
                .map(q => q.trim().substring(0, 120))
                .slice(0, 4);

        } catch (e) {
            console.error('[Search] Claim extraction failed:', e.message);
            return [this._buildFallbackQuery(text)];
        }
    },

    /**
     * Try SearXNG instances until one returns results
     */
    async _searchWithFallback(query) {
        const shuffled = [...INSTANCES].sort(() => Math.random() - 0.5);

        for (const instance of shuffled.slice(0, 3)) {
            try {
                console.log('[Search] Trying:', instance);
                const results = await this._fetch(instance, query);
                if (results.length > 0) {
                    console.log('[Search] Got', results.length, 'from', instance);
                    return results;
                }
            } catch (e) {
                console.error('[Search] Failed:', instance, e.message);
            }
        }

        return [];
    },

    /**
     * IMPROVED: Filter junk, score by quality, return best results
     */
    _filterAndScore(results) {
        const seen = new Set();

        return results
            .filter(r => {
                // Must have title and valid URL
                if (!r.title || !r.link) return false;

                // Block file extensions that are never citable
                const lowerUrl = r.link.toLowerCase();
                if (BANNED_EXTENSIONS.some(ext => lowerUrl.endsWith(ext))) return false;

                // Block banned social/commerce domains
                try {
                    const domain = new URL(r.link).hostname.replace('www.', '').toLowerCase();
                    if (BANNED_DOMAINS.some(b => domain.includes(b))) return false;

                    // One result per domain
                    if (seen.has(domain)) return false;
                    seen.add(domain);
                    return true;
                } catch { return false; }
            })
            .map(r => {
                // Score by source quality
                let score = 0;
                try {
                    const domain = new URL(r.link).hostname.replace('www.', '').toLowerCase();
                    if (PREFERRED_DOMAINS.some(p => domain.includes(p))) score += 3;
                    if (domain.endsWith('.edu')) score += 2;
                    if (domain.endsWith('.gov')) score += 2;
                    // Penalize generic/low-quality patterns
                    if (domain.includes('blog')) score -= 1;
                    if (r.title.length < 10) score -= 2; // Suspiciously short title
                } catch {}
                return { ...r, _score: score };
            })
            .sort((a, b) => b._score - a._score)
            .slice(0, 15);
    },

    /**
     * Fallback when no AI key: extract named entities and specific terms
     */
    _buildFallbackQuery(text) {
        // Prefer capitalized words (likely proper nouns/named things)
        const namedThings = text.match(/\b[A-Z][a-z]{3,}\b/g) || [];
        const uniqueNamed = [...new Set(namedThings)]
            .filter(w => !['The', 'This', 'That', 'These', 'Those', 'However', 'Furthermore', 'In'].includes(w))
            .slice(0, 4);

        if (uniqueNamed.length >= 2) {
            return uniqueNamed.join(' ') + ' research';
        }

        // Last resort: long meaningful words
        const stopWords = new Set([
            'the','a','an','is','are','was','were','be','been','being','have','has','had',
            'do','does','did','will','would','could','should','may','might','must','can',
            'this','that','these','those','they','their','what','which','who','where',
            'when','why','how','all','each','every','both','few','more','most','other',
            'some','such','no','nor','not','only','own','same','so','than','too','very',
            'just','also','now','people','things','many','much','often','even','well',
            'make','made','take','get','put','use','used','using','instead','through'
        ]);
        const words = text.toLowerCase().match(/\b[a-z]{6,}\b/g) || [];
        const meaningful = [...new Set(words)].filter(w => !stopWords.has(w)).slice(0, 4);
        return (meaningful.join(' ') || text.substring(0, 40)) + ' academic research';
    },

    async _fetch(instance, query) {
        const url = `${instance}/search?q=${encodeURIComponent(query)}&categories=general,science&language=en`;

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000);

        try {
            const res = await fetch(url, {
                signal: controller.signal,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Accept': 'text/html'
                }
            });
            clearTimeout(timeout);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const html = await res.text();
            return this._parseResults(html);
        } catch (e) {
            clearTimeout(timeout);
            throw e;
        }
    },

    _parseResults(html) {
        const results = [];

        const articleRegex = /<article[^>]*class="[^"]*result[^"]*"[^>]*>([\s\S]*?)<\/article>/gi;
        let match;

        while ((match = articleRegex.exec(html)) !== null) {
            const block = match[1];
            const urlMatch = block.match(/href="(https?:\/\/[^"]+)"/);
            const titleMatch = block.match(/<h3[^>]*>([\s\S]*?)<\/h3>/) ||
                               block.match(/<a[^>]*>([\s\S]*?)<\/a>/);
            const snippetMatch = block.match(/<p[^>]*class="[^"]*content[^"]*"[^>]*>([\s\S]*?)<\/p>/);

            if (urlMatch && titleMatch) {
                const url = urlMatch[1];
                const title = this._clean(titleMatch[1]);
                const snippet = snippetMatch ? this._clean(snippetMatch[1]) : '';
                if (title && url && !url.includes('searx')) {
                    results.push({ title, link: url, snippet });
                }
            }
        }

        // Fallback parsing
        if (results.length < 3) {
            const divRegex = /<div[^>]*class="[^"]*result[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/gi;
            while ((match = divRegex.exec(html)) !== null) {
                const block = match[1];
                const urlMatch = block.match(/href="(https?:\/\/[^"]+)"/);
                const titleMatch = block.match(/<h[34][^>]*>([\s\S]*?)<\/h[34]>/);
                if (urlMatch && titleMatch) {
                    const url = urlMatch[1];
                    const title = this._clean(titleMatch[1]);
                    if (title && !url.includes('searx') && !results.some(r => r.link === url)) {
                        results.push({ title, link: url, snippet: '' });
                    }
                }
            }
        }

        return results.slice(0, 30);
    },

    _clean(html) {
        return (html || '')
            .replace(/<[^>]+>/g, '')
            .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
            .replace(/\s+/g, ' ').trim().substring(0, 300);
    }
};
