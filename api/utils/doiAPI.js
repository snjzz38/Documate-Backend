// api/utils/doiAPI.js - DOI/ISBN Resolution & Citation Formatting

export const DoiAPI = {
    // Extract DOI from text
    extractDOI(text) {
        if (!text) return null;
        const match = text.match(/10\.\d{4,}\/[^\s"'<>\])+]+/i);
        return match ? match[0].replace(/[.,;:)\]]+$/, '') : null;
    },

    // Extract ISBN from text (ISBN-10 or ISBN-13)
    extractISBN(text) {
        if (!text) return null;
        // ISBN-13: 978 or 979 prefix
        const isbn13 = text.match(/(?:ISBN[:\-]?\s*)?(?:978|979)[\-\s]?\d{1,5}[\-\s]?\d{1,7}[\-\s]?\d{1,7}[\-\s]?\d/gi);
        if (isbn13) {
            return isbn13[0].replace(/[^\dX]/gi, '');
        }
        // ISBN-10
        const isbn10 = text.match(/(?:ISBN[:\-]?\s*)?\d{1,5}[\-\s]?\d{1,7}[\-\s]?\d{1,7}[\-\s]?[\dX]/gi);
        if (isbn10) {
            const clean = isbn10[0].replace(/[^\dX]/gi, '');
            if (clean.length === 10) return clean;
        }
        return null;
    },

    // Convert ISBN to DOI via Crossref
    async isbnToDOI(isbn) {
        try {
            const res = await fetch(
                `https://api.crossref.org/works?query.bibliographic=${isbn}&rows=1`,
                { signal: AbortSignal.timeout(5000) }
            );
            if (!res.ok) return null;
            const data = await res.json();
            const item = data.message?.items?.[0];
            if (item?.DOI) return item.DOI;
            return null;
        } catch { return null; }
    },

    // Fetch book metadata from Open Library using ISBN
    async fetchFromOpenLibrary(isbn) {
        try {
            const res = await fetch(
                `https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&jscmd=data&format=json`,
                { signal: AbortSignal.timeout(5000) }
            );
            if (!res.ok) return null;
            const data = await res.json();
            const book = data[`ISBN:${isbn}`];
            if (!book) return null;

            return {
                title: book.title,
                authors: (book.authors || []).map(a => {
                    const parts = a.name.split(/\s+/);
                    const family = parts.pop();
                    const given = parts.join(' ');
                    return { given, family };
                }),
                year: book.publish_date?.match(/\d{4}/)?.[0] || null,
                publisher: book.publishers?.[0]?.name || null,
                isbn,
                isBook: true
            };
        } catch { return null; }
    },

    // Fetch DOI metadata from Crossref
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
                pages: message.page,
                publisher: message.publisher,
                type: message.type
            };
        } catch { return null; }
    },

    // Try all methods to get metadata: DOI > ISBN > nothing
    async resolve(text, url) {
        // Try DOI first
        let doi = this.extractDOI(text) || this.extractDOI(url);
        if (doi) {
            const data = await this.fetch(doi);
            if (data) return { ...data, isDOI: true };
        }

        // Try ISBN
        const isbn = this.extractISBN(text) || this.extractISBN(url);
        if (isbn) {
            // Try converting ISBN to DOI first
            doi = await this.isbnToDOI(isbn);
            if (doi) {
                const data = await this.fetch(doi);
                if (data) return { ...data, isbn, isDOI: true };
            }
            
            // Fall back to Open Library
            const bookData = await this.fetchFromOpenLibrary(isbn);
            if (bookData) return { ...bookData, isDOI: false, isISBN: true };
        }

        return null;
    },

    // Format bibliography citation
    formatBib(meta, style = 'chicago') {
        if (!meta) return null;
        const { authors, year, title, journal, doi, isbn, volume, issue, pages, publisher, isBook } = meta;
        const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
        const y = year || 'n.d.';
        const s = (style || '').toLowerCase();
        const auth = this._authStr(authors, s);
        
        const url = doi ? `https://doi.org/${doi}` : '';

        // Book format
        if (isBook || (!journal && publisher)) {
            if (s.includes('apa')) {
                return `${auth} (${y}). *${title}*. ${publisher || 'Publisher'}. ${url}`;
            }
            if (s.includes('mla')) {
                return `${auth}. *${title}*. ${publisher || 'Publisher'}, ${y}.`;
            }
            return `${auth}. *${title}*. ${publisher || 'Publisher'}, ${y}. ${url} (Accessed ${today})`;
        }

        // Journal/article format
        if (s.includes('apa')) {
            let c = `${auth} (${y}). ${title}.`;
            if (journal) c += ` *${journal}*`;
            if (volume) c += `, ${volume}${issue ? `(${issue})` : ''}${pages ? `, ${pages}` : ''}`;
            return c + `. ${url}`;
        }
        if (s.includes('mla')) {
            let c = `${auth}. "${title}."`;
            if (journal) c += ` *${journal}*`;
            if (volume) c += `, vol. ${volume}`;
            if (issue) c += `, no. ${issue}`;
            c += `, ${y}`;
            if (pages) c += `, pp. ${pages}`;
            return c + `. ${url}.`;
        }
        // Chicago
        let c = `${auth}. "${title}."`;
        if (journal) c += ` *${journal}*`;
        if (volume) c += ` ${volume}${issue ? `, no. ${issue}` : ''}`;
        if (y !== 'n.d.') c += ` (${y})`;
        if (pages) c += `: ${pages}`;
        return c + `. ${url}. (Accessed ${today})`;
    },

    // Format in-text citation
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
        const s = (style || '').toLowerCase();
        if (authors.length === 1) {
            return s.includes('apa') ? `${a.family}, ${a.given?.charAt(0)}.` : `${a.family}, ${a.given}`;
        }
        if (authors.length === 2) {
            const b = authors[1];
            return s.includes('apa') 
                ? `${a.family}, ${a.given?.charAt(0)}., & ${b.family}, ${b.given?.charAt(0)}.`
                : `${a.family}, ${a.given}, and ${b.given} ${b.family}`;
        }
        return s.includes('apa') ? `${a.family}, ${a.given?.charAt(0)}., et al.` : `${a.family}, ${a.given}, et al.`;
    }
};
