// api/utils/scraper.js - Web Scraper with DOI Support
import * as cheerio from 'cheerio';
import { DoiAPI } from './doiAPI.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export const ScraperAPI = {
    async scrape(sources) {
        const results = await Promise.all(sources.slice(0, 10).map(s => this._process(s)));
        return results.map((r, i) => ({ ...r, id: i + 1 }));
    },

    async _process(source) {
        // Try DOI or ISBN first (most reliable metadata)
        const resolved = await DoiAPI.resolve(
            source.snippet || '', 
            source.link
        );
        
        if (resolved) {
            return {
                ...source,
                title: resolved.title || source.title,
                content: resolved.abstract 
                    ? `[Abstract]: ${resolved.abstract}` 
                    : `[${resolved.isBook ? 'Book' : 'Academic Article'}]: ${resolved.title}. ${source.snippet || ''}`,
                doi: resolved.doi,
                isbn: resolved.isbn,
                meta: {
                    authors: resolved.authors,
                    year: resolved.year || 'n.d.',
                    siteName: resolved.journal || resolved.publisher || 'Academic Source',
                    isDOI: resolved.isDOI || false,
                    isISBN: resolved.isISBN || false
                }
            };
        }

        // HTML scraping
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 8000);
            
            const res = await fetch(source.link, {
                headers: { 
                    'User-Agent': UA,
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    'Accept-Language': 'en-US,en;q=0.5'
                },
                signal: controller.signal
            });
            clearTimeout(timeout);
            
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            
            const html = await res.text();
            if (!html || html.length < 500) throw new Error('Empty response');
            
            return this._parseHtml(html, source);
            
        } catch (e) {
            console.error(`[Scraper] Failed for ${source.link}: ${e.message}`);
            return this._fallback(source);
        }
    },

    _parseHtml(html, source) {
        const $ = cheerio.load(html);
        
        // === EXTRACT METADATA FIRST ===
        let author = null;
        let year = 'n.d.';
        let siteName = null;

        // JSON-LD
        try {
            const ld = $('script[type="application/ld+json"]').first().html();
            if (ld) {
                const data = JSON.parse(ld);
                const item = data['@graph']?.[0] || data;
                if (item.author) {
                    author = typeof item.author === 'string' 
                        ? item.author 
                        : (item.author.name || item.author[0]?.name);
                }
                const dateStr = item.datePublished || item.dateCreated || item.dateModified;
                if (dateStr) {
                    const m = dateStr.match(/\b(20\d{2})\b/);
                    if (m) year = m[1];
                }
                if (item.publisher) {
                    siteName = typeof item.publisher === 'string' 
                        ? item.publisher 
                        : item.publisher.name;
                }
            }
        } catch {}

        // Meta tags
        if (!author) {
            author = $('meta[name="author"]').attr('content') ||
                    $('meta[property="article:author"]').attr('content') ||
                    $('a[rel="author"]').first().text().trim() ||
                    null;
        }
        
        if (year === 'n.d.') {
            const dateStr = $('meta[property="article:published_time"]').attr('content') ||
                           $('meta[name="publication_date"]').attr('content') ||
                           $('time[datetime]').first().attr('datetime');
            if (dateStr) {
                const m = dateStr.match(/\b(20\d{2})\b/);
                if (m) year = m[1];
            }
        }

        if (!siteName) {
            siteName = $('meta[property="og:site_name"]').attr('content');
        }
        
        // Fallback siteName from URL
        if (!siteName) {
            try {
                siteName = new URL(source.link).hostname.replace('www.', '');
            } catch {
                siteName = 'Unknown';
            }
        }

        // === REMOVE JUNK ELEMENTS ===
        $('script, style, noscript, iframe, svg, canvas').remove();
        $('nav, header, footer, aside, form, button, input, select').remove();
        $('[role="navigation"], [role="banner"], [role="contentinfo"]').remove();
        $('.nav, .navbar, .menu, .sidebar, .footer, .header, .ad, .popup, .cookie, .banner').remove();
        $('[class*="menu"], [class*="nav-"], [class*="sidebar"], [class*="footer"], [class*="header"]').remove();
        $('[class*="social"], [class*="share"], [class*="comment"], [class*="related"]').remove();

        // === EXTRACT CONTENT ===
        let content = '';
        
        // Try specific content containers first
        const contentSelectors = [
            'article', 
            'main', 
            '[role="main"]',
            '.post-content',
            '.article-content', 
            '.entry-content',
            '.content',
            '#content',
            '.post',
            '.article'
        ];
        
        for (const sel of contentSelectors) {
            const el = $(sel).first();
            if (el.length) {
                const text = el.text().replace(/\s+/g, ' ').trim();
                if (text.length > 500) {
                    content = text;
                    break;
                }
            }
        }
        
        // Fallback to body
        if (!content || content.length < 500) {
            content = $('body').text().replace(/\s+/g, ' ').trim();
        }

        // Clean content
        content = this._cleanContent(content);
        
        // Truncate to reasonable length
        if (content.length > 2000) {
            const cut = content.substring(0, 2200);
            const lastPeriod = cut.lastIndexOf('. ');
            content = lastPeriod > 1500 ? cut.substring(0, lastPeriod + 1) : cut.substring(0, 2000) + '...';
        }

        // If still no content, use snippet
        if (!content || content.length < 100) {
            content = source.snippet ? `[Summary]: ${source.snippet}` : '[No content available]';
        }

        return {
            ...source,
            content,
            meta: {
                author: author && author !== 'Unknown' ? author : null,
                year,
                siteName,
                isDOI: false
            }
        };
    },

    _cleanContent(text) {
        const patterns = [
            /Skip to (?:main )?content/gi,
            /Table of Contents/gi,
            /Cookie (?:Policy|Settings|Consent)/gi,
            /Privacy Policy/gi,
            /Terms (?:of (?:Service|Use)|and Conditions)/gi,
            /All [Rr]ights [Rr]eserved/gi,
            /©\s*\d{4}/gi,
            /Subscribe.*?Newsletter/gi,
            /Follow [Uu]s/gi,
            /Share (?:on|this)/gi,
            /Advertisement/gi
        ];
        
        let cleaned = text;
        for (const p of patterns) {
            cleaned = cleaned.replace(p, ' ');
        }
        return cleaned.replace(/\s{2,}/g, ' ').trim();
    },

    _fallback(source) {
        let siteName = 'Unknown';
        try { siteName = new URL(source.link).hostname.replace('www.', ''); } catch {}
        
        return {
            ...source,
            content: source.snippet && source.snippet.length > 50
                ? `[Summary]: ${source.snippet}`
                : '[Unable to fetch content]',
            meta: { author: null, year: 'n.d.', siteName, isDOI: false }
        };
    }
};
