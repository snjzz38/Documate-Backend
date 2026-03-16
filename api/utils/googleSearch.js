// api/utils/googleSearch.js
// SearXNG-based search with intelligent topic understanding

const INSTANCES = [
    'https://search.sapti.me',
    'https://searx.tiekoetter.com', 
    'https://search.bus-hit.me',
    'https://searx.be',
    'https://search.ononoki.org',
    'https://priv.au',
    'https://searx.work',
    'https://search.mdosch.de',
    'https://searx.oxynodus.xyz'
];

// Sites that are never useful for academic research
const BANNED_DOMAINS = [
    'reddit', 'quora', 'stackoverflow', 'stackexchange',
    'youtube', 'tiktok', 'instagram', 'facebook', 'twitter', 'pinterest',
    'amazon', 'ebay', 'etsy', 'alibaba', 'aliexpress',
    'macrumors', 'forums', 'discord', 'telegram',
    'petfinder', 'akc.org', 'dogbreeds', 'animalcorner',
    'allthingsdogs', 'a-z-animals', 'thesprucepets'
];

const BANNED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.mp4', '.mp3', '.pdf.jpg', '.zip', '.exe'];

// Academic and authoritative sources
const PREFERRED_DOMAINS = {
    tier1: ['doi.org', 'pubmed', 'ncbi.nlm.nih.gov', 'nih.gov', 'jstor.org', 'scholar.google', 
            'arxiv.org', 'semanticscholar', 'pmc', 'sciencedirect', 'springer', 'wiley'],
    tier2: ['.edu', '.gov', 'researchgate', 'academia.edu', 'nature.com', 'science.org'],
    tier3: ['tandfonline', 'sagepub', 'oup.com', 'cambridge.org', 'pnas.org', 'cell.com', 
            'bmj.com', 'thelancet.com', 'nejm.org', 'who.int', 'cdc.gov', 'nasa.gov',
            'britannica', 'nationalgeographic', 'smithsonian', 'bbc.com/news', 'npr.org',
            'nytimes.com', 'theguardian.com', 'washingtonpost.com', 'reuters.com', 'apnews.com']
};

// Music/entertainment sources
const MUSIC_DOMAINS = [
    'genius.com', 'azlyrics', 'songmeanings', 'metrolyrics',
    'allmusic.com', 'discogs.com', 'last.fm', 'spotify',
    'billboard.com', 'rollingstone.com', 'pitchfork.com', 'nme.com',
    'musicbrainz', 'rateyourmusic', 'albumoftheyear'
];

// Import GroqAPI
import * as groqModule from './groqAPI.js';
const GroqAPI = groqModule.GroqAPI || groqModule.default?.GroqAPI || groqModule.default || groqModule;

export const GoogleSearchAPI = {

    async search(query, apiKey, cx, groqKey = null) {
        console.log('[Search] Original query:', query);
        
        // Step 1: Understand the topic and generate smart queries
        const { queries, topicType, context } = groqKey
            ? await this._understandTopic(query, groqKey)
            : { queries: [this._buildSimpleQuery(query)], topicType: 'general', context: '' };

        console.log('[Search] Topic type:', topicType);
        console.log('[Search] Generated queries:', queries);

        // Step 2: Run searches
        const allResultArrays = await Promise.all(
            queries.map(q => this._searchWithFallback(q, topicType))
        );

        const allResults = allResultArrays.flat();
        console.log('[Search] Total raw results:', allResults.length);

        // Step 3: Filter and score based on topic type
        const filtered = this._filterAndScore(allResults, query, topicType, context);
        console.log('[Search] After filtering:', filtered.length);

        return filtered;
    },

    async _understandTopic(text, groqKey) {
        try {
            const prompt = `Analyze this query and generate search queries.

USER QUERY:
"${text.substring(0, 1000)}"

TASK:
1. Determine what the user is ACTUALLY asking about
2. Identify if common words have special meanings (e.g., "Dogs" could be a Pink Floyd song, "Apple" could be a company, "The Wall" could be an album)
3. Generate 3-5 specific search queries that will find relevant sources

DISAMBIGUATION RULES:
- If mentions lyrics, song, music, album, artist, band, track → topicType: "music"
- If mentions movie, film, actor, director, scene → topicType: "film"  
- If mentions book, author, chapter, novel, literary → topicType: "literature"
- If mentions company, CEO, stock, product, business → topicType: "business"
- If mentions scientific concepts, research, studies → topicType: "science"
- Look for artist names, song titles, album names that suggest music content
- Common song titles that look like regular words: "Dogs", "Money", "Time", "Us and Them", "Breathe"

Respond ONLY with this JSON:
{
  "topicType": "music|film|literature|science|history|politics|business|technology|general",
  "actualTopic": "brief description of what user wants",
  "context": "disambiguating info like artist name, year, album",
  "queries": ["specific search 1", "specific search 2", "specific search 3"]
}

QUERY RULES:
- ALWAYS include disambiguating terms
- For music: include artist name + "song" or "lyrics" or "meaning"
- For academic: include specific concepts, authors, theories
- Example: "Pink Floyd Dogs song analysis" NOT just "dogs"`;

            const response = await GroqAPI.chat([{ role: 'user', content: prompt }], groqKey, false);
            const jsonMatch = response.match(/\{[\s\S]*?\}/);
            
            if (!jsonMatch) throw new Error('No JSON found');
            
            const parsed = JSON.parse(jsonMatch[0]);
            
            const queries = (parsed.queries || [])
                .filter(q => typeof q === 'string' && q.trim().length >= 5)
                .map(q => q.trim().substring(0, 150));
            
            if (queries.length === 0) throw new Error('No valid queries');
            
            return {
                queries,
                topicType: parsed.topicType || 'general',
                context: parsed.context || parsed.actualTopic || ''
            };
            
        } catch (e) {
            console.error('[Search] Topic understanding failed:', e.message);
            return {
                queries: [this._buildSimpleQuery(text)],
                topicType: 'general',
                context: ''
            };
        }
    },

    _buildSimpleQuery(text) {
        const words = text.toLowerCase().match(/\b[a-z]{3,}\b/g) || [];
        const stopWords = new Set([
            'the','this','that','these','those','they','their','what','which','where',
            'when','why','how','have','has','had','will','would','could','should',
            'about','write','essay','paragraph','summary','discuss','explain','describe',
            'please','need','want','help','make','give','tell','find'
        ]);
        
        const meaningful = [...new Set(words)]
            .filter(w => !stopWords.has(w))
            .slice(0, 6);
        
        return meaningful.join(' ') || text.substring(0, 60);
    },

    async _searchWithFallback(query, topicType) {
        const shuffled = [...INSTANCES].sort(() => Math.random() - 0.5);

        for (const instance of shuffled.slice(0, 4)) {
            try {
                const results = await this._fetch(instance, query, topicType);
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

    _filterAndScore(results, originalQuery, topicType, context) {
        const seen = new Set();
        const queryLower = originalQuery.toLowerCase();
        const contextLower = (context || '').toLowerCase();
        const queryWords = queryLower.match(/\b[a-z]{3,}\b/g) || [];
        const contextWords = contextLower.match(/\b[a-z]{3,}\b/g) || [];

        return results
            .filter(r => {
                if (!r.title || !r.link) return false;

                const lowerUrl = r.link.toLowerCase();
                const lowerTitle = r.title.toLowerCase();
                
                if (BANNED_EXTENSIONS.some(ext => lowerUrl.includes(ext))) return false;

                try {
                    const domain = new URL(r.link).hostname.replace('www.', '').toLowerCase();
                    
                    // For music topics, aggressively filter out animal/pet content
                    if (topicType === 'music') {
                        const animalIndicators = ['petfinder', 'akc', 'dogbreed', 'animalcorner', 
                            'allthingsdogs', 'a-z-animals', 'thesprucepets', 'puppy', 'kennel'];
                        if (animalIndicators.some(s => domain.includes(s) || lowerTitle.includes(s))) return false;
                        if (lowerTitle.includes('dog breed') || lowerTitle.includes('types of dogs')) return false;
                    } else {
                        // For non-music, apply normal banned domains
                        if (BANNED_DOMAINS.some(b => domain.includes(b))) return false;
                    }
                    
                    // Skip duplicates
                    const baseDomain = domain.split('.').slice(-2).join('.');
                    if (seen.has(baseDomain)) return false;
                    seen.add(baseDomain);
                    
                    return true;
                } catch { return false; }
            })
            .map(r => {
                let score = 0;
                const lowerTitle = r.title.toLowerCase();
                const lowerSnippet = (r.snippet || '').toLowerCase();
                
                try {
                    const domain = new URL(r.link).hostname.replace('www.', '').toLowerCase();
                    
                    if (topicType === 'music') {
                        // Boost music sources heavily
                        if (MUSIC_DOMAINS.some(m => domain.includes(m))) score += 10;
                        if (domain.includes('genius')) score += 6;
                        if (domain.includes('rollingstone') || domain.includes('pitchfork')) score += 4;
                        
                        // Boost content indicators
                        if (lowerTitle.includes('meaning') || lowerTitle.includes('analysis')) score += 5;
                        if (lowerTitle.includes('lyrics') || lowerTitle.includes('song')) score += 4;
                        if (lowerTitle.includes('album') || lowerTitle.includes('review')) score += 3;
                        
                        // Heavy penalty for animal content
                        if (lowerTitle.includes('pet') || lowerTitle.includes('breed')) score -= 20;
                        if (lowerTitle.includes('puppy') || lowerTitle.includes('kennel')) score -= 20;
                        
                    } else {
                        // Academic scoring
                        if (PREFERRED_DOMAINS.tier1.some(p => domain.includes(p))) score += 8;
                        if (PREFERRED_DOMAINS.tier2.some(p => domain.includes(p))) score += 5;
                        if (PREFERRED_DOMAINS.tier3.some(p => domain.includes(p))) score += 3;
                        if (domain.endsWith('.edu')) score += 6;
                        if (domain.endsWith('.gov')) score += 5;
                        
                        // Penalize low-quality
                        if (domain.includes('blog')) score -= 2;
                        if (domain.includes('forum')) score -= 3;
                    }
                    
                    if (r.title.length < 15) score -= 2;
                    
                    // Boost context matches (artist name, album, etc)
                    for (const word of contextWords) {
                        if (word.length >= 3) {
                            if (lowerTitle.includes(word)) score += 5;
                            if (lowerSnippet.includes(word)) score += 2;
                        }
                    }
                    
                    // Boost query word matches
                    for (const word of queryWords) {
                        if (word.length >= 4) {
                            if (lowerTitle.includes(word)) score += 2;
                            if (lowerSnippet.includes(word)) score += 1;
                        }
                    }
                    
                } catch {}
                
                return { ...r, _score: score };
            })
            .sort((a, b) => b._score - a._score)
            .slice(0, 15);
    },

    async _fetch(instance, query, topicType) {
        let searchQuery = query;
        let categories = 'general';
        
        if (topicType === 'music') {
            categories = 'general,music';
        } else if (topicType === 'science' || topicType === 'general') {
            searchQuery = query + ' scholarly';
            categories = 'general,science';
        }
        
        const url = `${instance}/search?q=${encodeURIComponent(searchQuery)}&categories=${categories}&language=en&format=json`;

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);

        try {
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
