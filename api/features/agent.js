// api/features/agent.js - Agent Mode
// FLOW: RESEARCH → QUOTES → WRITE → HUMANIZE → INSERT_CITATIONS → GRADE → CITE

import { GeminiAPI } from '../utils/geminiAPI.js';
import { GroqAPI } from '../utils/groqAPI.js';
import { GoogleSearchAPI } from '../utils/googleSearch.js';
import { ScraperAPI } from '../utils/scraper.js';


// Helpers
async function vision(prompt, files, key) {
    const imgs = files.filter(f => f.type?.startsWith('image/') && f.data);
    if (!imgs.length) return 'No image provided. Please describe your assignment.';
    
    for (const model of ['gemini-2.0-flash', 'gemini-1.5-flash']) {
        try {
            const parts = [{ text: prompt }, ...imgs.map(f => ({
                inline_data: { mime_type: f.type, data: f.data.includes(',') ? f.data.split(',')[1] : f.data }
            }))];
            const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ contents: [{ parts }], generationConfig: { temperature: 0.4, maxOutputTokens: 4096 } })
            });
            const data = await res.json();
            if (data.candidates?.[0]?.content?.parts?.[0]?.text) return data.candidates[0].content.parts[0].text;
        } catch (e) { console.log(`[Agent] Vision ${model}:`, e.message); }
    }
    return 'Could not read image. Please describe your assignment.';
}

const cleanSite = s => {
    if (!s) return 'Unknown';
    const n = s.replace(/^(www\.|https?:\/\/)/i, '').split(/[\/\?#\.]/)[0].toLowerCase();
    return { pmc: 'NIH', ncbi: 'NIH', arxiv: 'arXiv', noaa: 'NOAA', nasa: 'NASA', pubmed: 'PubMed' }[n] || n.charAt(0).toUpperCase() + n.slice(1);
};

const getAuthor = src => (src.author?.length > 2 ? src.author : src.displayName || cleanSite(src.site));

const stripRefs = text => [/\n\n\*?\*?(?:References|Works Cited|Bibliography|Sources)\*?\*?[\s\S]*$/i, /\n\n#{1,3}\s*(?:References|Works Cited)[\s\S]*$/i]
    .reduce((t, p) => t.replace(p, ''), text).trim();

const stripMarkdown = text => text
    .replace(/\*\*([^*]+)\*\*/g, '$1')  // **bold**
    .replace(/\*([^*]+)\*/g, '$1')       // *italic*
    .replace(/__([^_]+)__/g, '$1')       // __bold__
    .replace(/_([^_]+)_/g, '$1')         // _italic_
    .replace(/^#{1,6}\s*/gm, '')         // # headings
    .replace(/`([^`]+)`/g, '$1')         // `code`
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1'); // [link](url)

const extractTopic = text => {
    for (const p of [/(?:topic|about|write about|essay on)[:\s]+["']?([^"'\n.!?]{10,80})["']?/i, /(?:designer babies|gene editing|CRISPR|climate change)/i, /(?:ethics of|effects of)\s+([^.!?\n]{5,50})/i]) {
        const m = text.match(p); if (m) return m[1] || m[0];
    }
    const skip = new Set(['write','essay','paragraph','summary','discuss','explain','citations','please','about','using']);
    return (text.toLowerCase().match(/\b[a-z]{4,}\b/g) || []).filter(w => !skip.has(w)).slice(0, 5).join(' ') || text.substring(0, 80);
};

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        const { action, task, options = {} } = req.body;
        const GEMINI = process.env.GEMINI_API_KEY, GROQ = process.env.GROQ_API_KEY;

        if (action === 'plan') {
            const steps = [{ tool: 'RESEARCH', action: 'Search and gather information' }];
            if (options.enableQuotes) steps.push({ tool: 'QUOTES', action: 'Extract quotes' });
            if (options.enableWrite !== false) steps.push({ tool: 'WRITE', action: 'Generate content' });
            if (options.enableHumanize) steps.push({ tool: 'HUMANIZE', action: 'Make natural' });
            if (options.enableCite && options.citationType !== 'bibliography') steps.push({ tool: 'INSERT_CITATIONS', action: 'Insert citations' });
            if (options.enableGrade) steps.push({ tool: 'GRADE', action: 'Check quality' });
            if (options.enableCite) steps.push({ tool: 'CITE', action: `Format ${{ mla9: 'MLA', apa7: 'APA', chicago: 'Chicago' }[options.citationStyle] || 'MLA'} ${options.citationType || 'bibliography'}` });
            return res.status(200).json({ success: true, plan: { understanding: task.substring(0, 150), steps } });
        }

        if (action === 'execute_step') {
            const { step, context = {}, options = {} } = req.body;
            let result = { success: true, output: '', type: 'text' };

            switch (step.tool.toUpperCase()) {
                case 'RESEARCH': {
                    let instructions = '';
                    if (options.files?.some(f => f.type?.startsWith('image/')))
                        instructions = await vision('Extract: 1) Main TOPIC 2) Required FORMAT/sections 3) Citation needs. TOPIC on first line.', options.files, GEMINI);
                    const query = extractTopic(instructions + ' ' + (context.task || ''));
                    console.log('[Agent] Query:', query);
                    
                    if (!GoogleSearchAPI || typeof GoogleSearchAPI.search !== 'function') {
                        throw new Error('GoogleSearchAPI not available. Check googleSearch.js import.');
                    }
                    
                    const results = await GoogleSearchAPI.search(query, null, null, GROQ);
                    if (!results?.length) { result.output = { text: '', sources: [], instructions }; result.type = 'research'; break; }
                    
                    const scraped = await ScraperAPI.scrape(results.slice(0, 10));
                    const sources = [], texts = [];
                    for (const s of scraped) {
                        const txt = s.text || s.content || s.snippet || '';
                        if (txt.length > 100) {
                            const site = cleanSite(s.meta?.siteName || s.link), name = s.meta?.author || site;
                            texts.push(`[${name}, ${s.meta?.year || 'n.d.'}]\n${txt.substring(0, 2000)}`);
                            sources.push({ id: sources.length + 1, title: s.title, url: s.link, site, author: s.meta?.author, year: s.meta?.year || 'n.d.', displayName: name, text: txt.substring(0, 2000) });
                        }
                    }
                    result.output = { text: texts.join('\n\n'), sources, instructions }; result.type = 'research'; break;
                }

                case 'QUOTES': {
                    const src = context.researchSources || [];
                    if (!src.length) { result.output = []; result.type = 'quotes'; break; }
                    const resp = await GeminiAPI.chat(`Extract 3-5 quotes.\nFORMAT: Source: "quote"\n\n${src.slice(0,5).map(s => `--- ${s.displayName} ---\n${s.text?.substring(0,1200)}`).join('\n\n')}`, GEMINI);
                    result.output = resp.split('\n').map(l => l.match(/^([^:]+):\s*"([^"]+)"/)).filter(Boolean).map(m => ({ source: m[1].trim(), quote: m[2].trim() }));
                    result.type = 'quotes'; break;
                }

                case 'WRITE': {
                    const { researchData = {}, extractedQuotes = [], task } = context;
                    const prompt = `Expert writer. Follow format exactly. Use HEADINGS not tables.

TASK: ${task}${researchData.instructions ? `\nINSTRUCTIONS:\n${researchData.instructions}` : ''}
RESEARCH:\n${researchData.text?.substring(0, 8000) || ''}${extractedQuotes.length ? `\nQUOTES:\n${extractedQuotes.map((q,i) => `${i+1}. ${q.source}: "${q.quote}"`).join('\n')}` : ''}

RULES:
1. Follow structure, formal tone, NO bibliography
2. Include quotes with attribution
3. OUTPUT PLAIN TEXT ONLY - no markdown, no asterisks, no bold, no italics, no special formatting
4. Use simple headings like "Arguments For" not "**Arguments For**" or "### Arguments For"`;
                    result.output = stripMarkdown(stripRefs(await GeminiAPI.chat(prompt, GEMINI))); result.type = 'text'; break;
                }

                case 'HUMANIZE': {
                    const text = context.previousOutput || '';
                    if (text.length < 50) throw new Error('No text');
                    let output = await GeminiAPI.chat(`Rewrite naturally. Keep structure, preserve quotes, NO references section.

OUTPUT PLAIN TEXT ONLY - no markdown, no asterisks, no bold, no italics, no special characters like * or #.

TEXT:\n${text}`, GEMINI);
                    result.output = stripMarkdown(stripRefs(output));
                    result.type = 'text'; break;
                }

                case 'INSERT_CITATIONS': {
                    const text = context.previousOutput || '', sources = context.researchSources || [];
                    const style = options.citationStyle || 'apa7', type = options.citationType || 'in-text';
                    if (!text || !sources.length) { result.output = text; result.type = 'text'; break; }
                    
                    try {
                        const resp = await GroqAPI.chat([{ role: 'user', content: `Insert citations.\nSOURCES:\n${sources.map(s => `[${s.id}] ${getAuthor(s)} (${s.year})`).join('\n')}\n\nTEXT:\n"${text.substring(0,5000)}"\n\nJSON: {"insertions":[{"anchor":"3-5 words","source_id":1}]}` }], GROQ, false);
                        const json = resp.match(/\{[\s\S]*\}/);
                        if (json) {
                            const ins = JSON.parse(json[0]).insertions || [];
                            let cited = text;
                            const toSuper = n => n.toString().split('').map(d => '⁰¹²³⁴⁵⁶⁷⁸⁹'[+d]).join('');
                            const pos = [];
                            let fn = 1;
                            for (const i of ins) {
                                if (!i.anchor) continue;
                                const p = cited.toLowerCase().indexOf(i.anchor.toLowerCase());
                                if (p === -1) continue;
                                const s = sources.find(x => x.id === i.source_id);
                                if (!s) continue;
                                const a = getAuthor(s);
                                const cit = type === 'footnotes' ? toSuper(fn++) : style.includes('apa') ? ` (${a}, ${s.year})` : style.includes('mla') ? ` (${a})` : ` (${a} ${s.year})`;
                                pos.push({ p: p + i.anchor.length, cit, src: s });
                            }
                            pos.sort((a, b) => b.p - a.p).forEach(x => cited = cited.slice(0, x.p) + x.cit + cited.slice(x.p));
                            result.output = cited; result.citedSources = pos.map(x => x.src);
                        } else result.output = text;
                    } catch { result.output = text; }
                    result.type = 'text'; break;
                }

                case 'GRADE': {
                    const text = context.previousOutput || '', inst = context.researchData?.instructions || context.task || '';
                    if (text.length < 50) { result.output = { grade: 'N/A', feedback: 'No content' }; result.type = 'grade'; break; }
                    const resp = await GeminiAPI.chat(`Grade:\n\nREQUIREMENTS:\n${inst}\n\nWORK:\n${text.substring(0,5000)}\n\nGRADE: A-F\nSTRENGTHS:\nIMPROVEMENTS:`, GEMINI);
                    result.output = { grade: resp.match(/GRADE:\s*([A-F][+-]?)/i)?.[1] || 'B', feedback: resp }; result.type = 'grade'; break;
                }

                case 'CITE': { result.output = context.researchSources || []; result.type = 'citations'; break; }
            }
            return res.status(200).json(result);
        }
        throw new Error(`Unknown action: ${action}`);
    } catch (e) { console.error('[Agent]', e); return res.status(500).json({ success: false, error: e.message }); }
}
