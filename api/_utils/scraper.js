// ==========================================================================
// FILE PATH: api/_utils/scraper.js
// ==========================================================================

/**
 * api/_utils/scraper.js
 * Universal Web Content & Metadata Scraper (Cheerio-powered)
 * 
 * Table of Contents:
 * 1. Batch Source Scraper Core
 * 2. HTML Scraper & Parser
 * 3. Cheerio Metadata Extractor
 * 4. Cheerio Content & Paragraph Extractor
 */

import * as cheerio from 'cheerio';
import { DoiAPI } from './doiAPI.js';

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const TIMEOUT_MS = 7000;

// ==========================================================================
// MODULE 1: Batch Source Scraper Core
// ==========================================================================
export const ScraperAPI = {
    async scrape(sources) {
        if (!sources || !Array.isArray(sources)) return [];

        return await Promise.all(
            sources.slice(0, 15).map(async (source, index) => {
                const url = source.link || source.url;

                try {
                    // Check if source already has a DOI
                    const doi = url ? (DoiAPI.extractDOI(url) || DoiAPI.extractDOI(source.snippet)) : null;
                    if (doi) {
                        const doiData = await DoiAPI.resolve(url, source.snippet);
                        if (doiData) {
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
                                    siteName: doiData.journal || 'Academic Journal',
                                    isDOI: true
                                }
                            };
                        }
                    }

                    // Scrape webpage directly using Cheerio
                    return await this._scrapeHTML(source, index);

                } catch (e) {
                    console.error('[Scraper] Failed for:', url, e.message);
                    return this._fallback(source, index);
                }
            })
        );
    },

// ==========================================================================
// MODULE 2: HTML Scraper & Parser
// ==========================================================================
    async _scrapeHTML(source, index) {
        const url = source.link || source.url;
        if (!url || url.toLowerCase().endsWith('.pdf')) {
            return this._fallback(source, index);
        }

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

        try {
            const res = await fetch(url, {
                signal: controller.signal,
                headers: {
                    'User-Agent': USER_AGENT,
                    'Accept': 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8'
                }
            });
            clearTimeout(timer);

            if (!res.ok) throw new Error(`HTTP ${res.status}`);

            const html = await res.text();
            const $ = cheerio.load(html);

            // Extract article text and metadata using Cheerio
            const content = this._extractContent($) || source.snippet || '';
            const meta = this._extractMeta($, url);

            return {
                ...source,
                id: index + 1,
                title: source.title || $('title').text().trim() || 'Web Document',
                content, // Full body text used for verbatim quote generation
                meta
            };

        } catch (e) {
            clearTimeout(timer);
            throw e;
        }
    },

// ==========================================================================
// MODULE 3: Cheerio Metadata Extractor
// ==========================================================================
    _extractMeta($, url) {
        let author = null;
        let year = 'n.d.';
        let siteName = null;

        // 1. JSON-LD structured data
        $('script[type="application/ld+json"]').each((_, el) => {
            try {
                const data = JSON.parse($(el).contents().text().trim());
                const items = data['@graph'] || [data];
                for (const item of items) {
                    if (item.author && !author) {
                        author = Array.isArray(item.author)
                            ? item.author.map(a => a.name || a).filter(Boolean)[0]
                            : (item.author.name || item.author);
                    }
                    if (item.datePublished && year === 'n.d.') {
                        const m = String(item.datePublished).match(/\b(202[0-6]|201\d|200\d|19\d{2})\b/);
                        if (m) year = m[0];
                    }
                    if (item.publisher?.name && !siteName) siteName = item.publisher.name;
                }
            } catch (_) {}
        });

        // 2. OpenGraph & HTML Meta Tags
        if (!author) {
            author = $('meta[name="author"]').attr('content') ||
                     $('meta[name="citation_author"]').attr('content') ||
                     $('meta[property="article:author"]').attr('content') ||
                     $('a[rel="author"]').first().text().trim() ||
                     null;
        }

        if (year === 'n.d.') {
            const dateStr = $('meta[property="article:published_time"]').attr('content') ||
                            $('meta[name="citation_publication_date"]').attr('content') ||
                            $('meta[name="date"]').attr('content') ||
                            $('time').first().attr('datetime') ||
                            $('time').first().text().trim() ||
                            '';
            const m = dateStr.match(/\b(202[0-6]|201\d|200\d|19\d{2})\b/);
            if (m) year = m[0];
        }

        if (!siteName) {
            siteName = $('meta[property="og:site_name"]').attr('content') || null;
        }

        // Domain fallback
        if (!siteName) {
            try {
                const host = new URL(url).hostname.replace(/^www\./i, '');
                siteName = host.split('.')[0];
                siteName = siteName.charAt(0).toUpperCase() + siteName.slice(1);
            } catch (_) {
                siteName = 'Web Source';
            }
        }

        return {
            author: author ? DoiAPI.cleanAuthorName(author) : null,
            year,
            published: year,
            siteName: siteName || 'Unknown',
            isDOI: false
        };
    },

// ==========================================================================
// MODULE 4: Cheerio Content & Paragraph Extractor
// ==========================================================================
    _extractContent($) {
        try {
            // Remove boilerplates and scripts
            $('script, style, noscript, nav, header, footer, svg, iframe, form, button, aside, .ad, .advertisement, .sidebar').remove();

            // Locate main content container
            const container = $('article, main, [itemprop="articleBody"], .article-body, #content').first();
            const root = container.length > 0 ? container : $('body');

            // Gather readable article paragraphs
            const paragraphs = [];
            root.find('p').each((_, el) => {
                const text = $(el).text().replace(/\s+/g, ' ').trim();
                if (text.length > 30) {
                    paragraphs.push(text);
                }
            });

            if (paragraphs.length > 0) {
                // Return text for quotes and citation matching (capped to 6,000 chars)
                return paragraphs.join('\n\n').slice(0, 6000);
            }

            return root.text().replace(/\s+/g, ' ').trim().slice(0, 3000);
        } catch (_) {
            return '';
        }
    },

    _fallback(source, index) {
        let siteName = 'Web Source';
        try {
            const host = new URL(source.link || source.url).hostname.replace(/^www\./i, '');
            siteName = host.split('.')[0];
            siteName = siteName.charAt(0).toUpperCase() + siteName.slice(1);
        } catch (_) {}

        return {
            ...source,
            id: index + 1,
            content: source.snippet || '',
            meta: {
                author: null,
                year: 'n.d.',
                published: 'n.d.',
                siteName,
                isDOI: false
            }
        };
    }
};

export default ScraperAPI;
