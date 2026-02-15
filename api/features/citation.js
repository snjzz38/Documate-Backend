// api/features/citation.js
import { GoogleSearchAPI } from '../utils/googleSearch.js';
import { ScraperAPI } from '../utils/scraper.js';
import { GroqAPI } from '../utils/groqAPI.js';
import { DoiAPI } from '../utils/doiAPI.js';

const TODAY = () => new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

// ==========================================================================
// CITATION FORMATTER
// ==========================================================================
function getAuthorName(source) {
    // DOI source with structured authors
    if (source.meta?.isDOI && source.meta?.authors?.length > 0) {
        const authors = source.meta.authors;
        if (authors.length === 1) return authors[0].family || authors[0].given || 'Unknown';
        if (authors.length === 2) return `${authors[0].family} and ${authors[1].family}`;
        return `${authors[0].family} et al.`;
    }
    
    // Non-DOI: check scraped author
    if (source.meta?.author) {
        let auth = String(source.meta.author).trim();
        
        // Skip junk authors
        if (auth.includes('→') || auth.includes('View all') || auth.length < 2) {
            return cleanSiteName(source.meta?.siteName || source.title);
        }
        
        // "Last, First" format
        if (auth.includes(',')) {
            return auth.split(',')[0].trim();
        }
        
        // Get last name if multiple words
        const parts = auth.split(/\s+/).filter(p => p.length > 1);
        if (parts.length >= 2) {
            return parts[parts.length - 1];
        }
        
        return auth;
    }
    
    // Fallback: use site name
    return cleanSiteName(source.meta?.siteName || source.title || 'Unknown');
}

function cleanSiteName(site) {
    if (!site) return 'Unknown';
    return String(site)
        .replace(/^www\./, '')
        .replace(/\.(com|org|edu|net|gov|io)$/i, '')
        .replace(/[→\-–|]/g, ' ')
        .split(/[.\s]/)[0]
        .trim()
        .replace(/^(\w)/, c => c.toUpperCase()) || 'Unknown';
}

function getYear(source) {
    const y = source.meta?.year;
    if (y && y !== 'n.d.' && /^\d{4}$/.test(String(y))) {
        return String(y);
    }
    return 'n.d.';
}

// Format in-text citation: (Author Year)
function formatInText(source, style) {
    const author = getAuthorName(source);
    const year = getYear(source);
    const s = String(style || 'chicago').toLowerCase();
    
    // MLA doesn't use year
    if (s.includes('mla')) {
        return `(${author})`;
    }
    
    // APA uses comma
    if (s.includes('apa')) {
        return `(${author}, ${year})`;
    }
    
    // Chicago - ALWAYS include year
    return `(${author} ${year})`;
}

// Format bibliography entry
function formatBib(source, style) {
    const s = String(style || 'chicago').toLowerCase();
    const year = getYear(source);
    const site = source.meta?.siteName || 'Unknown';
    const today = TODAY();
    
    // Get full author for bibliography
    let author;
    if (source.meta?.isDOI && source.meta?.authors?.length > 0) {
        const authors = source.meta.authors;
        if (authors.length === 1) {
            author = `${authors[0].family}, ${authors[0].given}`;
        } else if (authors.length === 2) {
            author = `${authors[0].family}, ${authors[0].given}, and ${authors[1].given} ${authors[1].family}`;
        } else {
            author = `${authors[0].family}, ${authors[0].given}, et al.`;
        }
    } else if (source.meta?.author && !source.meta.author.includes('→')) {
        author = source.meta.author;
    } else {
        author = cleanSiteName(site);
    }

    const url = source.doi ? `https://doi.org/${source.doi}` : source.link;

    if (s.includes('apa')) {
        return `${author}. (${year}). ${source.title}. *${site}*. ${url}`;
    }
    if (s.includes('mla')) {
        return `${author}. "${source.title}." *${site}*, ${year}, ${url}.`;
    }
    return `${author}. "${source.title}." *${site}*. ${year}. ${url} (Accessed ${today})`;
}

// ==========================================================================
// PROCESS INSERTIONS
// ==========================================================================
function processInsertions(text, insertions, sources, style, outputType) {
    let result = text;
    const used = new Set();
    const footnotes = [];
    let fnNum = 1;

    // Tokenize
    const tokens = [];
    const re = /[a-z0-9]+/gi;
    let m;
    while ((m = re.exec(text))) {
        tokens.push({ word: m[0].toLowerCase(), end: m.index + m[0].length });
    }

    // Find positions
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

    // Dedupe
    const byPos = new Map();
    valid.forEach(v => {
        if (!byPos.has(v.pos)) byPos.set(v.pos, v.sourceId);
    });

    // Build citations
    const positions = [...byPos.keys()].sort((a, b) => a - b);
    const posData = new Map();

    positions.forEach(pos => {
        const src = sources.find(s => s.id === byPos.get(pos));
        if (!src) return;
        used.add(src.id);

        if (outputType === 'footnotes') {
            footnotes.push({ num: fnNum, cit: formatBib(src, style) });
            posData.set(pos, { type: 'fn', num: fnNum++ });
        } else {
            // IN-TEXT: Use formatInText which includes year
            const citation = formatInText(src, style);
            posData.set(pos, { type: 'it', cit: citation });
        }
    });

    // Insert (reverse)
    const toSuper = n => n.toString().split('').map(d => '⁰¹²³⁴⁵⁶⁷⁸⁹'[+d]).join('');
    
    [...positions].reverse().forEach(pos => {
        const d = posData.get(pos);
        if (!d) return;
        const insert = d.type === 'fn' ? toSuper(d.num) : ` ${d.cit}`;
        result = result.slice(0, pos) + insert + result.slice(pos);
    });

    // Footer
    let footer = '\n\n';
    if (outputType === 'footnotes') {
        footer += '### Footnotes (Used)\n\n';
        footnotes.forEach(f => footer += `${f.num}. ${f.cit}\n\n`);
    } else {
        footer += '### References (Used)\n\n';
        sources.filter(s => used.has(s.id)).forEach(s => {
            footer += formatBib(s, style) + '\n\n';
        });
    }

    const unused = sources.filter(s => !used.has(s.id));
    if (unused.length) {
        footer += '\n### Further Reading (Unused)\n\n';
        unused.forEach(s => footer += formatBib(s, style) + '\n\n');
    }

    return result + footer;
}

// ==========================================================================
// PROMPT FOR GROQ
// ==========================================================================
function buildPrompt(text, sources, style) {
    const srcList = sources.map(s => {
        const author = getAuthorName(s);
        const year = getYear(s);
        return `[${s.id}] ${author} (${year}) - ${s.title.substring(0, 50)}`;
    }).join('\n');

    return `Find citation insertion points in this text.

SOURCES (use 8+ of these):
${srcList}

TEXT:
"${text}"

Return ONLY JSON:
{"insertions":[{"anchor":"3-6 exact words from text","source_id":1}]}

Rules:
- anchor = exact consecutive words from text
- 10+ insertions across all paragraphs
- source_id = number from list above`;
}

// ==========================================================================
// HANDLER
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
                `[${s.id}] ${s.title}\nURL: ${s.link}\nContent: ${(s.content || '').substring(0, 600)}`
            ).join('\n\n');
            const prompt = `Extract verbatim quotes.\n\nSOURCES:\n${srcList}\n\nFormat:\n**[ID] Title** - FULL_URL\n> "Exact quote..."`;
            
            let result = await GroqAPI.chat([{ role: 'user', content: prompt }], GROQ, false);
            
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
            const bibs = sources.map(s => formatBib(s, style)).join('\n\n');
            return res.status(200).json({ success: true, sources, text: bibs });
        }

        // CITATION MODE
        const prompt = buildPrompt(context, sources, style);
        const response = await GroqAPI.chat([{ role: 'user', content: prompt }], GROQ, true);
        
        let insertions = [];
        try {
            const json = response.match(/\{[\s\S]*\}/)?.[0];
            insertions = json ? JSON.parse(json).insertions || [] : [];
        } catch {}

        const result = processInsertions(context, insertions, sources, style, outputType);
        return res.status(200).json({ success: true, sources, text: result });

    } catch (error) {
        console.error('Citation Error:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
}
