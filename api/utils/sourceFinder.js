// api/utils/sourceFinder.js
import { DoiAPI } from './doiAPI.js';

const OPENALEX_BASE = 'https://api.openalex.org/works';

// ─── Extract core subject words from topic ────────────────────────────────────
// These are the words that MUST appear in any result we keep.
// We strip stop words and keep only the meaningful nouns/adjectives.
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
    'no','only','just','also','even','still','well','very','too','here','there'
]);

const extractCoreWords = topic => {
    return topic.toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length > 2 && !STOP_WORDS.has(w));
};

// ─── AI-powered query generation ─────────────────────────────────────────────
const generateQueriesWithAI = async (topic, apiKey) => {
    if (!apiKey) return null;
    try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${apiKey}`;
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: `You are an academic librarian generating search queries for OpenAlex (a database of peer-reviewed papers).

TOPIC: "${topic}"

Generate exactly 4 short search queries (3-6 words each) to find academic papers directly about this topic.

STRICT RULES:
1. Every query MUST contain the core subject of the topic (e.g. if topic is "Labrador Retriever", every query must include "Labrador" or "Labrador Retriever")
2. Cover different angles: e.g. behavior, health, genetics, training — but always anchored to the exact subject
3. Use formal/scientific terminology where appropriate
4. Do NOT generate queries about loosely related topics (e.g. "canine welfare" is too broad if topic is "Labrador Retriever")
5. Do NOT include "research", "study", or "review" as words in the queries

Return ONLY a JSON array of 4 strings, nothing else.

Example for topic "Labrador Retriever":
["Labrador Retriever temperament behavior", "Labrador Retriever hip dysplasia genetics", "Labrador Retriever obesity health", "yellow Labrador coat genetics"]

Return ONLY the JSON array:` }] }],
                generationConfig: { temperature: 0.1 }
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

// ─── Relevance check ──────────────────────────────────────────────────────────
// Returns true only if the paper is genuinely about the topic.
// Strategy: at least one core topic word must appear in the TITLE (not just abstract).
// This is the key fix — abstract matches are too loose, title matches are precise.
const isTrulyRelevant = (paper, coreWords) => {
    if (!coreWords.length) return true;
    const titleLower = (paper.title || '').toLowerCase();
    const abstractLower = (paper.abstract || '').toLowerCase();

    // Count how many core words appear in the title
    const titleMatches = coreWords.filter(w => titleLower.includes(w)).length;
    // Count how many core words appear in title OR abstract
    const totalMatches = coreWords.filter(w => titleLower.includes(w) || abstractLower.includes(w)).length;

    // Must have at least one core word in the title
    // AND at least 40% of core words somewhere in title+abstract
    const titleOk = titleMatches >= 1;
    const coverageOk = totalMatches >= Math.max(1, Math.ceil(coreWords.length * 0.4));

    return titleOk && coverageOk;
};

// ─── Relevance score ──────────────────────────────────────────────────────────
const scoreRelevance = (paper, coreWords) => {
    const titleLower = (paper.title || '').toLowerCase();
    const abstractLower = (paper.abstract || '').toLowerCase();
    let score = 0;
    for (const word of coreWords) {
        if (titleLower.includes(word)) score += 3;       // title match = strongest signal
        else if (abstractLower.includes(word)) score += 1; // abstract match = weak signal
    }
    return coreWords.length > 0 ? score / (coreWords.length * 3) : 0;
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
                    if (!p.doi || !p.abstract || p.abstract.length < 150) return false;
                    // Hard filter: must pass title+core-word relevance check
                    return isTrulyRelevant(p, coreWords);
                })
                .map(p => ({ ...p, _relevanceScore: scoreRelevance(p, coreWords) }))
                .slice(0, limit);
        } catch (e) {
            console.error('[SourceFinder] Search failed:', e.message);
            return [];
        }
    },

    async searchTopic(topic, limit = 12, citationStyle = null, apiKey = null) {
        const geminiKey = apiKey || process.env.GEMINI_API_KEY;

        // Extract core words — these must appear in any result we keep
        const coreWords = extractCoreWords(topic);
        console.log('[SourceFinder] Core words:', coreWords);

        // Generate AI queries anchored to the exact subject
        let queries = await generateQueriesWithAI(topic, geminiKey);
        if (!queries) queries = this._generateQueriesFallback(topic);
        console.log('[SourceFinder] Queries:', queries);

        // Search all queries in parallel, passing coreWords for filtering
        const allResults = await Promise.all(queries.map(q => this.search(q, 10, coreWords)));

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

        // Sort by relevance score (title matches heavily weighted), citation count as tiebreaker
        const sorted = deduplicated
            .sort((a, b) => {
                const diff = (b._relevanceScore || 0) - (a._relevanceScore || 0);
                if (Math.abs(diff) > 0.15) return diff;
                return (b.citationCount || 0) - (a.citationCount || 0);
            })
            .slice(0, limit);

        console.log(`[SourceFinder] ${sorted.length} relevant papers (filtered from ${deduplicated.length} candidates)`);

        if (citationStyle) return await this.fetchAllCitations(sorted, citationStyle);
        return sorted;
    },

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
        } else if (lower.includes('social media')) {
            queries.push('social media mental health adolescents', 'online platform behavior psychology', 'digital media society effects');
        } else {
            const words = topic.split(/\s+/).filter(w => w.length > 4).slice(0, 4);
            if (words.length > 1) {
                queries.push(words.join(' ') + ' behavior', words.join(' ') + ' health');
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
