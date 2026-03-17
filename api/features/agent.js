// api/features/agent.js - Agent Mode
// FLOW: RESEARCH → QUOTES → WRITE → HUMANIZE → INSERT_CITATIONS → GRADE → CITE

// Import with fallback for different module systems
import * as geminiModule from '../utils/geminiAPI.js';
import * as groqModule from '../utils/groqAPI.js';
import * as sourceModule from '../utils/sourceFinder.js';
import * as doiModule from '../utils/doiAPI.js';

// Extract the actual exports
const GeminiAPI = geminiModule.GeminiAPI || geminiModule.default?.GeminiAPI || geminiModule.default || geminiModule;
const GroqAPI = groqModule.GroqAPI || groqModule.default?.GroqAPI || groqModule.default || groqModule;
const SourceFinderAPI = sourceModule.SourceFinderAPI || sourceModule.default?.SourceFinderAPI || sourceModule.default || sourceModule;
const DoiAPI = doiModule.DoiAPI || doiModule.default?.DoiAPI || doiModule.default || doiModule;

// Verify imports
if (!GeminiAPI?.chat) console.error('[Agent] WARNING: GeminiAPI.chat not found');
if (!SourceFinderAPI?.search) console.error('[Agent] WARNING: SourceFinderAPI.search not found');

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
                    
                    // Use OpenAlex to find academic papers
                    const papers = await SourceFinderAPI.search(query, 12);
                    
                    if (!papers?.length) { 
                        result.output = { text: '', sources: [] }; 
                        result.type = 'research'; 
                        break; 
                    }
                    
                    // Enrich papers with DOI metadata for proper citations
                    const enrichedSources = await Promise.all(papers.map(async (p, i) => {
                        let enriched = {
                            id: i + 1,
                            title: p.title,
                            url: p.url,
                            doi: p.doi,
                            site: p.site || p.venue,
                            venue: p.venue,
                            author: p.author,
                            authors: p.authors || [],
                            year: p.year,
                            displayName: p.author || p.displayName,
                            text: p.abstract,
                            citationCount: p.citationCount
                        };
                        
                        // Try to get richer metadata from Crossref if DOI available
                        if (p.doi && DoiAPI?.fetchFromCrossref) {
                            try {
                                const doiMeta = await DoiAPI.fetchFromCrossref(p.doi);
                                if (doiMeta) {
                                    enriched.authors = doiMeta.authors || enriched.authors;
                                    enriched.venue = doiMeta.journal || enriched.venue;
                                    enriched.year = doiMeta.year || enriched.year;
                                    // Format author properly for citation
                                    if (doiMeta.authors?.length > 0) {
                                        const firstAuthor = doiMeta.authors[0];
                                        enriched.author = doiMeta.authors.length > 2 
                                            ? `${firstAuthor.family} et al.`
                                            : doiMeta.authors.map(a => a.family).join(' & ');
                                        enriched.displayName = enriched.author;
                                    }
                                }
                            } catch (e) {
                                console.log('[Agent] DOI enrichment failed for:', p.doi);
                            }
                        }
                        
                        return enriched;
                    }));
                    
                    // Build research text from abstracts
                    const texts = enrichedSources.map(s => 
                        `[${s.displayName}, ${s.year}] ${s.title}\n${s.text}`
                    );
                    
                    console.log('[Agent] Found', enrichedSources.length, 'academic sources');
                    
                    result.output = { text: texts.join('\n\n'), sources: enrichedSources }; 
                    result.type = 'research'; 
                    break;
                }

                case 'QUOTES': {
                    const src = context.researchSources || [];
                    if (!src.length) { result.output = []; result.type = 'quotes'; break; }
                    
                    const prompt = `Extract 8-12 important quotes from these academic paper abstracts.

SOURCES:
${src.slice(0, 10).map((s, i) => `--- SOURCE ${i + 1}: ${s.displayName} (${s.year}) ---\n${s.text?.substring(0, 1500)}`).join('\n\n')}

RULES:
1. Extract EXACT phrases from the abstracts (do not paraphrase)
2. Each quote should be a complete, meaningful sentence or key finding
3. Include quotes from AS MANY different sources as possible
4. Focus on: key findings, statistics, conclusions, and important claims
5. Aim for at least 1-2 quotes per source

FORMAT each quote on its own line as:
SourceName (Year): "exact quote from the abstract"

Example:
Smith et al. (2023): "Gene editing has shown a 95% success rate in preventing hereditary diseases"
Jones (2022): "Ethical considerations must be balanced with potential benefits"`;

                    const resp = await GeminiAPI.chat(prompt, GEMINI);
                    
                    // Parse quotes more flexibly
                    const quotes = [];
                    const lines = resp.split('\n').filter(l => l.trim());
                    
                    for (const line of lines) {
                        // Match various formats: "Source (Year): "quote"" or "Source: "quote""
                        const match = line.match(/^([^:]+(?:\(\d{4}\))?)\s*:\s*[""]([^""]+)[""]/) ||
                                     line.match(/^([^:]+)\s*:\s*[""]([^""]+)[""]/);
                        if (match) {
                            quotes.push({ 
                                source: match[1].trim(), 
                                quote: match[2].trim() 
                            });
                        }
                    }
                    
                    console.log('[Agent] Extracted', quotes.length, 'quotes');
                    result.output = quotes;
                    result.type = 'quotes'; 
                    break;
                }

                case 'WRITE': {
                    const { researchData = {}, extractedQuotes = [], task: userTask } = context;
                    const prompt = `You are an expert academic writer following strict academic writing standards.

TASK: ${userTask}
${researchData.text ? `\nRESEARCH:\n${researchData.text.substring(0, 8000)}` : ''}
${extractedQuotes.length ? `\nQUOTES TO INCLUDE:\n${extractedQuotes.map((q,i) => `${i+1}. ${q.source}: "${q.quote}"`).join('\n')}` : ''}

CRITICAL ACADEMIC WRITING RULES:

1. ACRONYMS & ABBREVIATIONS:
   - Define ALL acronyms on first use: "Preimplantation Genetic Diagnosis (PGD)"
   - After defining, use the acronym: "PGD allows screening..."
   - Common acronyms to define: PGD, PGT, CRISPR, IVF, DNA, RNA, IVG, etc.

2. FORMAL ACADEMIC TONE:
   - Use third person (avoid "I", "we", "you")
   - Use formal vocabulary and complex sentence structures
   - Present balanced arguments with evidence

3. NO CITATIONS IN TEXT:
   - DO NOT include any parenthetical references like "(Author, Year)"
   - DO NOT add superscript numbers or footnote markers
   - Citations will be added automatically in a separate step
   - Just present information naturally without attribution

4. STRUCTURE:
   - Clear introduction with thesis
   - Well-organized body paragraphs with topic sentences
   - Logical transitions between ideas
   - Strong conclusion

5. FORMATTING:
   - OUTPUT PLAIN TEXT ONLY - no markdown, no asterisks, no bold
   - Use simple text headings (just the heading text, no special formatting)
   - NO bibliography or references section

Write a well-structured, academically rigorous response:`;

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
                        const srcList = sources.map(s => `[${s.id}] ${getAuthor(s)} (${s.year}): "${s.title}"`).join('\n');
                        const prompt = `Add in-text citations throughout this academic text.

AVAILABLE SOURCES:
${srcList}

TEXT TO CITE:
"${text.substring(0, 6000)}"

RULES:
1. Add 8-15 citations throughout the text
2. Place citations after claims, facts, statistics, or arguments that need support
3. Each paragraph should have at least 1-2 citations
4. Use different sources - don't over-rely on just one or two
5. Match the citation to relevant content (e.g., cite genetics papers for genetics claims)

Return ONLY a JSON object:
{
  "insertions": [
    {"anchor": "exact 4-6 word phrase from the text", "source_id": 1},
    {"anchor": "another exact phrase", "source_id": 3}
  ]
}

IMPORTANT: 
- "anchor" must be an EXACT phrase that appears in the text
- Include at least 8 insertions
- Spread citations across different paragraphs`;
                        
                        const resp = await GroqAPI.chat([{ role: 'user', content: prompt }], GROQ, false);
                        const json = resp.match(/\{[\s\S]*\}/);
                        
                        if (json) {
                            const ins = JSON.parse(json[0]).insertions || [];
                            let cited = text;
                            const toSuper = n => n.toString().split('').map(d => '⁰¹²³⁴⁵⁶⁷⁸⁹'[+d]).join('');
                            const pos = [];
                            
                            // For footnotes: track which sources have been cited and their footnote number
                            const sourceToFootnote = new Map();
                            let nextFootnote = 1;
                            
                            // For bibliography: track all cited sources (deduplicated)
                            const citedSourcesMap = new Map();
                            
                            for (const i of ins) {
                                if (!i.anchor || i.anchor.length < 10) continue;
                                const anchorLower = i.anchor.toLowerCase();
                                const p = cited.toLowerCase().indexOf(anchorLower);
                                if (p === -1) continue;
                                const s = sources.find(x => x.id === i.source_id);
                                if (!s) continue;
                                
                                const a = getAuthor(s);
                                let cit;
                                
                                if (type === 'footnotes') {
                                    // For footnotes: reuse same number if source already cited
                                    if (!sourceToFootnote.has(s.id)) {
                                        sourceToFootnote.set(s.id, nextFootnote++);
                                    }
                                    cit = toSuper(sourceToFootnote.get(s.id));
                                } else {
                                    // For in-text citations
                                    cit = style.includes('apa') ? ` (${a}, ${s.year})` : 
                                          style.includes('mla') ? ` (${a})` : ` (${a} ${s.year})`;
                                }
                                
                                pos.push({ p: p + i.anchor.length, cit, src: s });
                                citedSourcesMap.set(s.id, s);
                            }
                            
                            // Sort by position (descending) and insert
                            pos.sort((a, b) => b.p - a.p).forEach(x => {
                                cited = cited.slice(0, x.p) + x.cit + cited.slice(x.p);
                            });
                            
                            // For footnotes, order sources by their footnote number
                            let orderedSources;
                            if (type === 'footnotes') {
                                orderedSources = [...sourceToFootnote.entries()]
                                    .sort((a, b) => a[1] - b[1])
                                    .map(([id]) => citedSourcesMap.get(id));
                            } else {
                                orderedSources = [...citedSourcesMap.values()];
                            }
                            
                            console.log('[Agent] Inserted', pos.length, 'citations,', orderedSources.length, 'unique sources');
                            result.output = cited; 
                            result.citedSources = orderedSources;
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
