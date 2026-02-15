// api/utils/scraper.js - Simplified Web Scraper
import * as cheerio from 'cheerio';
import { DoiAPI } from './doiAPI.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0';

export const ScraperAPI = {
    async scrape(sources) {
        const results = await Promise.all(sources.slice(0, 10).map(s => this._process(s)));
        return results.map((r, i) => ({ ...r, id: i + 1 }));
    },

    async _process(source) {
        // Try DOI first (most reliable)
        const doi = DoiAPI.extract(source.link) || DoiAPI.extract(source.snippet);
        if (doi) {
            const data = await DoiAPI.fetch(doi);
            if (data) {
                return {
                    ...source,
                    title: data.title || source.title,
                    content: data.abstract ? `[Abstract]: ${data.abstract}` : `[Summary]: ${source.snippet || ''}`,
                    doi,
                    meta: {
                        author: data.authors?.map(a => a.full).join(', ') || null,
                        allAuthors: data.authors?.map(a => a.full) || [],
                        year: data.year || 'n.d.',
                        siteName: data.journal || 'Academic Source',
                        isVerified: true
                    }
                };
            }
        }

        // Try HTML scraping
        try {
            const res = await fetch(source.link, {
                headers: { 'User-Agent': UA },
                signal: AbortSignal.timeout(6000)
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            
            const html = await res.text();
            return this._parseHtml(html, source);
        } catch {
            // Fallback to snippet
            return this._fallback(source);
        }
    },

    _parseHtml(html, source) {
        const $ = cheerio.load(html);
        
        // Extract metadata first
        const meta = this._extractMeta($, source.link);
        
        // Remove junk
        $('script,style,nav,header,footer,aside,form,button,iframe,.ad,.popup,.cookie,.banner,.sidebar,[class*="menu"],[class*="nav"]').remove();
        
        // Get content from article/main or body
        let content = $('article, main, .content, .post-content, #content').first().text() || $('body').text();
        content = content.replace(/\s+/g, ' ').trim();
        
        // Take intro (first 1000 chars at sentence boundary)
        if (content.length > 1000) {
            const cut = content.substring(0, 1200);
            const lastPeriod = cut.lastIndexOf('. ');
            content = lastPeriod > 800 ? cut.substring(0, lastPeriod + 1) : cut.substring(0, 1000) + '...';
        }

        return { ...source, content: content || `[Summary]: ${source.snippet}`, meta };
    },

    _extractMeta($, url) {
        let author = null, year = 'n.d.', siteName = null;

        // JSON-LD
        try {
            const ld = $('script[type="application/ld+json"]').first().html();
            if (ld) {
                const data = JSON.parse(ld);
                const item = data['@graph']?.[0] || data;
                if (item.author) {
                    author = typeof item.author === 'string' ? item.author : item.author.name || item.author[0]?.name;
                }
                const dateStr = item.datePublished || item.dateCreated;
                if (dateStr) {
                    const m = dateStr.match(/\b(20\d{2})\b/);
                    if (m) year = m[1];
                }
            }
        } catch {}

        // Meta tags
        author = author || $('meta[name="author"]').attr('content') || $('meta[property="article:author"]').attr('content');
        siteName = $('meta[property="og:site_name"]').attr('content');
        
        if (year === 'n.d.') {
            const dateContent = $('meta[property="article:published_time"]').attr('content') || $('time').first().attr('datetime');
            if (dateContent) {
                const m = dateContent.match(/\b(20\d{2})\b/);
                if (m) year = m[1];
            }
        }

        // Fallback siteName from URL
        if (!siteName) {
            try { siteName = new URL(url).hostname.replace('www.', ''); } catch {}
        }

        return {
            author: author && author !== 'Unknown' ? author : null,
            allAuthors: author ? [author] : [],
            year,
            siteName: siteName || 'Unknown'
        };
    },

    _fallback(source) {
        let siteName = 'Unknown';
        try { siteName = new URL(source.link).hostname.replace('www.', ''); } catch {}
        
        return {
            ...source,
            content: source.snippet ? `[Summary]: ${source.snippet}` : '[No content available]',
            meta: { author: null, allAuthors: [], year: 'n.d.', siteName }
        };
    }
};
