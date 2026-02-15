// api/utils/doiAPI.js

/**
 * DOI Resolution API
 * Fetches accurate citation metadata from Crossref and Unpaywall
 */
export const DoiAPI = {
    
    /**
     * Extract DOI from URL or text
     */
    extractDOI(text) {
        if (!text) return null;
        
        // Clean input
        text = text.trim();
        
        // Pattern 1: Full DOI URL
        const urlMatch = text.match(/https?:\/\/(?:dx\.)?doi\.org\/(.+)/i);
        if (urlMatch) return urlMatch[1];
        
        // Pattern 2: DOI pattern (10.XXXX/...)
        const doiMatch = text.match(/\b(10\.\d{4,}\/[^\s]+)/i);
        if (doiMatch) return doiMatch[1].replace(/[.,;:)\]]+$/, ''); // Remove trailing punctuation
        
        return null;
    },

    /**
     * Fetch metadata from Crossref
     */
    async fetchFromCrossref(doi) {
        try {
            const response = await fetch(
                `https://api.crossref.org/works/${encodeURIComponent(doi)}`,
                {
                    headers: {
                        'User-Agent': 'DocuMate/1.0 (mailto:support@documate.app)'
                    },
                    signal: AbortSignal.timeout(8000)
                }
            );
            
            if (!response.ok) return null;
            
            const data = await response.json();
            const item = data.message;
            
            // Extract authors
            const authors = item.author 
                ? item.author.map(a => {
                    const given = a.given || '';
                    const family = a.family || '';
                    return { given, family, full: `${given} ${family}`.trim() };
                })
                : [];
            
            // Extract year
            let year = null;
            if (item.published?.['date-parts']?.[0]?.[0]) {
                year = item.published['date-parts'][0][0].toString();
            } else if (item['published-print']?.['date-parts']?.[0]?.[0]) {
                year = item['published-print']['date-parts'][0][0].toString();
            } else if (item['published-online']?.['date-parts']?.[0]?.[0]) {
                year = item['published-online']['date-parts'][0][0].toString();
            }
            
            // Extract full date
            let fullDate = null;
            const dateParts = item.published?.['date-parts']?.[0] || 
                              item['published-print']?.['date-parts']?.[0] ||
                              item['published-online']?.['date-parts']?.[0];
            if (dateParts) {
                const [y, m, d] = dateParts;
                if (y && m && d) {
                    const months = ['January', 'February', 'March', 'April', 'May', 'June',
                                   'July', 'August', 'September', 'October', 'November', 'December'];
                    fullDate = `${months[m-1]} ${d}, ${y}`;
                } else if (y && m) {
                    const months = ['January', 'February', 'March', 'April', 'May', 'June',
                                   'July', 'August', 'September', 'October', 'November', 'December'];
                    fullDate = `${months[m-1]} ${y}`;
                } else if (y) {
                    fullDate = y.toString();
                }
            }
            
            // Clean abstract (remove HTML tags)
            const abstract = item.abstract 
                ? item.abstract.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
                : null;
            
            return {
                doi: doi,
                title: item.title?.[0] || null,
                authors: authors,
                authorString: authors.map(a => a.full).join(', '),
                year: year,
                fullDate: fullDate,
                journal: item['container-title']?.[0] || null,
                publisher: item.publisher || null,
                abstract: abstract,
                url: `https://doi.org/${doi}`,
                type: item.type || 'article',
                volume: item.volume || null,
                issue: item.issue || null,
                pages: item.page || null,
                issn: item.ISSN?.[0] || null,
                subject: item.subject || [],
                isVerified: true
            };
            
        } catch (e) {
            console.error('[DOI] Crossref fetch failed:', e.message);
            return null;
        }
    },

    /**
     * Check Open Access availability via Unpaywall
     */
    async checkOpenAccess(doi, email = 'support@documate.app') {
        try {
            const response = await fetch(
                `https://api.unpaywall.org/v2/${encodeURIComponent(doi)}?email=${email}`,
                { signal: AbortSignal.timeout(5000) }
            );
            
            if (!response.ok) return null;
            
            const data = await response.json();
            
            return {
                isOpenAccess: data.is_oa || false,
                oaUrl: data.best_oa_location?.url || null,
                license: data.best_oa_location?.license || null,
                version: data.best_oa_location?.version || null,
                pdfUrl: data.best_oa_location?.url_for_pdf || null
            };
            
        } catch (e) {
            return null;
        }
    },

    /**
     * Generate formatted citations from DOI metadata
     */
    formatCitations(meta, style = 'chicago') {
        if (!meta) return null;
        
        const { authors, authorString, year, title, journal, doi, volume, issue, pages } = meta;
        const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
        
        // Format authors for different styles
        const formatAuthors = (style) => {
            if (!authors || authors.length === 0) return 'Unknown';
            
            if (style === 'apa') {
                if (authors.length === 1) {
                    return `${authors[0].family}, ${authors[0].given.charAt(0)}.`;
                } else if (authors.length === 2) {
                    return `${authors[0].family}, ${authors[0].given.charAt(0)}., & ${authors[1].family}, ${authors[1].given.charAt(0)}.`;
                } else {
                    return `${authors[0].family}, ${authors[0].given.charAt(0)}., et al.`;
                }
            } else if (style === 'mla') {
                if (authors.length === 1) {
                    return `${authors[0].family}, ${authors[0].given}`;
                } else if (authors.length === 2) {
                    return `${authors[0].family}, ${authors[0].given}, and ${authors[1].given} ${authors[1].family}`;
                } else {
                    return `${authors[0].family}, ${authors[0].given}, et al.`;
                }
            } else { // chicago
                if (authors.length === 1) {
                    return `${authors[0].family}, ${authors[0].given}`;
                } else if (authors.length === 2) {
                    return `${authors[0].family}, ${authors[0].given}, and ${authors[1].given} ${authors[1].family}`;
                } else {
                    return `${authors[0].family}, ${authors[0].given}, et al.`;
                }
            }
        };
        
        // Volume/Issue/Pages formatting
        const volInfo = volume ? (issue ? `${volume}(${issue})` : volume) : '';
        const pageInfo = pages ? `: ${pages}` : '';
        const volPages = volInfo ? `${volInfo}${pageInfo}` : '';
        
        const s = style.toLowerCase();
        
        if (s.includes('apa')) {
            // APA 7th: Author, A. A. (Year). Title. Journal, Volume(Issue), Pages. https://doi.org/xxx
            let citation = `${formatAuthors('apa')} (${year || 'n.d.'}). ${title}. `;
            if (journal) citation += `*${journal}*`;
            if (volPages) citation += `, ${volPages}`;
            citation += `. https://doi.org/${doi}`;
            return citation;
        }
        
        if (s.includes('mla')) {
            // MLA 9th: Author. "Title." Journal, vol. X, no. X, Year, pp. X-X. DOI.
            let citation = `${formatAuthors('mla')}. "${title}." `;
            if (journal) citation += `*${journal}*`;
            if (volume) citation += `, vol. ${volume}`;
            if (issue) citation += `, no. ${issue}`;
            if (year) citation += `, ${year}`;
            if (pages) citation += `, pp. ${pages}`;
            citation += `. https://doi.org/${doi}.`;
            return citation;
        }
        
        // Chicago (default)
        // Chicago: Author. "Title." Journal Volume, no. Issue (Year): Pages. https://doi.org/xxx.
        let citation = `${formatAuthors('chicago')}. "${title}." `;
        if (journal) citation += `*${journal}*`;
        if (volume) citation += ` ${volume}`;
        if (issue) citation += `, no. ${issue}`;
        if (year) citation += ` (${year})`;
        if (pages) citation += `: ${pages}`;
        citation += `. https://doi.org/${doi}. (Accessed ${today})`;
        return citation;
    },

    /**
     * Generate in-text citation from DOI metadata
     */
    formatInText(meta, style = 'chicago') {
        if (!meta) return null;
        
        const { authors, year } = meta;
        const s = style.toLowerCase();
        
        let authorPart = 'Unknown';
        if (authors && authors.length > 0) {
            if (authors.length === 1) {
                authorPart = authors[0].family;
            } else if (authors.length === 2) {
                if (s.includes('apa')) {
                    authorPart = `${authors[0].family} & ${authors[1].family}`;
                } else {
                    authorPart = `${authors[0].family} and ${authors[1].family}`;
                }
            } else {
                authorPart = `${authors[0].family} et al.`;
            }
        }
        
        const yearPart = year || 'n.d.';
        
        if (s.includes('apa')) {
            return `(${authorPart}, ${yearPart})`;
        }
        if (s.includes('mla')) {
            return `(${authorPart})`;
        }
        // Chicago
        return `(${authorPart} ${yearPart})`;
    },

    /**
     * Full DOI lookup - combines Crossref + Unpaywall
     */
    async lookup(doiOrUrl) {
        const doi = this.extractDOI(doiOrUrl);
        if (!doi) return null;
        
        const [metadata, openAccess] = await Promise.all([
            this.fetchFromCrossref(doi),
            this.checkOpenAccess(doi)
        ]);
        
        if (!metadata) return null;
        
        return {
            ...metadata,
            openAccess: openAccess
        };
    }
};
