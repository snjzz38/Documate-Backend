// api/utils/sourceFinder.js
// Academic source discovery using OpenAlex API
// Returns open access papers with abstracts for citation

const OPENALEX_BASE = 'https://api.openalex.org/works';

export const SourceFinderAPI = {
    
    /**
     * Search for academic papers on a topic
     * @param {string} query - Search query
     * @param {number} limit - Max results (default 10)
     * @returns {Array} Array of paper objects with title, authors, abstract, url, etc.
     */
    async search(query, limit = 10) {
        if (!query || query.trim().length < 3) {
            console.log('[SourceFinder] Query too short:', query);
            return [];
        }

        try {
            // Build OpenAlex query with filters
            const params = new URLSearchParams({
                search: query.trim(),
                filter: 'is_oa:true,has_abstract:true',
                'per-page': Math.min(limit, 25).toString(),
                sort: 'relevance_score:desc'
            });

            const url = `${OPENALEX_BASE}?${params}`;
            console.log('[SourceFinder] Searching:', url);

            const response = await fetch(url, {
                headers: {
                    'User-Agent': 'DocuMate Academic Research Tool (mailto:contact@documate.app)'
                }
            });

            if (!response.ok) {
                throw new Error(`OpenAlex returned ${response.status}`);
            }

            const data = await response.json();
            
            if (!data.results || !Array.isArray(data.results)) {
                console.log('[SourceFinder] No results found');
                return [];
            }

            // Transform results into our format
            const papers = data.results
                .map(work => this._transformWork(work))
                .filter(p => p.abstract && p.abstract.length > 100); // Only keep papers with substantial abstracts

            console.log('[SourceFinder] Found', papers.length, 'papers with abstracts');
            return papers;

        } catch (e) {
            console.error('[SourceFinder] Search failed:', e.message);
            return [];
        }
    },

    /**
     * Search with multiple queries and deduplicate
     * @param {Array<string>} queries - Array of search queries
     * @param {number} limitPerQuery - Max results per query
     * @returns {Array} Deduplicated array of papers
     */
    async searchMultiple(queries, limitPerQuery = 5) {
        const allResults = await Promise.all(
            queries.map(q => this.search(q, limitPerQuery))
        );

        // Flatten and deduplicate by DOI or title
        const seen = new Set();
        const deduplicated = [];

        for (const results of allResults) {
            for (const paper of results) {
                const key = paper.doi || paper.title.toLowerCase().substring(0, 50);
                if (!seen.has(key)) {
                    seen.add(key);
                    deduplicated.push(paper);
                }
            }
        }

        // Sort by citation count (more cited = more authoritative)
        return deduplicated
            .sort((a, b) => (b.citationCount || 0) - (a.citationCount || 0))
            .slice(0, 15);
    },

    /**
     * Transform OpenAlex work object to our format
     */
    _transformWork(work) {
        const abstract = this._reconstructAbstract(work.abstract_inverted_index);
        
        // Get authors (limit to first 3 for citation)
        const authors = (work.authorships || [])
            .slice(0, 5)
            .map(a => a.author?.display_name)
            .filter(Boolean);

        // Get the best URL (prefer open access PDF)
        const bestUrl = work.best_oa_location?.pdf_url || 
                       work.best_oa_location?.landing_page_url ||
                       work.primary_location?.landing_page_url ||
                       work.doi ||
                       work.id;

        // Extract publication info
        const venue = work.primary_location?.source?.display_name ||
                     work.host_venue?.display_name ||
                     'Academic Publication';

        return {
            id: work.id,
            title: work.title || 'Untitled',
            authors: authors,
            // Format first author for citations
            author: authors.length > 0 
                ? (authors.length > 2 ? `${authors[0]} et al.` : authors.join(' & '))
                : 'Unknown',
            year: work.publication_year || 'n.d.',
            venue: venue,
            site: this._extractSiteName(venue),
            citationCount: work.cited_by_count || 0,
            url: bestUrl,
            doi: work.doi ? work.doi.replace('https://doi.org/', '') : null,
            abstract: abstract,
            // For compatibility with existing citation system
            text: abstract,
            displayName: authors[0] || venue
        };
    },

    /**
     * Reconstruct abstract from OpenAlex inverted index format
     */
    _reconstructAbstract(invertedIndex) {
        if (!invertedIndex || typeof invertedIndex !== 'object') {
            return null;
        }

        try {
            const words = [];
            for (const [word, positions] of Object.entries(invertedIndex)) {
                for (const pos of positions) {
                    words[pos] = word;
                }
            }
            return words.filter(Boolean).join(' ');
        } catch (e) {
            console.error('[SourceFinder] Abstract reconstruction failed:', e.message);
            return null;
        }
    },

    /**
     * Extract short site name from venue
     */
    _extractSiteName(venue) {
        if (!venue) return 'Academic Journal';
        
        // Common abbreviations
        const abbrevs = {
            'nature': 'Nature',
            'science': 'Science',
            'plos': 'PLOS',
            'bmc': 'BMC',
            'frontiers': 'Frontiers',
            'mdpi': 'MDPI',
            'elsevier': 'Elsevier',
            'springer': 'Springer',
            'wiley': 'Wiley',
            'taylor': 'Taylor & Francis',
            'oxford': 'Oxford Academic',
            'cambridge': 'Cambridge',
            'ieee': 'IEEE',
            'acm': 'ACM',
            'cell': 'Cell Press',
            'lancet': 'The Lancet',
            'bmj': 'BMJ',
            'jama': 'JAMA',
            'nejm': 'NEJM'
        };

        const lower = venue.toLowerCase();
        for (const [key, name] of Object.entries(abbrevs)) {
            if (lower.includes(key)) return name;
        }

        // Return first 2-3 words
        return venue.split(/[\s,]+/).slice(0, 3).join(' ');
    }
};

// Also export as default for direct API endpoint usage
export default async function handler(req, res) {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    try {
        const query = req.query.q;
        
        if (!query) {
            return res.status(400).json({
                success: false,
                error: 'Missing query parameter ?q='
            });
        }

        const results = await SourceFinderAPI.search(query, 10);

        return res.status(200).json({
            success: true,
            count: results.length,
            results: results
        });

    } catch (err) {
        console.error('[SourceFinder] Handler error:', err.message);
        return res.status(500).json({
            success: false,
            error: 'Failed to fetch papers'
        });
    }
}
