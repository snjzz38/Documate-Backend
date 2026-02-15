// api/utils/doiAPI.js - Simplified DOI Resolution

export const DoiAPI = {
    extract(text) {
        if (!text) return null;
        const match = text.match(/10\.\d{4,}\/[^\s"'<>]+/i);
        return match ? match[0].replace(/[.,;:)\]]+$/, '') : null;
    },

    async fetch(doi) {
        try {
            const res = await fetch(`https://api.crossref.org/works/${encodeURIComponent(doi)}`, {
                signal: AbortSignal.timeout(5000)
            });
            if (!res.ok) return null;
            
            const { message: item } = await res.json();
            const authors = (item.author || []).map(a => ({
                given: a.given || '',
                family: a.family || '',
                full: `${a.given || ''} ${a.family || ''}`.trim()
            }));
            
            return {
                doi,
                title: item.title?.[0],
                authors,
                year: item.published?.['date-parts']?.[0]?.[0]?.toString() || null,
                journal: item['container-title']?.[0],
                abstract: item.abstract?.replace(/<[^>]+>/g, '').trim() || null
            };
        } catch { return null; }
    },

    format(meta, style = 'chicago') {
        if (!meta) return null;
        const { authors, year, title, journal, doi } = meta;
        const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
        
        let auth = authors?.length > 0 
            ? (authors.length > 2 ? `${authors[0].family} et al.` : authors.map(a => a.full).join(' and '))
            : 'Unknown';
        
        const s = (style || '').toLowerCase();
        if (s.includes('apa')) return `${auth}. (${year || 'n.d.'}). ${title}. *${journal || ''}*. https://doi.org/${doi}`;
        if (s.includes('mla')) return `${auth}. "${title}." *${journal || ''}*, ${year || 'n.d.'}. https://doi.org/${doi}.`;
        return `${auth}. "${title}." *${journal || ''}*. ${year || 'n.d.'}. https://doi.org/${doi}. (Accessed ${today})`;
    }
};
