// api/utils/sourceFinder.js
import { DoiAPI } from './doiAPI.js';

const OPENALEX_BASE = 'https://api.openalex.org/works';

// ─── Semantic keyword extraction via Gemini ───────────────────────────────────
// Ask Gemini what the topic is really about and what keywords academic papers
// on this subject would actually use. Returns { keywords: string[], queries: string[] }
const extractSemanticKeywords = async (topic, apiKey) => {
    if (!apiKey) return null;
    try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${apiKey}`;
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: `You are an academic librarian. A student needs peer-reviewed sources on this topic:

"${topic}"

Your job:
1. Identify the main subject (what this is fundamentally about)
2. Generate academic keywords that peer-reviewed papers on this subject would actually use in their titles and abstracts — including synonyms, scientific terms, and related concepts
3. Generate 4 specific search queries for the OpenAlex academic database

Return ONLY this JSON (no other text):
{
  "mainSubject": "one sentence description of what this topic is about",
  "keywords": ["keyword1", "keyword2", "keyword3", ...],
  "queries": ["3-6 word query 1", "3-6 word query 2", "3-6 word query 3", "3-6 word query 4"]
}

Rules for keywords:
- Include the exact terms used AND academic synonyms (e.g. "Labrador Retriever" AND "Canis lupus familiaris" AND "gun dog breed")
- Include 8-15 keywords total
- Include both specific and broader terms that papers about this subject would use
- Do NOT include generic words like "research", "study", "effects", "impact"

Rules for queries:
- At least 2 queries must contain the core subject or its scientific name
- Queries should target different angles (behavior, health, genetics, history, etc.)
- 3-6 words per query` }] }],
                generationConfig: { temperature: 0.1 }
            })
        });
        if (!res.ok) return null;
        const data = await res.json();
        const text = (data.candidates?.[0]?.content?.parts?.[0]?.text || '')
            .replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
        const match = text.match(/\{[\s\S]*\}/);
        if (!match) return null;
        const parsed = JSON.parse(match[0]);
        if (!Array.isArray(parsed.keywords) || !Array.isArray(parsed.queries)) return null;
        return {
            keywords: parsed.keywords.filter(k => typeof k === 'string' && k.length > 1),
            queries: parsed.queries.filter(q => typeof q === 'string' && q.length > 3).slice(0, 4)
        };
    } catch (e) {
        console.error('[SourceFinder] Semantic extraction failed:', e.message);
        return null;
    }
};

// ─── Fuzzy/stemmed word match ─────────────────────────────────────────────────
// Handles plural, -ing, -ed, -er, -tion variations without a full stemmer
const fuzzyIncludes = (text, word) => {
    if (text.includes(word)) return true;
    if (word.length <= 3) return false; // don't stem very short words
    // Try common suffixes
    const stem = word.length > 5 ? word.slice(0, -2) : word.slice(0, -1);
    return text.includes(stem);
};

// ─── Relevance scoring ────────────────────────────────────────────────────────
// Title match = 3pts, abstract match = 1pt, citation boost via log scale
const scoreRelevance = (paper, keywords) => {
    if (!keywords.length) return 0.3;
    const titleLower = (paper.title || '').toLowerCase();
    const abstractLower = (paper.abstract || '').toLowerCase();
    let score = 0;
    for (const kw of keywords) {
        const word = kw.toLowerCase();
        if (fuzzyIncludes(titleLower, word)) score += 3;
        else if (fuzzyIncludes(abstractLower, word)) score += 1;
    }
    const base = score / (keywords.length * 3);
    // Citation boost: log10(citations+1)/10 adds up to ~0.5 for highly cited papers
    const citationBoost = Math.log10((paper.citationCount || 0) + 1) / 10;
    return Math.min(1, base + citationBoost * 0.3); // cap at 1, weight boost at 30%
};

// ─── Fallback keyword/query generation ───────────────────────────────────────
const STOP_WORDS = new Set([
    'a','an','the','and','or','but','in','on','at','to','for','of','with','by',
    'from','is','are','was','were','be','been','have','has','had','do','does',
    'did','will','would','could','should','may','might','can','its','it','this',
    'that','these','those','what','which','who','how','why','when','where',
    'about','some','any','all','each','every','both','than','then','so','not',
    'no','only','just','also','still','very','too','here','there','such','same',
    'effects','impact','impacts','study','studies','research','analysis','review',
    'approach','method','methods','using','use','based','new','results','findings',
    'data','case','cases','role','factors','factor','relationship','evidence',
    'implications','overview','issues','issue'
]);
const WHITELIST_SHORT = new Set(['ai','ml','dna','rna','gmo','uv','iq','ph','ev','vr','ar']);

const fallbackKeywords = topic => topic.toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => (w.length >= 3 && !STOP_WORDS.has(w)) || WHITELIST_SHORT.has(w));

const fallbackQueries = (topic, keywords) => {
    const lower = topic.toLowerCase();
    const kws = new Set(keywords);
    if (kws.has('crispr') || kws.has('gene') || lower.includes('designer bab')) {
        return [topic, 'CRISPR human embryo editing ethics', 'germline editing ethical implications', 'preimplantation genetic diagnosis'];
    }
    if (kws.has('climate') || kws.has('warming')) {
        return [topic, 'climate change mitigation policy', 'global warming environmental impact', 'carbon emissions strategies'];
    }
    if (kws.has('intelligence') || kws.has('machine') || lower.includes(' ai ')) {
        return [topic, 'artificial intelligence ethics society', 'machine learning bias fairness', 'AI regulation governance'];
    }
    if (kws.has('vaccine') || kws.has('vaccination')) {
        return [topic, 'vaccine hesitancy public health', 'immunization policy effectiveness', 'vaccine safety evidence'];
    }
    if (kws.has('social') && kws.has('media')) {
        return [topic, 'social media mental health adolescents', 'online platform behavior psychology', 'digital media society'];
    }
    const terms = keywords.slice(0, 3).join(' ');
    return [topic, `${terms} behavior`, `${terms} health`, `${terms} biology`].filter(Boolean).slice(0, 4);
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

    async search(query, limit = 12, keywords = []) {
        if (!query || query.trim().length < 3) return [];
        try {
            const params = new URLSearchParams({
                search: query.trim(),
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
                .filter(p => p.doi && p.abstract)
                .map(p => ({ ...p, _relevanceScore: scoreRelevance(p, keywords) }))
                .filter(p => {
                    // Adaptive threshold: fewer keywords = lower bar
                    const threshold = keywords.length <= 3 ? 0.1 : 0.15;
                    return p._relevanceScore >= threshold;
                })
                .slice(0, limit);
        } catch (e) {
            console.error('[SourceFinder] Search failed:', e.message);
            return [];
        }
    },

    async searchTopic(topic, limit = 12, citationStyle = null, apiKey = null) {
        const geminiKey = apiKey || process.env.GEMINI_API_KEY;

        // Step 1: Ask Gemini to understand the topic and extract academic keywords + queries
        const semantic = await extractSemanticKeywords(topic, geminiKey);

        // Use AI-generated keywords for scoring, fall back to surface extraction
        const keywords = semantic?.keywords || fallbackKeywords(topic);
        const queries = semantic?.queries || fallbackQueries(topic, fallbackKeywords(topic));

        console.log('[SourceFinder] Keywords:', keywords);
        console.log('[SourceFinder] Queries:', queries);

        // Step 2: Search all queries in parallel using semantic keywords for scoring
        const allResults = await Promise.all(queries.map(q => this.search(q, 12, keywords)));

        // Step 3: Deduplicate (DOI primary, normalized title fallback)
        const normalize = t => t?.toLowerCase().replace(/[^a-z0-9]/g, '') || '';
        const seen = new Set();
        const deduplicated = [];
        for (const results of allResults) {
            for (const paper of results) {
                const key = paper.doi || normalize(paper.title);
                if (key && !seen.has(key)) {
                    seen.add(key);
                    deduplicated.push(paper);
                }
            }
        }

        // Step 4: Sort by relevance score (citation-boosted), take top N
        const sorted = deduplicated
            .sort((a, b) => (b._relevanceScore || 0) - (a._relevanceScore || 0))
            .slice(0, limit);

        console.log(`[SourceFinder] ${sorted.length} results (from ${deduplicated.length} candidates)`);

        if (citationStyle) return await this.fetchAllCitations(sorted, citationStyle);
        return sorted;
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
