// api/features/citation.js
import { GoogleSearchAPI } from '../utils/googleSearch.js';
import { ScraperAPI } from '../utils/scraper.js';
import { GroqAPI } from '../utils/groqAPI.js';
import { DoiAPI } from '../utils/doiAPI.js';

const TODAY = () => new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

// ==========================================================================
// CITATION FORMATTER
// ==========================================================================
const Format = {
    // Get author name for citation (last name or site name)
    getAuthor(source) {
        // Check for DOI author data first
        if (source.meta?.authors?.length > 0) {
            const authors = source.meta.authors;
            if (authors.length === 1) return authors[0].family || authors[0].given;
            if (authors.length === 2) return `${authors[0].family} and ${authors[1].family}`;
            return `${authors[0].family} et al.`;
        }
        
        // Check for scraped author
        if (source.meta?.author && source.meta.author !== 'Unknown') {
            const author = source.meta.author;
            // If it contains comma, it's "Last, First" format
            if (author.includes(',')) return author.split(',')[0].trim();
            // Otherwise get last word (last name)
            const parts = author.trim().split(/\s+/);
            return parts[parts.length - 1];
        }
        
        // Fallback to site name
        const site = source.meta?.siteName || '';
        // Clean up site name: remove .com/.org, capitalize
        return site
            .replace(/\.(com|org|edu|net|gov|io)$/i, '')
            .replace(/^www\./, '')
            .split('.')[0] || 'Unknown';
    },

    // Get year
    getYear(source) {
        return source.meta?.year || 'n.d.';
    },

    // Format in-text citation: (Author Year) or (Author, Year) for APA
    inText(source, style) {
        const author = this.getAuthor(source);
        const year = this.getYear(source);
        const s = (style || '').toLowerCase();
        
        if (s.includes('apa')) return `(${author}, ${year})`;
        if (s.includes('mla')) return `(${author})`;
        return `(${author} ${year})`; // Chicago
    },

    // Format bibliography entry
    bib(source, style) {
        const s = (style || '').toLowerCase();
        const year = this.getYear(source);
        const site = source.meta?.siteName || 'Unknown';
        const today = TODAY();
        
        // Get full author string for bibliography
        let author;
        if (source.meta?.authors?.length > 0) {
            const authors = source.meta.authors;
            if (authors.length === 1) {
                author = `${authors[0].family}, ${authors[0].given}`;
            } else if (authors.length === 2) {
                author = `${authors[0].family}, ${authors[0].given}, and ${authors[1].given} ${authors[1].family}`;
            } else {
                author = `${authors[0].family}, ${authors[0].given}, et al.`;
            }
        } else if (source.meta?.author && source.meta.author !== 'Unknown') {
            author = source.meta.author;
        } else {
            author = site;
        }

        if (s.includes('apa')) {
            return `${author}. (${year}). ${source.title}. *${site}*. ${source.link}`;
        }
        if (s.includes('mla')) {
            return `${author}. "${source.title}." *${site}*, ${year}, ${source.link}.`;
        }
        // Chicago
        return `${author}. "${source.title}." *${site}*. ${year}. ${source.link} (Accessed ${today})`;
    }
};

// ==========================================================================
// INSERTION PROCESSOR
// ==========================================================================
function processInsertions(text, insertions, sources, style, outputType) {
    let result = text;
    const used = new Set();
    const footnotes = [];
    let fnNum = 1;

    // Tokenize text for anchor matching
    const tokens = [];
    const re = /[a-z0-9]+/gi;
    let m;
    while ((m = re.exec(text))) {
        tokens.push({ word: m[0].toLowerCase(), end: m.index + m[0].length });
    }

    // Find valid insertion positions
    const valid = insertions.map(ins => {
        if (!ins.anchor || !ins.source_id) return null;
        const words = ins.anchor.toLowerCase().match(/[a-z0-9]+/g);
        if (!words || words.length < 2) return null;
        
        for (let i = 0; i <= tokens.length - words.length; i++) {
            if (words.every((w, j) => tokens[i + j].word === w)) {
                return { sourceId: ins.source_id, pos: tokens[i + words.length - 1].end };
            }
        }
        return null;
    }).filter(Boolean);

    // Deduplicate: max 1 source per position
    const byPos = new Map();
    valid.forEach(v => {
        if (!byPos.has(v.pos)) byPos.set(v.pos, v.sourceId);
    });

    // Sort positions for sequential processing
    const positions = [...byPos.keys()].sort((a, b) => a - b);
    const posToData = new Map();

    // Build citation data for each position
    positions.forEach(pos => {
        const srcId = byPos.get(pos);
        const src = sources.find(s => s.id === srcId);
        if (!src) return;
        
        used.add(srcId);

        // Generate citation using DOI API or Format helper
        let bibCit, inTextCit;
        
        if (src.doi && src.meta?.isDOI) {
            // DOI source - use DoiAPI
            bibCit = DoiAPI.formatBib({ 
                ...src.meta, 
                doi: src.doi, 
                title: src.title 
            }, style);
            inTextCit = DoiAPI.formatInText({ 
                authors: src.meta.authors, 
                year: src.meta.year 
            }, style);
        } else {
            // Regular source - use Format
            bibCit = Format.bib(src, style);
            inTextCit = Format.inText(src, style);
        }

        if (outputType === 'footnotes') {
            footnotes.push({ num: fnNum, cit: bibCit });
            posToData.set(pos, { type: 'footnote', num: fnNum });
            fnNum++;
        } else {
            posToData.set(pos, { type: 'intext', cit: inTextCit });
        }
    });

    // Insert citations in reverse order (to preserve positions)
    const toSuper = n => n.toString().split('').map(d => '⁰¹²³⁴⁵⁶⁷⁸⁹'[+d]).join('');
    
    [...positions].reverse().forEach(pos => {
        const data = posToData.get(pos);
        if (!data) return;
        
        let insert;
        if (data.type === 'footnote') {
            insert = toSuper(data.num);
        } else {
            insert = ` ${data.cit}`;
        }
        
        result = result.slice(0, pos) + insert + result.slice(pos);
    });

    // Build footer
    let footer = '\n\n';
    
    if (outputType === 'footnotes') {
        footer += '### Footnotes (Used)\n\n';
        footnotes.forEach(f => footer += `${f.num}. ${f.cit}\n\n`);
    } else {
        footer += '### References (Used)\n\n';
        sources.filter(s => used.has(s.id)).forEach(s => {
            const cit = (s.doi && s.meta?.isDOI) 
                ? DoiAPI.formatBib({ ...s.meta, doi: s.doi, title: s.title }, style)
                : Format.bib(s, style);
            footer += cit + '\n\n';
        });
    }

    // Unused sources
    const unused = sources.filter(s => !used.has(s.id));
    if (unused.length) {
        footer += '\n### Further Reading (Unused)\n\n';
        unused.forEach(s => {
            const cit = (s.doi && s.meta?.isDOI)
                ? DoiAPI.formatBib({ ...s.meta, doi: s.doi, title: s.title }, style)
                : Format.bib(s, style);
            footer += cit + '\n\n';
        });
    }

    return result + footer;
}

// ==========================================================================
// PROMPT FOR GROQ (only asks for insertion points, not formatting)
// ==========================================================================
function buildInsertionPrompt(text, sources) {
    const srcList = sources.map(s => {
        const author = Format.getAuthor(s);
        const year = Format.getYear(s);
        return `[${s.id}] ${author} (${year}) - ${s.title.substring(0, 50)}`;
    }).join('\n');

    return `Find where to insert citations in this text.

SOURCES (use 8+ of these):
${srcList}

TEXT:
"${text}"

Return JSON only:
{"insertions":[{"anchor":"3-6 exact words from text","source_id":1}]}

Rules:
- anchor must be EXACT words from the text
- Use 10+ insertions spread across all paragraphs
- source_id must match a source number above`;
}

// ==========================================================================
// MAIN HANDLER
// ==========================================================================
export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        const { context, style = 'Chicago', outputType = 'in-text', apiKey, googleKey, preLoadedSources } = req.body;
        const GROQ = apiKey || process.env.GROQ_API_KEY;
        const GKEY = googleKey || process.env.GOOGLE_SEARCH_API_KEY;
        const GCX = process.env.SEARCH_ENGINE_ID;

        // QUOTES MODE
        if (preLoadedSources?.length) {
            const srcList = preLoadedSources.map(s => 
                `[${s.id}] ${s.title}\nURL: ${s.link}\nContent: ${(s.content || '').substring(0, 500)}`
            ).join('\n\n');
            const prompt = `Extract verbatim quotes from each source.\n\nSOURCES:\n${srcList}\n\nFormat:\n**[ID] Title** - FULL_URL\n> "Exact quote..."`;
            
            let result = await GroqAPI.chat([{ role: 'user', content: prompt }], GROQ, false);
            
            // Fix truncated URLs
            preLoadedSources.forEach(s => {
                try {
                    const domain = new URL(s.link).hostname.replace('www.', '');
                    result = result.replace(new RegExp(`https?://${domain}/?(?![\\w/])`, 'gi'), s.link);
                } catch {}
            });
            
            return res.status(200).json({ success: true, text: result });
        }

        // SEARCH & SCRAPE
        const raw = await GoogleSearchAPI.search(context, GKEY, GCX, GROQ);
        const sources = await ScraperAPI.scrape(raw);

        // BIBLIOGRAPHY MODE
        if (outputType === 'bibliography') {
            const bibs = sources.map(s => {
                return (s.doi && s.meta?.isDOI)
                    ? DoiAPI.formatBib({ ...s.meta, doi: s.doi, title: s.title }, style)
                    : Format.bib(s, style);
            }).join('\n\n');
            return res.status(200).json({ success: true, sources, text: bibs });
        }

        // CITATION MODE - Get insertion points from Groq
        const prompt = buildInsertionPrompt(context, sources);
        const response = await GroqAPI.chat([{ role: 'user', content: prompt }], GROQ, true);
        
        let insertions = [];
        try {
            const json = response.match(/\{[\s\S]*\}/)?.[0];
            insertions = json ? JSON.parse(json).insertions || [] : [];
        } catch {}

        // Process insertions with proper formatting
        const result = processInsertions(context, insertions, sources, style, outputType);
        
        return res.status(200).json({ success: true, sources, text: result });

    } catch (error) {
        console.error('Citation Error:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
}
