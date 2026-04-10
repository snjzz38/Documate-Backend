// api/utils/sourceFinder.js
import { DoiAPI } from './doiAPI.js';

const OPENALEX_BASE = 'https://api.openalex.org/works';

// ─── AI-powered query generation ─────────────────────────────────────────────
// Generates 3-4 focused academic search queries from any topic.
// Falls back to keyword extraction if Gemini is unavailable.
const generateQueriesWithAI = async (topic, apiKey) => {
    if (!apiKey) return null;
    try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${apiKey}`;
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: `You are an academic librarian. Generate exactly 4 short, specific search queries for finding peer-reviewed academic papers about this topic.

TOPIC: "${topic}"

RULES:
- Each query must be 3-6 words
- Queries should cover different angles of the topic (e.g. science, ethics, policy, social impact)
- Use academic terminology
- Do NOT include the word "research" or "study" in queries
- If the topic is about a specific animal, breed, or biological subject, include the scientific or formal name
- Return ONLY a JSON array of 4 strings, nothing else

Example output: ["CRISPR germline editing ethics", "heritable genome modification policy", "designer babies genetic selection", "preimplantation genetic diagnosis society"]

Return ONLY the JSON array:` }] }],
                generationConfig: { temperature: 0.2 }
            })
        });
        if (!res.ok) return null;
        const data = await res.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
        const match = text.match(/\[[\s\S]*?\]/);
        if (!match) return null;
        const queries = JSON.parse(match[0]);
        if (!Array.isArray(queries) || queries.length === 0) return null;
        return queries.filter(q => typeof q === 'string' && q.length > 3).slice(0, 4);
    } catch (e) {
        console.error('[SourceFinder] AI query generation failed:', e.message);
        return null;
    }
};

// ─── Relevance scoring ────────────────────────────────────────────────────────
// Returns a 0-1 relevance score for a paper against the original topic.
// Considers: title match, abstract match, concept overlap.
const scoreRelevance = (paper, topicWords, queries) => {
    const titleLower = (paper.title || '').toLowerCase();
    const abstractLower = (paper.abstract || '').toLowerCase();
    const allQueryWords = queries.flatMap(q => q.toLowerCase().split(/\s+/)).filter(w => w.length > 3);
    const uniqueQueryWords = [...new Set([...topicWords, ...allQueryWords])];

    let score = 0;
    let matches = 0;

    for (const word of uniqueQueryWords) {
        const inTitle = titleLower.includes(word);
        const inAbstract = abstractLower.includes(word);
        if (inTitle) { score += 2; matches++; }
        else if (inAbstract) { score += 1; matches++; }
    }

    // Normalize
    const maxPossible = uniqueQueryWords.length * 2;
    return maxPossible > 0 ? score / maxPossible : 0;
};

export const SourceFinderAPI = {

    async fetchAllCitations(sources, style = 'apa7') {
        if (!sources?.length) return sources;
        console.log(`[SourceFinder] Fetching ${sources.length} citations in ${style} format...`);

        const results = [];
        const batchSize = 3;

        for (let i = 0; i < sources.length; i += batchSize) {
            const batch = sources.slice(i, i + batchSize);
            const enriched = await Promise.all(batch.map(async src => {
                if (!src.doi) {
                    return { ...src, citation: this._formatCitation(src, style), citationSource: 'generated' };
                }
                const meta = await DoiAPI.fetchFromCrossref(src.doi);
                if (!meta) {
                    return { ...src, citation: this._formatCitation(src, style), citationSource: 'generated' };
                }

                let mergedAuthors = meta.authors?.length ? meta.authors : src.authors;
                mergedAuthors = mergedAuthors.filter(a => a.family && a.family.length > 1 && !/^\d+$/.test(a.family));
                if (mergedAuthors.length === 0) mergedAuthors = (src.authors || []).filter(a => a.family && a.family.length > 1);

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
            if (i + batchSize < sources.length) {
                await new Promise(r => setTimeout(r, 300));
            }
        }

        const crossrefCount = results.filter(s => s.citationSource === 'crossref').length;
        console.log(`[SourceFinder] ${crossrefCount}/${results.length} enriched from Crossref`);
        return results;
    },

    _formatCitation(source, style = 'apa7') {
        if (style.includes('mla')) return this._formatMla(source);
        if (style.includes('chicago')) return this._formatChicago(source);
        return this._formatApa(source);
    },

    _formatApa(source) {
        const authors = (source.authors || []).filter(a => a.family && a.family.length > 1);
        const formatAuthor = a => {
            const initials = a.given
                ? a.given.split(/[\s\-]+/).filter(Boolean).map(n => n[0].toUpperCase() + '.').join(' ')
                : '';
            return initials ? `${a.family}, ${initials}` : a.family;
        };

        let authorStr = source.author || 'Unknown';
        if (authors.length === 1) authorStr = formatAuthor(authors[0]);
        else if (authors.length === 2) authorStr = `${formatAuthor(authors[0])} & ${formatAuthor(authors[1])}`;
        else if (authors.length === 3) authorStr = `${formatAuthor(authors[0])}, ${formatAuthor(authors[1])}, & ${formatAuthor(authors[2])}`;
        else if (authors.length > 3) authorStr = `${formatAuthor(authors[0])}, et al.`;

        const year = source.year || 'n.d.';
        const title = source.title || 'Untitled';
        const journal = source.venue || '';
        const volume = source.volume ? `, ${source.volume}` : '';
        const issue = source.issue ? `(${source.issue})` : '';
        const pages = source.pages ? `, ${source.pages}` : '';
        const doi = source.doi ? `https://doi.org/${source.doi}` : (source.url || '');

        let citation = `${authorStr} (${year}). ${title}.`;
        if (journal) citation += ` ${journal}${volume}${issue}${pages}.`;
        if (doi) citation += ` ${doi}`;
        return citation.trim();
    },

    _formatMla(source) {
        const authors = (source.authors || []).filter(a => a.family && a.family.length > 1);
        const formatFirst = a => a.given ? `${a.family}, ${a.given}` : a.family;
        const formatRest = a => a.given ? `${a.given} ${a.family}` : a.family;

        let authorStr = source.author || 'Unknown';
        if (authors.length === 1) authorStr = formatFirst(authors[0]);
        else if (authors.length === 2) authorStr = `${formatFirst(authors[0])}, and ${formatRest(authors[1])}`;
        else if (authors.length >= 3) authorStr = `${formatFirst(authors[0])}, et al.`;

        const title = source.title || 'Untitled';
        const journal = source.venue || '';
        const year = source.year || 'n.d.';
        const volume = source.volume ? `vol. ${source.volume}` : '';
        const issue = source.issue ? `no. ${source.issue}` : '';
        const pages = source.pages ? `pp. ${source.pages}` : '';
        const doi = source.doi ? `https://doi.org/${source.doi}` : (source.url || '');

        let citation = `${authorStr}. "${title}."`;
        if (journal) citation += ` ${journal},`;
        const details = [volume, issue, year, pages].filter(Boolean).join(', ');
        if (details) citation += ` ${details}`;
        citation += '.';
        if (doi) citation += ` ${doi}.`;
        return citation.trim();
    },

    _formatChicago(source) {
        const authors = (source.authors || []).filter(a => a.family && a.family.length > 1);
        const formatFirst = a => a.given ? `${a.family}, ${a.given}` : a.family;
        const formatRest = a => a.given ? `${a.given} ${a.family}` : a.family;

        let authorStr = source.author || 'Unknown';
        if (authors.length === 1) authorStr = formatFirst(authors[0]);
        else if (authors.length === 2) authorStr = `${formatFirst(authors[0])}, and ${formatRest(authors[1])}`;
        else if (authors.length >= 3) authorStr = `${formatFirst(authors[0])}, et al.`;

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

    async search(query, limit = 12, topicWords = [], allQueries = []) {
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

            const queryWords = cleanQuery.split(/\s+/).filter(w => w.length > 3);

            return data.results
                .map(work => this._transformWork(work))
                .filter(p => {
                    if (!p.doi) return false;
                    if (!p.abstract || p.abstract.length < 150) return false;
                    // Require at least 60% of query words to appear in title or abstract
                    const titleLower = p.title.toLowerCase();
                    const abstractLower = p.abstract.toLowerCase();
                    const matchCount = queryWords.filter(w => titleLower.includes(w) || abstractLower.includes(w)).length;
                    const threshold = Math.max(1, Math.ceil(queryWords.length * 0.6));
                    return matchCount >= threshold;
                })
                .map(p => ({
                    ...p,
                    _relevanceScore: scoreRelevance(p, topicWords, allQueries)
                }))
                .slice(0, limit);
        } catch (e) {
            console.error('[SourceFinder] Search failed:', e.message);
            return [];
        }
    },

    async searchTopic(topic, limit = 12, citationStyle = null, apiKey = null) {
        // Step 1: Generate smart queries via AI, fall back to keyword extraction
        const geminiKey = apiKey || process.env.GEMINI_API_KEY;
        let queries = await generateQueriesWithAI(topic, geminiKey);

        if (!queries) {
            // Fallback: use hardcoded topic branches + raw topic
            queries = this._generateQueriesFallback(topic);
        }

        console.log('[SourceFinder] Queries:', queries);

        // Step 2: Extract topic words for relevance scoring
        const topicWords = topic.toLowerCase().split(/\s+/).filter(w => w.length > 3);

        // Step 3: Search all queries in parallel
        const allResults = await Promise.all(queries.map(q => this.search(q, 10, topicWords, queries)));

        // Step 4: Deduplicate by DOI
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

        // Step 5: Sort by relevance score first, then citation count as tiebreaker
        // Hard filter: drop anything with relevance score below 0.05 (genuinely off-topic)
        const filtered = deduplicated
            .filter(p => (p._relevanceScore || 0) >= 0.05)
            .sort((a, b) => {
                const scoreDiff = (b._relevanceScore || 0) - (a._relevanceScore || 0);
                if (Math.abs(scoreDiff) > 0.1) return scoreDiff;
                return (b.citationCount || 0) - (a.citationCount || 0);
            })
            .slice(0, limit);

        console.log(`[SourceFinder] ${filtered.length} relevant papers after filtering (${deduplicated.length - filtered.length} dropped as off-topic)`);

        if (citationStyle) {
            return await this.fetchAllCitations(filtered, citationStyle);
        }
        return filtered;
    },

    // Fallback query generation when AI is unavailable
    _generateQueriesFallback(topic) {
        const lower = topic.toLowerCase();
        const queries = [topic];
        if (lower.includes('designer bab') || lower.includes('gene edit') || lower.includes('crispr')) {
            queries.push('designer babies ethics genetic engineering', 'CRISPR human embryo editing ethics', 'germline editing ethical implications', 'preimplantation genetic diagnosis ethics');
        } else if (lower.includes('climate') || lower.includes('global warming')) {
            queries.push('climate change mitigation policy', 'global warming environmental impact', 'carbon emissions reduction strategies');
        } else if (lower.includes('artificial intelligence') || lower.includes(' ai ')) {
            queries.push('artificial intelligence ethics society', 'machine learning bias fairness', 'AI regulation governance policy');
        } else if (lower.includes('vaccine') || lower.includes('vaccination')) {
            queries.push('vaccine hesitancy public health', 'immunization policy effectiveness', 'vaccine safety clinical evidence');
        } else if (lower.includes('social media') || lower.includes('instagram') || lower.includes('tiktok')) {
            queries.push('social media mental health adolescents', 'online platform behavior psychology', 'digital media society effects');
        } else {
            // Generic: extract nouns and build a focused query
            const words = topic.split(/\s+/).filter(w => w.length > 4).slice(0, 4);
            if (words.length > 1) queries.push(words.join(' ') + ' ethics', words.join(' ') + ' policy');
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
