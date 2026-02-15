// api/features/citation.js - Simplified Citation Handler
import { GoogleSearchAPI } from '../utils/googleSearch.js';
import { ScraperAPI } from '../utils/scraper.js';
import { GroqAPI } from '../utils/groqAPI.js';
import { DoiAPI } from '../utils/doiAPI.js';

// ==========================================================================
// CITATION PROCESSOR
// ==========================================================================
const Processor = {
    today: () => new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
    
    getYear(source) {
        if (source.meta?.year && source.meta.year !== 'n.d.') return source.meta.year;
        const match = (source.content || '').match(/\b(20\d{2})\b/);
        return match ? match[1] : 'n.d.';
    },

    getSite(source) {
        return source.meta?.siteName || new URL(source.link).hostname.replace('www.', '');
    },

    getAuthor(source) {
        if (source.meta?.author && source.meta.author !== 'Unknown') return source.meta.author;
        return this.getSite(source);
    },

    formatCitation(source, style) {
        // Use DOI formatting if available
        if (source.doi && source.meta?.isVerified) {
            const doiMeta = {
                doi: source.doi,
                title: source.title,
                authors: source.meta.allAuthors?.map(n => ({ full: n, family: n.split(' ').pop(), given: n.split(' ').slice(0, -1).join(' ') })),
                year: source.meta.year,
                journal: source.meta.siteName
            };
            return DoiAPI.format(doiMeta, style);
        }

        const author = this.getAuthor(source);
        const year = this.getYear(source);
        const site = this.getSite(source);
        const today = this.today();
        const s = (style || '').toLowerCase();

        if (s.includes('apa')) return `${author}. (${year}). ${source.title}. *${site}*. ${source.link}`;
        if (s.includes('mla')) return `${author}. "${source.title}." *${site}*, ${year}, ${source.link}.`;
        return `${author}. "${source.title}." *${site}*. ${year}. ${source.link} (Accessed ${today})`;
    },

    formatInText(source, style) {
        const author = this.getAuthor(source).split(',')[0].split(' ')[0]; // First author last name
        const year = this.getYear(source);
        const s = (style || '').toLowerCase();
        
        if (s.includes('apa')) return `(${author}, ${year})`;
        if (s.includes('mla')) return `(${author})`;
        return `(${author} ${year})`;
    },

    processInsertions(text, insertions, sources, citations, outputType, style) {
        let result = text;
        const used = new Set();
        const footnotes = [];
        let fnNum = 1;

        // Build token map for anchor matching
        const tokens = [];
        let m;
        const re = /[a-z0-9]+/gi;
        while ((m = re.exec(text)) !== null) {
            tokens.push({ word: m[0].toLowerCase(), end: m.index + m[0].length });
        }

        // Find insertion positions
        const valid = (insertions || []).map(ins => {
            if (!ins.anchor || !ins.source_id) return null;
            const words = ins.anchor.toLowerCase().match(/[a-z0-9]+/g);
            if (!words) return null;

            for (let i = 0; i <= tokens.length - words.length; i++) {
                let match = true;
                for (let j = 0; j < words.length; j++) {
                    if (tokens[i + j].word !== words[j]) { match = false; break; }
                }
                if (match) return { ...ins, pos: tokens[i + words.length - 1].end };
            }
            return null;
        }).filter(Boolean);

        // Deduplicate by position
        const byPos = new Map();
        for (const v of valid) {
            if (!byPos.has(v.pos) || !byPos.get(v.pos).has(v.source_id)) {
                if (!byPos.has(v.pos)) byPos.set(v.pos, new Set());
                if (byPos.get(v.pos).size < 2) {
                    byPos.get(v.pos).add(v.source_id);
                }
            }
        }

        // Sort positions ascending for sequential footnote numbering
        const positions = [...byPos.keys()].sort((a, b) => a - b);
        const posToFn = new Map();

        // Assign footnote numbers in order of appearance
        for (const pos of positions) {
            const srcIds = [...byPos.get(pos)];
            for (const srcId of srcIds) {
                const source = sources.find(s => s.id === srcId);
                if (!source) continue;
                used.add(srcId);
                
                if (outputType === 'footnotes') {
                    const cit = citations[srcId] || this.formatCitation(source, style);
                    footnotes.push({ num: fnNum, cit });
                    if (!posToFn.has(pos)) posToFn.set(pos, []);
                    posToFn.get(pos).push(fnNum);
                    fnNum++;
                }
            }
        }

        // Insert citations (reverse order to preserve positions)
        const superscripts = '⁰¹²³⁴⁵⁶⁷⁸⁹';
        const toSuper = n => n.toString().split('').map(d => superscripts[+d]).join('');

        for (const pos of [...positions].reverse()) {
            let insert = '';
            if (outputType === 'footnotes') {
                insert = (posToFn.get(pos) || []).map(toSuper).join('');
            } else {
                const srcIds = [...byPos.get(pos)];
                const cits = srcIds.map(id => {
                    const src = sources.find(s => s.id === id);
                    return src ? this.formatInText(src, style).replace(/^\(|\)$/g, '') : null;
                }).filter(Boolean);
                if (cits.length) insert = ` (${cits.join('; ')})`;
            }
            result = result.slice(0, pos) + insert + result.slice(pos);
        }

        // Build footer
        let footer = '\n\n';
        if (outputType === 'footnotes') {
            footer += '### Footnotes (Used)\n\n';
            footnotes.forEach(f => { footer += `${f.num}. ${f.cit}\n\n`; });
        } else {
            footer += '### References (Used)\n\n';
            sources.filter(s => used.has(s.id)).forEach(s => {
                footer += (citations[s.id] || this.formatCitation(s, style)) + '\n\n';
            });
        }

        // Unused sources
        const unused = sources.filter(s => !used.has(s.id));
        if (unused.length) {
            footer += '\n### Further Reading (Unused)\n\n';
            unused.forEach(s => { footer += (citations[s.id] || this.formatCitation(s, style)) + '\n\n'; });
        }

        return result + footer;
    }
};

// ==========================================================================
// PROMPT BUILDER (Simplified)
// ==========================================================================
const Prompts = {
    citations(style, sources) {
        const today = Processor.today();
        const srcList = sources.map(s => {
            const author = s.meta?.author || s.meta?.siteName || 'Unknown';
            return `[${s.id}] ${s.title} | Author: ${author} | Year: ${s.meta?.year || 'n.d.'} | URL: ${s.link}`;
        }).join('\n');

        return `Generate ${style} bibliography entries for these sources.
Return JSON only: { "1": "citation", "2": "citation", ... }

SOURCES:
${srcList}

Rules:
- Never use "Unknown" as author - use site name instead
- Include (Accessed ${today}) at end
- Use proper ${style} formatting`;
    },

    insertions(outputType, style, text, sources) {
        const srcList = sources.map(s => {
            const author = s.meta?.author || s.meta?.siteName || 'Unknown';
            return `[${s.id}] ${author} (${s.meta?.year || 'n.d.'}) - ${s.title.substring(0, 50)}`;
        }).join('\n');

        const format = style.toLowerCase().includes('apa') ? '(Author, Year)' :
                      style.toLowerCase().includes('mla') ? '(Author)' : '(Author Year)';

        return `Find citation insertion points in this text.

SOURCES:
${srcList}

TEXT:
"${text}"

Rules:
- Use 8+ different sources
- Create 10+ insertions spread across all paragraphs
- Each anchor: 3-6 exact words from text
- Format: ${format}
- Never use "Unknown" - use site name

Return JSON only:
{ "insertions": [{ "anchor": "exact phrase", "source_id": 1, "citation_text": "${format}" }] }`;
    },

    quotes(text, sources) {
        const srcList = sources.map(s => `[${s.id}] ${s.title}\nURL: ${s.link}\nContent: ${(s.content || '').substring(0, 600)}...`).join('\n\n');

        return `Extract verbatim quotes from each source.

CONTEXT: "${text.substring(0, 400)}..."

SOURCES:
${srcList}

Output format:
**[ID] Title** - FULL_URL
> "Exact quote from source..."

Rules:
- Use FULL URL, not just domain
- Copy text VERBATIM
- 2-5 sentences per quote`;
    }
};

// ==========================================================================
// MAIN HANDLER
// ==========================================================================
export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        const { context, style = 'Chicago', outputType = 'in-text', apiKey, googleKey, preLoadedSources } = req.body;
        const GROQ_KEY = apiKey || process.env.GROQ_API_KEY;
        const SEARCH_KEY = googleKey || process.env.GOOGLE_SEARCH_API_KEY;
        const SEARCH_CX = process.env.SEARCH_ENGINE_ID;

        // QUOTES MODE
        if (preLoadedSources?.length > 0) {
            const prompt = Prompts.quotes(context, preLoadedSources);
            let result = await GroqAPI.chat([{ role: 'user', content: prompt }], GROQ_KEY, false);
            
            // Fix URLs in output
            for (const s of preLoadedSources) {
                const domain = new URL(s.link).hostname.replace('www.', '');
                result = result.replace(new RegExp(`https?://${domain}/?(?![\\w/])`, 'gi'), s.link);
            }
            
            return res.status(200).json({ success: true, text: result });
        }

        // SEARCH & SCRAPE
        const rawSources = await GoogleSearchAPI.search(context, SEARCH_KEY, SEARCH_CX, GROQ_KEY);
        const sources = await ScraperAPI.scrape(rawSources);

        // BIBLIOGRAPHY MODE
        if (outputType === 'bibliography') {
            const prompt = Prompts.citations(style, sources);
            const result = await GroqAPI.chat([{ role: 'user', content: prompt }], GROQ_KEY, true);
            return res.status(200).json({ success: true, sources, text: result.replace(/```json|```/g, '').trim() });
        }

        // CITATION MODE (2-step)
        // Step 1: Generate formatted citations
        const step1 = await GroqAPI.chat([{ role: 'user', content: Prompts.citations(style, sources) }], GROQ_KEY, true);
        let citations = {};
        try {
            const json = step1.match(/\{[\s\S]*\}/)?.[0];
            citations = json ? JSON.parse(json) : {};
        } catch { /* use fallbacks */ }

        // Step 2: Find insertion points
        const step2 = await GroqAPI.chat([{ role: 'user', content: Prompts.insertions(outputType, style, context, sources) }], GROQ_KEY, true);
        let insertions = [];
        try {
            const json = step2.match(/\{[\s\S]*\}/)?.[0];
            insertions = json ? JSON.parse(json).insertions || [] : [];
        } catch { /* no insertions */ }

        const result = Processor.processInsertions(context, insertions, sources, citations, outputType, style);
        return res.status(200).json({ success: true, sources, text: result });

    } catch (error) {
        console.error('Citation Error:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
}
