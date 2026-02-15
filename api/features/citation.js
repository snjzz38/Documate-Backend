// api/features/citation.js
import { GoogleSearchAPI } from '../utils/googleSearch.js';
import { ScraperAPI } from '../utils/scraper.js';
import { GroqAPI } from '../utils/groqAPI.js';
import { DoiAPI } from '../utils/doiAPI.js';

const TODAY = () => new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

// Simple citation formatter for non-DOI sources
const Format = {
    bib(source, style) {
        const s = (style || '').toLowerCase();
        const author = source.meta?.author || source.meta?.siteName || 'Unknown';
        const year = source.meta?.year || 'n.d.';
        const site = source.meta?.siteName || 'Unknown';
        const today = TODAY();

        if (s.includes('apa')) {
            return `${author}. (${year}). ${source.title}. *${site}*. ${source.link}`;
        }
        if (s.includes('mla')) {
            return `${author}. "${source.title}." *${site}*, ${year}, ${source.link}.`;
        }
        return `${author}. "${source.title}." *${site}*. ${year}. ${source.link} (Accessed ${today})`;
    },

    inText(source, style) {
        const s = (style || '').toLowerCase();
        const author = (source.meta?.author || source.meta?.siteName || 'Unknown').split(/[,\s]/)[0];
        const year = source.meta?.year || 'n.d.';

        if (s.includes('apa')) return `(${author}, ${year})`;
        if (s.includes('mla')) return `(${author})`;
        return `(${author} ${year})`;
    }
};

// Process insertions into text
function processInsertions(text, insertions, sources, style, outputType) {
    let result = text;
    const used = new Set();
    const footnotes = [];
    let fnNum = 1;

    // Tokenize
    const tokens = [];
    const re = /[a-z0-9]+/gi;
    let m;
    while ((m = re.exec(text))) tokens.push({ word: m[0].toLowerCase(), end: m.index + m[0].length });

    // Find positions
    const valid = insertions.map(ins => {
        if (!ins.anchor || !ins.source_id) return null;
        const words = ins.anchor.toLowerCase().match(/[a-z0-9]+/g);
        if (!words) return null;
        for (let i = 0; i <= tokens.length - words.length; i++) {
            if (words.every((w, j) => tokens[i + j].word === w)) {
                return { ...ins, pos: tokens[i + words.length - 1].end };
            }
        }
        return null;
    }).filter(Boolean);

    // Dedupe positions
    const byPos = new Map();
    valid.forEach(v => {
        if (!byPos.has(v.pos)) byPos.set(v.pos, new Set());
        if (byPos.get(v.pos).size < 1) byPos.get(v.pos).add(v.source_id);
    });

    // Process in text order
    const positions = [...byPos.keys()].sort((a, b) => a - b);
    const posToFn = new Map();

    positions.forEach(pos => {
        byPos.get(pos).forEach(srcId => {
            const src = sources.find(s => s.id === srcId);
            if (!src) return;
            used.add(srcId);

            if (outputType === 'footnotes') {
                // Get citation - DOI formats itself, else use Format
                const cit = src.doi 
                    ? DoiAPI.formatBib({ ...src.meta, doi: src.doi, title: src.title }, style)
                    : Format.bib(src, style);
                
                footnotes.push({ num: fnNum, cit });
                if (!posToFn.has(pos)) posToFn.set(pos, []);
                posToFn.get(pos).push(fnNum);
                fnNum++;
            }
        });
    });

    // Insert (reverse order)
    const toSuper = n => n.toString().split('').map(d => '⁰¹²³⁴⁵⁶⁷⁸⁹'[+d]).join('');
    
    [...positions].reverse().forEach(pos => {
        let insert = '';
        if (outputType === 'footnotes') {
            insert = (posToFn.get(pos) || []).map(toSuper).join('');
        } else {
            const cits = [...byPos.get(pos)].map(id => {
                const src = sources.find(s => s.id === id);
                if (!src) return null;
                // DOI formats itself, else use Format
                const inText = src.doi 
                    ? DoiAPI.formatInText({ authors: src.meta.authors, year: src.meta.year }, style)
                    : Format.inText(src, style);
                return inText?.replace(/^\(|\)$/g, '');
            }).filter(Boolean);
            if (cits.length) insert = ` (${cits.join('; ')})`;
        }
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
            const cit = s.doi 
                ? DoiAPI.formatBib({ ...s.meta, doi: s.doi, title: s.title }, style)
                : Format.bib(s, style);
            footer += cit + '\n\n';
        });
    }

    const unused = sources.filter(s => !used.has(s.id));
    if (unused.length) {
        footer += '\n### Further Reading (Unused)\n\n';
        unused.forEach(s => {
            const cit = s.doi 
                ? DoiAPI.formatBib({ ...s.meta, doi: s.doi, title: s.title }, style)
                : Format.bib(s, style);
            footer += cit + '\n\n';
        });
    }

    return result + footer;
}

// Build prompt for Groq (only non-DOI sources need AI formatting)
function buildPrompt(style, text, sources) {
    const nonDoi = sources.filter(s => !s.doi);
    const srcList = sources.map(s => {
        const author = s.doi ? s.meta.authors?.map(a => `${a.given} ${a.family}`).join(', ') : (s.meta?.author || s.meta?.siteName);
        return `[${s.id}] ${author || 'Unknown'} (${s.meta?.year || 'n.d.'}) - ${s.title.substring(0, 40)}...`;
    }).join('\n');

    return `Find citation points in this text. Use 8+ sources, 10+ insertions.

SOURCES:
${srcList}

TEXT:
"${text}"

Return JSON: {"insertions":[{"anchor":"3-5 exact words","source_id":1,"citation_text":"(Author Year)"}]}`;
}

// Main handler
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

        // Quotes mode
        if (preLoadedSources?.length) {
            const srcList = preLoadedSources.map(s => `[${s.id}] ${s.title}\nURL: ${s.link}\nContent: ${(s.content || '').substring(0, 500)}`).join('\n\n');
            const prompt = `Extract verbatim quotes. Use FULL URLs.\n\nSOURCES:\n${srcList}\n\nFormat:\n**[ID] Title** - FULL_URL\n> "Quote..."`;
            let result = await GroqAPI.chat([{ role: 'user', content: prompt }], GROQ, false);
            // Fix URLs
            preLoadedSources.forEach(s => {
                const domain = new URL(s.link).hostname.replace('www.', '');
                result = result.replace(new RegExp(`https?://${domain}/?(?![\\w/])`, 'gi'), s.link);
            });
            return res.status(200).json({ success: true, text: result });
        }

        // Search & scrape
        const raw = await GoogleSearchAPI.search(context, GKEY, GCX, GROQ);
        const sources = await ScraperAPI.scrape(raw);

        // Bibliography mode
        if (outputType === 'bibliography') {
            const bibs = sources.map(s => {
                return s.doi 
                    ? DoiAPI.formatBib({ ...s.meta, doi: s.doi, title: s.title }, style)
                    : Format.bib(s, style);
            }).join('\n\n');
            return res.status(200).json({ success: true, sources, text: bibs });
        }

        // Citation mode - get insertions from Groq
        const prompt = buildPrompt(style, context, sources);
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
