// ==========================================================================
// FILE PATH: api/_utils/scraper.js
// ==========================================================================

/**
 * api/_utils/scraper.js
 * Scrapes web pages for citation metadata and full text using Cheerio
 * 
 * Table of Contents:
 * 1. Main Source Scraper Module
 * 2. HTML Scraper & Parser Module
 * 3. Metadata Extraction Module (Cheerio-powered)
 * 4. Content Extractor & Cleaners Module (Cheerio-powered)
 */

import * as cheerio from 'cheerio';
import { DoiAPI } from './doiAPI.js';

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// ==========================================================================
// MODULE 1: Main Source Scraper
// ==========================================================================
export const ScraperAPI = {
    async scrape(sources) {
        if (!sources || !Array.isArray(sources)) return [];

        const results = await Promise.all(
            sources.slice(0, 20).map(async (source, index) => {
                try {
                    const url = source.link || source.url;

                    // 1. Check for DOI in URL or snippet first (bypasses HTML scraping entirely)
                    const doi = url ? (DoiAPI.extractDOI(url) || DoiAPI.extractDOI(source.snippet)) : null;

                    if (doi) {
                        const doiData = await DoiAPI.resolve(url, source.snippet);
                        if (doiData) {
                            console.log('[Scraper] Programmatic DOI resolved:', doi);
                            return {
                                ...source,
                                id: index + 1,
                                title: doiData.title,
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

                    // 2. Fall back to Cheerio HTML scraping
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
            console.log('[Scraper] Skipping PDF:', url);
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
                console.log('[Scraper] Skipping binary content:', url);
                return ScraperAPI._fallback(source, index);
            }

            const html = await res.text();

            // Binary signature check
            if (html.startsWith('%PDF') || html.substring(0, 100).includes('\x00')) {
                console.log('[Scraper] Detected binary content:', url);
                return ScraperAPI._fallback(source, index);
            }

            // Load DOM with Cheerio
            const $ = cheerio.load(html);

            // Scan HTML DOM for embedded academic DOIs
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

            // Extract content and metadata via Cheerio
            const extractedContent = ScraperAPI._extractContent($) || source.snippet || '';
            const extractedMeta = ScraperAPI._extractMeta($, html, url);

            return {
                ...source,
                id: index + 1,
                content: extractedContent,
                meta: extractedMeta
            };

        } catch (e) {
            clearTimeout(timeout);
            throw e;
        }
    },

// ==========================================================================
// MODULE 3: Metadata Extraction Module (Cheerio-powered)
// ==========================================================================
    _extractDoiFromHtml($, html) {
        // Fast Cheerio meta tag lookups
        const metaDoi = $('meta[name="citation_doi"]').attr('content') ||
                        $('meta[name="dc.identifier"]').attr('content') ||
                        $('meta[name="DC.identifier"]').attr('content') ||
                        $('meta[name="doi"]').attr('content') ||
                        $('meta[property="citation_doi"]').attr('content');

        if (metaDoi) {
            const clean = metaDoi.replace(/^https?:\/\/doi\.org\//i, '').trim();
            if (clean.startsWith('10.')) return clean;
        }

        // Regex scan for raw DOI strings
        const patterns = [
            /doi\.org\/(10\.\d{4,}\/[^\s"'<>\]]+)/i,
            /"doi"\s*:\s*"(10\.[^"]+)"/i,
            /DOI:\s*(10\.\d{4,}\/[^\s<]+)/i
        ];

        for (const pattern of patterns) {
            const match = html.match(pattern);
            if (match) {
                const doi = match[1].replace(/[.,;)}\]]+$/, '');
                if (doi.startsWith('10.')) return doi;
            }
        }

        return null;
    },

    _extractMeta($, html, url) {
        let author = null;
        let year = 'n.d.';
        let siteName = null;

        // 1. JSON-LD Structured Data Parsing
        $('script[type="application/ld+json"]').each((_, el) => {
            try {
                const raw = $(el).contents().text().trim();
                if (!raw) return;
                const data = JSON.parse(raw);
                const items = data['@graph'] || [data];

                for (const item of items) {
                    if (item.author && !author) {
                        author = Array.isArray(item.author)
                            ? item.author.map(a => a.name || a).filter(Boolean)[0]
                            : (typeof item.author === 'object' ? item.author.name : item.author);
                    }
                    if (item.datePublished && year === 'n.d.') {
                        const match = String(item.datePublished).match(/\b(202[0-6]|201\d|200\d|19\d{2})\b/);
                        if (match) year = match[1];
                    }
                    if (item.publisher?.name && !siteName) {
                        siteName = item.publisher.name;
                    }
                }
            } catch (_) {}
        });

        // 2. OpenGraph & Citation Meta Tag Selectors
        if (!author) {
            author = $('meta[name="citation_author"]').attr('content') ||
                     $('meta[name="author"]').attr('content') ||
                     $('meta[name="dc.creator"]').attr('content') ||
                     $('meta[property="article:author"]').attr('content') ||
                     $('a[rel="author"]').first().text().trim() ||
                     $('.byline, .author, [itemprop="author"]').first().text().trim() ||
                     null;
        }

        if (year === 'n.d.') {
            const dateStr = $('meta[property="article:published_time"]').attr('content') ||
                            $('meta[name="citation_publication_date"]').attr('content') ||
                            $('meta[name="date"]').attr('content') ||
                            $('meta[name="DC.date"]').attr('content') ||
                            $('time').first().attr('datetime') ||
                            $('time').first().text().trim() ||
                            '';
            const match = dateStr.match(/\b(202[0-6]|201\d|200\d|19\d{2})\b/);
            if (match) year = match[1];
        }

        if (!siteName) {
            siteName = $('meta[property="og:site_name"]').attr('content') ||
                       $('meta[name="application-name"]').attr('content') ||
                       null;
        }

        // 3. Domain Fallback
        if (!siteName) {
            try {
                const hostname = new URL(url).hostname.replace(/^www\./i, '');
                const clean = hostname.split('.')[0];
                siteName = clean.charAt(0).toUpperCase() + clean.slice(1);
            } catch (_) {
                siteName = 'Unknown';
            }
        }

        return {
            author: DoiAPI.cleanAuthorName(author),
            year,
            published: year,
            siteName: siteName || 'Unknown'
        };
    },

// ==========================================================================
// MODULE 4: Content Extractor & Cleaners Module (Cheerio-powered)
// ==========================================================================
    _extractContent($) {
        try {
            // Strip non-content and clutter elements
            $('script, style, noscript, nav, header, footer, svg, iframe, form, button, aside, .ad, .advertisement, .sidebar, .cookie-banner, .menu').remove();

            // Locate main article container
            const articleElement = $('article, [itemprop="articleBody"], main, .article-body, .post-content, .entry-content, #content, .content').first();
            const root = articleElement.length > 0 ? articleElement : $('body');

            // Extract all readable text paragraphs
            const paragraphs = [];
            root.find('p').each((_, el) => {
                const text = $(el).text().replace(/\s+/g, ' ').trim();
                // Filter out short navigation crumbs or disclaimers
                if (text.length > 30) {
                    paragraphs.push(text);
                }
            });

            if (paragraphs.length > 0) {
                // Return clean, double-newline separated article text (capped to 8,000 chars for LLM context safety)
                return paragraphs.join('\n\n').slice(0, 8000);
            }

            // Fallback: extract cleaned root text if no distinct <p> tags were found
            const fallbackText = root.text().replace(/\s+/g, ' ').trim();
            return fallbackText.slice(0, 4000);

        } catch (err) {
            console.warn('[Scraper] Content extraction error:', err.message);
            return '';
        }
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
                siteName
            }
        };
    }
};
