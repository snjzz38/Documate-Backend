// api/utils/sourceFinder.js
// Academic source discovery using OpenAlex API
// Fetches official citations from CrossRef/doi.org

const OPENALEX_BASE = 'https://api.openalex.org/works';

// Map style names to CSL styles for CrossRef
const CSL_STYLES = {
    'apa': 'apa',
    'apa7': 'apa',
    'mla': 'modern-language-association',
    'mla9': 'modern-language-association',
    'chicago': 'chicago-author-date',
    'harvard': 'harvard-cite-them-right',
    'ieee': 'ieee'
};

export const SourceFinderAPI = {
    
    /**
     * Fetch official citation from doi.org using CrossRef
     * @param {string} doi - The DOI
     * @param {string} style - Citation style (apa7, mla9, chicago, etc.)
     * @returns {Promise<string|null>} - Formatted citation or null
     */
    async fetchCitation(doi, style = 'apa7') {
        if (!doi) return null;
        
        const cleanDoi = doi.replace(/^https?:\/\/doi\.org\//i, '').trim();
        if (!cleanDoi) return null;
        
        const cslStyle = CSL_STYLES[style.toLowerCase()] || 'apa';
        
        try {
            const response = await fetch(`https://doi.org/${cleanDoi}`, {
                headers: { 'Accept': `text/x-bibliography; style=${cslStyle}` },
                redirect: 'follow'
            });
            
            if (!response.ok) return null;
            
            const citation = await response.text();
            return citation.trim();
        } catch (e) {
            console.log(`[SourceFinder] Citation fetch failed for ${cleanDoi}:`, e.message);
            return null;
        }
    },

    /**
     * Fetch citations for all sources
     * @param {Array} sources - Array of source objects with doi field
     * @param {string} style - Citation style
     * @returns {Promise<Array>} - Sources with citation field added
     */
    async fetchAllCitations(sources, style = 'apa7') {
        if (!sources?.length) return sources;
        
        console.log(`[SourceFinder] Fetching ${sources.length} citations in ${style} format...`);
        
        const results = await Promise.all(
            sources.map(async (source) => {
                if (!source.doi) {
                    return { ...source, citation: this._generateFallbackCitation(source, style) };
                }
                
                const official = await this.fetchCitation(source.doi, style);
                if (official) {
                    return { ...source, citation: official, citationSource: 'crossref' };
                }
                
                // Fallback if CrossRef fails
                return { ...source, citation: this._generateFallbackCitation(source, style), citationSource: 'generated' };
            })
        );
        
        const crossrefCount = results.filter(s => s.citationSource === 'crossref').length;
        console.log(`[SourceFinder] Got ${crossrefCount}/${results.length} citations from CrossRef`);
        
        return results;
    },

    /**
     * Generate fallback citation when CrossRef is unavailable
     */
    _generateFallbackCitation(source, style) {
        const isApa = style.includes('apa');
        const isMla = style.includes('mla');
        
        const author = this._formatAuthorForCitation(source, isApa ? 'apa' : 'mla');
        const title = source.title || 'Untitled';
        const venue = source.venue || '';
        const year = source.year || 'n.d.';
        const url = source.doi ? `https://doi.org/${source.doi}` : (source.url || '');
        
        if (isApa) {
            // APA 7th: Author, A. A. (Year). Title. Journal. URL
            return `${author} (${year}). ${title}.${venue ? ` ${venue}.` : ''} ${url}`;
        } else if (isMla) {
            // MLA 9th: Author. "Title." Journal, Year, URL.
            return `${author}. "${title}."${venue ? ` ${venue},` : ''} ${year}, ${url}.`;
        } else {
            // Chicago: Author. "Title." Journal. Year. URL.
            return `${author}. "${title}."${venue ? ` ${venue}.` : ''} ${year}. ${url}.`;
        }
    },

    /**
     * Format author name for citations
     */
    _formatAuthorForCitation(source, style) {
        if (source.authors?.length && source.authors[0].family) {
            const auths = source.authors;
            if (style === 'apa') {
                // APA: Last, F. I., Last, F. I., & Last, F. I.
                const formatted = auths.slice(0, 3).map(a => {
                    const initials = a.given ? a.given.split(' ').map(n => n[0] + '.').join(' ') : '';
                    return `${a.family}, ${initials}`;
                });
                if (auths.length > 3) return formatted[0] + ', et al.';
                if (formatted.length > 1) return formatted.slice(0, -1).join(', ') + ', & ' + formatted[formatted.length - 1];
                return formatted[0];
            } else {
                // MLA: Last, First, et al.
                const first = auths[0];
                if (auths.length > 2) return `${first.family}, ${first.given || ''}, et al.`;
                if (auths.length === 2) return `${first.family}, ${first.given || ''}, and ${auths[1].given || ''} ${auths[1].family}`;
                return `${first.family}, ${first.given || ''}`;
            }
        }
        return source.author || source.displayName || 'Unknown';
    },

    /**
     * Search for academic papers on a topic
     * Only returns papers with DOIs for proper citation
     */
    async search(query, limit = 12) {
        if (!query || query.trim().length < 3) {
            console.log('[SourceFinder] Query too short:', query);
            return [];
        }

        try {
            // Clean and enhance query
            const cleanQuery = query.trim().toLowerCase();
            
            // Build OpenAlex query - REQUIRE DOI
            const params = new URLSearchParams({
                search: cleanQuery,
                filter: 'is_oa:true,has_abstract:true,has_doi:true',
                'per-page': '25', // Get more to filter
                sort: 'relevance_score:desc'
            });

            const url = `${OPENALEX_BASE}?${params}`;
            console.log('[SourceFinder] Searching:', url);

            const response = await fetch(url, {
                headers: { 'User-Agent': 'DocuMate Academic Tool (mailto:contact@documate.app)' }
            });

            if (!response.ok) throw new Error(`OpenAlex returned ${response.status}`);

            const data = await response.json();
            if (!data.results?.length) return [];

            // Transform and filter results
            const papers = data.results
                .map(work => this._transformWork(work))
                .filter(p => {
                    // Must have DOI
                    if (!p.doi) return false;
                    // Must have substantial abstract
                    if (!p.abstract || p.abstract.length < 150) return false;
                    // Check relevance - title or abstract should contain query terms
                    const queryWords = cleanQuery.split(/\s+/).filter(w => w.length > 3);
                    const titleLower = p.title.toLowerCase();
                    const abstractLower = p.abstract.toLowerCase();
                    const matchCount = queryWords.filter(w => 
                        titleLower.includes(w) || abstractLower.includes(w)
                    ).length;
                    // At least half the query words should match
                    return matchCount >= Math.ceil(queryWords.length / 2);
                })
                .slice(0, limit);

            console.log('[SourceFinder] Found', papers.length, 'relevant papers with DOIs');
            return papers;

        } catch (e) {
            console.error('[SourceFinder] Search failed:', e.message);
            return [];
        }
    },

    /**
     * Search with multiple specific queries for better coverage
     * @param {string} topic - Topic to search
     * @param {number} limit - Max results
     * @param {string} citationStyle - Style for citations (apa7, mla9, chicago)
     */
    async searchTopic(topic, limit = 12, citationStyle = null) {
        // Generate specific search queries based on topic
        const queries = this._generateQueries(topic);
        console.log('[SourceFinder] Generated queries:', queries);
        
        const allResults = await Promise.all(
            queries.map(q => this.search(q, 8))
        );

        // Deduplicate by DOI
        const seen = new Set();
        const deduplicated = [];

        for (const results of allResults) {
            for (const paper of results) {
                if (paper.doi && !seen.has(paper.doi)) {
                    seen.add(paper.doi);
                    deduplicated.push(paper);
                }
            }
        }

        // Sort by citation count and get top results
        const topResults = deduplicated
            .sort((a, b) => (b.citationCount || 0) - (a.citationCount || 0))
            .slice(0, limit);

        // If citation style specified, fetch official citations
        if (citationStyle) {
            return await this.fetchAllCitations(topResults, citationStyle);
        }

        return topResults;
    },

    /**
     * Generate multiple search queries for better coverage
     */
    _generateQueries(topic) {
        const lower = topic.toLowerCase();
        const queries = [topic]; // Original query
        
        // Add specific variations based on topic keywords
        if (lower.includes('designer bab') || lower.includes('gene edit') || lower.includes('crispr')) {
            queries.push(
                'designer babies ethics genetic engineering',
                'CRISPR human embryo editing ethics',
                'germline editing ethical implications',
                'preimplantation genetic diagnosis ethics',
                'human genome editing policy regulation'
            );
        } else if (lower.includes('climate') || lower.includes('global warming')) {
            queries.push(
                'climate change mitigation policy',
                'global warming environmental impact',
                'carbon emissions reduction strategies'
            );
        } else if (lower.includes('artificial intelligence') || lower.includes(' ai ')) {
            queries.push(
                'artificial intelligence ethics society',
                'machine learning bias fairness',
                'AI regulation governance policy'
            );
        }
        
        return queries.slice(0, 4); // Max 4 queries
    },

    /**
     * Transform OpenAlex work to our format
     */
    _transformWork(work) {
        const abstract = this._reconstructAbstract(work.abstract_inverted_index);
        
        // Get authors with structured names for proper citation
        const authors = (work.authorships || [])
            .slice(0, 5)
            .map(a => {
                const name = a.author?.display_name || '';
                const parts = name.split(' ');
                if (parts.length >= 2) {
                    return {
                        given: parts.slice(0, -1).join(' '),
                        family: parts[parts.length - 1]
                    };
                }
                return { given: '', family: name };
            })
            .filter(a => a.family);

        // Format display author
        let displayAuthor = 'Unknown';
        if (authors.length > 0) {
            displayAuthor = authors.length > 2 
                ? `${authors[0].family} et al.`
                : authors.map(a => a.family).join(' & ');
        }

        const venue = work.primary_location?.source?.display_name ||
                     work.host_venue?.display_name ||
                     '';

        const doi = work.doi ? work.doi.replace('https://doi.org/', '') : null;

        return {
            id: work.id,
            title: work.title || 'Untitled',
            authors: authors,
            author: displayAuthor,
            displayName: displayAuthor,
            year: work.publication_year || 'n.d.',
            venue: venue,
            citationCount: work.cited_by_count || 0,
            url: doi ? `https://doi.org/${doi}` : work.id,
            doi: doi,
            abstract: abstract,
            text: abstract
        };
    },

    /**
     * Reconstruct abstract from inverted index
     */
    _reconstructAbstract(invertedIndex) {
        if (!invertedIndex || typeof invertedIndex !== 'object') return null;
        try {
            const words = [];
            for (const [word, positions] of Object.entries(invertedIndex)) {
                for (const pos of positions) words[pos] = word;
            }
            return words.filter(Boolean).join(' ');
        } catch (e) {
            return null;
        }
    }
};

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        const query = req.query.q;
        if (!query) return res.status(400).json({ success: false, error: 'Missing ?q=' });

        // Use topic search for better results
        const results = await SourceFinderAPI.searchTopic(query, 12);
        return res.status(200).json({ success: true, count: results.length, results });
    } catch (err) {
        console.error('[SourceFinder]', err);
        return res.status(500).json({ success: false, error: 'Search failed' });
    }
}
