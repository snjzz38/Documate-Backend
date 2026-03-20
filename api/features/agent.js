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
    // Check if text already contains HTML tags (e.g. <sup> from citations)
    const hasHtml = /<[a-z][\s\S]*>/i.test(text);
    if (hasHtml) {
        // Already has HTML — just wrap in paragraphs without escaping
        return `<div style="font-family: 'Times New Roman', Times, serif; font-size: 12pt; line-height: 2; color: #000;">` +
            text.split(/\n\n+/).map(p =>
                `<p style="margin:0 0 0 0; text-indent:36px;">${p.replace(/\n/g, '<br>')}</p>`
            ).join('\n') +
            `</div>`;
    }
    // Plain text — safe to escape
    return `<div style="font-family: 'Times New Roman', Times, serif; font-size: 12pt; line-height: 2; color: #000;">` +
        text.split(/\n\n+/).map(p =>
            `<p style="margin:0 0 0 0; text-indent:36px;">${p.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>')}</p>`
        ).join('\n') +
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
            if (options.enableWrite !== false) {
                steps.push({ tool: 'WRITE', action: 'Write essay' });
                steps.push({ tool: 'REFINE', action: 'Strengthen argument' });
            }
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
                        ? `\nUSER FILES: ${otherFiles.map(f => f.name).join(', ')} - consider this context.\n` : '';
                
                    const prompt = `Write a high-level academic essay with a CLEAR ARGUMENT.
                
                TASK: ${userTask}
                ${pdfContext}${fileContext}
                RESEARCH SOURCES:
                ${sourceInfo}
                
                THESIS:
                - Must take a STRONG position (not neutral)
                - Must include 2-3 clear reasons (e.g. safety, ethics, inequality)
                
                STRUCTURE:
                - Introduction: context + clear argumentative thesis as the last sentence
                - Body Paragraphs: each paragraph = ONE main argument with a strong topic sentence, research evidence, and explanation of WHY it matters
                - Conclusion: reinforce the argument, do not just summarize
                
                STYLE:
                - Be concise and direct — avoid filler phrases
                - Avoid vague phrases like "this highlights" without explanation
                - Formal academic tone throughout
                
                IMPORTANT:
                - Do NOT include any citations or author references yet
                - Do NOT include a bibliography
                - Integrate ideas from sources meaningfully in your own words
                - Plain text only - no markdown, no bold, no headers
                ${imageFiles.length > 0 ? '- Carefully analyze and describe the uploaded image(s) as part of the essay.' : ''}
                
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

                case 'REFINE': {
                    const input = context.previousOutput || '';
                    if (!input) { result.output = ''; result.outputHtml = ''; break; }
                
                    const prompt = `Improve this academic essay's argument quality.
                    
                    ESSAY:
                    ${input}
                    
                    FOCUS:
                    1. Strengthen the thesis — it must take a CLEAR STRONG position, not just describe the issue
                    2. Each body paragraph must develop ONE argument only — eliminate repetition across paragraphs
                    3. Replace vague phrases like "this shows", "this highlights", "this underscores", "this demonstrates" with specific explanations of WHY the evidence matters to YOUR argument
                    4. Every piece of evidence must be connected explicitly to the thesis
                    5. Transitions between paragraphs must show logical progression, not just topic shifts
                    6. Conclusion must synthesize the argument — not restate the introduction
                    7. Keep ALL original content and ideas — only sharpen the logic and language
                    8. Plain text only - no markdown, no bold, no headers
                    
                    Return the improved essay:`;
                
                    const refined = stripMarkdown(stripRefs(await GeminiAPI.chat(prompt, GEMINI)));
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
                2. Each citation must directly support the SPECIFIC claim it follows
                3. After each citation, explain in ONE specific sentence HOW this source proves your point
                4. NEVER mention an author's name in the text without immediately following it with a citation number
                5. If you reference a source by name (e.g. "Smith argues"), you MUST add the superscript right after
                6. Do NOT drop citations into sentences that already make the point clearly
                7. Distribute citations naturally — frontload evidence in argumentative paragraphs
                8. Use varied signposting: "As X argues,", "X's research confirms that,", "X found that,"
                9. Do NOT add a bibliography section
                10. Ensure format matches: ${citationFormat}
                
                Return ONLY the essay with citations inserted:`;
            
                const citedText = stripMarkdown(stripRefs(await GeminiAPI.chat(prompt, GEMINI)));
            
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
                    // ¹⁰ = source 10, ¹² = could be source 12 OR sources 1+2
                    const parseSuper = (str) => {
                        const chars = str.split('');
                        const num = parseInt(chars.map(c => superToNum[c] ?? 0).join(''));
                        if (num > 0 && num <= sources.length) return [num];
                        // Out of range — treat each char as separate citation
                        return chars.map(c => superToNum[c]).filter(n => n > 0 && n <= sources.length);
                    };
                
                    // Build footnote list — every occurrence gets a NEW sequential number
                    // noteEntries[i] = source for footnote i+1
                    const noteEntries = [];
                    // Map from match index to new footnote numbers assigned
                    const matchToNewNums = new Map();
                
                    allMatches.forEach((m, matchIdx) => {
                        const sourceNums = parseSuper(m[0]);
                        const newNums = sourceNums.map(sNum => {
                            const source = sources[sNum - 1];
                            if (!source) return null;
                            noteEntries.push(source);
                            return noteEntries.length; // new sequential number
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
                    insertionOrder = noteEntries; // one entry per footnote number, duplicates allowed
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
