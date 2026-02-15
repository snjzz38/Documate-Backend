// api/utils/scraper.js - Web Scraper with DOI Support
import * as cheerio from 'cheerio';
import { DoiAPI } from './doiAPI.js';

export const ScraperAPI = {
    async scrape(sources) {
        const results = await Promise.all(sources.slice(0, 10).map(s => this._process(s)));
        return results.map((r, i) => ({ ...r, id: i + 1 }));
    },

    async _process(source) {
        // Try DOI first
        const doi = DoiAPI.extract(source.link) || DoiAPI.extract(source.snippet);
        if (doi) {
            const data = await DoiAPI.fetch(doi);
            if (data) {
                return {
                    ...source,
                    title: data.title || source.title,
                    content: `[Academic Source] ${data.title}`,
                    doi,
                    meta: {
                        authors: data.authors,
                        year: data.year || 'n.d.',
                        journal: data.journal,
                        isDOI: true
                    }
                };
            }
        }

        // HTML scraping
        try {
            const res = await fetch(source.link, {
                headers: { 'User-Agent': 'Mozilla/5.0 Chrome/120.0.0.0' },
                signal: AbortSignal.timeout(6000)
            });
            if (!res.ok) throw new Error();
            
            const $ = cheerio.load(await res.text());
            
            // Get metadata
            let author = $('meta[name="author"]').attr('content') || 
                        $('meta[property="article:author"]').attr('content') ||
                        $('a[rel="author"]').first().text().trim();
            
            let year = 'n.d.';
            const dateStr = $('meta[property="article:published_time"]').attr('content') || 
                           $('time').first().attr('datetime');
            if (dateStr) {
                const m = dateStr.match(/\b(20\d{2})\b/);
                if (m) year = m[1];
            }
            
            const siteName = $('meta[property="og:site_name"]').attr('content') ||
                            new URL(source.link).hostname.replace('www.', '');
            
            // Get content
            $('script,style,nav,header,footer,aside,form,.ad,.popup,.sidebar,[class*="menu"],[class*="nav"]').remove();
            let content = $('article, main, .content').first().text() || $('body').text();
            content = content.replace(/\s+/g, ' ').trim().substring(0, 1000);

            return {
                ...source,
                content: content || `[Summary]: ${source.snippet}`,
                meta: {
                    author: author && author !== 'Unknown' ? author : null,
                    year,
                    siteName,
                    isDOI: false
                }
            };
        } catch {
            return {
                ...source,
                content: source.snippet ? `[Summary]: ${source.snippet}` : '[No content]',
                meta: {
                    author: null,
                    year: 'n.d.',
                    siteName: new URL(source.link).hostname.replace('www.', ''),
                    isDOI: false
                }
            };
        }
    }
};
