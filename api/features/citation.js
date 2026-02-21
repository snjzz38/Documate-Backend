// api/features/citation.js
import { GoogleSearchAPI } from '../utils/googleSearch.js';
import { ScraperAPI } from '../utils/scraper.js';
import { GroqAPI } from '../utils/groqAPI.js';

const TODAY = () => new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

// ============ HELPERS ============
function getAuthor(source) {
    if (source.meta?.isDOI && source.meta?.authors?.length) {
        const a = source.meta.authors;
        if (a.length === 1) return a[0].family || 'Unknown';
        if (a.length === 2) return `${a[0].family} and ${a[1].family}`;
        return `${a[0].family} et al.`;
    }
    if (source.meta?.author) {
        const auth = String(source.meta.author);
        if (auth.includes(',')) return auth.split(',')[0].trim();
        const parts = auth.split(/\s+/);
        return parts.length > 1 ? parts[parts.length - 1] : auth;
    }
    const site = source.meta?.siteName || '';
    return site.replace(/\.(com|org|edu|net)$/i, '').replace(/^www\./, '').split('.')[0] || 'Unknown';
}

function getYear(source) {
    const y = source.meta?.year;
    return (y && /^\d{4}$/.test(y)) ? y : 'n.d.';
}

function formatInText(source, style) {
    const author = getAuthor(source);
    const year = getYear(source);
    const s = (style || '').toLowerCase();
    if (s.includes('mla')) return `(${author})`;
    if (s.includes('apa')) return `(${author}, ${year})`;
    return `(${author} ${year})`;
}

function formatBib(source, style) {
    const author = source.meta?.author || getAuthor(source);
    const year = getYear(source);
    const site = source.meta?.siteName || 'Unknown';
    const today = TODAY();
    const s = (style || '').toLowerCase();
    
    if (s.includes('apa')) return `${author}. (${year}). ${source.title}. *${site}*. ${source.link}`;
    if (s.includes('mla')) return `${author}. "${source.title}." *${site}*, ${year}, ${source.link}.`;
    return `${author}. "${source.title}." *${site}*. ${year}. ${source.link} (Accessed ${today})`;
}

// ============ PROCESS INSERTIONS ============
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
    const valid = [];
    for (const ins of insertions) {
        if (!ins.anchor || !ins.source_id) continue;
        const words = ins.anchor.toLowerCase().match(/[a-z0-9]+/g);
        if (!words || words.length < 2) continue;
        
        for (let i = 0; i <= tokens.length - words.length; i++) {
            if (words.every((w, j) => tokens[i + j].word === w)) {
                valid.push({ srcId: ins.source_id, pos: tokens[i + words.length - 1].end });
                break;
            }
        }
    }

    // Dedupe by position
    const byPos = new Map();
    valid.forEach(v => { if (!byPos.has(v.pos)) byPos.set(v.pos, v.srcId); });

    // Process
    const positions = [...byPos.keys()].sort((a, b) => a - b);
    const posData = new Map();

    positions.forEach(pos => {
        const src = sources.find(s => s.id === byPos.get(pos));
        if (!src) return;
        used.add(src.id);

        if (outputType === 'footnotes') {
            footnotes.push({ num: fnNum, cit: formatBib(src, style) });
            posData.set(pos, { fn: fnNum++ });
        } else {
            posData.set(pos, { cit: formatInText(src, style) });
        }
    });

    // Insert reverse
    const toSuper = n => String(n).split('').map(d => '⁰¹²³⁴⁵⁶⁷⁸⁹'[+d]).join('');
    [...positions].reverse().forEach(pos => {
        const d = posData.get(pos);
        const insert = d.fn ? toSuper(d.fn) : ` ${d.cit}`;
        result = result.slice(0, pos) + insert + result.slice(pos);
    });

    // Footer
    let footer = '\n\n';
    if (outputType === 'footnotes') {
        footer += '### Footnotes (Used)\n\n';
        footnotes.forEach(f => footer += `${f.num}. ${f.cit}\n\n`);
    } else {
        footer += '### References (Used)\n\n';
        sources.filter(s => used.has(s.id)).forEach(s => footer += formatBib(s, style) + '\n\n');
    }

    const unused = sources.filter(s => !used.has(s.id));
    if (unused.length) {
        footer += '\n### Further Reading (Unused)\n\n';
        unused.forEach(s => footer += formatBib(s, style) + '\n\n');
    }

    return result + footer;
}

// ============ HANDLER ============
export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        const { context, style = 'Chicago', outputType = 'in-text', apiKey, googleKey, preLoadedSources } = req.body || {};
        
        if (!context) {
            return res.status(400).json({ success: false, error: 'No context provided' });
        }

        const GROQ = apiKey || process.env.GROQ_API_KEY;
        const GKEY = googleKey || process.env.GOOGLE_SEARCH_API_KEY;
        const GCX = process.env.SEARCH_ENGINE_ID;

        // QUOTES MODE
        if (preLoadedSources?.length) {
            const srcList = preLoadedSources.map((s, i) => 
                `[${i + 1}] ${s.title}\nURL: ${s.link}\nContent: ${(s.content || s.snippet || '').substring(0, 1000)}`
            ).join('\n\n');
            
            const prompt = `Extract verbatim quotes from each source.\n\nSOURCES:\n${srcList}\n\nFormat:\n**[ID] Title** - URL\n> "Quote..."`;
            const result = await GroqAPI.chat([{ role: 'user', content: prompt }], GROQ, false);
            return res.status(200).json({ success: true, text: result });
        }

        // SEARCH
        console.log('[Citation] Starting search...');
        const raw = await GoogleSearchAPI.search(context, GKEY, GCX, GROQ);
        console.log('[Citation] Search results:', raw?.length || 0);
        
        if (!raw || !raw.length) {
            return res.status(200).json({ 
                success: false, 
                error: 'No search results. Check Google API key and Search Engine ID.',
                debug: { hasGoogleKey: !!GKEY, hasCX: !!GCX, hasGroq: !!GROQ }
            });
        }

        // SCRAPE
        console.log('[Citation] Starting scrape...');
        const sources = await ScraperAPI.scrape(raw);
        console.log('[Citation] Scraped sources:', sources?.length || 0);

        // BIBLIOGRAPHY MODE
        if (outputType === 'bibliography') {
            const bibs = sources.map(s => formatBib(s, style)).join('\n\n');
            return res.status(200).json({ success: true, sources, text: bibs });
        }

        // CITATION MODE
        const srcList = sources.map(s => `[${s.id}] ${getAuthor(s)} (${getYear(s)}) - ${s.title.substring(0, 40)}`).join('\n');
        const prompt = `Find citation points.\n\nSOURCES:\n${srcList}\n\nTEXT:\n"${context}"\n\nReturn JSON: {"insertions":[{"anchor":"3-5 exact words","source_id":1}]}`;
        
        const response = await GroqAPI.chat([{ role: 'user', content: prompt }], GROQ, true);
        
        let insertions = [];
        try {
            const json = response.match(/\{[\s\S]*\}/)?.[0];
            if (json) insertions = JSON.parse(json).insertions || [];
        } catch {}

        const result = processInsertions(context, insertions, sources, style, outputType);
        return res.status(200).json({ success: true, sources, text: result });

    } catch (error) {
        console.error('Citation Error:', error);
        return res.status(500).json({ success: false, error: error.message || 'Unknown error' });
    }
}
