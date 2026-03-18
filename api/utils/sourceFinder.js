import { DoiAPI } from './doiAPI.js';

// api/utils/sourceFinder.js
const OPENALEX_BASE = 'https://api.openalex.org/works';

export const SourceFinderAPI = {
  async fetchAllCitations(sources, style = 'apa7') {
    if (!sources?.length) return sources;

    console.log(`[SourceFinder] Fetching ${sources.length} citations in ${style} format...`);

    const limit = 5; // throttle to 5/sec
    const results = [];

    for (let i = 0; i < sources.length; i++) {
      const src = sources[i];
      let citation = null;

      if (src.doi) {
        const metadata = await DoiAPI.fetchFromCrossref(src.doi);
        if (metadata) {
          // format citation based on your style
          citation = style.includes('apa') 
            ? this._formatApa(metadata)
            : style.includes('mla')
              ? this._formatMla(metadata)
              : this._formatChicago(metadata);
        }
      }

      if (!citation) {
        // fallback to local generator
        citation = this._generateFallbackCitation(src, style);
      }

      results.push({
        ...src,
        citation,
        citationSource: src.doi && citation ? 'crossref' : 'generated'
      });

      if (i % limit === 0) await new Promise(res => setTimeout(res, 1000));
    }

    return results;
  },

  _formatApa(meta) {
    const authors = meta.authors || [];
    const authorStr = authors.length === 1
      ? `${authors[0].family}, ${authors[0].given?.[0] || ''}.`
      : authors.length === 2
        ? `${authors[0].family}, ${authors[0].given?.[0]}. & ${authors[1].family}, ${authors[1].given?.[0]}.`
        : `${authors[0].family}, ${authors[0].given?.[0]}. et al.`;

    return `${authorStr} (${meta.year}). ${meta.title}. ${meta.journal}. ${meta.url}`;
  },

  _formatMla(meta) {
    const authors = meta.authors || [];
    const authorStr = authors.length > 0
      ? authors.length > 2
        ? `${authors[0].family}, ${authors[0].given}, et al.`
        : authors.map(a => `${a.family}, ${a.given}`).join(' and ')
      : 'Unknown';
    return `${authorStr}. "${meta.title}." ${meta.journal}, ${meta.year}, ${meta.url}.`;
  },

  _formatChicago(meta) {
    const authors = meta.authors || [];
    const authorStr = authors.length > 0
      ? authors.length > 2
        ? `${authors[0].family}, ${authors[0].given}, et al.`
        : authors.map(a => `${a.family}, ${a.given}`).join(' and ')
      : 'Unknown';
    return `${authorStr}. "${meta.title}." ${meta.journal}. ${meta.year}. ${meta.url}.`;
  },

  _generateFallbackCitation(src, style) {
    // your existing fallback logic
    return src.title + ' (no citation)';
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
