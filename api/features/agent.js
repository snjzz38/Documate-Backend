// api/features/agent.js
import { GeminiAPI } from '../utils/geminiAPI.js';
import { SourceFinderAPI } from '../utils/sourceFinder.js';
import humanizerHandler from './humanizer.js';
import graderHandler from './grader.js';

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
        if (style === 'mla') return s.authors.length > 2 ? `${s.authors[0].family} et al.` : s.authors.map(a=>a.family).join(' and ');
        return s.authors.length > 2 ? `${s.authors[0].family} et al.` : s.authors.map(a=>a.family).join(' & ');
    }
    return s.author || s.displayName || 'Unknown';
};

// Build fully formatted bibliography HTML on the backend
const buildBibliographyHTML = (sources, style, type) => {
    if (!sources?.length) return { html: '', plain: '' };

    const isApa = style.includes('apa');
    const isMla = style.includes('mla');
    const title = type === 'footnotes' ? 'Notes'
        : isMla ? 'Works Cited'
        : isApa ? 'References'
        : 'Bibliography';

    const sorted = type === 'footnotes'
        ? sources
        : [...sources].sort((a, b) => {
            const ka = (a.authors?.[0]?.family || a.author || 'zzz').toLowerCase();
            const kb = (b.authors?.[0]?.family || b.author || 'zzz').toLowerCase();
            return ka.localeCompare(kb);
        });

    // Make only the trailing DOI URL a clickable link
    const linkifyDoi = (text, doi) => {
        if (!text || !doi) return text || '';
        const doiUrl = `https://doi.org/${doi}`;
        // Escape for use in regex
        const escaped = doiUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return text.replace(
            new RegExp(`(${escaped})([.\\s]*)$`),
            `<a href="${doiUrl}" target="_blank" style="color:#000; text-decoration:underline;">${doiUrl}</a>$2`
        );
    };

    const wrapStyle = [
        `font-family: 'Times New Roman', Times, serif`,
        `font-size: 12pt`,
        `line-height: 2`,
        `color: #000`,
        `background: #fff`,
        `padding: 20px`
    ].join('; ');

    const titleStyle = [
        `text-align: center`,
        `margin-bottom: 24px`,
        `font-weight: normal`,
        `font-family: 'Times New Roman', Times, serif`,
        `font-size: 12pt`
    ].join('; ');

    const entryStyle = [
        `text-indent: -36px`,
        `padding-left: 36px`,
        `margin: 0 0 24px 0`,
        `line-height: 2`,
        `font-family: 'Times New Roman', Times, serif`,
        `font-size: 12pt`,
        `color: #000`
    ].join('; ');

    let html = `<div class="bibliography" style="${wrapStyle}">`;
    html += `<p style="${titleStyle}">${title}</p>`;
    let plain = `${title}\n\n`;

    sorted.forEach((s, i) => {
        const citationText = s.citation || '';
        const plain_entry = citationText || `${s.author || 'Unknown'} (${s.year || 'n.d.'}). ${s.title}.`;

        if (type === 'footnotes') {
            const linked = linkifyDoi(plain_entry, s.doi);
            html += `<p style="${entryStyle}"><sup>${i+1}</sup> ${linked}</p>`;
            plain += `${i+1}. ${plain_entry}\n\n`;
        } else {
            const linked = linkifyDoi(plain_entry, s.doi);
            html += `<p style="${entryStyle}">${linked}</p>`;
            plain += `${plain_entry}\n\n`;
        }
    });

    html += `</div>`;
    return { html, plain };
};

// Build formatted essay HTML on the backend
const buildEssayHTML = text => {
    if (!text) return '<i>No output.</i>';
    const escaped = text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    return `<div style="font-family: 'Times New Roman', Times, serif; font-size: 12pt; line-height: 2; color: #000;">` +
        escaped.split(/\n\n+/).map(p => `<p style="margin: 0 0 0 0; text-indent: 36px;">${p.replace(/\n/g, '<br>')}</p>`).join('\n') +
        `</div>`;
};

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        const { action, task, options = {} } = req.body;
        const GEMINI = process.env.GEMINI_API_KEY;

        if (action === 'plan') {
            const steps = [{ tool: 'RESEARCH', action: 'Find academic sources' }];
            if (options.enableWrite !== false) steps.push({ tool: 'WRITE', action: 'Write essay' });
            if (options.enableHumanize) steps.push({ tool: 'HUMANIZE', action: 'Humanize text' });
            if (options.enableCite) steps.push({ tool: 'CITE', action: `Add ${options.citationType || 'in-text'} citations` });
            if (options.enableQuotes) steps.push({ tool: 'QUOTES', action: 'Insert quotes with transitions' });
            steps.push({ tool: 'PROOFREAD', action: 'Polish and improve' });
            if (options.enableGrade) steps.push({ tool: 'GRADE', action: 'Grade work' });
            return res.status(200).json({ success: true, plan: { steps } });
        }

        if (action === 'execute_step') {
            const { step, context = {}, options = {} } = req.body;
            const result = { success: true, output: '', type: 'text' };

            switch (step.tool.toUpperCase()) {

            case 'RESEARCH': {
                const topic = extractTopic(context.task || '');
                const style = options.citationStyle || 'apa7';
                const papers = await SourceFinderAPI.searchTopic(topic, 12, style);
                if (!papers?.length) { result.output = { sources: [] }; result.type = 'research'; break; }
            
                const sources = papers.map((p, i) => ({
                    id: i + 1,
                    title: p.title, url: p.url, doi: p.doi,
                    venue: p.venue, author: p.author, authors: p.authors || [],
                    year: p.year, displayName: p.author || p.displayName,
                    text: p.abstract,
                    citation: p.citation || null,           // preserve Crossref citation
                    citationSource: p.citationSource || null // preserve source flag
                }));
            
                const crossrefCount = sources.filter(s => s.citationSource === 'crossref').length;
                console.log(`[Agent] RESEARCH: ${crossrefCount}/${sources.length} Crossref citations fetched`);
            
                result.output = { sources };
                result.type = 'research';
                break;
            }

                case 'WRITE': {
                    const { researchSources = [], task: userTask, uploadedFile, uploadedFiles = [] } = context;

                    const sourceInfo = researchSources.slice(0, 10).map((s, i) =>
                        `SOURCE ${i+1}:\nTitle: "${s.title}"\nKey info: ${s.text?.substring(0, 500) || 'N/A'}`
                    ).join('\n\n');

                    const allFiles = uploadedFiles.length > 0 ? uploadedFiles : (uploadedFile ? [uploadedFile] : []);
                    const imageFiles = allFiles.filter(f => f.type?.startsWith('image/'));
                    const pdfFiles = allFiles.filter(f => f.type === 'application/pdf');
                    const otherFiles = allFiles.filter(f => !f.type?.startsWith('image/') && f.type !== 'application/pdf');

                    let pdfContext = '';
                    for (const pdf of pdfFiles) {
                        try {
                            const pdfText = await GeminiAPI.vision(`Extract and summarize all key information from this PDF document thoroughly.`, GEMINI, [pdf]);
                            pdfContext += `\nUPLOADED DOCUMENT (${pdf.name}):\n${pdfText}\n`;
                        } catch (e) { console.error('[Agent] PDF extraction failed:', e.message); }
                    }

                    const fileContext = otherFiles.length > 0
                        ? `\nUSER FILES: ${otherFiles.map(f => f.name).join(', ')} - consider this context.\n`
                        : '';

                    const prompt = `Write a well-researched academic essay.
TASK: ${userTask}
${pdfContext}${fileContext}
RESEARCH SOURCES:
${sourceInfo}

REQUIREMENTS:
1. Write naturally WITHOUT any citations or author references
2. Use research content in your own words
3. Define acronyms on first use
4. Structure: Introduction → Body paragraphs → Conclusion
5. Plain text only - no markdown, no bold, no headers
6. Do NOT include a bibliography
${imageFiles.length > 0 ? '7. Carefully analyze and describe the uploaded image(s) as part of the essay.' : ''}

Write the essay now:`;

                    const rawText = imageFiles.length > 0
                        ? await GeminiAPI.vision(prompt, GEMINI, imageFiles)
                        : await GeminiAPI.chat(prompt, GEMINI);

                    const plainText = stripMarkdown(stripRefs(rawText));
                    result.output = plainText;
                    result.outputHtml = buildEssayHTML(plainText);
                    result.type = 'text';
                    break;
                }

                case 'HUMANIZE': {
                    const input = context.previousOutput || '';
                    if (!input) { result.output = ''; result.outputHtml = ''; break; }

                    const mockReq = { method: 'POST', body: { text: input, tone: 'Academic' } };
                    let humanizedResult = '';
                    const mockRes = { setHeader: () => {}, status: () => ({ end: () => {}, json: d => { humanizedResult = d; } }) };
                    await humanizerHandler(mockReq, mockRes);

                    const humanized = (humanizedResult.success && humanizedResult.result)
                        ? humanizedResult.result
                        : stripMarkdown(await GeminiAPI.chat(`Rewrite naturally while keeping academic quality. Plain text only.\n\n${input}`, GEMINI));

                    result.output = humanized;
                    result.outputHtml = buildEssayHTML(humanized);
                    result.type = 'text';
                    break;
                }

               case 'CITE': {
                    const input = context.previousOutput || '';
                    const sources = context.researchSources || [];
                    const style = options.citationStyle || 'apa7';
                    const type = options.citationType || 'in-text';
                
                    if (!input || !sources.length) {
                        result.output = input;
                        result.outputHtml = buildEssayHTML(input);
                        result.citedSources = sources;
                        result.bibliographyHtml = '';
                        result.type = 'cited';
                        break;
                    }
                
                    const isApa = style.includes('apa');
                    const isMla = style.includes('mla');
                
                    // Fetch Crossref citations for any sources that don't have them yet
                    const sourcesNeedingCitations = sources.filter(s => s.doi && s.citationSource !== 'crossref');
                    if (sourcesNeedingCitations.length > 0) {
                        const updatedSources = await SourceFinderAPI.fetchAllCitations(sourcesNeedingCitations, style);
                        updatedSources.forEach(updated => {
                            if (updated.citationSource !== 'crossref') return;
                            const original = sources.find(s => s.doi === updated.doi);
                            if (original) {
                                original.citation = updated.citation;
                                original.citationSource = 'crossref';
                            }
                        });
                    }
                
                    // Log how many real citations we have
                    const crossrefCount = sources.filter(s => s.citationSource === 'crossref').length;
                    console.log(`[Agent] CITE: ${crossrefCount}/${sources.length} Crossref citations`);
                
                    const sourceList = sources.slice(0, 12).map((s, i) => {
                        const author = fmtAuthor(s, isMla ? 'mla' : 'apa');
                        return `[${i+1}] ${author} (${s.year})\n   Title: "${s.title}"\n   Key findings: ${s.text?.substring(0, 300) || 'N/A'}`;
                    }).join('\n\n');
                
                    let citationFormat = '';
                    if (type === 'in-text') {
                        if (isApa) citationFormat = `APA 7th: (Author, Year) or Author (Year)`;
                        else if (isMla) citationFormat = `MLA 9th: (Author) - no year`;
                        else citationFormat = `Chicago: (Author Year)`;
                    } else if (type === 'footnotes') {
                        citationFormat = `Superscript numbers¹ ² ³ at end of cited sentences.`;
                    }
                
                    const prompt = `Add scholarly citations to this essay with strong signposting.
                
                ESSAY:
                ${input}
                
                AVAILABLE SOURCES:
                ${sourceList}
                
                CITATION FORMAT: ${citationFormat}
                
                INSTRUCTIONS:
                1. Insert 10-15 citations with signposting phrases
                2. Use varied phrases: "As X demonstrates,", "X argues that,", "According to X,"
                3. Distribute citations across ALL paragraphs evenly
                4. Match citations to the most relevant sources
                5. Do NOT add a bibliography section
                6. Ensure citation format matches: ${citationFormat}
                
                Return ONLY the essay with citations inserted:`;
                
                    const citedText = stripMarkdown(stripRefs(await GeminiAPI.chat(prompt, GEMINI)));
                    const bib = buildBibliographyHTML(sources, style, type);
                
                    result.output = citedText;
                    result.outputHtml = buildEssayHTML(citedText);
                    result.citedSources = sources;
                    result.bibliographyHtml = bib.html;
                    result.bibliographyPlain = bib.plain;
                    result.type = 'cited';
                    break;
                }

                case 'QUOTES': {
                    const input = context.previousOutput || '';
                    const sources = context.researchSources || [];
                    if (!input || !sources.length) { result.output = input; result.outputHtml = buildEssayHTML(input); result.type = 'text'; break; }

                    const quotesFromSources = sources.slice(0, 10).map(s => {
                        const author = fmtAuthor(s);
                        const sentences = (s.text || '').match(/[^.!?]+[.!?]+/g) || [];
                        const goodSentence = sentences.find(sent =>
                            sent.length > 40 && sent.length < 250 &&
                            /show|found|suggest|demonstrate|indicate|reveal|important|significant|evidence/i.test(sent)
                        ) || sentences.find(sent => sent.length > 50 && sent.length < 200) || sentences[0] || '';
                        return { author, year: s.year, title: s.title, quote: goodSentence.trim() };
                    }).filter(q => q.quote);

                    const quotesList = quotesFromSources.map((q, i) =>
                        `[${i+1}] ${q.author} (${q.year}):\n   Quote: "${q.quote}"\n   From: "${q.title}"`
                    ).join('\n\n');

                    const prompt = `Insert 4-6 direct quotes into this essay with analytical transitions.

ESSAY:
${input}

QUOTES TO INSERT:
${quotesList}

INSTRUCTIONS:
1. Find the best places to insert each quote where it strengthens the argument
2. Use analytical transitions that explain why the quote matters
3. After each quote add 1-2 sentences analyzing its significance
4. Keep ALL existing text and citations
5. Do NOT add a bibliography section

Return the essay with quotes inserted:`;

                    const withQuotes = stripMarkdown(await GeminiAPI.chat(prompt, GEMINI));
                    result.output = withQuotes;
                    result.outputHtml = buildEssayHTML(withQuotes);
                    result.type = 'text';
                    break;
                }

                case 'PROOFREAD': {
                    const input = context.previousOutput || '';
                    if (!input) { result.output = ''; result.outputHtml = ''; break; }

                    const prompt = `Proofread and polish this academic essay. Fix grammar, spelling, punctuation. Improve awkward phrasing. Keep ALL existing content, citations, and quotes. Plain text only - no markdown.\n\nESSAY:\n${input}\n\nReturn the polished essay:`;
                    const polished = stripMarkdown(stripRefs(await GeminiAPI.chat(prompt, GEMINI)));

                    result.output = polished;
                    result.outputHtml = buildEssayHTML(polished);
                    result.type = 'text';
                    break;
                }

                case 'GRADE': {
                    const text = context.previousOutput || '';
                    if (!text) { result.output = { grade: 'N/A', feedback: 'No text to grade.' }; result.type = 'grade'; break; }

                    const mockReq = {
                        method: 'POST',
                        body: {
                            text,
                            instructions: context.task || '',
                            rubric: `1. Thesis clarity and argumentation (25%)\n2. Evidence and source integration (25%)\n3. Organization and flow (20%)\n4. Writing quality and academic tone (20%)\n5. Grammar and mechanics (10%)`
                        }
                    };
                    let gradeResult = null;
                    const mockRes = { setHeader: () => {}, status: () => ({ end: () => {}, json: d => { gradeResult = d; } }) };
                    await graderHandler(mockReq, mockRes);

                    const feedback = gradeResult?.result || 'Grading completed.';
                    const gradeMatch = feedback.match(/(?:Overall\s+)?Grade[:\s]*([A-F][+-]?)/i);
                    result.output = { grade: gradeMatch ? gradeMatch[1].toUpperCase() : 'B', feedback };
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
