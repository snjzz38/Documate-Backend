// api/features/agent.js - Agent Mode
// FLOW: RESEARCH → QUOTES → WRITE → HUMANIZE → INSERT_CITATIONS → GRADE → CITE

// Import with fallback for different module systems
import * as geminiModule from '../utils/geminiAPI.js';
import * as groqModule from '../utils/groqAPI.js';
import * as searchModule from '../utils/googleSearch.js';
import * as scraperModule from '../utils/scraper.js';

// Extract the actual exports (handles both named exports and default exports)
const GeminiAPI = geminiModule.GeminiAPI || geminiModule.default?.GeminiAPI || geminiModule.default || geminiModule;
const GroqAPI = groqModule.GroqAPI || groqModule.default?.GroqAPI || groqModule.default || groqModule;
const GoogleSearchAPI = searchModule.GoogleSearchAPI || searchModule.default?.GoogleSearchAPI || searchModule.default || searchModule;
const ScraperAPI = scraperModule.ScraperAPI || scraperModule.default?.ScraperAPI || scraperModule.default || scraperModule;

// Verify imports
if (!GeminiAPI?.chat) console.error('[Agent] WARNING: GeminiAPI.chat not found. Module:', geminiModule);
if (!GroqAPI?.chat) console.error('[Agent] WARNING: GroqAPI.chat not found. Module:', groqModule);

// Helpers
const cleanSite = s => {
    if (!s) return 'Unknown';
    const n = s.replace(/^(www\.|https?:\/\/)/i, '').split(/[\/\?#\.]/)[0].toLowerCase();
    return { pmc: 'NIH', ncbi: 'NIH', arxiv: 'arXiv', noaa: 'NOAA', nasa: 'NASA', pubmed: 'PubMed' }[n] || n.charAt(0).toUpperCase() + n.slice(1);
};

const getAuthor = src => (src.author?.length > 2 ? src.author : src.displayName || cleanSite(src.site));

const stripRefs = text => [/\n\n\*?\*?(?:References|Works Cited|Bibliography|Sources)\*?\*?[\s\S]*$/i, /\n\n#{1,3}\s*(?:References|Works Cited)[\s\S]*$/i]
    .reduce((t, p) => t.replace(p, ''), text).trim();

const stripMarkdown = text => text
    .replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\*([^*]+)\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1').replace(/_([^_]+)_/g, '$1')
    .replace(/^#{1,6}\s*/gm, '').replace(/`([^`]+)`/g, '$1');

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
        const GEMINI = process.env.GEMINI_API_KEY;
        const GROQ = process.env.GROQ_API_KEY;

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
                    const query = extractTopic(context.task || '');
                    console.log('[Agent] Research query:', query);
                    
                    const results = await GoogleSearchAPI.search(query, null, null, GROQ);
                    if (!results?.length) { 
                        result.output = { text: '', sources: [] }; 
                        result.type = 'research'; 
                        break; 
                    }
                    
                    const scraped = await ScraperAPI.scrape(results.slice(0, 10));
                    const sources = [], texts = [];
                    
                    for (const s of scraped) {
                        const txt = s.text || s.content || s.snippet || '';
                        if (txt.length > 100) {
                            const site = cleanSite(s.meta?.siteName || s.link);
                            const name = s.meta?.author || site;
                            texts.push(`[${name}, ${s.meta?.year || 'n.d.'}]\n${txt.substring(0, 2000)}`);
                            sources.push({ 
                                id: sources.length + 1, 
                                title: s.title, 
                                url: s.link, 
                                site, 
                                author: s.meta?.author, 
                                year: s.meta?.year || 'n.d.', 
                                displayName: name, 
                                text: txt.substring(0, 2000) 
                            });
                        }
                    }
                    
                    result.output = { text: texts.join('\n\n'), sources }; 
                    result.type = 'research'; 
                    break;
                }

                case 'QUOTES': {
                    const src = context.researchSources || [];
                    if (!src.length) { result.output = []; result.type = 'quotes'; break; }
                    
                    const prompt = `Extract 3-5 direct quotes from these sources.\nFORMAT each as: SourceName: "exact quote"\n\n${src.slice(0,5).map(s => `--- ${s.displayName} ---\n${s.text?.substring(0,1200)}`).join('\n\n')}`;
                    const resp = await GeminiAPI.chat(prompt, GEMINI);
                    
                    result.output = resp.split('\n')
                        .map(l => l.match(/^([^:]+):\s*"([^"]+)"/))
                        .filter(Boolean)
                        .map(m => ({ source: m[1].trim(), quote: m[2].trim() }));
                    result.type = 'quotes'; 
                    break;
                }

                case 'WRITE': {
                    const { researchData = {}, extractedQuotes = [], task: userTask } = context;
                    const prompt = `You are an expert academic writer.

TASK: ${userTask}
${researchData.text ? `\nRESEARCH:\n${researchData.text.substring(0, 8000)}` : ''}
${extractedQuotes.length ? `\nQUOTES TO INCLUDE:\n${extractedQuotes.map((q,i) => `${i+1}. ${q.source}: "${q.quote}"`).join('\n')}` : ''}

RULES:
1. Write in formal academic tone
2. Include the quotes with proper attribution
3. NO bibliography or references section at the end
4. OUTPUT PLAIN TEXT ONLY - no markdown formatting, no asterisks, no bold, no italics
5. Use simple text headings without any special formatting`;

                    const resp = await GeminiAPI.chat(prompt, GEMINI);
                    result.output = stripMarkdown(stripRefs(resp)); 
                    result.type = 'text'; 
                    break;
                }

                case 'HUMANIZE': {
                    const text = context.previousOutput || '';
                    if (text.length < 50) throw new Error('No text to humanize');
                    
                    const prompt = `Rewrite this text to sound more natural and human-written while keeping the same structure and content.
Preserve any quotes exactly as they are.
Do NOT add a references or bibliography section.
OUTPUT PLAIN TEXT ONLY - no markdown, no asterisks, no formatting.

TEXT:\n${text}`;

                    const resp = await GeminiAPI.chat(prompt, GEMINI);
                    result.output = stripMarkdown(stripRefs(resp));
                    result.type = 'text'; 
                    break;
                }

                case 'INSERT_CITATIONS': {
                    const text = context.previousOutput || '';
                    const sources = context.researchSources || [];
                    const style = options.citationStyle || 'apa7';
                    const type = options.citationType || 'in-text';
                    
                    if (!text || !sources.length) { 
                        result.output = text; 
                        result.type = 'text'; 
                        break; 
                    }
                    
                    try {
                        const srcList = sources.map(s => `[${s.id}] ${getAuthor(s)} (${s.year})`).join('\n');
                        const prompt = `Add in-text citations to this text.

SOURCES:
${srcList}

TEXT:
"${text.substring(0, 5000)}"

Return JSON only: {"insertions":[{"anchor":"3-5 word phrase from text","source_id":1}]}`;
                        
                        const resp = await GroqAPI.chat([{ role: 'user', content: prompt }], GROQ, false);
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
                                const cit = type === 'footnotes' ? toSuper(fn++) : 
                                           style.includes('apa') ? ` (${a}, ${s.year})` : 
                                           style.includes('mla') ? ` (${a})` : ` (${a} ${s.year})`;
                                pos.push({ p: p + i.anchor.length, cit, src: s });
                            }
                            
                            pos.sort((a, b) => b.p - a.p).forEach(x => cited = cited.slice(0, x.p) + x.cit + cited.slice(x.p));
                            result.output = cited; 
                            result.citedSources = pos.map(x => x.src);
                        } else {
                            result.output = text;
                        }
                    } catch (e) {
                        console.error('[Agent] Citation insertion failed:', e.message);
                        result.output = text;
                    }
                    result.type = 'text'; 
                    break;
                }

                case 'GRADE': {
                    const text = context.previousOutput || '';
                    const inst = context.task || '';
                    
                    if (text.length < 50) { 
                        result.output = { grade: 'N/A', feedback: 'No content to grade' }; 
                        result.type = 'grade'; 
                        break; 
                    }
                    
                    const prompt = `Grade this academic work.

ASSIGNMENT: ${inst}

STUDENT WORK:
${text.substring(0, 5000)}

Provide:
GRADE: (A/B/C/D/F with +/- if applicable)
STRENGTHS: (2-3 bullet points)
AREAS FOR IMPROVEMENT: (2-3 bullet points)`;
                    
                    const resp = await GeminiAPI.chat(prompt, GEMINI);
                    const gradeMatch = resp.match(/GRADE:\s*([A-F][+-]?)/i);
                    
                    result.output = { 
                        grade: gradeMatch?.[1] || 'B', 
                        feedback: resp 
                    }; 
                    result.type = 'grade'; 
                    break;
                }

                case 'CITE': { 
                    result.output = context.researchSources || []; 
                    result.type = 'citations'; 
                    break; 
                }
            }
            
            return res.status(200).json(result);
        }
        
        throw new Error(`Unknown action: ${action}`);
    } catch (e) { 
        console.error('[Agent] Error:', e); 
        return res.status(500).json({ success: false, error: e.message }); 
    }
}
