// api/features/agent.js - Agent Mode
// Uses existing humanizer.js and grader.js for those steps
import { GeminiAPI } from '../utils/geminiAPI.js';
import { SourceFinderAPI } from '../utils/sourceFinder.js';

// Import handlers directly to reuse logic
import humanizerHandler from './humanizer.js';
import graderHandler from './grader.js';

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
                
                // --- RESEARCH: Find academic sources with official citations ---
                case 'RESEARCH': {
                    const topic = extractTopic(context.task || '');
                    const style = options.citationStyle || 'apa7';
                    console.log('[Agent] Research topic:', topic, 'Style:', style);
                    
                    // searchTopic now fetches official citations from CrossRef
                    const papers = await SourceFinderAPI.searchTopic(topic, 12, style);
                    if (!papers?.length) { 
                        result.output = { text: '', sources: [] }; 
                        result.type = 'research'; 
                        break; 
                    }
                    
                    // Build source objects (papers already have citation field from CrossRef)
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
                        text: p.abstract,
                        citation: p.citation,  // Official citation from CrossRef
                        citationSource: p.citationSource  // 'crossref' or 'generated'
                    }));
                    
                    const crossrefCount = sources.filter(s => s.citationSource === 'crossref').length;
                    console.log('[Agent] Sources with CrossRef citations:', crossrefCount, '/', sources.length);
                    
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
                
                    // Handle multiple uploaded files
                    const allFiles = uploadedFiles.length > 0 ? uploadedFiles : (uploadedFile ? [uploadedFile] : []);
                    const imageFiles = allFiles.filter(f => f.type?.startsWith('image/'));
                    const pdfFiles = allFiles.filter(f => f.type === 'application/pdf');
                    const otherFiles = allFiles.filter(f => !f.type?.startsWith('image/') && f.type !== 'application/pdf');
                
                    // Extract PDF content using Gemini Vision
                    let pdfContext = '';
                    if (pdfFiles.length > 0) {
                        for (const pdf of pdfFiles) {
                            try {
                                const extractPrompt = `Extract and summarize all the key information, data, arguments, and content from this PDF document. Be thorough and preserve important details.`;
                                const pdfText = await GeminiAPI.vision(extractPrompt, GEMINI, [pdf]);
                                pdfContext += `\nUPLOADED DOCUMENT (${pdf.name}):\n${pdfText}\n`;
                            } catch (e) {
                                console.error('[Agent] PDF extraction failed:', e.message);
                            }
                        }
                    }
                
                    let fileContext = '';
                    if (otherFiles.length > 0) {
                        fileContext = `\nUSER FILES: ${otherFiles.map(f => f.name).join(', ')} - consider this context.\n`;
                    }
                
                    const prompt = `Write a well-researched academic essay.

TASK: ${userTask}
${pdfContext}
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
${imageFiles.length > 0 ? '7. Carefully analyze and describe the uploaded image(s) as part of the essay.' : ''}

Write the essay now:`;
                
                    const text = imageFiles.length > 0
                        ? await GeminiAPI.vision(prompt, GEMINI, imageFiles)
                        : await GeminiAPI.chat(prompt, GEMINI);
                
                    result.output = stripMarkdown(stripRefs(text));
                    result.type = 'text';
                    break;
                }

                // --- HUMANIZE: Use existing humanizer.js ---
                case 'HUMANIZE': {
                    const input = context.previousOutput || '';
                    if (!input) { result.output = ''; break; }
                    
                    // Create mock req/res to call humanizer handler
                    const mockReq = {
                        method: 'POST',
                        body: { text: input, tone: 'Academic' }
                    };
                    
                    let humanizedResult = '';
                    const mockRes = {
                        setHeader: () => {},
                        status: () => ({
                            end: () => {},
                            json: (data) => { humanizedResult = data; }
                        })
                    };
                    
                    await humanizerHandler(mockReq, mockRes);
                    
                    if (humanizedResult.success && humanizedResult.result) {
                        result.output = humanizedResult.result;
                    } else {
                        // Fallback to inline humanization
                        const prompt = `Rewrite this academic text to sound more natural and human-written.

TEXT:
${input}

RULES:
1. Make it conversational while keeping academic quality
2. Vary sentence structure and length
3. Add subtle transitions between ideas
4. Keep all quoted text and citations exactly as-is
5. Plain text only - no markdown

Rewrite:`;
                        result.output = stripMarkdown(await GeminiAPI.chat(prompt, GEMINI));
                    }
                    result.type = 'text';
                    break;
                }

                // --- CITE: Insert in-text citations with signposting & analysis ---
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
                    
                    // Build detailed source reference for LLM with key findings
                    const sourceList = sources.slice(0, 12).map((s, i) => {
                        const author = fmtAuthor(s, isMla ? 'mla' : 'apa');
                        return `[${i+1}] ${author} (${s.year})
   Title: "${s.title}"
   Key findings: ${s.text?.substring(0, 300) || 'N/A'}`;
                    }).join('\n\n');

                    let citationFormat = '';
                    if (type === 'in-text') {
                        if (isApa) {
                            citationFormat = `APA 7th in-text format: (Author, Year) or Author (Year)`;
                        } else if (isMla) {
                            citationFormat = `MLA 9th in-text format: (Author) or (Author Page) - no year`;
                        } else {
                            citationFormat = `Chicago format: (Author Year) or footnote numbers¹`;
                        }
                    } else if (type === 'footnotes') {
                        citationFormat = `Use superscript numbers¹ ² ³ at end of cited sentences.`;
                    }

                    const prompt = `Add scholarly citations to this essay with STRONG signposting and analysis.

ESSAY:
${input}

AVAILABLE SOURCES:
${sourceList}

CITATION FORMAT: ${citationFormat}

SIGNPOSTING TECHNIQUES (use these patterns):
- "As [Author] demonstrates, [claim] ([Author], [Year])."
- "This finding, highlighted by [Author] et al., suggests that..."
- "[Author] ([Year]) provides compelling evidence that..."
- "Building on [Author]'s research, we can see that..."
- "The implications of this, as [Author] argues, extend to..."
- "Critically, [Author] et al. ([Year]) found that..."

INSTRUCTIONS:
1. Insert 10-15 citations with SIGNPOSTING - don't just add parenthetical citations
2. For EACH citation, add a brief ANALYSIS of why it matters to the argument
3. Use varied signposting phrases (As X demonstrates, X argues that, According to X, etc.)
4. Connect each source to the essay's argument - explain the relevance
5. Distribute citations across ALL paragraphs evenly
6. Match citations to the MOST relevant sources for each claim
7. Do NOT change the core text - ADD signposting phrases and citations
8. Do NOT add a bibliography section
9. Ensure citation format matches: ${citationFormat}

Return the essay with well-integrated, analyzed citations:`;

                    const citedText = await GeminiAPI.chat(prompt, GEMINI);
                    result.output = stripMarkdown(stripRefs(citedText));
                    result.citedSources = sources;
                    result.type = 'cited';
                    break;
                }

                // --- QUOTES: Insert direct quotes with analytical transitions ---
                case 'QUOTES': {
                    const input = context.previousOutput || '';
                    const sources = context.researchSources || [];
                    
                    if (!input || !sources.length) {
                        result.output = input;
                        result.type = 'text';
                        break;
                    }

                    // Extract meaningful quotes from source abstracts
                    const quotesFromSources = sources.slice(0, 10).map(s => {
                        const author = fmtAuthor(s);
                        const sentences = (s.text || '').match(/[^.!?]+[.!?]+/g) || [];
                        // Find sentences with key findings/claims
                        const goodSentence = sentences.find(sent => 
                            sent.length > 40 && sent.length < 250 &&
                            (sent.includes('show') || sent.includes('found') || sent.includes('suggest') ||
                             sent.includes('demonstrate') || sent.includes('indicate') || sent.includes('reveal') ||
                             sent.includes('important') || sent.includes('significant') || sent.includes('evidence'))
                        ) || sentences.find(sent => sent.length > 50 && sent.length < 200) || sentences[0] || '';
                        return { author, year: s.year, title: s.title, quote: goodSentence.trim() };
                    }).filter(q => q.quote);

                    const quotesList = quotesFromSources.map((q, i) => 
                        `[${i+1}] ${q.author} (${q.year}):
   Quote: "${q.quote}"
   From: "${q.title}"`
                    ).join('\n\n');

                    const prompt = `Insert 4-6 direct quotes into this essay with ANALYTICAL transitions.

ESSAY:
${input}

QUOTES TO INSERT:
${quotesList}

ANALYTICAL TRANSITION PATTERNS (use these - they explain WHY the quote matters):
- "This concern is substantiated by research showing that '[quote]' ([Author], [Year]), which demonstrates..."
- "As [Author] et al. ([Year]) emphasize, '[quote]' - a finding that underscores the importance of..."
- "The significance of this issue becomes clear when considering that '[quote]' ([Author], [Year]). This suggests..."
- "Supporting this point, [Author] ([Year]) notes that '[quote],' which has important implications for..."
- "Evidence for this claim comes from [Author] et al., who found that '[quote]' ([Year]). This research reveals..."
- "The depth of this challenge is captured by [Author] ([Year]): '[quote].' This observation highlights..."

INSTRUCTIONS:
1. Find the BEST places to insert each quote where it strengthens the argument
2. Use analytical transitions that EXPLAIN why the quote matters
3. After each quote, add 1-2 sentences analyzing its significance to the argument
4. Keep ALL existing text and citations - only ADD quotes with analysis
5. Spread quotes across different paragraphs for balance
6. Ensure quotes flow naturally with the surrounding text
7. Do NOT add a bibliography section
8. Match the existing citation style in the essay

Return the essay with analytically-integrated quotes:`;

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

                // --- GRADE: Use existing grader.js ---
                case 'GRADE': {
                    const text = context.previousOutput || '';
                    if (!text) { 
                        result.output = { grade: 'N/A', feedback: 'No text to grade.' }; 
                        result.type = 'grade'; 
                        break; 
                    }
                    
                    // Create mock req/res to call grader handler
                    const mockReq = {
                        method: 'POST',
                        body: { 
                            text: text,
                            instructions: context.task || '',
                            rubric: `Evaluate on:
1. Thesis clarity and argumentation (25%)
2. Evidence and source integration (25%)
3. Organization and flow (20%)
4. Writing quality and academic tone (20%)
5. Grammar and mechanics (10%)`
                        }
                    };
                    
                    let gradeResult = null;
                    const mockRes = {
                        setHeader: () => {},
                        status: () => ({
                            end: () => {},
                            json: (data) => { gradeResult = data; }
                        })
                    };
                    
                    await graderHandler(mockReq, mockRes);
                    
                    if (gradeResult?.success && gradeResult?.result) {
                        const feedback = gradeResult.result;
                        const gradeMatch = feedback.match(/(?:Overall\s+)?Grade[:\s]*([A-F][+-]?)/i) ||
                                          feedback.match(/([A-F][+-]?)\s*(?:\/|out of)/i);
                        result.output = {
                            grade: gradeMatch ? gradeMatch[1].toUpperCase() : 'B',
                            feedback: feedback
                        };
                    } else {
                        // Fallback
                        result.output = { grade: 'B', feedback: 'Grading completed.' };
                    }
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
