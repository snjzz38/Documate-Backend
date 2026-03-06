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

const BANNED_DOMAINS = [
    'reddit', 'quora', 'stackoverflow', 'stackexchange',
    'youtube', 'tiktok', 'instagram', 'facebook', 'twitter', 'pinterest',
    'amazon', 'ebay', 'etsy', 'alibaba'
];

const BANNED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.mp4', '.mp3', '.pdf.jpg'];

const PREFERRED_DOMAINS = [
    'edu', 'gov', 'pubmed', 'ncbi.nlm.nih.gov', 'jstor',
    'scholar.google', 'arxiv', 'nature.com', 'science.org',
    'springer', 'wiley', 'tandfonline', 'sagepub', 'oup.com',
    'cambridge.org', 'pnas.org', 'cell.com', 'bmj.com', 'thelancet.com'
];

export const GoogleSearchAPI = {

    async search(query, apiKey, cx, groqKey = null) {
        const queries = groqKey
            ? await this._extractClaimQueries(query, groqKey)
            : [this._buildFallbackQuery(query)];

        console.log('[Search] Claim queries:', queries);

        // Run all queries in parallel
        const allResultArrays = await Promise.all(
            queries.map(q => this._searchWithFallback(q))
        );

        const allResults = allResultArrays.flat();
        console.log('[Search] Total raw results:', allResults.length);

        const filtered = this._filterAndScore(allResults);
        console.log('[Search] After scoring:', filtered.length);

        // Groq relevance pass to remove off-topic sources
        const relevant = await this._filterByRelevance(filtered, query, groqKey);
        console.log('[Search] After relevance filter:', relevant.length);

        return relevant;
    },

    async _extractClaimQueries(text, groqKey) {
        try {
            const prompt = `You are helping find academic sources for a student essay.

ESSAY TEXT:
"${text.substring(0, 1500)}"

TASK: Return a JSON array of 4-6 search queries covering the FULL range of topics in the text. Make sure to cover EACH distinct section or argument separately.

STRICT RULES:
- If a researcher is named (e.g. "Peter Turchin"), include their name
- If a specific study or event is described (e.g. "Pompeii DNA victims"), search for THAT
- If a named theory, philosopher, or concept is mentioned (e.g. "Hume impressions ideas", "Berkeley esse est percipi", "Descartes clear distinct ideas"), include it
- Every query must be 4-8 words
- Do NOT write generic queries like "history research study" or "scientific method"
- Do NOT repeat the same topic twice
- Cover BOTH/ALL sections of the essay, not just the first one

EXAMPLES OF GOOD QUERIES:
- "Peter Turchin cliodynamics secular cycles Seshat"
- "Pompeii victims DNA analysis misidentification 2024"
- "Hume impressions ideas empiricism epistemology"
- "Berkeley esse est percipi perception philosophy"
- "Descartes rationalism clear distinct ideas"
- "Plato innate ideas rationalism a priori knowledge"

Return ONLY a raw JSON array, no explanation, no markdown:
["query one here", "query two here", "query three here"]`;

            const response = await GroqAPI.chat([{ role: 'user', content: prompt }], groqKey, false);
            console.log('[Search] Groq raw response:', response);

            const jsonMatch = response.match(/\[[\s\S]*?\]/);
            if (!jsonMatch) throw new Error('No JSON array in response');

            const queries = JSON.parse(jsonMatch[0]);

            if (!Array.isArray(queries) || queries.length === 0) throw new Error('Empty array');

            const cleaned = queries
                .filter(q => typeof q === 'string' && q.trim().split(/\s+/).length >= 3)
                .map(q => q.trim().substring(0, 120));

            if (cleaned.length === 0) throw new Error('No valid queries after cleaning');

            console.log('[Search] Extracted queries:', cleaned);
            return cleaned;

        } catch (e) {
            console.error('[Search] _extractClaimQueries failed:', e.message);
            return [this._buildFallbackQuery(text)];
        }
    },

    async _filterByRelevance(results, originalText, groqKey) {
        if (!groqKey || results.length === 0) return results;

        try {
            const summaries = results.map((r, i) =>
                `${i}: "${r.title}" - ${r.snippet || '(no snippet)'}`
            ).join('\n');

            const prompt = `You are filtering search results for relevance to a student essay.

ESSAY TOPIC SUMMARY (first 600 chars):
"${originalText.substring(0, 600)}"

SEARCH RESULTS:
${summaries}

TASK: Return ONLY the index numbers of results that are directly relevant to the specific philosophical claims, named philosophers, named theories, named researchers, or named events in this essay. Be strict — exclude anything that is tangentially related or only shares a keyword without being about the same topic.

Return ONLY a raw JSON array of index numbers, e.g.: [0, 1, 3, 5]`;

            const response = await GroqAPI.chat([{ role: 'user', content: prompt }], groqKey, false);
            const jsonMatch = response.match(/\[[\s\S]*?\]/);
            if (!jsonMatch) throw new Error('No JSON array');

            const indices = JSON.parse(jsonMatch[0]);
            if (!Array.isArray(indices)) throw new Error('Not an array');

            const filtered = indices
                .filter(i => typeof i === 'number' && i >= 0 && i < results.length)
                .map(i => results[i]);

            // Safety: if Groq filtered everything out, return originals
            return filtered.length > 0 ? filtered : results;

        } catch (e) {
            console.error('[Search] Relevance filter failed:', e.message);
            return results;
        }
    },

    async _searchWithFallback(query) {
        const shuffled = [...INSTANCES].sort(() => Math.random() - 0.5);

        for (const instance of shuffled.slice(0, 4)) {
            try {
                console.log('[Search] Trying instance:', instance, 'for:', query);
                const results = await this._fetch(instance, query);
                if (results.length > 0) {
                    console.log('[Search] Got', results.length, 'results from', instance);
                    return results;
                }
            } catch (e) {
                console.error('[Search] Instance failed:', instance, e.message);
            }
        }

        console.warn('[Search] All instances failed for query:', query);
        return [];
    },

    _filterAndScore(results) {
        const seen = new Set();

        return results
            .filter(r => {
                if (!r.title || !r.link) return false;

                const lowerUrl = r.link.toLowerCase();
                if (BANNED_EXTENSIONS.some(ext => lowerUrl.includes(ext))) return false;

                try {
                    const domain = new URL(r.link).hostname.replace('www.', '').toLowerCase();
                    if (BANNED_DOMAINS.some(b => domain.includes(b))) return false;
                    if (seen.has(domain)) return false;
                    seen.add(domain);
                    return true;
                } catch { return false; }
            })
            .map(r => {
                let score = 0;
                try {
                    const domain = new URL(r.link).hostname.replace('www.', '').toLowerCase();
                    if (PREFERRED_DOMAINS.some(p => domain.includes(p))) score += 3;
                    if (domain.endsWith('.edu')) score += 2;
                    if (domain.endsWith('.gov')) score += 2;
                    if (domain.includes('blog')) score -= 1;
                    if (r.title.length < 10) score -= 2;
                } catch {}
                return { ...r, _score: score };
            })
            .sort((a, b) => b._score - a._score)
            .slice(0, 15);
    },

    _buildFallbackQuery(text) {
        const namedThings = text.match(/\b[A-Z][a-z]{3,}\b/g) || [];
        const uniqueNamed = [...new Set(namedThings)]
            .filter(w => !['The', 'This', 'That', 'These', 'Those', 'However', 'Furthermore', 'In', 'By', 'It'].includes(w))
            .slice(0, 4);

        if (uniqueNamed.length >= 2) {
            return uniqueNamed.join(' ') + ' research';
        }

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
