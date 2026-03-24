// api/features/agent.js
import { GeminiAPI } from '../utils/geminiAPI.js';
import { SourceFinderAPI } from '../utils/sourceFinder.js';
import humanizerHandler from './humanizer.js';
import graderHandler from './grader.js';

const stripMarkdown = t => t
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/`([^`]+)`/g, '$1');

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

const renderEntry = (plainCitation, source) => {
    if (!plainCitation) return '';
    const journal = source.venue || '';
    const doiUrl = source.doi ? `https://doi.org/${source.doi}` : '';

    let text = plainCitation;

    // 1. Mark journal for italics before escaping
    if (journal) {
        const ej = journal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        text = text.replace(new RegExp(`(${ej})`), '\x00I\x00$1\x00/I\x00');
    }

    // 2. Mark DOI URL — keep the URL text inside the placeholder
    if (doiUrl) {
        const eu = doiUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        text = text.replace(new RegExp(eu), '\x00A\x00' + doiUrl + '\x00/A\x00');
    }

    // 3. Escape HTML
    text = text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

    // 4. Restore tags
    text = text
        .replace(/\x00I\x00/g, '<i>')
        .replace(/\x00\/I\x00/g, '</i>')
        .replace(/\x00A\x00/g, `<a href="${doiUrl}" target="_blank">`)
        .replace(/\x00\/A\x00/g, '</a>');

    return text;
};

const buildBibliographyHTML = (sources, style, type, insertionOrder = null) => {
    if (!sources?.length) return { html: '', plain: '' };

    const isApa = style.includes('apa');
    const isMla = style.includes('mla');
    const title = type === 'footnotes' ? 'Notes' : isMla ? 'Works Cited' : isApa ? 'References' : 'Bibliography';

    const sorted = type === 'footnotes'
        ? (insertionOrder || sources)
        : [...sources].sort((a, b) => {
            const ka = (a.authors?.[0]?.family || a.author || 'zzz').toLowerCase();
            const kb = (b.authors?.[0]?.family || b.author || 'zzz').toLowerCase();
            return ka.localeCompare(kb);
        });

    const wrapStyle = `font-family: 'Times New Roman', Times, serif; font-size: 12pt; line-height: 2; color: #000; background: #fff; padding: 20px;`;
    const titleStyle = `text-align: center; margin-bottom: 24px; font-weight: normal; font-family: 'Times New Roman', Times, serif; font-size: 12pt;`;
    const entryStyle = `text-indent: -36px; padding-left: 36px; margin: 0 0 24px 0; line-height: 2; font-family: 'Times New Roman', Times, serif; font-size: 12pt; color: #000;`;

    let html = `<div class="bibliography" style="${wrapStyle}">`;
    html += `<p style="${titleStyle}">${title}</p>`;
    let plain = `${title}\n\n`;

    sorted.forEach((s, i) => {
        const citationPlain = s.citation || `${s.author || 'Unknown'} (${s.year || 'n.d.'}). ${s.title || 'Untitled'}.`;
        const citationHtml = renderEntry(citationPlain, s);
        const num = i + 1;
    
        if (type === 'footnotes') {
            html += `<p style="${entryStyle}">${num}. ${citationHtml}</p>`;
            plain += `${num}. ${citationPlain}\n\n`;
        } else {
            html += `<p style="${entryStyle}">${citationHtml}</p>`;
            plain += `${citationPlain}\n\n`;
        }
    });

    html += `</div>`;
    return { html, plain };
};

const buildEssayHTML = text => {
    if (!text) return '<i>No output.</i>';

    // Check if it's primarily code
    const hasCodeBlocks = /```[\w]*\n[\s\S]*?```/.test(text);
    const hasHtml = /<[a-z][\s\S]*>/i.test(text);

    if (hasCodeBlocks) {
        // Render markdown with code blocks
        return `<div style="font-family: 'Times New Roman', Times, serif; font-size: 12pt; line-height: 2; color: #000;">` +
            text.split(/\n\n+/).map(p => {
                if (p.startsWith('```')) {
                    // Code block — preserve as preformatted
                    const match = p.match(/```(\w*)\n([\s\S]*?)```/);
                    if (match) {
                        const lang = match[1] || 'text';
                        const code = match[2].replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
                        return `<div style="margin:12px 0;"><div style="background:#f5f5f5;padding:4px 8px;font-size:10px;font-family:monospace;border-top:1px solid #ddd;border-left:1px solid #ddd;border-right:1px solid #ddd;">${lang}</div><pre style="margin:0;padding:12px;background:#1e1e1e;color:#d4d4d4;font-family:monospace;font-size:11px;overflow-x:auto;border:1px solid #ddd;"><code>${code}</code></pre></div>`;
                    }
                }
                return `<p style="margin:0 0 0 0; text-indent:36px;">${p.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>')}</p>`;
            }).join('\n') +
            `</div>`;
    }

    if (hasHtml) {
        return `<div style="font-family: 'Times New Roman', Times, serif; font-size: 12pt; line-height: 2; color: #000;">` +
            text.split(/\n\n+/).map(p =>
                `<p style="margin:0 0 0 0; text-indent:36px;">${p.replace(/\n/g, '<br>')}</p>`
            ).join('\n') +
            `</div>`;
    }

    return `<div style="font-family: 'Times New Roman', Times, serif; font-size: 12pt; line-height: 2; color: #000;">` +
        text.split(/\n\n+/).map(p =>
            `<p style="margin:0 0 0 0; text-indent:36px;">${p.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>')}</p>`
        ).join('\n') +
        `</div>`;
};;

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        const { action, task, options = {} } = req.body;
        const GEMINI = process.env.GEMINI_API_KEY;

        if (action === 'plan') {
            const taskLower = (task || '').toLowerCase();
            
            // Detect task type
            const isWriting = /essay|argue|argument|thesis|discuss|paragraph|write about|explain|analyze|analyse|compare|contrast|evaluate|assess|review|critique|response|reflection|opinion|position/i.test(task);
            const isCoding = /code|program|function|script|implement|debug|fix|class|algorithm|html|css|javascript|python|java|sql|api|component/i.test(task);
            const isQuestions = /\?\s*(\n|$)|\ba\)|b\)|c\)|\d+\.\s/i.test(task);
        
            const steps = [{ tool: 'RESEARCH', action: 'Find academic sources' }];
            if (options.enableWrite !== false) {
                steps.push({ tool: 'WRITE', action: 'Write response' });
                // Only refine for genuine writing tasks
                if (isWriting && !isCoding && !isQuestions) {
                    steps.push({ tool: 'REFINE', action: 'Strengthen argument' });
                }
            }
            if (options.enableHumanize) steps.push({ tool: 'HUMANIZE', action: 'Humanize text' });
            if (options.enableCite) steps.push({ tool: 'CITE', action: `Add ${options.citationType || 'in-text'} citations` });
            if (options.enableQuotes) steps.push({ tool: 'QUOTES', action: 'Insert quotes with transitions' });
            // Only proofread writing tasks
            if (isWriting && !isCoding) {
                steps.push({ tool: 'PROOFREAD', action: 'Fix grammar errors' });
            }
            if (options.enableGrade) steps.push({ tool: 'GRADE', action: 'Grade work' });
        
            return res.status(200).json({ 
                success: true, 
                plan: { steps, taskType: isCoding ? 'code' : isQuestions ? 'questions' : isWriting ? 'writing' : 'general' } 
            });
        }

        if (action === 'execute_step') {
            const { step, context = {}, options = {} } = req.body;
            const result = { success: true, output: '', type: 'text' };

            switch (step.tool.toUpperCase()) {

                case 'RESEARCH': {
                    const topic = extractTopic(context.task || '');
                    const style = options.citationStyle || 'apa7';
                    console.log('[Agent] Research topic:', topic, 'Style:', style);
                    const papers = await SourceFinderAPI.searchTopic(topic, 12, style);
                    if (!papers?.length) { result.output = { sources: [] }; result.type = 'research'; break; }

                    const sources = papers.map((p, i) => ({
                        id: i + 1,
                        title: p.title, url: p.url, doi: p.doi,
                        venue: p.venue, author: p.author, authors: p.authors || [],
                        year: p.year, displayName: p.author || p.displayName,
                        text: p.abstract,
                        citation: p.citation || null,
                        citationSource: p.citationSource || null,
                        volume: p.volume || null,
                        issue: p.issue || null,
                        pages: p.pages || null
                    }));

                    console.log('[Agent] RESEARCH:', sources.filter(s => s.citationSource === 'crossref').length, '/', sources.length, 'Crossref');
                    result.output = { sources };
                    result.type = 'research';
                    break;
                }

                case 'WRITE': {
                    const { researchSources = [], task: userTask, uploadedFile, uploadedFiles = [], taskType } = context;
                
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
                        ? `\nUSER FILES: ${otherFiles.map(f => f.name).join(', ')} - consider this context.\n` : '';
                
                    // Detect task type
                    const detectedType = taskType ||
                        (/code|program|function|script|implement|debug|fix|class|algorithm|html|css|javascript|python|java|sql/i.test(userTask) ? 'code' :
                        /\?\s*(\n|$)|\ba\)|b\)|c\)|\d+\.\s/i.test(userTask) ? 'questions' :
                        /essay|argue|argument|thesis|discuss at length|write about/i.test(userTask) ? 'writing' : 'general');
                
                    let formatInstructions = '';
                    if (detectedType === 'code') {
                        formatInstructions = `FORMAT RULES:
                - Return working, complete code
                - Use proper code blocks with language specified: \`\`\`python, \`\`\`javascript etc.
                - Add brief comments explaining key sections
                - If multiple files are needed, clearly separate them with headers
                - Include a brief explanation before and/or after the code if helpful`;
                    } else if (detectedType === 'questions') {
                        formatInstructions = `FORMAT RULES:
                - Answer each question directly and completely
                - Keep the same question structure and numbering as given
                - Answer each part (a, b, c etc.) separately and clearly labeled
                - Do not turn this into an essay
                - Be thorough but concise for each answer
                - Plain text only`;
                    } else if (detectedType === 'writing') {
                        formatInstructions = `FORMAT RULES — ACADEMIC ESSAY:
                THESIS:
                - Must take a STRONG position (not neutral)
                - Must include 2-3 clear reasons
                
                STRUCTURE:
                - Introduction: context + clear argumentative thesis as the last sentence
                - Body Paragraphs: each = ONE main argument with topic sentence, evidence, and explanation of WHY it matters
                - Conclusion: reinforce the argument, do not just summarize
                
                STYLE:
                - Concise and direct — avoid filler phrases
                - Avoid vague phrases like "this highlights" without explanation
                - Formal academic tone
                - Define ALL acronyms on first use`;
                    } else {
                        formatInstructions = `FORMAT RULES:
                - Follow the format most appropriate for this specific task
                - If it asks questions, answer them directly
                - If it asks for analysis, provide structured analysis
                - Do not default to essay format unless explicitly asked
                - Plain text only unless code is required`;
                    }
                
                    const prompt = `Complete the following task accurately and appropriately.
                
                TASK:
                ${userTask}
                ${pdfContext}${fileContext}
                ${researchSources.length > 0 ? `RESEARCH SOURCES (for ideas only — do NOT cite or reference these):\n${sourceInfo}` : ''}
                
                ${formatInstructions}
                
                IMPORTANT:
                - Do NOT include any citations, author names, or source references of ANY kind
                - Do NOT include a bibliography
                ${detectedType !== 'code' ? '- Plain text only - no markdown, no bold, no headers unless the task requires them' : ''}
                ${imageFiles.length > 0 ? '- Carefully analyze and describe the uploaded image(s) as part of the response.' : ''}
                
                Complete the task now:`;
                
                    const rawText = imageFiles.length > 0
                        ? await GeminiAPI.vision(prompt, GEMINI, imageFiles)
                        : await GeminiAPI.chat(prompt, GEMINI);
                    const plainText = detectedType === 'code' ? rawText : stripMarkdown(stripRefs(rawText));
                    result.output = plainText;
                    result.outputHtml = buildEssayHTML(plainText);
                    result.type = 'text';
                    break;
                }

             case 'REFINE': {
                const input = context.previousOutput || '';
                if (!input) { result.output = ''; result.outputHtml = ''; break; }
            
                const taskLower = (context.task || '').toLowerCase();
                const isQuestions = /\?\s*$|\?\s*\n|questions?|answer|a\)|b\)|1\.|2\./i.test(context.task || '');
            
                const refinePrompt = isQuestions
                    ? `Review these question answers and improve them.
            
            ANSWERS:
            ${input}
            
            FOCUS:
            1. Make each answer more complete and specific
            2. Ensure each part (a, b, etc.) is clearly addressed
            3. Add relevant detail or analysis where answers are thin
            4. Keep the same question structure and labels
            5. Plain text only - no markdown
            
            Return the improved answers:`
                    : `Improve this academic writing's argument quality.
            
            ESSAY:
            ${input}
            
            FOCUS:
            1. Strengthen the thesis — clear strong position, not just describing the issue
            2. Each body paragraph develops ONE argument only — eliminate repetition
            3. Replace vague phrases like "this shows", "this highlights" with specific explanations of WHY the evidence matters
            4. Every piece of evidence must connect explicitly to the thesis
            5. Transitions must show logical progression
            6. Conclusion must synthesize — not restate the introduction
            7. Keep ALL original content and ideas — only sharpen logic and language
            8. Plain text only - no markdown, no bold, no headers
            
            Return the improved writing:`;
            
                const refined = stripMarkdown(stripRefs(await GeminiAPI.chat(refinePrompt, GEMINI)));
                result.output = refined;
                result.outputHtml = buildEssayHTML(refined);
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

    if (!sources.length) {
        result.output = input;
        result.outputHtml = buildEssayHTML(input);
        result.citedSources = [];
        result.bibliographyHtml = '';
        result.type = 'cited';
        break;
    }

    if (!input) {
        const earlyBib = buildBibliographyHTML(sources, style, type);
        result.output = '';
        result.outputHtml = '';
        result.citedSources = sources;
        result.bibliographyHtml = earlyBib.html;
        result.bibliographyPlain = earlyBib.plain;
        result.type = 'cited';
        break;
    }

    const isApa = style.includes('apa');
    const isMla = style.includes('mla');

    const needsCitation = sources.filter(s => s.doi && s.citationSource !== 'crossref');
    if (needsCitation.length > 0) {
        console.log('[Agent] CITE: fetching', needsCitation.length, 'missing citations');
        const updated = await SourceFinderAPI.fetchAllCitations(needsCitation, style);
        updated.forEach(u => {
            if (u.citationSource !== 'crossref') return;
            const orig = sources.find(s => s.doi === u.doi);
            if (orig) {
                orig.citation = u.citation;
                orig.citationSource = 'crossref';
                orig.volume = u.volume;
                orig.issue = u.issue;
                orig.pages = u.pages;
                if (u.authors?.length) orig.authors = u.authors;
            }
        });
    }

    console.log('[Agent] CITE:', sources.filter(s => s.citationSource === 'crossref').length, '/', sources.length, 'Crossref');

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
        citationFormat = `Use superscript numbers at end of cited sentences. Each citation occurrence gets its OWN unique sequential number even if the same source is cited again. Number every citation sequentially from 1 upward — so if source [3] appears 3 times it gets three different numbers like ³ ⁷ ¹¹.`;
    }

    const prompt = `Add scholarly citations to this essay with strong signposting.

ESSAY:
${input}

AVAILABLE SOURCES:
${sourceList}

CITATION FORMAT: ${citationFormat}

INSTRUCTIONS:
1. Add citations ONLY where claims genuinely need evidence
2. Each citation must directly support the SPECIFIC claim it follows — not just be topically related
3. After each citation, explain in ONE specific sentence HOW this source proves your point
4. NEVER mention an author's name in the text without immediately following it with a citation number
5. If you reference a source by name (e.g. "Smith argues"), you MUST add the superscript right after that sentence
6. Do NOT drop citations into sentences that already make the point clearly
7. Distribute citations naturally — frontload evidence in argumentative paragraphs
8. Use varied signposting: "As X argues,", "X's research confirms that,", "X found that,"
9. Do NOT add a bibliography section
10. Ensure format matches: ${citationFormat}

Return ONLY the essay with citations inserted:`;

    let citedText = stripMarkdown(stripRefs(await GeminiAPI.chat(prompt, GEMINI)));

    // Second pass: fix any author mentions missing a superscript
    if (type === 'footnotes') {
        const prompt = `Review this essay and fix any author mentions that are missing a footnote superscript number.

ESSAY:
${citedText}

AVAILABLE SOURCES:
${sourceList}

RULES:
1. Every time an author is mentioned by name (e.g. "Smith argues", "Jones & Lee found"), there MUST be a superscript number immediately after the closing punctuation of that sentence
2. If an author is mentioned without a superscript, add the correct superscript based on the existing numbering pattern in the essay
3. Do NOT change any existing superscripts
4. Do NOT change any other text
5. Do NOT add a bibliography

Return the corrected essay only:`;

        citedText = stripMarkdown(stripRefs(await GeminiAPI.chat(prompt, GEMINI)));
    }

    // For footnotes: extract insertion order and rebuild sequential numbering
    let insertionOrder = null;
    let finalText = citedText;

    if (type === 'footnotes') {
        const superToNum = {'¹':1,'²':2,'³':3,'⁴':4,'⁵':5,'⁶':6,'⁷':7,'⁸':8,'⁹':9,'⁰':0};
        const toSuper = n => String(n).split('').map(d => '⁰¹²³⁴⁵⁶⁷⁸⁹'[+d]).join('');

        // Normalize <sup>N</sup> to unicode
        let normalized = citedText.replace(/<sup>(\d+)<\/sup>/gi, (_, n) => toSuper(parseInt(n)));

        // Find all superscript sequences in order of appearance
        const allMatches = [...normalized.matchAll(/[¹²³⁴⁵⁶⁷⁸⁹⁰]+/g)];

        // Parse a superscript sequence into source indices
        const parseSuper = (str) => {
            const chars = str.split('');
            const num = parseInt(chars.map(c => superToNum[c] ?? 0).join(''));
            if (num > 0 && num <= sources.length) return [num];
            return chars.map(c => superToNum[c]).filter(n => n > 0 && n <= sources.length);
        };

        // Build footnote list — every occurrence gets a NEW sequential number
        const noteEntries = [];
        const matchToNewNums = new Map();

        allMatches.forEach((m, matchIdx) => {
            const sourceNums = parseSuper(m[0]);
            const newNums = sourceNums.map(sNum => {
                const source = sources[sNum - 1];
                if (!source) return null;
                noteEntries.push(source);
                return noteEntries.length;
            }).filter(Boolean);
            if (newNums.length > 0) matchToNewNums.set(matchIdx, newNums);
        });

        // Rewrite text replacing each superscript with new sequential number(s)
        let rewritten = normalized;
        let offset = 0;
        allMatches.forEach((m, matchIdx) => {
            const newNums = matchToNewNums.get(matchIdx);
            if (!newNums?.length) return;
            const newSuper = newNums.map(toSuper).join('');
            const pos = m.index + offset;
            rewritten = rewritten.slice(0, pos) + newSuper + rewritten.slice(pos + m[0].length);
            offset += newSuper.length - m[0].length;
        });

        finalText = rewritten;
        insertionOrder = noteEntries;
    }

    result.output = finalText;
    result.outputHtml = buildEssayHTML(finalText);
    result.citedSources = sources;

    const bib = buildBibliographyHTML(sources, style, type, insertionOrder);
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
1. Find best places for each quote to strengthen the argument
2. Use analytical transitions that explain why the quote matters
3. After each quote add 1-2 sentences of analysis
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
                
                    const proofPrompt = `Fix ONLY grammatical errors, typos, and spelling mistakes in this text.
                
                STRICT RULES:
                - Do NOT rewrite any sentences
                - Do NOT change word choice or phrasing
                - Do NOT improve style or tone
                - Do NOT restructure paragraphs
                - Only fix: spelling errors, grammatical mistakes, punctuation errors
                - Keep ALL citations, superscripts, footnote numbers exactly as they are
                - Plain text only - no markdown
                
                TEXT:
                ${input}
                
                Return the text with ONLY spelling/grammar/punctuation corrections:`;
                
                    const polished = stripMarkdown(stripRefs(await GeminiAPI.chat(proofPrompt, GEMINI)));
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
                            rubric: context.rubric || '',
                            files: context.uploadedFiles?.map(f => ({
                                name: f.name,
                                type: f.type,
                                content: f.data,
                                isBase64: true
                            })) || []
                        }
                    };
                
                    let gradeResult = null;
                    const mockRes = {
                        setHeader: () => {},
                        status: () => ({ end: () => {}, json: d => { gradeResult = d; } })
                    };
                    await graderHandler(mockReq, mockRes);
                
                    const feedback = gradeResult?.result || 'Grading completed.';
                    const gradeMatch = feedback.match(/(?:Overall\s+)?Grade[:\s]*([A-F][+-]?|\d+[\/.]\d+)/i)
                        || feedback.match(/([A-F][+-]?)\s*(?:\/|out of|\()/i);
                
                    result.output = {
                        grade: gradeMatch ? gradeMatch[1].toUpperCase() : '—',
                        feedback
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
