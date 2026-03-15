// api/utils/googleSearch.js
// SearXNG-based search with academic source prioritization
import { GroqAPI } from './groqAPI.js';

const INSTANCES = [
    'https://search.sapti.me',
    'https://searx.tiekoetter.com', 
    'https://search.bus-hit.me',
    'https://searx.be',
    'https://search.ononoki.org',
    'https://priv.au',
    'https://searx.work',
    'https://search.mdosch.de'
];

// Sites that are never useful for academic research
const BANNED_DOMAINS = [
    'reddit', 'quora', 'stackoverflow', 'stackexchange',
    'youtube', 'tiktok', 'instagram', 'facebook', 'twitter', 'pinterest',
    'amazon', 'ebay', 'etsy', 'alibaba', 'aliexpress',
    'macrumors', 'forums', 'discord', 'telegram',
    'commerzbank', 'investopedia' // financial sites unless relevant
];

const BANNED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.mp4', '.mp3', '.pdf.jpg', '.zip', '.exe'];

// Academic and authoritative sources get priority
const PREFERRED_DOMAINS = [
    // Academic databases
    'edu', 'gov', 'pubmed', 'ncbi.nlm.nih.gov', 'nih.gov', 'jstor', 'doi.org',
    'scholar.google', 'arxiv', 'researchgate', 'academia.edu',
    // Major publishers
    'nature.com', 'science.org', 'sciencedirect', 'springer', 'wiley', 
    'tandfonline', 'sagepub', 'oup.com', 'cambridge.org', 'pnas.org', 
    'cell.com', 'bmj.com', 'thelancet.com', 'nejm.org', 'jama',
    // Trusted organizations  
    'who.int', 'cdc.gov', 'nasa.gov', 'noaa.gov', 'epa.gov',
    'nationalacademies', 'genome.gov', 'niehs.nih.gov'
];

export const GoogleSearchAPI = {

    async search(query, apiKey, cx, groqKey = null) {
        // Generate focused search queries
        const queries = groqKey
            ? await this._extractTopicQueries(query, groqKey)
            : [this._buildSimpleQuery(query)];

        console.log('[Search] Queries:', queries);

        // Run all queries in parallel
        const allResultArrays = await Promise.all(
            queries.map(q => this._searchWithFallback(q))
        );

        const allResults = allResultArrays.flat();
        console.log('[Search] Total raw results:', allResults.length);

        // Filter and score results
        const filtered = this._filterAndScore(allResults, query);
        console.log('[Search] After filtering:', filtered.length);

        return filtered;
    },

    async _extractTopicQueries(text, groqKey) {
        try {
            const prompt = `Generate 3-5 specific search queries for academic research on this topic.

TEXT:
"${text.substring(0, 800)}"

RULES:
- Each query should be 3-6 words
- Focus on the MAIN TOPIC and key concepts
- Include specific terms, names, or theories mentioned
- Make queries specific enough to find relevant academic sources
- Avoid generic words like "research", "study", "analysis"

Return ONLY a JSON array:
["specific query one", "specific query two", "specific query three"]`;

            const response = await GroqAPI.chat([{ role: 'user', content: prompt }], groqKey, false);
            const jsonMatch = response.match(/\[[\s\S]*?\]/);
            
            if (!jsonMatch) throw new Error('No JSON array');
            
            const queries = JSON.parse(jsonMatch[0]);
            const cleaned = queries
                .filter(q => typeof q === 'string' && q.trim().length >= 8)
                .map(q => q.trim().substring(0, 100));
            
            if (cleaned.length === 0) throw new Error('No valid queries');
            
            console.log('[Search] Generated queries:', cleaned);
            return cleaned;
            
        } catch (e) {
            console.error('[Search] Query generation failed:', e.message);
            return [this._buildSimpleQuery(text)];
        }
    },

    _buildSimpleQuery(text) {
        // Extract key terms from the text
        const words = text.toLowerCase().match(/\b[a-z]{4,}\b/g) || [];
        const stopWords = new Set([
            'the','this','that','these','those','they','their','what','which','where',
            'when','why','how','have','has','had','will','would','could','should',
            'about','write','essay','paragraph','summary','discuss','explain','describe'
        ]);
        
        const meaningful = [...new Set(words)]
            .filter(w => !stopWords.has(w))
            .slice(0, 5);
        
        return meaningful.join(' ') || text.substring(0, 50);
    },

    async _searchWithFallback(query) {
        const shuffled = [...INSTANCES].sort(() => Math.random() - 0.5);

        for (const instance of shuffled.slice(0, 4)) {
            try {
                console.log('[Search] Trying:', instance);
                const results = await this._fetch(instance, query);
                if (results.length > 0) {
                    console.log('[Search] Got', results.length, 'results');
                    return results;
                }
            } catch (e) {
                console.error('[Search] Instance failed:', instance, e.message);
            }
        }

        console.warn('[Search] All instances failed for:', query);
        return [];
    },

    _filterAndScore(results, originalQuery) {
        const seen = new Set();
        const queryLower = originalQuery.toLowerCase();
        const queryWords = queryLower.match(/\b[a-z]{4,}\b/g) || [];

        return results
            .filter(r => {
                if (!r.title || !r.link) return false;

                const lowerUrl = r.link.toLowerCase();
                const lowerTitle = r.title.toLowerCase();
                
                // Skip banned file types
                if (BANNED_EXTENSIONS.some(ext => lowerUrl.includes(ext))) return false;

                try {
                    const domain = new URL(r.link).hostname.replace('www.', '').toLowerCase();
                    
                    // Skip banned domains
                    if (BANNED_DOMAINS.some(b => domain.includes(b))) return false;
                    
                    // Skip duplicate domains
                    if (seen.has(domain)) return false;
                    seen.add(domain);
                    
                    return true;
                } catch { return false; }
            })
            .map(r => {
                let score = 0;
                const lowerTitle = r.title.toLowerCase();
                const lowerSnippet = (r.snippet || '').toLowerCase();
                
                try {
                    const domain = new URL(r.link).hostname.replace('www.', '').toLowerCase();
                    
                    // Boost academic/authoritative sources
                    if (PREFERRED_DOMAINS.some(p => domain.includes(p))) score += 5;
                    if (domain.endsWith('.edu')) score += 4;
                    if (domain.endsWith('.gov')) score += 4;
                    if (domain.includes('.org')) score += 2;
                    
                    // Penalize low-quality indicators
                    if (domain.includes('blog')) score -= 2;
                    if (domain.includes('forum')) score -= 3;
                    if (r.title.length < 15) score -= 2;
                    
                    // Boost relevance to query
                    let relevance = 0;
                    for (const word of queryWords) {
                        if (lowerTitle.includes(word)) relevance += 2;
                        if (lowerSnippet.includes(word)) relevance += 1;
                    }
                    score += Math.min(relevance, 6); // Cap relevance boost
                    
                } catch {}
                
                return { ...r, _score: score };
            })
            .sort((a, b) => b._score - a._score)
            .slice(0, 12);
    },

    async _fetch(instance, query) {
        // Add academic focus to search
        const searchQuery = query + ' scholarly';
        const url = `${instance}/search?q=${encodeURIComponent(searchQuery)}&categories=general,science&language=en&format=json`;

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);

        try {
            // Try JSON format first (cleaner)
            let res = await fetch(url, {
                signal: controller.signal,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Accept': 'application/json, text/html'
                }
            });
            clearTimeout(timeout);
            
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            
            const contentType = res.headers.get('content-type') || '';
            
            if (contentType.includes('json')) {
                const data = await res.json();
                if (data.results && Array.isArray(data.results)) {
                    return data.results.map(r => ({
                        title: r.title || '',
                        link: r.url || r.link || '',
                        snippet: r.content || r.snippet || ''
                    })).filter(r => r.title && r.link);
                }
            }
            
            // Fallback to HTML parsing
            const html = await res.text();
            return this._parseResults(html);
            
        } catch (e) {
            clearTimeout(timeout);
            throw e;
        }
    },

    _parseResults(html) {
        const results = [];

        // Try article tags first (most SearX instances)
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

        // Fallback: try div-based results
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

        return results.slice(0, 25);
    },

    _clean(html) {
        return (html || '')
            .replace(/<[^>]+>/g, '')
            .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
            .replace(/\s+/g, ' ').trim().substring(0, 300);
    }
};
