// ==========================================================================
// FILE PATH: api/_utils/scraper.js
// ==========================================================================

/**
 * api/_utils/scraper.js
 * Scrapes web pages for citation metadata, prioritizing DOI when available.
 * Uses Cheerio for DOM parsing and clean body text extraction.
 * 
 * Table of Contents:
 * 1. Main Source Scraper Module
 * 2. HTML Scraper & Parser Module
 * 3. Metadata Extraction Module
 * 4. Content Extractor & Cleaners Module
 */

import * as cheerio from 'cheerio';
import { DoiAPI } from './doiAPI.js';

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// ==========================================================================
// MODULE 1: Main Source Scraper
// ==========================================================================
export const ScraperAPI = {
    async scrape(sources) {
        if (!Array.isArray(sources) || sources.length === 0) return [];

        const results = await Promise.all(
            sources.slice(0, 20).map(async (source, index) => {
                try {
                    const url = source.link || source.url;

                    // Extract DOI directly from link/url or snippet (avoids web blocks)
                    const doi = url ? (DoiAPI.extractDOI(url) || DoiAPI.extractDOI(source.snippet)) : null;

                    if (doi) {
                        const doiData = await DoiAPI.resolve(url, source.snippet);
                        if (doiData) {
                            console.log('[Scraper] Programmatic DOI resolved:', doi);
                            return {
                                ...source,
                                id: index + 1,
                                title: doiData.title || source.title,
                                content: doiData.abstract || source.snippet || '',
                                doi: doiData.doi,
                                meta: {
                                    authors: doiData.authors,
                                    year: doiData.year,
                                    published: doiData.year,
                                    siteName: doiData.journal,
                                    isDOI: true
                                }
                            };
                        }
                    }

                    // Fall back to web HTML scrape only if programmatic DOI resolution fails
                    console.log('[Scraper] HTML Scraping:', url || 'undefined');
                    return await this._scrapeHTML(source, index);

                } catch (e) {
                    console.error('[Scraper] Error:', source.link || source.url, e.message);
                    return this._fallback(source, index);
                }
            })
        );
        return results;
    },

// ==========================================================================
// MODULE 2: HTML Scraper & Parser
// ==========================================================================
    async _scrapeHTML(source, index) {
        const url = source.link || source.url;
        if (!url) {
            console.warn('[Scraper] Skipping HTML scrape: No URL provided.');
            return ScraperAPI._fallback(source, index);
        }

        if (url.toLowerCase().endsWith('.pdf') || 
            url.includes('/pdf/') ||
            url.includes('pdfs.semanticscholar.org')) {
            console.log('[Scraper] Skipping PDF binary URL:', url);
            return ScraperAPI._fallback(source, index);
        }

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 7000);

        try {
            const res = await fetch(url, {
                signal: controller.signal,
                headers: {
                    'User-Agent': USER_AGENT,
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    'Accept-Language': 'en-US,en;q=0.9'
                }
            });
            clearTimeout(timeout);

            if (!res.ok) throw new Error(`HTTP ${res.status}`);

            const contentType = res.headers.get('content-type') || '';
            if (contentType.includes('pdf') || contentType.includes('octet-stream')) {
                console.log('[Scraper] Skipping binary content-type:', url);
                return ScraperAPI._fallback(source, index);
            }

            const html = await res.text();

            // Binary signatures check
            if (html.startsWith('%PDF') || html.substring(0, 100).includes('\x00')) {
                console.log('[Scraper] Detected binary content signature:', url);
                return ScraperAPI._fallback(source, index);
            }

            // Load DOM into Cheerio
            const $ = cheerio.load(html);

            // Scan HTML context for hidden DOIs in meta headers or body text
            const doiInHtml = ScraperAPI._extractDoiFromHtml($, html);
            if (doiInHtml) {
                const doiData = await DoiAPI.resolve(doiInHtml);
                if (doiData) {
                    console.log('[Scraper] Found DOI in HTML content:', doiInHtml);
                    return {
                        ...source,
                        id: index + 1,
                        title: doiData.title || source.title,
                        content: doiData.abstract || ScraperAPI._extractContent($) || source.snippet || '',
                        doi: doiData.doi,
                        meta: {
                            authors: doiData.authors,
                            year: doiData.year,
                            published: doiData.year,
                            siteName: doiData.journal,
                            isDOI: true
                        }
                    };
                }
            }

            const extractedContent = ScraperAPI._extractContent($);

            return {
                ...source,
                id: index + 1,
                content: extractedContent || source.snippet || '',
                meta: ScraperAPI._extractMeta($, html, url)
            };

        } catch (e) {
            clearTimeout(timeout);
            throw e;
        }
    },

// ==========================================================================
// MODULE 3: Metadata Extraction
// ==========================================================================
    _extractDoiFromHtml($, html) {
        // 1. Cheerio Meta Tag Selectors (Highwire Press, Dublin Core, PRISM)
        const metaDoi = $('meta[name="citation_doi"]').attr('content') ||
                        $('meta[name="dc.identifier"]').attr('content') ||
                        $('meta[property="prism:doi"]').attr('content') ||
                        $('meta[name="doi"]').attr('content');

        if (metaDoi) {
            const clean = metaDoi.replace(/^https?:\/\/doi\.org\//i, '').trim();
            if (clean.startsWith('10.')) return clean;
        }

        // 2. Regex fallback for inline text DOIs
        const patterns = [
            /doi\.org\/(10\.\d{4,}\/[^\s"'<>\]]+)/i,
            /"doi"\s*:\s*"(10\.[^"]+)"/i,
            /DOI:\s*(10\.\d{4,}\/[^\s<]+)/i
        ];

        for (const pattern of patterns) {
            const match = html.match(pattern);
            if (match) {
                const doi = match[1].replace(/^https?:\/\/doi\.org\//i, '').replace(/[.,;)}\]]+$/, '');
                if (doi.startsWith('10.')) return doi;
            }
        }
        return null;
    },

    _extractMeta($, html, url) {
        let author = null;
        let year = 'n.d.';
        let siteName = null;

        // 1. Highwire Press & Dublin Core Meta Tags
        author = $('meta[name="citation_author"]').attr('content') ||
                 $('meta[name="author"]').attr('content') ||
                 $('meta[name="dc.creator"]').attr('content');

        const pubDate = $('meta[name="citation_publication_date"]').attr('content') ||
                        $('meta[name="citation_date"]').attr('content') ||
                        $('meta[property="article:published_time"]').attr('content') ||
                        $('meta[name="date"]').attr('content') ||
                        $('meta[name="dc.date"]').attr('content');

        if (pubDate) {
            const match = pubDate.match(/\b(20\d{2}|19\d{2})\b/);
            if (match) year = match[1];
        }

        siteName = $('meta[property="og:site_name"]').attr('content') ||
                   $('meta[name="application-name"]').attr('content');

        // 2. JSON-LD Metadata Parsing
        $('script[type="application/ld+json"]').each((_, el) => {
            try {
                const rawJson = $(el).html();
                if (!rawJson) return;
                const data = JSON.parse(rawJson);
                const items = data['@graph'] || [data];

                for (const item of items) {
                    if (!author && item.author) {
                        author = Array.isArray(item.author)
                            ? item.author.map(a => (typeof a === 'object' ? a.name : a)).filter(Boolean).join(', ')
                            : (typeof item.author === 'object' ? item.author.name : item.author);
                    }
                    if (year === 'n.d.' && (item.datePublished || item.dateCreated)) {
                        const match = String(item.datePublished || item.dateCreated).match(/\b(20\d{2}|19\d{2})\b/);
                        if (match) year = match[1];
                    }
                    if (!siteName && item.publisher?.name) {
                        siteName = item.publisher.name;
                    }
                }
            } catch (_) {}
        });

        // 3. Fallback Site Name from Hostname
        if (!siteName) {
            try {
                const hostname = new URL(url).hostname.replace(/^www\./i, '');
                const base = hostname.split('.')[0] || 'Web';
                siteName = base.charAt(0).toUpperCase() + base.slice(1);
            } catch (_) {
                siteName = 'Unknown';
            }
        }

        return {
            author: DoiAPI.cleanAuthorName(author),
            year: year,
            published: year,
            siteName: siteName || 'Unknown'
        };
    },

// ==========================================================================
// MODULE 4: Content Extractor & Cleaners
// ==========================================================================
    /**
     * Uses Cheerio to strip boilerplate and extract core text
     */
    _extractContent($) {
        if (!$) return '';

        // Strip non-content and layout noise elements
        $('script, style, noscript, nav, header, footer, aside, form, svg, iframe, .ad, .advertisement, #comments, .comments').remove();

        // Target primary content containers if present
        let targetSelector = 'article, main, [role="main"], .entry-content, .post-content, .article-content, .story-body';
        let container = $(targetSelector);

        if (!container.length) {
            container = $('body');
        }

        // Collect readable paragraphs
        const paragraphs = [];
        container.find('p, h2, h3').each((_, el) => {
            const text = $(el).text().replace(/\s+/g, ' ').trim();
            // Discard short captions, copyright footers, and cookie disclaimers
            if (text.length > 40 && !/cookie|copyright|all rights reserved|subscribe|newsletter/i.test(text)) {
                paragraphs.push(text);
            }
        });

        const fullText = paragraphs.join('\n\n');

        // Truncate to ~4,000 characters for quotes and synthesis
        return fullText.slice(0, 4000).trim();
    },

    _fallback(source, index) {
        let siteName = 'Unknown';
        const url = source.link || source.url;
        try {
            if (url) {
                const hostname = new URL(url).hostname.replace(/^www\./i, '');
                const parts = hostname.split('.');
                siteName = parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
            }
        } catch (_) {}

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
