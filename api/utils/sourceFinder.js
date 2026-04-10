// api/utils/sourceFinder.js
import { DoiAPI } from './doiAPI.js';

const OPENALEX_BASE = 'https://api.openalex.org/works';

// ─── Stop words ───────────────────────────────────────────────────────────────
const STOP_WORDS = new Set([
    'a','an','the','and','or','but','in','on','at','to','for','of','with','by',
    'from','is','are','was','were','be','been','being','have','has','had','do',
    'does','did','will','would','could','should','may','might','shall','can',
    'its','it','this','that','these','those','what','which','who','how','why',
    'when','where','about','above','after','against','along','among','around',
    'before','behind','between','during','except','into','near','off','out',
    'over','since','through','throughout','under','until','upon','within',
    'without','some','any','all','each','every','both','either','neither',
    'such','same','other','another','than','then','so','yet','nor','not',
    'no','only','just','also','even','still','well','very','too','here','there',
    // Generic academic filler words that aren't useful filters
    'effects','impact','impacts','study','studies','research','analysis',
    'review','approach','method','methods','using','use','based','new',
    'results','findings','data','case','cases','role','factors','factor',
    'relationship','evidence','implications','implications','overview','issues'
]);

// Short but meaningful terms to always keep
const WHITELIST_SHORT = new Set(['ai','ml','dna','rna','gmo','uv','iq','ph','ev','vr','ar']);

// ─── Core word extraction ─────────────────────────────────────────────────────
const extractCoreWords = topic => {
    return topic.toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(w => (w.length >= 3 && !STOP_WORDS.has(w)) || WHITELIST_SHORT.has(w));
};

// ─── Relevance scoring ────────────────────────────────────────────────────────
// Score-first: no hard reject on title. Weight title matches 3x, abstract 1x.
// Returns 0.0–1.0.
const scoreRelevance = (paper, coreWords) => {
    if (!coreWords.length) return 0.5;
    const titleLower = (paper.title || '').toLowerCase();
    const abstractLower = (paper.abstract || '').toLowerCase();
    let score = 0;
    for (const word of coreWords) {
        if (titleLower.includes(word)) score += 3;
        else if (abstractLower.includes(word)) score += 1;
    }
    const maxPossible = coreWords.length * 3;
    return maxPossible > 0 ? score / maxPossible : 0;
};

// ─── AI query generation ──────────────────────────────────────────────────────
const generateQueriesWithAI = async (topic, apiKey) => {
    if (!apiKey) return null;
    try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${apiKey}`;
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: `You are an academic librarian generating search queries for OpenAlex (peer-reviewed paper database).

TOPIC: "${topic}"

Generate exactly 4 search queries (3-6 words each) to find academic papers about this topic.

RULES:
1. At least 2 queries must use the exact core subject or its formal/scientific name
2. The other 1-2 queries may use scientific synonyms or related academic terminology that OpenAlex would index (e.g. for "Labrador Retriever" you could use "Canis lupus familiaris breed")
3. Cover different angles: e.g. behavior, health, genetics, ecology, ethics — whichever are relevant
4. Do NOT use generic words like "research", "study", "review", "effects", "impact" as the main terms
5. Queries should be specific enough to find papers directly about this subject, not loosely related topics

Return ONLY a JSON array of 4 strings, nothing else.` }] }],
                generationConfig: { temperature: 0.1 }
            })
        });
        if (!res.ok) return null;
        const data = await res.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
        // Strip any <think> blocks from reasoning models
        const clean = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
        const match = clean.match(/\[[\s\S]*?\]/);
        if (!match) return null;
        const queries = JSON.parse(match[0]);
        if (!Array.isArray(queries) || !queries.length) return null;
        return queries.filter(q => typeof q === 'string' && q.length > 3).slice(0, 4);
    } catch (e) {
        console.error('[SourceFinder] AI query generation failed:', e.message);
        return null;
    }
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

    async search(query, limit = 12, coreWords = []) {
        if (!query || query.trim().length < 3) return [];
        try {
            const cleanQuery = query.trim().toLowerCase();
            const params = new URLSearchParams({
                search: cleanQuery,
                filter: 'is_oa:true,has_abstract:true,has_doi:true',
                'per-page': '30',
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
                .filter(p => p.doi && p.abstract) // only require abstract exists, not a length
                .map(p => ({ ...p, _relevanceScore: scoreRelevance(p, coreWords) }))
                // Score-first: filter AFTER scoring, not before
                // Threshold 0.15 = at least some meaningful word match in title or abstract
                .filter(p => p._relevanceScore >= 0.15)
                .slice(0, limit);
        } catch (e) {
            console.error('[SourceFinder] Search failed:', e.message);
            return [];
        }
    },

    async searchTopic(topic, limit = 12, citationStyle = null, apiKey = null) {
        const geminiKey = apiKey || process.env.GEMINI_API_KEY;
        const coreWords = extractCoreWords(topic);
        console.log('[SourceFinder] Core words:', coreWords);

        let queries = await generateQueriesWithAI(topic, geminiKey);
        if (!queries) queries = this._generateQueriesFallback(topic, coreWords);
        console.log('[SourceFinder] Queries:', queries);

        const allResults = await Promise.all(queries.map(q => this.search(q, 12, coreWords)));

        // Deduplicate by DOI, fallback to lowercased title
        const seen = new Set();
        const deduplicated = [];
        for (const results of allResults) {
            for (const paper of results) {
                const key = paper.doi || paper.title?.toLowerCase();
                if (key && !seen.has(key)) {
                    seen.add(key);
                    deduplicated.push(paper);
                }
            }
        }

        // Sort: relevance score first (title matches weighted 3x), citation count as tiebreaker
        const sorted = deduplicated
            .sort((a, b) => {
                const diff = (b._relevanceScore || 0) - (a._relevanceScore || 0);
                if (Math.abs(diff) > 0.1) return diff;
                return (b.citationCount || 0) - (a.citationCount || 0);
            })
            .slice(0, limit);

        console.log(`[SourceFinder] ${sorted.length} results (from ${deduplicated.length} candidates, ${deduplicated.length - sorted.length} dropped)`);

        if (citationStyle) return await this.fetchAllCitations(sorted, citationStyle);
        return sorted;
    },

    _generateQueriesFallback(topic, coreWords = []) {
        const lower = topic.toLowerCase();
        const queries = [topic];
        if (coreWords.includes('crispr') || coreWords.includes('gene') || lower.includes('designer bab')) {
            queries.push('designer babies ethics genetic engineering', 'CRISPR human embryo editing ethics', 'germline editing ethical implications');
        } else if (coreWords.includes('climate') || coreWords.includes('warming')) {
            queries.push('climate change mitigation policy', 'global warming environmental impact', 'carbon emissions reduction strategies');
        } else if (coreWords.includes('intelligence') || coreWords.includes('machine') || lower.includes(' ai ')) {
            queries.push('artificial intelligence ethics society', 'machine learning bias fairness', 'AI regulation governance policy');
        } else if (coreWords.includes('vaccine') || coreWords.includes('vaccination')) {
            queries.push('vaccine hesitancy public health', 'immunization policy effectiveness', 'vaccine safety clinical evidence');
        } else if (coreWords.includes('social') && coreWords.includes('media')) {
            queries.push('social media mental health adolescents', 'online platform behavior psychology', 'digital media society effects');
        } else {
            // Generic: build queries from core words directly
            const terms = coreWords.slice(0, 3).join(' ');
            if (terms) {
                queries.push(`${terms} behavior`, `${terms} health`, `${terms} biology`);
            }
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
