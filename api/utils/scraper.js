// api/utils/scraper.js
import * as cheerio from 'cheerio';
import PdfParse from 'pdf-parse/lib/pdf-parse.js';
import { DoiAPI } from './doiAPI.js';

const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
];

/**
 * HELPER: Find the nearest valid sentence start.
 */
function findSentenceStart(text, searchFromIndex) {
    if (searchFromIndex >= text.length) return -1;

    const buffer = text.substring(searchFromIndex, searchFromIndex + 500);
    const match = buffer.match(/([a-z0-9""'])[.!?]\s+([A-Z])/);

    if (match) {
        const splitIndex = match[0].lastIndexOf(match[2]);
        return searchFromIndex + match.index + splitIndex;
    }

    return -1;
}

/**
 * HELPER: Extract a semantic chunk.
 */
function getSmartChunk(fullText, approxStart, targetLength) {
    let start = findSentenceStart(fullText, approxStart);
    
    if (start === -1) {
        if (approxStart === 0) start = 0;
        else return "";
    }

    let chunk = fullText.substr(start, targetLength);
    
    const buffer = fullText.substr(start + targetLength, 300);
    const endMatch = buffer.match(/([a-z0-9""'])[.!?](?:\s|$)/);

    if (endMatch) {
        const cutIndex = endMatch.index + endMatch[1].length + 1;
        chunk += buffer.substring(0, cutIndex);
    } else {
        chunk += "...";
    }

    return chunk;
}

/**
 * HELPER: Extract metadata using multiple strategies.
 * Expanded to cover links, buttons, spans, and various HTML patterns.
 */
function extractMetadata($, rawText, url) {
    let author = null;
    let allAuthors = [];
    let date = null;
    let siteName = null;

    // ==========================================================================
    // 1. JSON-LD (Highest Priority - Structured Data)
    // ==========================================================================
    try {
        $('script[type="application/ld+json"]').each((i, el) => {
            try {
                const jsonLd = $(el).html();
                if (jsonLd) {
                    const data = JSON.parse(jsonLd);
                    const objects = Array.isArray(data) ? data : [data];
                    
                    objects.forEach(obj => {
                        // Handle nested @graph structure
                        const items = obj['@graph'] || [obj];
                        
                        items.forEach(item => {
                            // Author extraction
                            if (item.author && !author) {
                                if (Array.isArray(item.author)) {
                                    allAuthors = item.author.map(a => 
                                        typeof a === 'string' ? a : (a.name || '')
                                    ).filter(Boolean);
                                    author = allAuthors[0];
                                } else if (typeof item.author === 'string') {
                                    author = item.author;
                                    allAuthors = [author];
                                } else if (item.author.name) {
                                    author = item.author.name;
                                    allAuthors = [author];
                                }
                            }
                            
                            // Date extraction
                            if (!date) {
                                date = item.datePublished || item.dateCreated || item.dateModified;
                            }
                            
                            // Site name
                            if (!siteName && item.publisher) {
                                siteName = typeof item.publisher === 'string' 
                                    ? item.publisher 
                                    : item.publisher.name;
                            }
                        });
                    });
                }
            } catch (e) {}
        });
    } catch (e) {}

    // ==========================================================================
    // 2. META TAGS (Standard & OpenGraph)
    // ==========================================================================
    if (!author) {
        author = $('meta[name="author"]').attr('content') ||
                 $('meta[name="article:author"]').attr('content') ||
                 $('meta[property="article:author"]').attr('content') ||
                 $('meta[name="dc.creator"]').attr('content') ||
                 $('meta[name="DC.creator"]').attr('content') ||
                 $('meta[name="citation_author"]').attr('content');
    }
    
    // Multiple authors from citation_author tags
    if (allAuthors.length === 0) {
        $('meta[name="citation_author"]').each((i, el) => {
            const name = $(el).attr('content');
            if (name) allAuthors.push(name.trim());
        });
        if (allAuthors.length > 0 && !author) {
            author = allAuthors[0];
        }
    }

    if (!date) {
        date = $('meta[property="article:published_time"]').attr('content') ||
               $('meta[name="publication_date"]').attr('content') ||
               $('meta[name="date"]').attr('content') ||
               $('meta[name="dc.date"]').attr('content') ||
               $('meta[name="DC.date"]').attr('content') ||
               $('meta[name="citation_publication_date"]').attr('content') ||
               $('meta[property="og:updated_time"]').attr('content');
    }

    if (!siteName) {
        siteName = $('meta[property="og:site_name"]').attr('content') ||
                   $('meta[name="application-name"]').attr('content') ||
                   $('meta[name="publisher"]').attr('content');
    }

    // ==========================================================================
    // 3. HTML ELEMENTS (Links, Buttons, Spans, Divs)
    // ==========================================================================
    
    // Author from links
    if (!author) {
        // rel="author" links
        author = $('a[rel="author"]').first().text().trim() ||
                 $('a[href*="/author/"]').first().text().trim() ||
                 $('a[href*="/authors/"]').first().text().trim() ||
                 $('a[href*="/contributor/"]').first().text().trim() ||
                 $('a[href*="/profile/"]').first().text().trim() ||
                 $('a[href*="/staff/"]').first().text().trim() ||
                 $('a[href*="/people/"]').first().text().trim() ||
                 $('a[href*="/byline/"]').first().text().trim();
    }

    // Author from common class names
    if (!author) {
        const authorSelectors = [
            '.author', '.byline', '.author-name', '.writer', '.contributor',
            '.post-author', '.article-author', '.entry-author', '.meta-author',
            '[class*="author"]', '[class*="byline"]', '[class*="writer"]',
            '[data-author]', '[itemprop="author"]', '[rel="author"]',
            '.by-author', '.story-author', '.content-author'
        ];
        
        for (const selector of authorSelectors) {
            const el = $(selector).first();
            if (el.length) {
                // Try to get text from nested link first
                let text = el.find('a').first().text().trim() || el.text().trim();
                // Clean up "By " prefix
                text = text.replace(/^(By|Written by|Author:|Posted by)\s*/i, '').trim();
                // Validate it looks like a name (has space, not too long)
                if (text && text.length > 3 && text.length < 60 && /\s/.test(text)) {
                    author = text;
                    break;
                }
            }
        }
    }

    // Author from buttons or spans with author-related attributes
    if (!author) {
        author = $('button[data-author]').attr('data-author') ||
                 $('span[data-author]').attr('data-author') ||
                 $('[data-analytics-author]').attr('data-analytics-author') ||
                 $('[data-track-author]').attr('data-track-author');
    }

    // Date from time elements
    if (!date) {
        const timeEl = $('time[datetime]').first();
        if (timeEl.length) {
            date = timeEl.attr('datetime');
        } else {
            // Try time element text
            date = $('time').first().text().trim();
        }
    }

    // Date from common class names
    if (!date) {
        const dateSelectors = [
            '.date', '.published', '.post-date', '.article-date', '.entry-date',
            '.meta-date', '.publish-date', '.publication-date', '.timestamp',
            '[class*="date"]', '[class*="publish"]', '[itemprop="datePublished"]',
            '.story-date', '.content-date', '.posted-on'
        ];
        
        for (const selector of dateSelectors) {
            const el = $(selector).first();
            if (el.length) {
                const text = el.attr('datetime') || el.text().trim();
                // Validate it looks like a date
                if (text && /\d{4}/.test(text)) {
                    date = text;
                    break;
                }
            }
        }
    }

    // ==========================================================================
    // 4. TEXT FORENSICS (Last Resort)
    // ==========================================================================
    
    // Author from "By [Name]" pattern in first 2000 chars
    if (!author) {
        const bylinePatterns = [
            /By\s+([A-Z][a-z]+(?:\s+[A-Z]\.?\s*)?[A-Z][a-z]+)(?:\s+and\s+([A-Z][a-z]+(?:\s+[A-Z]\.?\s*)?[A-Z][a-z]+))?/,
            /Written by\s+([A-Z][a-z]+(?:\s+[A-Z]\.?\s*)?[A-Z][a-z]+)/i,
            /Author:\s*([A-Z][a-z]+(?:\s+[A-Z]\.?\s*)?[A-Z][a-z]+)/i,
            /([A-Z][a-z]+(?:\s+[A-Z]\.?\s*)?[A-Z][a-z]+)\s+\|\s+[A-Z]/  // "John Smith | CNN"
        ];
        
        const headerText = rawText.substring(0, 2000);
        for (const pattern of bylinePatterns) {
            const match = headerText.match(pattern);
            if (match) {
                author = match[1].trim();
                if (match[2]) {
                    allAuthors = [match[1].trim(), match[2].trim()];
                }
                break;
            }
        }
    }

    // Date from text patterns
    if (!date || date === "n.d.") {
        const datePatterns = [
            /(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}/i,
            /(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\.?\s+\d{1,2},?\s+\d{4}/i,
            /\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}/i,
            /\d{4}-\d{2}-\d{2}/,
            /\d{1,2}\/\d{1,2}\/\d{4}/
        ];
        
        const headerText = rawText.substring(0, 2000);
        for (const pattern of datePatterns) {
            const match = headerText.match(pattern);
            if (match) {
                date = match[0];
                break;
            }
        }
    }

    // ==========================================================================
    // 5. SITE NAME FALLBACK
    // ==========================================================================
    if (!siteName) {
        try {
            const hostname = new URL(url).hostname.replace('www.', '');
            // Try to make it readable: "nytimes.com" -> "NYTimes"
            const parts = hostname.split('.');
            if (parts.length >= 2) {
                const domain = parts[parts.length - 2];
                // Capitalize first letter
                siteName = domain.charAt(0).toUpperCase() + domain.slice(1);
            } else {
                siteName = hostname;
            }
        } catch (e) {
            siteName = "Unknown Source";
        }
    }

    // ==========================================================================
    // 6. FINAL CLEANUP
    // ==========================================================================
    
    // Clean author name
    if (author) {
        author = author
            .replace(/^(By|Written by|Author:|Posted by)\s*/i, '')
            .replace(/\s+/g, ' ')
            .trim();
        
        // Filter out obvious non-names
        const invalidNames = ['admin', 'editor', 'staff', 'contributor', 'anonymous', 'unknown'];
        if (invalidNames.includes(author.toLowerCase()) || author.length < 3) {
            author = null;
        }
    }

    // Ensure allAuthors includes primary author
    if (author && allAuthors.length === 0) {
        allAuthors = [author];
    }

    // Clean date - extract year if full date
    let year = "n.d.";
    if (date && date !== "n.d.") {
        const yearMatch = date.match(/\b(19|20)\d{2}\b/);
        if (yearMatch) year = yearMatch[0];
    }

    return { 
        author: author || null,
        allAuthors: allAuthors,
        published: date || "n.d.",
        year: year,
        siteName: siteName
    };
}

export const ScraperAPI = {
    async scrape(sources) {
        const targetSources = sources.slice(0, 10);

        const promises = targetSources.map(async (source) => {
            // =======================================================
            // STRATEGY 1: Check for DOI first (most reliable)
            // =======================================================
            const doi = DoiAPI.extractDOI(source.link) || DoiAPI.extractDOI(source.snippet || '');
            
            if (doi) {
                try {
                    const doiData = await DoiAPI.lookup(doi);
                    if (doiData) {
                        return this._formatDoiResult(doiData, source);
                    }
                } catch (e) {
                    console.log('[Scraper] DOI lookup failed, falling back to HTML scrape');
                }
            }
            
            // =======================================================
            // STRATEGY 2: Try HTML scraping
            // =======================================================
            try {
                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), 6000); 

                const res = await fetch(source.link, {
                    signal: controller.signal,
                    headers: { 
                        'User-Agent': USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)],
                        'Accept': 'text/html,application/xhtml+xml,application/pdf'
                    }
                });
                clearTimeout(timeout);

                if (!res.ok) throw new Error(`HTTP ${res.status}`);

                const contentType = res.headers.get('content-type') || '';
                
                // Handle PDFs
                if (contentType.includes('application/pdf') || source.link.endsWith('.pdf')) {
                    const buffer = await res.arrayBuffer();
                    const pdfData = await PdfParse(Buffer.from(buffer));
                    
                    // Try to find DOI in PDF text
                    const pdfDoi = DoiAPI.extractDOI(pdfData.text);
                    if (pdfDoi) {
                        const doiData = await DoiAPI.lookup(pdfDoi);
                        if (doiData) {
                            // Combine PDF content with DOI metadata
                            const result = this._formatDoiResult(doiData, source);
                            result.content = this._formatPdfContent(pdfData.text, result.content);
                            return result;
                        }
                    }
                    
                    return this._formatResult(pdfData.text, source, null);
                }

                const html = await res.text();
                const result = this._parseHtml(html, source);
                
                // Check if we got meaningful content
                if (result.content && result.content.length > 200) {
                    // Try to find DOI in HTML for better metadata
                    const htmlDoi = DoiAPI.extractDOI(html);
                    if (htmlDoi && (!result.meta?.author || result.meta.author === 'Unknown')) {
                        const doiData = await DoiAPI.lookup(htmlDoi);
                        if (doiData) {
                            // Enhance metadata with DOI data
                            result.meta = this._mergeMetadata(result.meta, doiData);
                            result.doi = htmlDoi;
                        }
                    }
                    return result;
                }
                
                // Content too short, try fallback
                throw new Error('Insufficient content scraped');

            } catch (e) {
                // =======================================================
                // STRATEGY 3: Fallback to snippet
                // =======================================================
                return this._createFallbackResult(source, e.message);
            }
        });

        const results = await Promise.all(promises);
        return results.map((r, i) => ({ ...r, id: i + 1 }));
    },

    /**
     * Format result from DOI data
     */
    _formatDoiResult(doiData, source) {
        const content = doiData.abstract 
            ? `[Abstract]: ${doiData.abstract}`
            : `[Summary]: ${source.snippet || 'Academic article available via DOI.'}`;
        
        return {
            ...source,
            title: doiData.title || source.title,
            link: doiData.url || source.link,
            content: content,
            doi: doiData.doi,
            meta: {
                author: doiData.authorString || null,
                allAuthors: doiData.authors?.map(a => a.full) || [],
                published: doiData.fullDate || doiData.year || 'n.d.',
                year: doiData.year || 'n.d.',
                siteName: doiData.journal || doiData.publisher || 'Academic Source',
                journal: doiData.journal,
                volume: doiData.volume,
                issue: doiData.issue,
                pages: doiData.pages,
                isVerified: true
            },
            quality: 'high' // DOI sources are high quality
        };
    },

    /**
     * Format PDF content, preserving key parts
     */
    _formatPdfContent(pdfText, existingContent) {
        const intro = getSmartChunk(pdfText, 0, 800);
        return existingContent + '\n\n[PDF Excerpt]:\n' + intro;
    },

    /**
     * Merge scraped metadata with DOI metadata (DOI takes priority)
     */
    _mergeMetadata(scrapedMeta, doiData) {
        return {
            author: doiData.authorString || scrapedMeta?.author,
            allAuthors: doiData.authors?.map(a => a.full) || scrapedMeta?.allAuthors || [],
            published: doiData.fullDate || scrapedMeta?.published || 'n.d.',
            year: doiData.year || scrapedMeta?.year || 'n.d.',
            siteName: doiData.journal || scrapedMeta?.siteName,
            journal: doiData.journal,
            isVerified: true
        };
    },

    /**
     * Create fallback result when scraping fails
     */
    _createFallbackResult(source, errorMsg) {
        let siteName = "Unknown";
        try {
            siteName = new URL(source.link).hostname.replace('www.', '');
        } catch (err) {}
        
        const content = source.snippet && source.snippet.length > 50
            ? `[Summary]: ${source.snippet}`
            : `[Error]: Could not retrieve content (${errorMsg}). Title: ${source.title}`;
        
        return {
            ...source,
            content: content,
            meta: { 
                author: null, 
                allAuthors: [],
                published: "n.d.", 
                year: "n.d.",
                siteName: siteName 
            },
            quality: source.snippet ? 'low' : 'failed'
        };
    },

    _parseHtml(html, originalSource) {
        const $ = cheerio.load(html);
        
        // =======================================================
        // STEP 1: Extract metadata BEFORE removing elements
        // =======================================================
        const metaRawText = $('body').text().replace(/\s+/g, ' ').trim();
        const meta = extractMetadata($, metaRawText, originalSource.link);

        // =======================================================
        // STEP 2: Aggressively remove junk elements
        // =======================================================
        
        // Scripts and styles (keep JSON-LD for metadata but remove after)
        $('script, style, noscript').remove();
        
        // Navigation and structural junk
        $('nav, header, footer, aside, menu, menuitem').remove();
        $('[role="navigation"], [role="banner"], [role="contentinfo"]').remove();
        $('[role="menu"], [role="menubar"], [role="toolbar"]').remove();
        
        // Common junk class names
        const junkClasses = [
            '.nav', '.navbar', '.navigation', '.menu', '.sidebar', '.footer', '.header',
            '.ad', '.ads', '.advertisement', '.popup', '.modal', '.cookie', '.banner',
            '.breadcrumb', '.breadcrumbs', '.toc', '.table-of-contents', '.tableofcontents',
            '.share', '.social', '.sharing', '.subscribe', '.newsletter', '.signup',
            '.related', '.recommended', '.also-read', '.more-stories',
            '.comment', '.comments', '.discuss', '.feedback',
            '.search', '.searchbox', '.search-form', '.search-box',
            '.toolbar', '.toolbox', '.tools', '.utility',
            '.login', '.signin', '.register', '.account',
            '.skip', '.skip-link', '.skip-to-content',
            '.pagination', '.pager', '.page-numbers',
            '.widget', '.widgets', '.widget-area',
            '.alert', '.notice', '.warning', '.error', '.info-box',
            '.download', '.downloads', '.resources',
            '.reference', '.references', '.bibliography', '.citations', '.footnotes',
            '.author-bio', '.about-author', '.author-box'
        ];
        $(junkClasses.join(', ')).remove();
        
        // Common junk ID patterns
        const junkIds = [
            '#nav', '#navigation', '#menu', '#sidebar', '#footer', '#header',
            '#comments', '#respond', '#search', '#toc', '#table-of-contents',
            '#breadcrumbs', '#share', '#social', '#related', '#widget-area'
        ];
        $(junkIds.join(', ')).remove();
        
        // Elements with junk-indicating attributes
        $('[class*="menu"]').remove();
        $('[class*="nav-"]').remove();
        $('[class*="-nav"]').remove();
        $('[class*="toolbar"]').remove();
        $('[class*="sidebar"]').remove();
        $('[class*="footer"]').remove();
        $('[class*="header-"]').remove();
        $('[class*="breadcrumb"]').remove();
        $('[class*="search"]').not('article [class*="search"]').remove();
        $('[class*="widget"]').remove();
        $('[class*="cookie"]').remove();
        $('[class*="popup"]').remove();
        $('[class*="modal"]').remove();
        $('[class*="banner"]').remove();
        $('[class*="advertisement"]').remove();
        $('[class*="social"]').remove();
        $('[class*="share"]').remove();
        
        // Remove iframes, forms, buttons (usually not content)
        $('iframe, form, button, input, select, textarea').remove();
        $('svg, canvas').remove();
        
        // Remove empty elements
        $('div:empty, span:empty, p:empty').remove();
        
        // =======================================================
        // STEP 3: Try to find main content area
        // =======================================================
        let contentText = '';
        
        // Priority 1: Look for article or main content
        const contentSelectors = [
            'article',
            'main',
            '[role="main"]',
            '.content',
            '.post-content',
            '.article-content',
            '.entry-content',
            '.page-content',
            '.main-content',
            '#content',
            '#main',
            '#article',
            '.post',
            '.article',
            '.entry'
        ];
        
        for (const selector of contentSelectors) {
            const el = $(selector).first();
            if (el.length) {
                const text = el.text().replace(/\s+/g, ' ').trim();
                // Must have substantial content (at least 500 chars)
                if (text.length > 500) {
                    contentText = text;
                    break;
                }
            }
        }
        
        // Priority 2: Fall back to body text
        if (!contentText || contentText.length < 500) {
            contentText = $('body').text().replace(/\s+/g, ' ').trim();
        }
        
        // =======================================================
        // STEP 4: Clean up the extracted text
        // =======================================================
        contentText = this._cleanText(contentText);

        return this._formatResult(contentText, originalSource, meta);
    },

    /**
     * Clean extracted text of common junk patterns
     */
    _cleanText(text) {
        // Remove common UI text patterns
        const junkPatterns = [
            /Skip to (?:main )?content/gi,
            /Table of Contents/gi,
            /Search\s*Search/gi,
            /Login\s*Register/gi,
            /Sign [Ii]n\s*Sign [Uu]p/gi,
            /Subscribe\s*Newsletter/gi,
            /Share\s*(?:on\s*)?(?:Facebook|Twitter|LinkedIn|Email)/gi,
            /Follow [Uu]s/gi,
            /Cookie (?:Policy|Settings|Consent)/gi,
            /Privacy Policy/gi,
            /Terms (?:of (?:Service|Use)|and Conditions)/gi,
            /All [Rr]ights [Rr]eserved/gi,
            /©\s*\d{4}/gi,
            /\bAdvertisement\b/gi,
            /\bSponsored\b/gi,
            /Read [Mm]ore\s*›/gi,
            /Continue [Rr]eading/gi,
            /Load [Mm]ore/gi,
            /Show [Mm]ore/gi,
            /Click here/gi,
            /Download (?:PDF|Full Book)/gi,
            /Resources expand_more/gi,
            /menu_book|perm_media|login|hub|school/gi,  // Material icons text
            /expand_more|expand_less|chevron_right/gi,
            /chrome_reader_mode|build_circle|fact_check/gi,
            /Enter Reader Mode/gi,
            /Exit Reader Mode/gi,
            /Reset \+\-/gi,
            /Text (?:Color|Size)/gi,
            /Font Type/gi,
            /Enable Dyslexic Font/gi,
            /Margin Size/gi,
            /This action is not available/gi,
            /Error\s*This action/gi,
            /selected template will load here/gi,
            /property get \[Map MindTouch[^\]]+\]/gi,  // MindTouch junk
            /"[^"]*"\s*:\s*"property get[^"]*"/gi,
            /\{\s*\}\s*\{/gi,  // Empty object patterns
            /Searchbuild_circle/gi,
            /Toolbarfact_check/gi,
            /Homeworkcancel/gi,
        ];
        
        let cleaned = text;
        for (const pattern of junkPatterns) {
            cleaned = cleaned.replace(pattern, ' ');
        }
        
        // Remove multiple spaces
        cleaned = cleaned.replace(/\s{2,}/g, ' ').trim();
        
        // Remove very short "sentences" (likely UI fragments)
        // Split by periods, filter out fragments under 30 chars, rejoin
        const sentences = cleaned.split(/(?<=[.!?])\s+/);
        const goodSentences = sentences.filter(s => {
            const trimmed = s.trim();
            // Keep if it's substantial or ends with punctuation
            return trimmed.length > 30 || /[.!?]$/.test(trimmed);
        });
        
        return goodSentences.join(' ').trim();
    },

    _formatResult(rawText, source, metaOverride = null) {
        const len = rawText.length;
        
        // 1. Intro: Always 0-1000
        let finalContent = getSmartChunk(rawText, 0, 1000);

        // 2. Central Chunks
        if (len > 3000) {
            const safeEnd = Math.floor(len * 0.85);
            const bodyStart = 1200;

            if (safeEnd > bodyStart + 500) {
                const zoneSize = safeEnd - bodyStart;
                const midPoint = bodyStart + Math.floor(zoneSize / 2);

                const rangeA = midPoint - bodyStart;
                if (rangeA > 200) {
                    const startA = bodyStart + Math.floor(Math.random() * (rangeA - 100));
                    const chunkA = getSmartChunk(rawText, startA, 350);
                    if (chunkA) finalContent += `\n\n... [Excerpt A] ...\n${chunkA}`;
                }

                const rangeB = safeEnd - midPoint;
                if (rangeB > 200) {
                    const startB = midPoint + Math.floor(Math.random() * (rangeB - 100));
                    const chunkB = getSmartChunk(rawText, startB, 350);
                    if (chunkB) finalContent += `\n\n... [Excerpt B] ...\n${chunkB}`;
                }
            }
        }

        // Build metadata
        let meta;
        if (metaOverride) {
            meta = metaOverride;
        } else {
            // PDF fallback
            let siteName = "Unknown";
            try {
                siteName = new URL(source.link).hostname.replace('www.', '');
            } catch (e) {}
            
            meta = { 
                author: null, 
                allAuthors: [],
                published: "n.d.", 
                year: "n.d.",
                siteName: siteName 
            };
        }

        return {
            ...source,
            content: finalContent,
            meta: meta
        };
    }
};
