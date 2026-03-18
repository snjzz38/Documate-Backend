// api/utils/sourceFinder.js
const OPENALEX_BASE = 'https://api.openalex.org/works';

export const SourceFinderAPI = {

    // Fetch rich metadata from Crossref JSON API
    async fetchCrossrefMetadata(doi) {
        if (!doi) return null;
        const cleanDoi = doi.replace(/^https?:\/\/doi\.org\//i, '').trim();
        if (!cleanDoi) return null;
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 5000);
            const res = await fetch(`https://api.crossref.org/works/${encodeURIComponent(cleanDoi)}`, {
                signal: controller.signal,
                headers: { 'User-Agent': 'DocuMate Academic Tool (mailto:contact@documate.app)' }
            });
            clearTimeout(timeout);
            if (!res.ok) { console.log(`[CrossRef FAILED] ${cleanDoi} → ${res.status}`); return null; }
            const data = await res.json();
            console.log(`[CrossRef OK] ${cleanDoi}`);
            return data.message || null;
        } catch (e) {
            console.log(`[CrossRef ERROR] ${cleanDoi}:`, e.message);
            return null;
        }
    },

    // Enrich a source with Crossref metadata
    async enrichSource(source, style = 'apa7') {
        if (!source.doi) {
            return { ...source, citation: this._formatCitation(source, style), citationSource: 'openalex' };
        }
        const meta = await this.fetchCrossrefMetadata(source.doi);
        if (!meta) {
            return { ...source, citation: this._formatCitation(source, style), citationSource: 'openalex' };
        }

        // Merge Crossref metadata into source — fill any gaps
        const enriched = { ...source };

        // Authors from Crossref are more complete
        if (meta.author?.length) {
            enriched.authors = meta.author.map(a => ({
                family: a.family || '',
                given: a.given || ''
            })).filter(a => a.family);
        }

        // Title
        if (meta.title?.[0]) enriched.title = meta.title[0];

        // Journal
        if (meta['container-title']?.[0]) enriched.venue = meta['container-title'][0];

        // Year
        const pubYear = meta.published?.['date-parts']?.[0]?.[0]
            || meta['published-print']?.['date-parts']?.[0]?.[0]
            || meta['published-online']?.['date-parts']?.[0]?.[0];
        if (pubYear) enriched.year = pubYear;

        // Volume, issue, pages — for proper journal citation
        enriched.volume = meta.volume || null;
        enriched.issue = meta.issue || null;
        enriched.pages = meta.page || null;

        enriched.citation = this._formatCitation(enriched, style);
        enriched.citationSource = 'crossref';
        return enriched;
    },

    // Enrich all sources in batches
    async fetchAllCitations(sources, style = 'apa7') {
        if (!sources?.length) return sources;
        console.log(`[SourceFinder] Enriching ${sources.length} sources with Crossref metadata...`);

        const results = [];
        const batchSize = 3;
        for (let i = 0; i < sources.length; i += batchSize) {
            const batch = sources.slice(i, i + batchSize);
            const enriched = await Promise.all(batch.map(s => this.enrichSource(s, style)));
            results.push(...enriched);
            if (i + batchSize < sources.length) {
                await new Promise(r => setTimeout(r, 300));
            }
        }

        const crossrefCount = results.filter(s => s.citationSource === 'crossref').length;
        console.log(`[SourceFinder] ${crossrefCount}/${results.length} enriched from Crossref`);
        return results;
    },

    // Master citation formatter — builds from structured metadata
    _formatCitation(source, style = 'apa7') {
        const isApa = style.includes('apa');
        const isMla = style.includes('mla');
        if (isApa) return this._formatApa(source);
        if (isMla) return this._formatMla(source);
        return this._formatChicago(source);
    },

        _formatApa(source) {
        const authors = source.authors || [];
    
        const formatAuthor = a => {
            if (!a.family) return '';
            const initials = a.given
                ? a.given.split(/[\s\-]+/).filter(Boolean).map(n => n[0].toUpperCase() + '.').join(' ')
                : '';
            return initials ? `${a.family}, ${initials}` : a.family;
        };
    
        let authorStr = 'Unknown';
        if (authors.length === 1) {
            authorStr = formatAuthor(authors[0]);
        } else if (authors.length === 2) {
            authorStr = `${formatAuthor(authors[0])} & ${formatAuthor(authors[1])}`;
        } else if (authors.length === 3) {
            authorStr = `${formatAuthor(authors[0])}, ${formatAuthor(authors[1])}, & ${formatAuthor(authors[2])}`;
        } else if (authors.length > 3) {
            authorStr = `${formatAuthor(authors[0])}, et al.`;
        }
    
        const year = source.year || 'n.d.';
        const title = source.title || 'Untitled';
        const journal = source.venue ? `*${source.venue}*` : '';
        const volume = source.volume || '';
        const issue = source.issue ? `(${source.issue})` : '';
        const pages = source.pages || '';
        const doi = source.doi ? `https://doi.org/${source.doi}` : (source.url || '');
    
        let citation = `${authorStr} (${year}). ${title}.`;
        if (journal) {
            citation += ` ${journal}`;
            if (volume) {
                citation += `, *${volume}*${issue}`;
                if (pages) citation += `, ${pages}`;
            }
            citation += '.';
        }
        if (doi) citation += ` ${doi}`;
        return citation.trim();
    },
    
    _formatMla(source) {
        const authors = source.authors || [];
    
        const formatFirst = a => {
            if (!a.family) return '';
            return a.given ? `${a.family}, ${a.given}` : a.family;
        };
        const formatRest = a => {
            if (!a.family) return '';
            return a.given ? `${a.given} ${a.family}` : a.family;
        };
    
        let authorStr = 'Unknown';
        if (authors.length === 1) {
            authorStr = formatFirst(authors[0]);
        } else if (authors.length === 2) {
            authorStr = `${formatFirst(authors[0])}, and ${formatRest(authors[1])}`;
        } else if (authors.length >= 3) {
            authorStr = `${formatFirst(authors[0])}, et al.`;
        }
    
        const title = source.title || 'Untitled';
        const journal = source.venue || '';
        const year = source.year || 'n.d.';
        const volume = source.volume ? `vol. ${source.volume}` : '';
        const issue = source.issue ? `no. ${source.issue}` : '';
        const pages = source.pages ? `pp. ${source.pages}` : '';
        const doi = source.doi ? `https://doi.org/${source.doi}` : (source.url || '');
    
        let citation = `${authorStr}. "${title}."`;
        if (journal) citation += ` *${journal}*,`;
        const details = [volume, issue, year, pages].filter(Boolean).join(', ');
        if (details) citation += ` ${details}`;
        citation += '.';
        if (doi) citation += ` ${doi}.`;
        return citation.trim();
    },
    
    _formatChicago(source) {
        const authors = source.authors || [];
    
        const formatFirst = a => a.given ? `${a.family}, ${a.given}` : a.family;
        const formatRest = a => a.given ? `${a.given} ${a.family}` : a.family;
    
        let authorStr = 'Unknown';
        if (authors.length === 1) {
            authorStr = formatFirst(authors[0]);
        } else if (authors.length === 2) {
            authorStr = `${formatFirst(authors[0])}, and ${formatRest(authors[1])}`;
        } else if (authors.length >= 3) {
            authorStr = `${formatFirst(authors[0])}, et al.`;
        }
    
        const title = source.title || 'Untitled';
        const journal = source.venue || '';
        const year = source.year || 'n.d.';
        const volume = source.volume || '';
        const issue = source.issue ? `no. ${source.issue}` : '';
        const pages = source.pages || '';
        const doi = source.doi ? `https://doi.org/${source.doi}` : (source.url || '');
    
        let citation = `${authorStr}. "${title}."`;
        if (journal) citation += ` ${journal}`;
        if (volume) citation += ` ${volume}`;
        if (issue) citation += `, ${issue}`;
        citation += ` (${year})`;
        if (pages) citation += `: ${pages}`;
        citation += '.';
        if (doi) citation += ` ${doi}.`;
        return citation.trim();
    },

    async search(query, limit = 12) {
        if (!query || query.trim().length < 3) return [];
        try {
            const cleanQuery = query.trim().toLowerCase();
            const params = new URLSearchParams({
                search: cleanQuery,
                filter: 'is_oa:true,has_abstract:true,has_doi:true',
                'per-page': '25',
                sort: 'relevance_score:desc'
            });
            const response = await fetch(`${OPENALEX_BASE}?${params}`, {
                headers: { 'User-Agent': 'DocuMate Academic Tool (mailto:contact@documate.app)' }
            });
            if (!response.ok) throw new Error(`OpenAlex returned ${response.status}`);
            const data = await response.json();
            if (!data.results?.length) return [];

            return data.results
                .map(work => this._transformWork(work))
                .filter(p => {
                    if (!p.doi) return false;
                    if (!p.abstract || p.abstract.length < 150) return false;
                    const queryWords = cleanQuery.split(/\s+/).filter(w => w.length > 3);
                    const titleLower = p.title.toLowerCase();
                    const abstractLower = p.abstract.toLowerCase();
                    const matchCount = queryWords.filter(w => titleLower.includes(w) || abstractLower.includes(w)).length;
                    return matchCount >= Math.ceil(queryWords.length / 2);
                })
                .slice(0, limit);
        } catch (e) {
            console.error('[SourceFinder] Search failed:', e.message);
            return [];
        }
    },

    async searchTopic(topic, limit = 12, citationStyle = null) {
        const queries = this._generateQueries(topic);
        console.log('[SourceFinder] Generated queries:', queries);

        const allResults = await Promise.all(queries.map(q => this.search(q, 8)));

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

        const topResults = deduplicated
            .sort((a, b) => (b.citationCount || 0) - (a.citationCount || 0))
            .slice(0, limit);

        if (citationStyle) {
            return await this.fetchAllCitations(topResults, citationStyle);
        }
        return topResults;
    },

    _generateQueries(topic) {
        const lower = topic.toLowerCase();
        const queries = [topic];
        if (lower.includes('designer bab') || lower.includes('gene edit') || lower.includes('crispr')) {
            queries.push('designer babies ethics genetic engineering', 'CRISPR human embryo editing ethics', 'germline editing ethical implications', 'preimplantation genetic diagnosis ethics');
        } else if (lower.includes('climate') || lower.includes('global warming')) {
            queries.push('climate change mitigation policy', 'global warming environmental impact', 'carbon emissions reduction strategies');
        } else if (lower.includes('artificial intelligence') || lower.includes(' ai ')) {
            queries.push('artificial intelligence ethics society', 'machine learning bias fairness', 'AI regulation governance policy');
        }
        return queries.slice(0, 4);
    },

    _transformWork(work) {
        const abstract = this._reconstructAbstract(work.abstract_inverted_index);
        const authors = (work.authorships || []).slice(0, 5).map(a => {
            const name = a.author?.display_name || '';
            const parts = name.split(' ');
            if (parts.length >= 2) return { given: parts.slice(0, -1).join(' '), family: parts[parts.length - 1] };
            return { given: '', family: name };
        }).filter(a => a.family);

        let displayAuthor = 'Unknown';
        if (authors.length > 0) {
            displayAuthor = authors.length > 2 ? `${authors[0].family} et al.` : authors.map(a => a.family).join(' & ');
        }

        const venue = work.primary_location?.source?.display_name || work.host_venue?.display_name || '';
        const doi = work.doi ? work.doi.replace('https://doi.org/', '') : null;

        return {
            id: work.id, title: work.title || 'Untitled',
            authors, author: displayAuthor, displayName: displayAuthor,
            year: work.publication_year || 'n.d.',
            venue, citationCount: work.cited_by_count || 0,
            url: doi ? `https://doi.org/${doi}` : work.id,
            doi, abstract, text: abstract
        };
    },

    _reconstructAbstract(invertedIndex) {
        if (!invertedIndex || typeof invertedIndex !== 'object') return null;
        try {
            const words = [];
            for (const [word, positions] of Object.entries(invertedIndex)) {
                for (const pos of positions) words[pos] = word;
            }
            return words.filter(Boolean).join(' ');
        } catch (e) { return null; }
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
        const results = await SourceFinderAPI.searchTopic(query, 12);
        return res.status(200).json({ success: true, count: results.length, results });
    } catch (err) {
        console.error('[SourceFinder]', err);
        return res.status(500).json({ success: false, error: 'Search failed' });
    }
}
