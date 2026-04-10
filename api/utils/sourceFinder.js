// api/utils/sourceFinder.js
import { DoiAPI } from './doiAPI.js';
import { GeminiAPI } from './geminiAPI.js';

const OPENALEX_BASE = 'https://api.openalex.org/works';

// Ask Gemini to understand the topic and return:
// [0] main idea (1-2 sentences)
// [1] a search string that will return high-quality citations from OpenAlex
const analyzeTopicWithGemini = async (topic, apiKey) => {
    const prompt = `You are an academic librarian. A student needs peer-reviewed sources for this topic:

"${topic}"

Return a JSON array with exactly 2 elements:
- Index 0: A 1-2 sentence description of the main idea or subject of this topic
- Index 1: A single search string (5-10 words) that will return the most relevant peer-reviewed papers from the OpenAlex academic database. Use formal academic and scientific terminology that would appear in paper titles and abstracts. Include synonyms if the topic has a scientific name.

Example for "yellow Labrador Retriever":
["The topic concerns the Labrador Retriever breed, specifically the yellow coat variant, covering its behavior, health, and characteristics.", "Labrador Retriever breed temperament health genetics canine"]

Example for "CRISPR gene editing ethics":
["The topic concerns the ethical implications of CRISPR-Cas9 technology for editing human genomes, particularly germline modification.", "CRISPR Cas9 germline editing ethics human embryo genetic modification"]

Return ONLY the JSON array, nothing else.`;

    try {
        const raw = await GeminiAPI.chat(prompt, apiKey, 0.1);
        const match = raw.match(/\[[\s\S]*?\]/);
        if (!match) return null;
        const parsed = JSON.parse(match[0]);
        if (!Array.isArray(parsed) || parsed.length < 2) return null;
        if (typeof parsed[0] !== 'string' || typeof parsed[1] !== 'string') return null;
        return parsed;
    } catch (e) {
        console.error('[SourceFinder] Gemini topic analysis failed:', e.message);
        return null;
    }
};

export const SourceFinderAPI = {

    async fetchAllCitations(sources, style = 'apa7') {
        if (!sources?.length) return sources;
        const results = [];
        const batchSize = 3;
        for (let i = 0; i < sources.length; i += batchSize) {
            const batch = sources.slice(i, i + batchSize);
            const enriched = await Promise.all(batch.map(async src => {
                if (!src.doi) return { ...src, citation: this._formatCitation(src, style), citationSource: 'generated' };
                const meta = await DoiAPI.fetchFromCrossref(src.doi);
                if (!meta) return { ...src, citation: this._formatCitation(src, style), citationSource: 'generated' };
                let mergedAuthors = meta.authors?.length ? meta.authors : src.authors;
                mergedAuthors = mergedAuthors.filter(a => a.family && a.family.length > 1 && !/^\d+$/.test(a.family));
                if (!mergedAuthors.length) mergedAuthors = (src.authors || []).filter(a => a.family && a.family.length > 1);
                const enrichedSrc = {
                    ...src,
                    authors: mergedAuthors,
                    title: meta.title || src.title,
                    venue: meta.journal || src.venue,
                    year: (meta.year && meta.year !== 'n.d.') ? meta.year : src.year,
                    volume: meta.volume || null,
                    issue: meta.issue || null,
                    pages: meta.pages || null,
                };
                enrichedSrc.citation = this._formatCitation(enrichedSrc, style);
                enrichedSrc.citationSource = 'crossref';
                return enrichedSrc;
            }));
            results.push(...enriched);
            if (i + batchSize < sources.length) await new Promise(r => setTimeout(r, 300));
        }
        console.log(`[SourceFinder] ${results.filter(s => s.citationSource === 'crossref').length}/${results.length} enriched from Crossref`);
        return results;
    },

    _formatCitation(source, style = 'apa7') {
        if (style.includes('mla')) return this._formatMla(source);
        if (style.includes('chicago')) return this._formatChicago(source);
        return this._formatApa(source);
    },

    _formatApa(source) {
        const authors = (source.authors || []).filter(a => a.family && a.family.length > 1);
        const fmt = a => a.given
            ? `${a.family}, ${a.given.split(/[\s\-]+/).filter(Boolean).map(n => n[0].toUpperCase() + '.').join(' ')}`
            : a.family;
        let authorStr = source.author || 'Unknown';
        if (authors.length === 1) authorStr = fmt(authors[0]);
        else if (authors.length === 2) authorStr = `${fmt(authors[0])} & ${fmt(authors[1])}`;
        else if (authors.length === 3) authorStr = `${fmt(authors[0])}, ${fmt(authors[1])}, & ${fmt(authors[2])}`;
        else if (authors.length > 3) authorStr = `${fmt(authors[0])}, et al.`;
        const doi = source.doi ? `https://doi.org/${source.doi}` : (source.url || '');
        let citation = `${authorStr} (${source.year || 'n.d.'}). ${source.title || 'Untitled'}.`;
        if (source.venue) citation += ` ${source.venue}${source.volume ? `, ${source.volume}` : ''}${source.issue ? `(${source.issue})` : ''}${source.pages ? `, ${source.pages}` : ''}.`;
        if (doi) citation += ` ${doi}`;
        return citation.trim();
    },

    _formatMla(source) {
        const authors = (source.authors || []).filter(a => a.family && a.family.length > 1);
        const fmtFirst = a => a.given ? `${a.family}, ${a.given}` : a.family;
        const fmtRest = a => a.given ? `${a.given} ${a.family}` : a.family;
        let authorStr = source.author || 'Unknown';
        if (authors.length === 1) authorStr = fmtFirst(authors[0]);
        else if (authors.length === 2) authorStr = `${fmtFirst(authors[0])}, and ${fmtRest(authors[1])}`;
        else if (authors.length >= 3) authorStr = `${fmtFirst(authors[0])}, et al.`;
        const doi = source.doi ? `https://doi.org/${source.doi}` : (source.url || '');
        let citation = `${authorStr}. "${source.title || 'Untitled'}."`;
        if (source.venue) citation += ` ${source.venue},`;
        const details = [
            source.volume ? `vol. ${source.volume}` : '',
            source.issue ? `no. ${source.issue}` : '',
            source.year || 'n.d.',
            source.pages ? `pp. ${source.pages}` : ''
        ].filter(Boolean).join(', ');
        if (details) citation += ` ${details}`;
        citation += '.';
        if (doi) citation += ` ${doi}.`;
        return citation.trim();
    },

    _formatChicago(source) {
        const authors = (source.authors || []).filter(a => a.family && a.family.length > 1);
        const fmtFirst = a => a.given ? `${a.family}, ${a.given}` : a.family;
        const fmtRest = a => a.given ? `${a.given} ${a.family}` : a.family;
        let authorStr = source.author || 'Unknown';
        if (authors.length === 1) authorStr = fmtFirst(authors[0]);
        else if (authors.length === 2) authorStr = `${fmtFirst(authors[0])}, and ${fmtRest(authors[1])}`;
        else if (authors.length >= 3) authorStr = `${fmtFirst(authors[0])}, et al.`;
        const doi = source.doi ? `https://doi.org/${source.doi}` : (source.url || '');
        let citation = `${authorStr}. "${source.title || 'Untitled'}."`;
        if (source.venue) citation += ` ${source.venue}`;
        if (source.volume) citation += ` ${source.volume}`;
        if (source.issue) citation += `, no. ${source.issue}`;
        citation += ` (${source.year || 'n.d.'})`;
        if (source.pages) citation += `: ${source.pages}`;
        citation += '.';
        if (doi) citation += ` ${doi}.`;
        return citation.trim();
    },

    async search(query, limit = 12) {
        if (!query || query.trim().length < 3) return [];
        try {
            const params = new URLSearchParams({
                search: query.trim(),
                filter: 'is_oa:true,has_abstract:true,has_doi:true',
                'per-page': String(limit),
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
                .filter(p => p.doi && p.abstract);
        } catch (e) {
            console.error('[SourceFinder] Search failed:', e.message);
            return [];
        }
    },

    async searchTopic(topic, limit = 12, citationStyle = null, apiKey = null) {
        const geminiKey = apiKey || process.env.GEMINI_API_KEY;

        // Step 1: Gemini understands the topic and generates the search string
        const analysis = await analyzeTopicWithGemini(topic, geminiKey);

        const searchQuery = analysis?.[1] || topic;
        console.log('[SourceFinder] Main idea:', analysis?.[0]);
        console.log('[SourceFinder] Search query:', searchQuery);

        // Step 2: Single focused search using Gemini's query
        const results = await this.search(searchQuery, Math.min(limit + 5, 20));

        // Step 3: Deduplicate by DOI
        const seen = new Set();
        const deduplicated = results.filter(p => {
            if (seen.has(p.doi)) return false;
            seen.add(p.doi);
            return true;
        }).slice(0, limit);

        console.log(`[SourceFinder] ${deduplicated.length} results`);

        if (citationStyle) return await this.fetchAllCitations(deduplicated, citationStyle);
        return deduplicated;
    },

    _transformWork(work) {
        const abstract = this._reconstructAbstract(work.abstract_inverted_index);
        const authors = (work.authorships || []).slice(0, 5).map(a => {
            const name = a.author?.display_name || '';
            const parts = name.split(' ');
            return parts.length >= 2
                ? { given: parts.slice(0, -1).join(' '), family: parts[parts.length - 1] }
                : { given: '', family: name };
        }).filter(a => a.family);
        const displayAuthor = authors.length === 0 ? 'Unknown'
            : authors.length > 2 ? `${authors[0].family} et al.`
            : authors.map(a => a.family).join(' & ');
        const venue = work.primary_location?.source?.display_name || work.host_venue?.display_name || '';
        const doi = work.doi ? work.doi.replace('https://doi.org/', '') : null;
        return {
            id: work.id,
            title: work.title || 'Untitled',
            authors,
            author: displayAuthor,
            displayName: displayAuthor,
            year: work.publication_year || 'n.d.',
            venue,
            citationCount: work.cited_by_count || 0,
            url: doi ? `https://doi.org/${doi}` : work.id,
            doi,
            abstract,
            text: abstract
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
