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

const stripRefs = t => t.replace(/\n\n\*?\*?(?:References|Works Cited|Bibliography|Notes)\*?\*?[\s\S]*$/i,'').trim();

const extractTopic = text => {
    const m = text.match(/(?:about|essay on|write about)[:\s]+["']?([^"'\n.!?]{10,80})/i);
    if (m) return m[1];
    const skip = new Set(['write','essay','paragraph','summary','discuss','explain','please','about','using','citations']);
    return (text.toLowerCase().match(/\b[a-z]{4,}\b/g)||[]).filter(w=>!skip.has(w)).slice(0,5).join(' ') || text.substring(0,80);
};

// Returns last name(s) only — handles structured authors array OR plain "First Last" strings
const fmtAuthor = (s, style = 'apa') => {
    if (s.authors?.length && s.authors[0].family) {
        if (style === 'mla') return s.authors.length > 2 ? `${s.authors[0].family} et al.` : s.authors.map(a=>a.family).join(' and ');
        return s.authors.length > 2 ? `${s.authors[0].family} et al.` : s.authors.map(a=>a.family).join(' & ');
    }
    const raw = s.author || s.displayName || '';
    if (!raw) return 'Unknown';
    const extractLast = name => { const p = name.trim().split(/\s+/); return p[p.length - 1]; };
    const names = raw.split(/,\s*(?=[A-Z])|(?:\s+&\s+|\s+and\s+)/i).map(n=>n.trim()).filter(Boolean);
    if (!names.length) return 'Unknown';
    if (names.length === 1) return extractLast(names[0]);
    if (names.length > 2) return `${extractLast(names[0])} et al.`;
    return names.map(extractLast).join(style === 'mla' ? ' and ' : ' & ');
};

// Strips any source list / reference list that the model appended to the essay text
const stripSourceAppendix = t => t
    .replace(/\n\n(?:Sources?|References?|Works Cited|Bibliography|Notes)[:\s]*\n[\s\S]*$/i, '')
    .replace(/\n\nThe following sources[^]+$/i, '')
    .replace(/\n\n\(.*?\d{4}.*?\)[.,\s]*$/gm, '')
    .trim();

const renderEntry = (plainCitation, source) => {
    if (!plainCitation) return '';
    const journal = source.venue || '';
    const doiUrl = source.doi ? `https://doi.org/${source.doi}` : '';

    let text = plainCitation;

    if (journal) {
        const ej = journal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        text = text.replace(new RegExp(`(${ej})`), '\x00I\x00$1\x00/I\x00');
    }
    if (doiUrl) {
        const eu = doiUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        text = text.replace(new RegExp(eu), '\x00A\x00' + doiUrl + '\x00/A\x00');
    }

    text = text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    text = text
        .replace(/\x00I\x00/g,'<i>').replace(/\x00\/I\x00/g,'</i>')
        .replace(/\x00A\x00/g,`<a href="${doiUrl}" target="_blank">`).replace(/\x00\/A\x00/g,'</a>');

    return text;
};

const buildBibliographyHTML = (sources, style, type, insertionOrder = null) => {
    if (!sources?.length) return { html: '', plain: '' };

    const isApa = style.includes('apa');
    const isMla = style.includes('mla');
    const isFootnotes = type === 'footnotes';

    const title = isFootnotes ? 'Notes' : isMla ? 'Works Cited' : isApa ? 'References' : 'Bibliography';

    const sorted = isFootnotes
        ? (insertionOrder || sources)
        : [...sources].sort((a,b) => {
            const ka = (a.authors?.[0]?.family || a.author || 'zzz').toLowerCase();
            const kb = (b.authors?.[0]?.family || b.author || 'zzz').toLowerCase();
            return ka.localeCompare(kb);
        });

    const wrapStyle = `font-family:'Times New Roman',Times,serif;font-size:12pt;line-height:2;color:#000;background:#fff;padding:20px;`;
    const titleStyle = `text-align:center;margin-bottom:24px;font-weight:normal;font-family:'Times New Roman',Times,serif;font-size:12pt;`;
    const entryStyle = `text-indent:-36px;padding-left:36px;margin:0 0 24px 0;line-height:2;font-family:'Times New Roman',Times,serif;font-size:12pt;color:#000;`;

    let html = `<div class="bibliography" style="${wrapStyle}"><p style="${titleStyle}">${title}</p>`;
    let plain = `${title}\n\n`;

    sorted.forEach((s,i) => {
        const citationPlain = s.citation || `${s.author||'Unknown'} (${s.year||'n.d.'}). ${s.title||'Untitled'}.`;
        const citationHtml = renderEntry(citationPlain, s);
        if (isFootnotes) {
            html += `<p style="${entryStyle}">${i+1}. ${citationHtml}</p>`;
            plain += `${i+1}. ${citationPlain}\n\n`;
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
    const hasHtml = /<[a-z][\s\S]*>/i.test(text);
    if (hasHtml) {
        return `<div style="font-family:'Times New Roman',Times,serif;font-size:12pt;line-height:2;color:#000;">` +
            text.split(/\n\n+/).map(p=>`<p style="margin:0;text-indent:36px;">${p.replace(/\n/g,'<br>')}</p>`).join('\n') +
            `</div>`;
    }
    return `<div style="font-family:'Times New Roman',Times,serif;font-size:12pt;line-height:2;color:#000;">` +
        text.split(/\n\n+/).map(p=>`<p style="margin:0;text-indent:36px;">${p.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>')}</p>`).join('\n') +
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

                    const sources = papers.map((p,i) => ({
                        id: i+1,
                        title: p.title, url: p.url, doi: p.doi,
                        venue: p.venue, author: p.author, authors: p.authors||[],
                        year: p.year, displayName: p.author||p.displayName,
                        text: p.abstract,
                        citation: p.citation||null,
                        citationSource: p.citationSource||null,
                        volume: p.volume||null, issue: p.issue||null, pages: p.pages||null
                    }));

                    console.log('[Agent] RESEARCH:', sources.filter(s=>s.citationSource==='crossref').length, '/', sources.length, 'Crossref');
                    result.output = { sources };
                    result.type = 'research';
                    break;
                }

                case 'WRITE': {
                    const { researchSources=[], task: userTask, uploadedFile, uploadedFiles=[] } = context;

                    const sourceInfo = researchSources.slice(0,10).map((s,i)=>
                        `SOURCE ${i+1}:\nTitle: "${s.title}"\nKey info: ${s.text?.substring(0,500)||'N/A'}`
                    ).join('\n\n');

                    const allFiles = uploadedFiles.length>0 ? uploadedFiles : (uploadedFile ? [uploadedFile] : []);
                    const imageFiles = allFiles.filter(f=>f.type?.startsWith('image/'));
                    const pdfFiles = allFiles.filter(f=>f.type==='application/pdf');
                    const otherFiles = allFiles.filter(f=>!f.type?.startsWith('image/')&&f.type!=='application/pdf');

                    let pdfContext = '';
                    for (const pdf of pdfFiles) {
                        try {
                            const pdfText = await GeminiAPI.vision(`Extract and summarize all key information from this PDF document thoroughly.`, GEMINI, [pdf]);
                            pdfContext += `\nUPLOADED DOCUMENT (${pdf.name}):\n${pdfText}\n`;
                        } catch(e) { console.error('[Agent] PDF extraction failed:', e.message); }
                    }

                    const fileContext = otherFiles.length>0 ? `\nUSER FILES: ${otherFiles.map(f=>f.name).join(', ')} - consider this context.\n` : '';

                    const taskLower = userTask.toLowerCase();
                    const isQuestions = /\?\s*$|\?\s*\n|questions?|answer|respond to|a\)|b\)|1\.|2\./i.test(userTask);
                    const isList = /list|bullet|enumerate|summarize|outline/i.test(taskLower);
                    const isEssay = /essay|argue|argument|thesis|discuss at length|write about/i.test(taskLower);

                    let formatInstructions = '';
                    if (isQuestions) {
                        formatInstructions = `FORMAT RULES:
- Answer each question directly and completely
- Keep the same question structure/numbering as given
- Answer each part (a, b, c etc.) separately and clearly labeled
- Do not turn this into an essay
- Plain text only - no markdown`;
                    } else if (isList) {
                        formatInstructions = `FORMAT RULES:
- Use clear, organized structure appropriate to the task
- Plain text only - no markdown`;
                    } else if (isEssay) {
                        formatInstructions = `FORMAT RULES — ESSAY:
THESIS: Strong position with 2-3 clear reasons
STRUCTURE: Intro (context + thesis) → Body (one argument per paragraph) → Conclusion (synthesis not summary)
SENTENCE VARIETY: Vary sentence openings and lengths throughout
EVIDENCE: Paraphrase ideas from sources in your own words — no direct quotes
STYLE: Concise, formal academic tone — avoid filler phrases`;
                    } else {
                        formatInstructions = `FORMAT RULES:
- Follow the format most appropriate for this task
- Plain text only - no markdown`;
                    }

                    const prompt = `Complete the following task accurately and appropriately.

TASK:
${userTask}
${pdfContext}${fileContext}
${researchSources.length>0 ? `RESEARCH SOURCES (for ideas only — do NOT cite or reference these):\n${sourceInfo}` : ''}

${formatInstructions}

CRITICAL:
- Do NOT include any citations, author names, source references, or bibliography of ANY kind
- Do NOT list sources at the end
- Plain text only - no markdown, no bold, no headers unless the task requires them
${imageFiles.length>0 ? '- Carefully analyze and describe the uploaded image(s) as part of the response.' : ''}

Complete the task now:`;

                    const rawText = imageFiles.length>0
                        ? await GeminiAPI.vision(prompt, GEMINI, imageFiles)
                        : await GeminiAPI.chat(prompt, GEMINI);
                    const plainText = stripMarkdown(stripRefs(stripSourceAppendix(rawText)));
                    result.output = plainText;
                    result.outputHtml = buildEssayHTML(plainText);
                    result.type = 'text';
                    break;
                }

                case 'HUMANIZE': {
                    const input = context.previousOutput || '';
                    if (!input) { result.output=''; result.outputHtml=''; break; }

                    const mockReq = { method:'POST', body:{ text:input, tone:'Academic' } };
                    let humanizedResult = '';
                    const mockRes = { setHeader:()=>{}, status:()=>({ end:()=>{}, json:d=>{ humanizedResult=d; } }) };
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
                    const sources = context.researchSources || [];
                    const style = options.citationStyle || 'apa7';
                    const type = options.citationType || 'in-text';

                    // Use previousOutput if available, fall back to raw task text.
                    // Strip any source appendix the WRITE step may have accidentally appended.
                    const rawInput = (context.previousOutput || '').trim() || (context.task || '').trim();
                    const input = stripSourceAppendix(stripRefs(rawInput));

                    // Always build bibliography from whatever sources we have
                    const buildAndReturn = async (essayText, citedSources, insertionOrder = null) => {
                        const bib = buildBibliographyHTML(
                            citedSources, style,
                            type === 'footnotes' ? 'footnotes' : 'bibliography',
                            insertionOrder
                        );
                        result.output = essayText;
                        result.outputHtml = buildEssayHTML(essayText);
                        result.citedSources = citedSources;
                        result.bibliographyHtml = bib.html;
                        result.bibliographyPlain = bib.plain;
                        result.type = 'cited';
                    };

                    // No sources — return text as-is with empty bibliography
                    if (!sources.length) {
                        await buildAndReturn(input, []);
                        break;
                    }

                    // No essay text — return bibliography only
                    if (!input) {
                        await buildAndReturn('', sources);
                        break;
                    }

                    const isApa = style.includes('apa');
                    const isMla = style.includes('mla');

                    // Fetch missing Crossref citations
                    const needsCitation = sources.filter(s=>s.doi && s.citationSource!=='crossref');
                    if (needsCitation.length>0) {
                        console.log('[Agent] CITE: fetching', needsCitation.length, 'missing citations');
                        const updated = await SourceFinderAPI.fetchAllCitations(needsCitation, style);
                        updated.forEach(u => {
                            if (u.citationSource!=='crossref') return;
                            const orig = sources.find(s=>s.doi===u.doi);
                            if (orig) {
                                orig.citation=u.citation; orig.citationSource='crossref';
                                orig.volume=u.volume; orig.issue=u.issue; orig.pages=u.pages;
                                if (u.authors?.length) orig.authors=u.authors;
                            }
                        });
                    }

                    console.log('[Agent] CITE:', sources.filter(s=>s.citationSource==='crossref').length, '/', sources.length, 'Crossref');

                    // Build source list with explicit last-name keys for the model
                    const sourceList = sources.slice(0,12).map((s,i) => {
                        const lastName = fmtAuthor(s, isMla?'mla':'apa');
                        const fullName = s.author || s.displayName || lastName;
                        return `[${i+1}] CITE-AS: (${lastName}${isApa?`, ${s.year}`:''}) | Full: ${fullName} (${s.year})\n   Title: "${s.title}"\n   Findings: ${s.text?.substring(0,250)||'N/A'}`;
                    }).join('\n\n');

                    let citationFormat = '';
                    if (type==='in-text') {
                        if (isApa) citationFormat = `APA 7th: parenthetical = (LastName, Year) | narrative = LastName (Year). Use ONLY the "CITE-AS" key shown above — never invent author names.`;
                        else if (isMla) citationFormat = `MLA 9th: (LastName) — no year. Use ONLY the "CITE-AS" key shown above.`;
                        else citationFormat = `Chicago: (LastName Year). Use ONLY the "CITE-AS" key shown above.`;
                    } else if (type==='footnotes') {
                        citationFormat = `Footnote superscripts: number each citation occurrence sequentially (¹²³…). Each occurrence of the same source gets its own new number.`;
                    }

                    const prompt = `Add scholarly citations to this essay using ONLY the sources listed below. Do not invent, assume, or reuse any author names from the essay text itself — only use the sources in the list.

ESSAY:
${input}

SOURCES (use ONLY these — cite by their CITE-AS key):
${sourceList}

CITATION FORMAT: ${citationFormat}

RULES:
1. Cite ONLY where a claim maps clearly to one of the listed sources above
2. If a claim cannot be matched to a listed source, leave it uncited — do NOT fabricate a citation
3. Vary citation introduction patterns: parenthetical, narrative (Author (Year) found…), embedded mid-sentence
4. Paraphrase source findings — only quote directly when exact wording is essential (max one quote per paragraph, under 20 words)
5. Never end a paragraph with a bare citation — always follow with your own analytical sentence
6. Do NOT add a bibliography or reference list — that will be added separately
7. Do NOT include any source list, "Sources:" section, or footnote list at the end

Return ONLY the essay body with citations inserted:`;

                    let citedText = await GeminiAPI.chat(prompt, GEMINI);
                    citedText = stripMarkdown(stripRefs(stripSourceAppendix(citedText)));

                    // Footnotes second pass
                    if (type==='footnotes') {
                        const fixPrompt = `Review this essay. Every time an author name appears in the text, it must be followed by a superscript footnote number. Add any missing superscripts based on the numbering already present. Do not change anything else. Do not add a reference list.

ESSAY:
${citedText}

SOURCES:
${sourceList}

Return the corrected essay only:`;
                        citedText = stripMarkdown(stripRefs(stripSourceAppendix(await GeminiAPI.chat(fixPrompt, GEMINI))));
                    }

                    // Rebuild sequential footnote numbering
                    let insertionOrder = null;
                    let finalText = citedText;

                    if (type==='footnotes') {
                        const superToNum={'¹':1,'²':2,'³':3,'⁴':4,'⁵':5,'⁶':6,'⁷':7,'⁸':8,'⁹':9,'⁰':0};
                        const toSuper = n=>String(n).split('').map(d=>'⁰¹²³⁴⁵⁶⁷⁸⁹'[+d]).join('');
                        let normalized = citedText.replace(/<sup>(\d+)<\/sup>/gi,(_,n)=>toSuper(parseInt(n)));
                        const allMatches=[...normalized.matchAll(/[¹²³⁴⁵⁶⁷⁸⁹⁰]+/g)];
                        const parseSuper=str=>{
                            const chars=str.split('');
                            const num=parseInt(chars.map(c=>superToNum[c]??0).join(''));
                            if(num>0&&num<=sources.length) return [num];
                            return chars.map(c=>superToNum[c]).filter(n=>n>0&&n<=sources.length);
                        };
                        const noteEntries=[], matchToNewNums=new Map();
                        allMatches.forEach((m,idx)=>{
                            const nums=parseSuper(m[0]);
                            const newNums=nums.map(sNum=>{
                                const src=sources[sNum-1]; if(!src) return null;
                                noteEntries.push(src); return noteEntries.length;
                            }).filter(Boolean);
                            if(newNums.length) matchToNewNums.set(idx,newNums);
                        });
                        let rewritten=normalized, offset=0;
                        allMatches.forEach((m,idx)=>{
                            const newNums=matchToNewNums.get(idx); if(!newNums?.length) return;
                            const newSuper=newNums.map(toSuper).join('');
                            const pos=m.index+offset;
                            rewritten=rewritten.slice(0,pos)+newSuper+rewritten.slice(pos+m[0].length);
                            offset+=newSuper.length-m[0].length;
                        });
                        finalText=rewritten;
                        insertionOrder=noteEntries;
                    }

                    await buildAndReturn(finalText, sources, insertionOrder);
                    break;
                }

                case 'QUOTES': {
                    const input = context.previousOutput || '';
                    const sources = context.researchSources || [];
                    if (!input || !sources.length) { result.output=input; result.outputHtml=buildEssayHTML(input); result.type='text'; break; }

                    const quotesFromSources = sources.slice(0,10).map(s=>{
                        const author=fmtAuthor(s);
                        const sentences=(s.text||'').match(/[^.!?]+[.!?]+/g)||[];
                        const goodSentence=sentences.find(sent=>
                            sent.length>40&&sent.length<250&&
                            /show|found|suggest|demonstrate|indicate|reveal|important|significant|evidence/i.test(sent)
                        )||sentences.find(sent=>sent.length>50&&sent.length<200)||sentences[0]||'';
                        return { author, year:s.year, title:s.title, quote:goodSentence.trim() };
                    }).filter(q=>q.quote);

                    const quotesList=quotesFromSources.map((q,i)=>
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

                case 'GRADE': {
                    const text = context.previousOutput || '';
                    if (!text) { result.output={grade:'N/A',feedback:'No text to grade.'}; result.type='grade'; break; }

                    const mockReq = {
                        method:'POST',
                        body:{
                            text,
                            instructions:context.task||'',
                            rubric:context.rubric||'',
                            files:context.uploadedFiles?.map(f=>({name:f.name,type:f.type,content:f.data,isBase64:true}))||[]
                        }
                    };
                    let gradeResult=null;
                    const mockRes={ setHeader:()=>{}, status:()=>({ end:()=>{}, json:d=>{ gradeResult=d; } }) };
                    await graderHandler(mockReq, mockRes);

                    const feedback=gradeResult?.result||'Grading completed.';
                    const gradeMatch=feedback.match(/(?:Overall\s+)?Grade[:\s]*([A-F][+-]?|\d+[\/.]\d+)/i)
                        ||feedback.match(/([A-F][+-]?)\s*(?:\/|out of|\()/i);

                    result.output={ grade:gradeMatch?gradeMatch[1].toUpperCase():'—', feedback };
                    result.type='grade';
                    break;
                }

                default:
                    result.output='Unknown step';
            }

            return res.status(200).json(result);
        }

        return res.status(400).json({ success:false, error:'Invalid action' });

    } catch(e) {
        console.error('[Agent] Error:', e);
        return res.status(500).json({ success:false, error:e.message });
    }
}
