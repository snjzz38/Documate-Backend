// api/features/agent.js - Agent Mode
import { GeminiAPI } from '../utils/geminiAPI.js';
import { GroqAPI } from '../utils/groqAPI.js';
import { SourceFinderAPI } from '../utils/sourceFinder.js';

// Helpers
const stripMarkdown = t => t.replace(/\*\*?([^*]+)\*\*?/g,'$1').replace(/__?([^_]+)__?/g,'$1').replace(/^#{1,6}\s*/gm,'').replace(/`([^`]+)`/g,'$1');
const stripRefs = t => t.replace(/\n\n\*?\*?(?:References|Works Cited|Bibliography)\*?\*?[\s\S]*$/i,'').trim();
const stripCitations = t => t.replace(/\s*\([^)]*\d{4}[^)]*\)/g,'').replace(/\s*\[[^\]]*\d{4}[^\]]*\]/g,'');

const extractTopic = text => {
    const m = text.match(/(?:about|essay on|write about)[:\s]+["']?([^"'\n.!?]{10,80})/i);
    if (m) return m[1];
    const skip = new Set(['write','essay','paragraph','summary','discuss','explain','please','about','using','citations']);
    return (text.toLowerCase().match(/\b[a-z]{4,}\b/g)||[]).filter(w=>!skip.has(w)).slice(0,5).join(' ') || text.substring(0,80);
};

const fmtAuthor = s => {
    if (s.authors?.length && s.authors[0].family) {
        return s.authors.length > 2 ? `${s.authors[0].family} et al.` : s.authors.map(a=>a.family).join(' & ');
    }
    return s.author || s.displayName || 'Unknown';
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
            const steps = [{ tool: 'RESEARCH', action: 'Find academic sources' }];
            if (options.enableWrite !== false) steps.push({ tool: 'WRITE', action: 'Write content' });
            if (options.enableHumanize) steps.push({ tool: 'HUMANIZE', action: 'Humanize text' });
            if (options.enableCite) steps.push({ tool: 'CITE', action: 'Format citations' });
            if (options.enableGrade) steps.push({ tool: 'GRADE', action: 'Grade work' });
            return res.status(200).json({ success: true, plan: { understanding: task.substring(0,150), steps } });
        }

        if (action === 'execute_step') {
            const { step, context = {}, options = {} } = req.body;
            const result = { success: true, output: '', type: 'text' };

            switch (step.tool.toUpperCase()) {
                case 'RESEARCH': {
                    const papers = await SourceFinderAPI.search(extractTopic(context.task||''), 12);
                    if (!papers?.length) { result.output = { text: '', sources: [] }; result.type = 'research'; break; }
                    
                    const sources = papers.map((p, i) => ({
                        id: i + 1, title: p.title, url: p.url, doi: p.doi,
                        venue: p.venue, author: p.author, authors: p.authors || [],
                        year: p.year, displayName: p.author || p.displayName, text: p.abstract
                    }));
                    
                    result.output = { 
                        text: sources.map(s => `[${s.displayName}, ${s.year}] ${s.title}\n${s.text}`).join('\n\n'), 
                        sources 
                    };
                    result.type = 'research';
                    break;
                }

                case 'WRITE': {
                    const { researchData = {}, task: userTask } = context;
                    const prompt = `You are an academic writer. Write a well-structured essay.

TASK: ${userTask}

RESEARCH (use this information):
${researchData.text?.substring(0, 10000) || 'No research provided'}

STRICT RULES:
1. Define acronyms on first use: "Preimplantation Genetic Diagnosis (PGD)" then use "PGD"
2. DO NOT include ANY citations or references like "(Author, 2020)" or "[1]" - these will be added later
3. DO NOT mention author names with years - just present facts naturally
4. Write in third person, formal academic tone
5. Clear structure: Introduction → Body paragraphs → Conclusion
6. NO bibliography/references section
7. Plain text only - no markdown, bold, or special formatting

Write the essay now:`;

                    let text = await GeminiAPI.chat(prompt, GEMINI);
                    result.output = stripMarkdown(stripRefs(stripCitations(text)));
                    result.type = 'text';
                    break;
                }

                case 'HUMANIZE': {
                    const text = context.previousOutput || '';
                    if (text.length < 50) throw new Error('No text to humanize');
                    
                    const prompt = `Rewrite to sound natural and human-written. Keep structure and facts.
DO NOT add any citations, author names, or references.
Plain text only, no formatting.

TEXT:
${text}`;

                    result.output = stripMarkdown(stripRefs(stripCitations(await GeminiAPI.chat(prompt, GEMINI))));
                    result.type = 'text';
                    break;
                }

                case 'CITE': {
                    const text = context.previousOutput || '';
                    const sources = context.researchSources || [];
                    const style = options.citationStyle || 'apa7';
                    const type = options.citationType || 'bibliography';
                    
                    // For bibliography only - no text modification needed
                    if (type === 'bibliography' || !text || !sources.length) {
                        result.output = text;
                        result.citedSources = sources;
                        result.type = 'cited'; // Special type to trigger bibliography display
                        break;
                    }
                    
                    // For in-text/footnotes - insert citations into text
                    try {
                        const srcList = sources.slice(0,10).map(s => `[${s.id}] ${fmtAuthor(s)} (${s.year})`).join('\n');
                        const prompt = `Add citations to this text. Return JSON only.

SOURCES:
${srcList}

TEXT:
"${text.substring(0, 5000)}"

Return: {"insertions":[{"anchor":"exact 5-8 word phrase","source_id":1}]}
Add 8-12 citations spread across paragraphs.`;
                        
                        const resp = await GroqAPI.chat([{ role: 'user', content: prompt }], GROQ, false);
                        const json = resp.match(/\{[\s\S]*\}/);
                        
                        if (json) {
                            const ins = JSON.parse(json[0]).insertions || [];
                            let cited = text;
                            const toSuper = n => n.toString().split('').map(d => '⁰¹²³⁴⁵⁶⁷⁸⁹'[+d]).join('');
                            const srcToFn = new Map();
                            let fnNum = 1;
                            const usedSrcs = new Map();
                            const positions = [];
                            
                            for (const i of ins) {
                                if (!i.anchor || i.anchor.length < 8) continue;
                                const pos = cited.toLowerCase().indexOf(i.anchor.toLowerCase());
                                if (pos === -1) continue;
                                const src = sources.find(x => x.id === i.source_id);
                                if (!src) continue;
                                
                                let cit;
                                if (type === 'footnotes') {
                                    if (!srcToFn.has(src.id)) srcToFn.set(src.id, fnNum++);
                                    cit = toSuper(srcToFn.get(src.id));
                                } else {
                                    const a = fmtAuthor(src);
                                    cit = style.includes('apa') ? ` (${a}, ${src.year})` : ` (${a})`;
                                }
                                
                                positions.push({ p: pos + i.anchor.length, cit, src });
                                usedSrcs.set(src.id, src);
                            }
                            
                            positions.sort((a,b) => b.p - a.p).forEach(x => cited = cited.slice(0,x.p) + x.cit + cited.slice(x.p));
                            
                            result.output = cited;
                            result.citedSources = type === 'footnotes' 
                                ? [...srcToFn.entries()].sort((a,b)=>a[1]-b[1]).map(([id])=>usedSrcs.get(id))
                                : [...usedSrcs.values()];
                        } else {
                            result.output = text;
                            result.citedSources = sources;
                        }
                    } catch (e) {
                        console.error('[Agent] Citation error:', e.message);
                        result.output = text;
                        result.citedSources = sources;
                    }
                    result.type = 'cited';
                    break;
                }

                case 'GRADE': {
                    const text = context.previousOutput || '';
                    if (text.length < 50) { result.output = { grade: 'N/A', feedback: 'No content' }; result.type = 'grade'; break; }
                    
                    const resp = await GeminiAPI.chat(`Grade this work.\n\nASSIGNMENT: ${context.task}\n\nWORK:\n${text.substring(0,5000)}\n\nProvide:\nGRADE: A/B/C/D/F\nSTRENGTHS:\nIMPROVEMENTS:`, GEMINI);
                    result.output = { grade: resp.match(/GRADE:\s*([A-F][+-]?)/i)?.[1] || 'B', feedback: resp };
                    result.type = 'grade';
                    break;
                }
            }
            
            return res.status(200).json(result);
        }
        
        throw new Error(`Unknown action: ${action}`);
    } catch (e) { 
        console.error('[Agent]', e); 
        return res.status(500).json({ success: false, error: e.message }); 
    }
}
