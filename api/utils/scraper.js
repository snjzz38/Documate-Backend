// api/utils/scraper.js
// Scrapes web pages for citation metadata, prioritizing DOI when available

import { DoiAPI } from './doiAPI.js';

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export const ScraperAPI = {
    async scrape(sources) {
        const results = await Promise.all(
            sources.slice(0, 10).map(async (source, index) => {
                try {
                    // STEP 1: Try DOI first (most reliable metadata)
                    const doiData = await DoiAPI.resolve(source.link, source.snippet);
                    
                    if (doiData) {
                        console.log('[Scraper] DOI found for:', source.link);
                        return {
                            ...source,
                            id: index + 1,
                            title: doiData.title,
                            content: doiData.abstract || source.snippet || '',
                            doi: doiData.doi,
                            meta: {
                                author: this._formatAuthors(doiData.authors),
                                authors: doiData.authors,
                                year: doiData.year,
                                published: doiData.year,
                                siteName: doiData.journal,
                                isDOI: true
                            }
                        };
                    }
                    
                    // STEP 2: Fallback to HTML scraping
                    console.log('[Scraper] No DOI, scraping HTML:', source.link);
                    return await this._scrapeHTML(source, index);
                    
                } catch (e) {
                    console.error('[Scraper] Error:', source.link, e.message);
                    return this._fallback(source, index);
                }
            })
        );
        
        return results;
    },

    _formatAuthors(authors) {
        if (!authors || authors.length === 0) return null;
        
        if (authors.length === 1) {
            return authors[0].family || authors[0].given || null;
        }
        if (authors.length === 2) {
            return `${authors[0].family} and ${authors[1].family}`;
        }
        return `${authors[0].family} et al.`;
    },

    async _scrapeHTML(source, index) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 6000);
        
        try {
            const res = await fetch(source.link, {
                signal: controller.signal,
                headers: {
                    'User-Agent': USER_AGENT,
                    'Accept': 'text/html,application/xhtml+xml'
                }
            });
            clearTimeout(timeout);
            
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            
            const html = await res.text();
            const meta = this._extractMeta(html, source.link);
            const content = this._extractContent(html);
            
            return {
                ...source,
                id: index + 1,
                content: content || source.snippet || '',
                meta: meta
            };
        } catch (e) {
            clearTimeout(timeout);
            throw e;
        }
    },

    _extractMeta(html, url) {
        let author = null;
        let year = 'n.d.';
        let siteName = null;
        
        // === AUTHOR EXTRACTION ===
        
        // 1. JSON-LD (most reliable for modern sites)
        const jsonLdMatch = html.match(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/i);
        if (jsonLdMatch) {
            try {
                const data = JSON.parse(jsonLdMatch[1]);
                const items = data['@graph'] || [data];
                
                for (const item of items) {
                    if (item.author) {
                        if (Array.isArray(item.author)) {
                            const names = item.author.map(a => a.name || a).filter(Boolean);
                            author = names[0];
                        } else if (typeof item.author === 'object') {
                            author = item.author.name;
                        } else {
                            author = item.author;
                        }
                    }
                    if (item.datePublished && year === 'n.d.') {
                        const match = item.datePublished.match(/\b(20\d{2})\b/);
                        if (match) year = match[1];
                    }
                    if (item.publisher?.name && !siteName) {
                        siteName = item.publisher.name;
                    }
                }
            } catch {}
        }
        
        // 2. Meta tags
        if (!author) {
            const authorMeta = html.match(/<meta[^>]*name=["'](?:author|citation_author|dc\.creator)["'][^>]*content=["']([^"']+)["']/i) ||
                              html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*name=["'](?:author|citation_author)["']/i);
            if (authorMeta) author = authorMeta[1];
        }
        
        if (year === 'n.d.') {
            const dateMeta = html.match(/<meta[^>]*(?:name|property)=["'](?:article:published_time|citation_publication_date|date|DC\.date)["'][^>]*content=["']([^"']+)["']/i) ||
                            html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*(?:name|property)=["'](?:article:published_time|citation_publication_date)["']/i);
            if (dateMeta) {
                const match = dateMeta[1].match(/\b(20\d{2})\b/);
                if (match) year = match[1];
            }
        }
        
        if (!siteName) {
            const siteMatch = html.match(/<meta[^>]*property=["']og:site_name["'][^>]*content=["']([^"']+)["']/i) ||
                             html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:site_name["']/i);
            if (siteMatch) siteName = siteMatch[1];
        }
        
        // 3. Byline patterns in HTML
        if (!author) {
            const bylinePatterns = [
                /<[^>]*class="[^"]*(?:author|byline)[^"]*"[^>]*>([^<]+)</i,
                /By\s+([A-Z][a-z]+(?:\s+[A-Z]\.?\s*)?[A-Z][a-z]+)/,
                /<a[^>]*rel=["']author["'][^>]*>([^<]+)</i
            ];
            
            for (const pattern of bylinePatterns) {
                const match = html.match(pattern);
                if (match && match[1].length > 3 && match[1].length < 50) {
                    author = match[1].trim();
                    break;
                }
            }
        }
        
        // 4. Year from content if still missing
        if (year === 'n.d.') {
            const yearMatch = html.match(/(?:Published|Posted|Date)[:\s]*[^<]*\b(202[0-6]|201\d)\b/i) ||
                             html.match(/<time[^>]*datetime=["']([^"']+)["']/i);
            if (yearMatch) {
                const match = yearMatch[1].match(/\b(20\d{2})\b/);
                if (match) year = match[1];
            }
        }
        
        // 5. Site name from URL if missing
        if (!siteName) {
            try {
                const hostname = new URL(url).hostname.replace('www.', '');
                const parts = hostname.split('.');
                siteName = parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
            } catch {}
        }
        
        // === CLEAN UP ===
        
        // Validate author
        if (author) {
            author = author
                .replace(/^(By|Written by|Author:)\s*/i, '')
                .replace(/\s+/g, ' ')
                .trim();
            
            // Reject invalid authors
            const invalid = /^(default|unknown|admin|editor|staff|https?:|www\.|[^a-zA-Z]{3,})/i;
            if (invalid.test(author) || author.length < 3 || author.length > 60) {
                author = null;
            }
        }
        
        return {
            author: author,
            year: year,
            published: year,
            siteName: siteName || 'Unknown'
        };
    },

    _extractContent(html) {
        // Remove scripts, styles, nav, footer
        let clean = html
            .replace(/<script[\s\S]*?<\/script>/gi, '')
            .replace(/<style[\s\S]*?<\/style>/gi, '')
            .replace(/<nav[\s\S]*?<\/nav>/gi, '')
            .replace(/<footer[\s\S]*?<\/footer>/gi, '')
            .replace(/<header[\s\S]*?<\/header>/gi, '');
        
        // Try to find article content
        const articleMatch = clean.match(/<article[^>]*>([\s\S]*?)<\/article>/i) ||
                            clean.match(/<main[^>]*>([\s\S]*?)<\/main>/i) ||
                            clean.match(/<div[^>]*class="[^"]*(?:content|article|post)[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
        
        if (articleMatch) {
            clean = articleMatch[1];
        }
        
        // Strip all HTML tags
        const text = clean
            .replace(/<[^>]+>/g, ' ')
            .replace(/&nbsp;/g, ' ')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/\s+/g, ' ')
            .trim();
        
        // Return first ~1500 chars
        return text.substring(0, 1500);
    },

    _fallback(source, index) {
        let siteName = 'Unknown';
        try {
            const hostname = new URL(source.link).hostname.replace('www.', '');
            siteName = hostname.split('.')[0];
            siteName = siteName.charAt(0).toUpperCase() + siteName.slice(1);
        } catch {}
        
        return {
            ...source,
            id: index + 1,
            content: source.snippet || '',
            meta: {
                author: null,
                year: 'n.d.',
                published: 'n.d.',
                siteName: siteName
            }
        };
    }
};
