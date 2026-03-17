// api/features/agent.js - Agent Mode
import { GeminiAPI } from '../utils/geminiAPI.js';
import { GroqAPI } from '../utils/groqAPI.js';
import { SourceFinderAPI } from '../utils/sourceFinder.js';

// Helpers
const stripMarkdown = t => t.replace(/\*\*?([^*]+)\*\*?/g,'$1').replace(/__?([^_]+)__?/g,'$1').replace(/^#{1,6}\s*/gm,'').replace(/`([^`]+)`/g,'$1');
const stripRefs = t => t.replace(/\n\n\*?\*?(?:References|Works Cited|Bibliography)\*?\*?[\s\S]*$/i,'').trim();
const stripInlineCitations = t => t.replace(/\s*\([^)]*\d{4}[^)]*\)/g,'');

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
            if (options.enableWrite !== false) steps.push({ tool: 'WRITE', action: 'Write with quotes' });
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
                    const topic = extractTopic(context.task||'');
                    console.log('[Agent] Research topic:', topic);
                    
                    const papers = await SourceFinderAPI.searchTopic(topic, 12);
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
                    const { researchData = {}, researchSources = [], task: userTask } = context;
                    
                    // Build source info with quotes for the LLM to use
                    const sourceInfo = researchSources.slice(0, 10).map((s, i) => {
                        const authorCite = fmtAuthor(s);
                        return `SOURCE ${i+1}: ${authorCite} (${s.year})
Title: "${s.title}"
Abstract: ${s.text?.substring(0, 800) || 'No abstract'}
---`;
                    }).join('\n\n');

                    const prompt = `You are an expert academic writer. Write a well-researched essay with DIRECT QUOTES from sources.

TASK: ${userTask}

SOURCES TO USE (extract quotes from these abstracts):
${sourceInfo}

CRITICAL REQUIREMENTS:

1. INCLUDE 4-6 DIRECT QUOTES from the source abstracts
   Use varied transitions like:
   - According to [Author] ([Year]), "[quote]"
   - As [Author] ([Year]) argues, "[quote]"
   - [Author] ([Year]) found that "[quote]"
   - Research suggests that "[quote]" ([Author], [Year])
   - "[Quote]," notes [Author] ([Year])

2. DEFINE ACRONYMS on first use:
   "Preimplantation Genetic Diagnosis (PGD)" then use "PGD"

3. DO NOT add in-text citations like (Author, 2020) EXCEPT when introducing quotes
   The citation system will add other citations later

4. STRUCTURE:
   - Clear introduction with thesis
   - Body paragraphs with evidence and quotes
   - Strong conclusion

5. Plain text only - no markdown, bold, asterisks
6. NO bibliography section at the end

Write the essay with embedded quotes now:`;

                    let text = await GeminiAPI.chat(prompt, GEMINI);
                    result.output = stripMarkdown(stripRefs(text));
                    result.type = 'text';
                    break;
                }

                case 'HUMANIZE': {
                    const text = context.previousOutput || '';
                    if (text.length < 50) throw new Error('No text to humanize');
                    
                    const prompt = `Rewrite to sound natural and human-written. 

IMPORTANT:
- Keep ALL direct quotes exactly as they are (text inside quotation marks)
- Keep the quote attributions like "According to Smith (2020)"
- Make the surrounding text more natural and conversational
- Keep structure and facts
- Plain text only, no formatting

TEXT:
${text}`;

                    result.output = stripMarkdown(stripRefs(await GeminiAPI.chat(prompt, GEMINI)));
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
                        result.type = 'cited';
                        break;
                    }
                    
                    // For in-text/footnotes - add additional citations
                    try {
                        const srcList = sources.slice(0,10).map(s => `[${s.id}] ${fmtAuthor(s)} (${s.year}): "${s.title.substring(0,50)}"`).join('\n');
                        const prompt = `Add MORE in-text citations to support claims in this text.

Note: Some citations already exist (with quotes). Add citations to OTHER claims that need support.

AVAILABLE SOURCES:
${srcList}

TEXT:
"${text.substring(0, 5000)}"

RULES:
1. Add 6-10 MORE citations to unsupported claims
2. Don't add citations right next to existing ones
3. Place citations after facts, statistics, or arguments
4. You MAY cite same source multiple times in different spots

Return ONLY JSON:
{"insertions":[{"anchor":"exact 5-8 word phrase","source_id":1}]}`;
                        
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
                    
                    const resp = await GeminiAPI.chat(`Grade this academic work.

ASSIGNMENT: ${context.task}

STUDENT WORK:
${text.substring(0,5000)}

Evaluate based on:
1. Use of direct quotes from sources
2. Proper citation format
3. Argument structure and clarity
4. Academic writing quality

Provide:
GRADE: (A+/A/A-/B+/B/B-/C+/C/D/F)
STRENGTHS: (bullet points)
IMPROVEMENTS: (bullet points)`, GEMINI);
                    
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
