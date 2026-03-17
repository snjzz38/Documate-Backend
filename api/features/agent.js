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
            if (options.enableQuotes) steps.push({ tool: 'QUOTES', action: 'Extract quotes' });
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

                case 'QUOTES': {
                    const sources = context.researchSources || [];
                    if (!sources.length) { result.output = []; result.type = 'quotes'; break; }
                    
                    const prompt = `Extract 6-10 important direct quotes from these academic paper abstracts.

SOURCES:
${sources.slice(0, 10).map((s, i) => `--- SOURCE ${i + 1}: ${fmtAuthor(s)} (${s.year}) ---\n"${s.title}"\n${s.text?.substring(0, 1200)}`).join('\n\n')}

RULES:
1. Extract EXACT phrases from the abstracts (do not paraphrase)
2. Each quote should be a meaningful sentence or key finding
3. Get quotes from AS MANY different sources as possible (at least 5-6 sources)
4. Focus on: key findings, conclusions, important claims
5. Include the author name and year with each quote

FORMAT each quote on its own line as:
AuthorLastName et al. (Year): "exact quote from the abstract"

Example:
Smith et al. (2023): "CRISPR technology has revolutionized genome editing capabilities"
Jones & Lee (2022): "Ethical considerations must guide the development of germline therapies"`;

                    const resp = await GeminiAPI.chat(prompt, GEMINI);
                    
                    // Parse quotes
                    const quotes = [];
                    for (const line of resp.split('\n')) {
                        const match = line.match(/^([^:]+\(\d{4}\))\s*:\s*[""]([^""]+)[""]/);
                        if (match) {
                            quotes.push({ source: match[1].trim(), quote: match[2].trim() });
                        }
                    }
                    
                    console.log('[Agent] Extracted', quotes.length, 'quotes');
                    result.output = quotes;
                    result.type = 'quotes';
                    break;
                }

                case 'WRITE': {
                    const { researchSources = [], extractedQuotes = [], task: userTask, uploadedFile } = context;
                    
                    // Build source info
                    const sourceInfo = researchSources.slice(0, 10).map((s, i) => {
                        return `SOURCE ${i+1}: ${fmtAuthor(s)} (${s.year})
Title: "${s.title}"
Abstract: ${s.text?.substring(0, 600) || 'No abstract'}`;
                    }).join('\n\n');

                    // Build quotes section if available
                    let quotesSection = '';
                    if (extractedQuotes?.length) {
                        quotesSection = `\n\nPRE-EXTRACTED QUOTES TO USE (include these in your essay):
${extractedQuotes.map((q, i) => `${i+1}. ${q.source}: "${q.quote}"`).join('\n')}`;
                    }

                    // Handle uploaded file context
                    let fileContext = '';
                    if (uploadedFile?.data) {
                        fileContext = `\n\nUSER UPLOADED FILE: ${uploadedFile.name}
The user has uploaded a file for context. Consider it when writing.`;
                    }

                    const prompt = `You are an expert academic writer. Write a well-researched essay with DIRECT QUOTES from sources.

TASK: ${userTask}
${fileContext}

SOURCES:
${sourceInfo}
${quotesSection}

CRITICAL REQUIREMENTS:

1. INCLUDE 4-6 DIRECT QUOTES using varied transitions:
   - According to [Author] ([Year]), "[quote]"
   - As [Author] ([Year]) argues, "[quote]"
   - [Author] ([Year]) found that "[quote]"
   - Research suggests that "[quote]" ([Author], [Year])
   - "[Quote]," notes [Author] ([Year])
${extractedQuotes?.length ? '\n   USE THE PRE-EXTRACTED QUOTES ABOVE - they are already formatted correctly.' : ''}

2. DEFINE ACRONYMS on first use:
   "Preimplantation Genetic Diagnosis (PGD)" then use "PGD"

3. DO NOT add extra in-text citations like (Author, 2020) EXCEPT when introducing quotes
   The citation system will add additional citations later

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
                    const input = context.previousOutput || '';
                    if (!input) { result.output = ''; break; }
                    
                    const prompt = `Rewrite this text to sound more natural and human-written while preserving ALL direct quotes and academic quality.

TEXT:
${input}

RULES:
1. Keep ALL direct quotes exactly as they are (text inside quotation marks)
2. Keep all author attributions (According to X, As Y argues, etc.)
3. Make surrounding text more conversational and natural
4. Vary sentence structure and length
5. Add subtle transitions between ideas
6. Maintain academic tone but make it engaging
7. DO NOT add any new citations or references
8. Plain text only - no markdown

Rewrite now:`;

                    result.output = stripMarkdown(await GeminiAPI.chat(prompt, GEMINI));
                    result.type = 'text';
                    break;
                }

                case 'CITE': {
                    // Return sources for bibliography - don't modify text
                    result.output = context.previousOutput || '';
                    result.citedSources = context.researchSources || [];
                    result.type = 'cited';
                    break;
                }

                case 'GRADE': {
                    const text = context.previousOutput || '';
                    if (!text) { result.output = { grade: 'N/A', feedback: 'No text to grade.' }; result.type = 'grade'; break; }
                    
                    const prompt = `Grade this academic essay and provide detailed feedback.

ESSAY:
${text}

Evaluate on:
1. Thesis clarity and argumentation (25%)
2. Evidence and source integration (25%)
3. Organization and flow (20%)
4. Writing quality and academic tone (20%)
5. Grammar and mechanics (10%)

Format your response as:
GRADE: [A+ to F]

STRENGTHS:
- [strength 1]
- [strength 2]

AREAS FOR IMPROVEMENT:
- [area 1]
- [area 2]

DETAILED FEEDBACK:
[1-2 paragraphs of specific feedback]`;

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
