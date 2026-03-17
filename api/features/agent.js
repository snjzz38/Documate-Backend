// api/features/agent.js - Agent Mode
import { GeminiAPI } from '../utils/geminiAPI.js';
import { SourceFinderAPI } from '../utils/sourceFinder.js';

// Helpers
const stripMarkdown = t => t.replace(/\*\*?([^*]+)\*\*?/g,'$1').replace(/__?([^_]+)__?/g,'$1').replace(/^#{1,6}\s*/gm,'').replace(/`([^`]+)`/g,'$1');
const stripRefs = t => t.replace(/\n\n\*?\*?(?:References|Works Cited|Bibliography)\*?\*?[\s\S]*$/i,'').trim();

const extractTopic = text => {
    const m = text.match(/(?:about|essay on|write about)[:\s]+["']?([^"'\n.!?]{10,80})/i);
    if (m) return m[1];
    const skip = new Set(['write','essay','paragraph','summary','discuss','explain','please','about','using','citations']);
    return (text.toLowerCase().match(/\b[a-z]{4,}\b/g)||[]).filter(w=>!skip.has(w)).slice(0,5).join(' ') || text.substring(0,80);
};

const fmtAuthor = (s, style = 'apa') => {
    if (s.authors?.length && s.authors[0].family) {
        if (style === 'mla') {
            return s.authors.length > 2 ? `${s.authors[0].family} et al.` : s.authors.map(a=>a.family).join(' and ');
        }
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
        const GEMINI = process.env.GEMINI_API_KEY;

        // === PLAN ===
        // Flow: RESEARCH → WRITE → HUMANIZE → CITE → QUOTES → PROOFREAD → GRADE
        if (action === 'plan') {
            const steps = [{ tool: 'RESEARCH', action: 'Find academic sources' }];
            if (options.enableWrite !== false) steps.push({ tool: 'WRITE', action: 'Write essay' });
            if (options.enableHumanize) steps.push({ tool: 'HUMANIZE', action: 'Humanize text' });
            if (options.enableCite) steps.push({ tool: 'CITE', action: `Add ${options.citationType || 'in-text'} citations` });
            if (options.enableQuotes) steps.push({ tool: 'QUOTES', action: 'Insert quotes with transitions' });
            steps.push({ tool: 'PROOFREAD', action: 'Polish and improve' });
            if (options.enableGrade) steps.push({ tool: 'GRADE', action: 'Grade work' });
            return res.status(200).json({ success: true, plan: { understanding: task.substring(0,150), steps } });
        }

        // === EXECUTE STEP ===
        if (action === 'execute_step') {
            const { step, context = {}, options = {} } = req.body;
            const result = { success: true, output: '', type: 'text' };

            switch (step.tool.toUpperCase()) {
                
                // --- RESEARCH: Find academic sources ---
                case 'RESEARCH': {
                    const topic = extractTopic(context.task || '');
                    console.log('[Agent] Research topic:', topic);
                    
                    const papers = await SourceFinderAPI.searchTopic(topic, 12);
                    if (!papers?.length) { 
                        result.output = { text: '', sources: [] }; 
                        result.type = 'research'; 
                        break; 
                    }
                    
                    const sources = papers.map((p, i) => ({
                        id: i + 1, 
                        title: p.title, 
                        url: p.url, 
                        doi: p.doi,
                        venue: p.venue, 
                        author: p.author, 
                        authors: p.authors || [],
                        year: p.year, 
                        displayName: p.author || p.displayName, 
                        text: p.abstract
                    }));
                    
                    result.output = { 
                        text: sources.map(s => `[${s.displayName}, ${s.year}] ${s.title}\n${s.text}`).join('\n\n'), 
                        sources 
                    };
                    result.type = 'research';
                    break;
                }

                // --- WRITE: Create essay without any citations ---
                case 'WRITE': {
                    const { researchSources = [], task: userTask, uploadedFile, uploadedFiles = [] } = context;
                    
                    const sourceInfo = researchSources.slice(0, 10).map((s, i) => 
                        `SOURCE ${i+1}:\nTitle: "${s.title}"\nKey info: ${s.text?.substring(0, 500) || 'N/A'}`
                    ).join('\n\n');
                
                    const allFiles = uploadedFiles.length > 0 ? uploadedFiles : (uploadedFile ? [uploadedFile] : []);
                    const imageFiles = allFiles.filter(f => f.type?.startsWith('image/'));
                    const otherFiles = allFiles.filter(f => !f.type?.startsWith('image/'));
                
                    let fileContext = otherFiles.length > 0
                        ? `\nUSER FILES: ${otherFiles.map(f => f.name).join(', ')} - consider this context.\n`
                        : '';
                
                    const prompt = `Write a well-researched academic essay.
                TASK: ${userTask}
                ${fileContext}
                RESEARCH SOURCES:
                ${sourceInfo}
                REQUIREMENTS:
                1. Write naturally WITHOUT any citations or author references
                2. Use the research content but express ideas in your own words
                3. Define acronyms on first use
                4. Structure: Introduction with thesis → Body paragraphs → Conclusion
                5. Plain text only - no markdown, no bold, no headers
                6. Do NOT include a bibliography
                ${imageFiles.length > 0 ? '7. Carefully analyze and describe the uploaded image(s) as part of the essay.' : ''}
                Write the essay now:`;
                
                    // Use unified generate() - passes images automatically if present
                    const text = await GeminiAPI.generate(prompt, GEMINI, imageFiles);
                    result.output = stripMarkdown(stripRefs(text));
                    result.type = 'text';
                    break;
                }

TASK: ${userTask}
${fileContext}
RESEARCH SOURCES:
${sourceInfo}

REQUIREMENTS:
1. Write naturally WITHOUT any citations or author references
   - Do NOT write "(Author, 2020)" or "According to Author"  
   - Do NOT mention any author names or years
   - Citations will be added in a later step
2. Use the research content but express ideas in your own words
3. Define acronyms on first use: "Preimplantation Genetic Diagnosis (PGD)"
4. Structure: Introduction with thesis → Body paragraphs → Conclusion
5. Plain text only - no markdown, no bold, no headers
6. Do NOT include a bibliography

Write the essay now:`;

                    let text = await GeminiAPI.chat(prompt, GEMINI);
                    result.output = stripMarkdown(stripRefs(text));
                    result.type = 'text';
                    break;
                }

                // --- HUMANIZE: Make text more natural ---
                case 'HUMANIZE': {
                    const input = context.previousOutput || '';
                    if (!input) { result.output = ''; break; }
                    
                    const prompt = `Rewrite this academic text to sound more natural and human-written.

TEXT:
${input}

RULES:
1. Make it conversational while keeping academic quality
2. Vary sentence structure and length
3. Add subtle transitions between ideas
4. Keep all quoted text exactly as-is
5. Keep any citations exactly as-is (don't add or remove)
6. Plain text only - no markdown

Rewrite:`;

                    result.output = stripMarkdown(await GeminiAPI.chat(prompt, GEMINI));
                    result.type = 'text';
                    break;
                }

                // --- CITE: Insert in-text citations into the essay ---
                case 'CITE': {
                    const input = context.previousOutput || '';
                    const sources = context.researchSources || [];
                    const style = options.citationStyle || 'apa7';
                    const type = options.citationType || 'in-text';
                    
                    if (!input || !sources.length) {
                        result.output = input;
                        result.citedSources = sources;
                        result.type = 'cited';
                        break;
                    }

                    const isApa = style.includes('apa');
                    const isMla = style.includes('mla');
                    
                    // Build source reference for LLM
                    const sourceList = sources.slice(0, 12).map((s, i) => {
                        const author = fmtAuthor(s, isMla ? 'mla' : 'apa');
                        return `[${i+1}] ${author} (${s.year}) - "${s.title}" - Key content: ${s.text?.substring(0, 200)}`;
                    }).join('\n');

                    let citationFormat = '';
                    if (type === 'in-text') {
                        if (isApa) {
                            citationFormat = `APA in-text: (Author, Year) or Author (Year) states...
Examples: (Smith et al., 2020) or Smith et al. (2020) found that...`;
                        } else if (isMla) {
                            citationFormat = `MLA in-text: (Author) or (Author Page) - no year in parentheses
Examples: (Smith et al.) or Smith et al. argue that...`;
                        } else {
                            citationFormat = `Chicago: (Author Year) or footnote numbers
Examples: (Smith 2020) or Smith argues that...¹`;
                        }
                    } else if (type === 'footnotes') {
                        citationFormat = `Use superscript numbers¹ ² ³ at the end of sentences that need citations.`;
                    }

                    const prompt = `Add ${type} citations to this essay using ${style.toUpperCase()} format.

ESSAY:
${input}

AVAILABLE SOURCES:
${sourceList}

CITATION FORMAT:
${citationFormat}

INSTRUCTIONS:
1. Insert 8-12 citations throughout the essay where claims need support
2. Match citations to relevant sources from the list above
3. Distribute citations across different paragraphs
4. Use the EXACT citation format shown above
5. Do NOT change any other text - only ADD citations
6. Do NOT add a bibliography section

Return the essay with citations inserted:`;

                    const citedText = await GeminiAPI.chat(prompt, GEMINI);
                    result.output = stripMarkdown(stripRefs(citedText));
                    result.citedSources = sources;
                    result.type = 'cited';
                    break;
                }

                // --- QUOTES: Insert direct quotes with transitions ---
                case 'QUOTES': {
                    const input = context.previousOutput || '';
                    const sources = context.researchSources || [];
                    
                    if (!input || !sources.length) {
                        result.output = input;
                        result.type = 'text';
                        break;
                    }

                    // Extract quotes from sources
                    const quotesFromSources = sources.slice(0, 8).map(s => {
                        const author = fmtAuthor(s);
                        // Get a meaningful sentence from abstract
                        const sentences = (s.text || '').match(/[^.!?]+[.!?]+/g) || [];
                        const goodSentence = sentences.find(sent => sent.length > 50 && sent.length < 200) || sentences[0] || '';
                        return { author, year: s.year, quote: goodSentence.trim() };
                    }).filter(q => q.quote);

                    const quotesList = quotesFromSources.map((q, i) => 
                        `[${i+1}] ${q.author} (${q.year}): "${q.quote}"`
                    ).join('\n');

                    const prompt = `Insert 4-6 direct quotes into this essay with appropriate transitions.

ESSAY:
${input}

QUOTES TO INSERT:
${quotesList}

INSTRUCTIONS:
1. Find appropriate places in the essay to insert these quotes
2. Add a TRANSITION phrase before each quote to make it flow naturally:
   - "As one researcher notes, "..."
   - "This is supported by evidence: "..."
   - "Research confirms this: "..."
   - "Experts emphasize that "..."
   - "Studies have shown that "..."
3. Keep the existing citations - just add the quotes with transitions
4. Spread quotes across different paragraphs
5. Do NOT change other text - only INSERT quotes with transitions
6. Do NOT add a bibliography

Return the essay with quotes inserted:`;

                    result.output = stripMarkdown(await GeminiAPI.chat(prompt, GEMINI));
                    result.type = 'text';
                    break;
                }

                // --- PROOFREAD: Polish and improve text ---
                case 'PROOFREAD': {
                    const input = context.previousOutput || '';
                    if (!input) { result.output = ''; break; }
                    
                    const prompt = `Proofread and polish this academic essay.

ESSAY:
${input}

TASKS:
1. Fix any grammar, spelling, or punctuation errors
2. Improve awkward phrasing or unclear sentences
3. Ensure smooth transitions between paragraphs
4. Check that quotes are properly integrated
5. Verify citations are correctly formatted
6. Keep ALL existing content - only improve quality
7. Do NOT add or remove citations
8. Do NOT add a bibliography section
9. Plain text only - no markdown

Return the polished essay:`;

                    result.output = stripMarkdown(stripRefs(await GeminiAPI.chat(prompt, GEMINI)));
                    result.type = 'text';
                    break;
                }

                // --- GRADE: Evaluate the essay ---
                case 'GRADE': {
                    const text = context.previousOutput || '';
                    if (!text) { 
                        result.output = { grade: 'N/A', feedback: 'No text to grade.' }; 
                        result.type = 'grade'; 
                        break; 
                    }
                    
                    const prompt = `Grade this academic essay and provide detailed feedback.

ESSAY:
${text}

CRITERIA:
1. Thesis clarity and argumentation (25%)
2. Evidence and source integration (25%)
3. Organization and flow (20%)
4. Writing quality and academic tone (20%)
5. Grammar and mechanics (10%)

FORMAT:
GRADE: [A+ to F]

STRENGTHS:
- [point 1]
- [point 2]

AREAS FOR IMPROVEMENT:
- [point 1]
- [point 2]

DETAILED FEEDBACK:
[2-3 paragraphs]`;

                    const feedback = await GeminiAPI.chat(prompt, GEMINI);
                    const gradeMatch = feedback.match(/GRADE:\s*([A-F][+-]?)/i);
                    result.output = {
                        grade: gradeMatch ? gradeMatch[1].toUpperCase() : 'B',
                        feedback: feedback
                    };
                    result.type = 'grade';
                    break;
                }

                default:
                    result.output = 'Unknown step';
            }

            return res.status(200).json(result);
        }

        return res.status(400).json({ success: false, error: 'Invalid action' });

    } catch (e) {
        console.error('[Agent] Error:', e);
        return res.status(500).json({ success: false, error: e.message });
    }
}
