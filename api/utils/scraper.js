import * as cheerio from 'cheerio';
import PdfParse from 'pdf-parse/lib/pdf-parse.js';

const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
];

/**
 * HELPER: Extract metadata using JSON-LD (Schema.org) & Meta Tags.
 * JSON-LD is the gold standard for modern news sites.
 */
function extractMetadata($) {
    let author = null;
    let date = null;

    // 1. Try JSON-LD (Schema.org) - Best for Brookings/News sites
    try {
        const jsonLd = $('script[type="application/ld+json"]').html();
        if (jsonLd) {
            const data = JSON.parse(jsonLd);
            const obj = Array.isArray(data) ? data[0] : data;
            
            // Extract Author
            if (obj.author) {
                if (typeof obj.author === 'string') author = obj.author;
                else if (Array.isArray(obj.author)) author = obj.author[0]?.name;
                else if (obj.author.name) author = obj.author.name;
            }
            
            // Extract Date
            date = obj.datePublished || obj.dateCreated || obj.uploadDate;
        }
    } catch (e) { /* Ignore JSON parse errors */ }

    // 2. Meta Tags (Fallback)
    if (!author) {
        author = $('meta[name="author"]').attr('content') || 
                 $('meta[property="og:site_name"]').attr('content') ||
                 $('a[class*="author"]').first().text();
    }
    
    if (!date) {
        date = $('meta[property="article:published_time"]').attr('content') || 
               $('meta[name="date"]').attr('content') ||
               $('time').first().attr('datetime');
    }

    // 3. Text Scraping (Last Resort)
    if (!date || date === "n.d.") {
        // Look for "April 24, 2018" pattern in the first 1000 chars of body
        const bodyStart = $('body').text().substring(0, 1500);
        const dateMatch = bodyStart.match(/([A-Z][a-z]{2,8}\.?\s+\d{1,2},\s+\d{4})/);
        if (dateMatch) date = dateMatch[1];
    }

    return { 
        author: author || "Unknown", 
        date: date || "n.d." 
    };
}

export const ScraperAPI = {
    async scrape(sources) {
        const targetSources = sources.slice(0, 10);

        const promises = targetSources.map(async (source) => {
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

                // PDF Handling
                const contentType = res.headers.get('content-type') || '';
                if (contentType.includes('application/pdf') || source.link.endsWith('.pdf')) {
                    const buffer = await res.arrayBuffer();
                    const pdfData = await PdfParse(Buffer.from(buffer));
                    return this._formatPdfResult(pdfData.text, source);
                }

                // HTML Handling
                const html = await res.text();
                return this._parseHtml(html, source);

            } catch (e) {
                return {
                    ...source,
                    content: `[Summary]: ${source.snippet || "No content available."}`,
                    meta: { author: "Unknown", published: "n.d.", siteName: new URL(source.link).hostname }
                };
            }
        });

        const results = await Promise.all(promises);
        return results.map((r, i) => ({ ...r, id: i + 1 }));
    },

    _parseHtml(html, originalSource) {
        const $ = cheerio.load(html);
        
        // 1. Extract Metadata FIRST (before cleaning)
        const meta = extractMetadata($);

        // 2. Aggressive Noise Removal
        // Remove Standard Garbage
        $('script, style, nav, footer, iframe, svg, header, form, button').remove();
        $('.ad, .popup, .menu, .share, .social, .subscribe, .cookie, .banner, .hidden').remove();
        $('[aria-hidden="true"]').remove();
        
        // --- SPECIFIC FIX: Remove "Related Content" sections ---
        // Brookings and others use classes like 'related-content', 'related-stories', 'sidebar'
        $('.related, .related-content, .related-stories, .related-posts').remove();
        $('.sidebar, .widget, .module, .recommends, .read-more').remove();
        $('#related, #sidebar, #comments').remove();
        
        // Remove lists of links that look like navigation/related items
        $('ul[class*="menu"], ul[class*="related"]').remove();

        // 3. Targeted Content Selection
        // Try to find the specific "Article Body" before falling back to generic tags
        let contentObj = $('.post-body, .article-body, .entry-content, .story-body, [itemprop="articleBody"]');
        
        // If no specific class found, try generic semantic tags
        if (contentObj.length === 0) contentObj = $('article');
        if (contentObj.length === 0) contentObj = $('[role="main"]');
        if (contentObj.length === 0) contentObj = $('body'); 

        // 4. Semantic Paragraph Extraction
        // Only grab <p> tags to avoid getting lists of names/links
        const paragraphs = [];
        contentObj.find('p').each((i, el) => {
            const text = $(el).text().trim();
            // Filter out short noise (e.g., "Read more", "By Name") and very long link lists
            if (text.length > 60 && !text.toLowerCase().startsWith("copyright")) {
                paragraphs.push(text);
            }
        });

        // 5. Content Assembly
        let finalContent = "";

        if (paragraphs.length > 0) {
            // A. Intro: First 3 paragraphs (good for summary)
            const intro = paragraphs.slice(0, 3).join('\n\n');
            finalContent = intro;

            // B. Random Sections: Pick 2 paragraphs from the middle/end
            // We ensure we don't pick the intro paragraphs again
            if (paragraphs.length > 6) {
                const bodyParas = paragraphs.slice(3);
                
                if (bodyParas.length >= 2) {
                    const idx1 = Math.floor(Math.random() * bodyParas.length);
                    let idx2 = Math.floor(Math.random() * bodyParas.length);
                    // Ensure distinct
                    while (idx2 === idx1 && bodyParas.length > 1) {
                        idx2 = Math.floor(Math.random() * bodyParas.length);
                    }
                    
                    finalContent += `\n\n... [Section A] ...\n${bodyParas[idx1]}`;
                    finalContent += `\n\n... [Section B] ...\n${bodyParas[idx2]}`;
                }
            }
        } else {
            // Fallback: Raw Text (if no <p> tags found)
            const raw = $('body').text().replace(/\s+/g, ' ').trim();
            finalContent = raw.substring(0, 1500);
        }

        return {
            ...originalSource,
            content: finalContent,
            meta: { 
                author: meta.author ? meta.author.trim() : "Unknown", 
                published: meta.date ? meta.date.substring(0, 20) : "n.d.", 
                siteName: new URL(originalSource.link).hostname.replace('www.', '') 
            }
        };
    },

    _formatPdfResult(rawText, source) {
        const safeText = rawText.replace(/\s+/g, ' ').trim();
        let finalContent = safeText.substring(0, 1000); 
        
        if (safeText.length > 3000) {
             const mid = Math.floor(safeText.length * 0.4);
             finalContent += `\n... [PDF Excerpt] ...\n${safeText.substring(mid, mid + 600)}`;
        }

        return {
            ...source,
            content: finalContent,
            meta: { author: "PDF Document", published: "n.d.", siteName: "PDF" }
        };
    }
};
