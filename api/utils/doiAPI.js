// api/utils/doiAPI.js - DOI Resolution & Citation Formatting

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
            
            const { message } = await res.json();
            
            return {
                doi,
                title: message.title?.[0],
                authors: (message.author || []).map(a => ({ given: a.given || '', family: a.family || '' })),
                year: message.published?.['date-parts']?.[0]?.[0]?.toString() ||
                      message['published-print']?.['date-parts']?.[0]?.[0]?.toString() || null,
                journal: message['container-title']?.[0],
                volume: message.volume,
                issue: message.issue,
                pages: message.page
            };
        } catch { return null; }
    },

    formatBib(meta, style = 'chicago') {
        if (!meta) return null;
        const { authors, year, title, journal, doi, volume, issue, pages } = meta;
        const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
        const y = year || 'n.d.';
        const s = (style || '').toLowerCase();
        const auth = this._authStr(authors, s);
        
        if (s.includes('apa')) {
            let c = `${auth} (${y}). ${title}.`;
            if (journal) c += ` *${journal}*`;
            if (volume) c += `, ${volume}${issue ? `(${issue})` : ''}${pages ? `: ${pages}` : ''}`;
            return c + `. https://doi.org/${doi}`;
        }
        if (s.includes('mla')) {
            let c = `${auth}. "${title}."`;
            if (journal) c += ` *${journal}*`;
            if (volume) c += `, vol. ${volume}`;
            if (issue) c += `, no. ${issue}`;
            c += `, ${y}`;
            if (pages) c += `, pp. ${pages}`;
            return c + `. https://doi.org/${doi}.`;
        }
        // Chicago
        let c = `${auth}. "${title}."`;
        if (journal) c += ` *${journal}*`;
        if (volume) c += ` ${volume}${issue ? `, no. ${issue}` : ''}`;
        if (y !== 'n.d.') c += ` (${y})`;
        if (pages) c += `: ${pages}`;
        return c + `. https://doi.org/${doi}. (Accessed ${today})`;
    },

    formatInText(meta, style = 'chicago') {
        if (!meta?.authors?.length) return null;
        const { authors, year } = meta;
        const y = year || 'n.d.';
        const s = (style || '').toLowerCase();
        
        const name = authors.length === 1 ? authors[0].family
            : authors.length === 2 ? `${authors[0].family} ${s.includes('apa') ? '&' : 'and'} ${authors[1].family}`
            : `${authors[0].family} et al.`;
        
        if (s.includes('apa')) return `(${name}, ${y})`;
        if (s.includes('mla')) return `(${name})`;
        return `(${name} ${y})`;
    },

    _authStr(authors, style) {
        if (!authors?.length) return 'Unknown';
        const a = authors[0];
        if (authors.length === 1) {
            return style.includes('apa') ? `${a.family}, ${a.given?.charAt(0)}.` : `${a.family}, ${a.given}`;
        }
        if (authors.length === 2) {
            const b = authors[1];
            return style.includes('apa') 
                ? `${a.family}, ${a.given?.charAt(0)}., & ${b.family}, ${b.given?.charAt(0)}.`
                : `${a.family}, ${a.given}, and ${b.given} ${b.family}`;
        }
        return style.includes('apa') ? `${a.family}, ${a.given?.charAt(0)}., et al.` : `${a.family}, ${a.given}, et al.`;
    }
};
