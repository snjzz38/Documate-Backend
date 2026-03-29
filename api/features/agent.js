// api/features/agent.js
import { GeminiAPI } from '../utils/geminiAPI.js';
import { SourceFinderAPI } from '../utils/sourceFinder.js';
import humanizerHandler from './humanizer.js';
import graderHandler from './grader.js';

// ─── Text cleanup helpers ────────────────────────────────────────────────────

const stripMarkdown = t => t
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/`([^`]+)`/g, '$1');

// Remove any bibliography/reference section the model appended
const stripRefs = t => t
    .replace(/\n\n\*?\*?(?:APA References?|References?|Works Cited|Bibliography|Notes)[:\s]*\*?\*?[\s\S]*$/i, '')
    .trim();

// Remove trailing source appendices the model likes to sneak in
const stripSourceAppendix = t => t
    .replace(/\n\n(?:Sources?|References?|APA References?|Works Cited|Following instructions?|The following sources)[\s\S]*$/i, '')
    .replace(/\n\n\(.*?\d{4}.*?\)[.,\s]*$/, '')
    .trim();

// Strip ALL existing in-text citations from an essay before re-citing
// Removes: (Author, 2023) / (Author et al., 2023) / Author (2023) / bare (2023)
const stripExistingCitations = t => t
    .replace(/\([A-Z][a-zA-Z\s,&.]+(?:et al\.)?[,\s]+\d{4}[a-z]?\)/g, '')   // (Author, Year)
    .replace(/\b([A-Z][a-z]+(?:\s+(?:et al\.|&\s+[A-Z][a-z]+))?)\s*\(\d{4}[a-z]?\)/g, '$1') // Author (Year) → Author
    .replace(/\(\d{4}[a-z]?\)/g, '')                                           // bare (Year)
    .replace(/\s{2,}/g, ' ')
    .trim();

// ─── Topic extraction ────────────────────────────────────────────────────────

const extractTopic = text => {
    // Look for explicit "issue:" or "about X" framing first
    const m = text.match(/(?:issue:|about|essay on|write about)[:\s]+["']?([^"'\n.!?]{10,80})/i);
    if (m) return m[1].trim();
    // Fall back to keyword extraction
    const skip = new Set([
        'write','essay','paragraph','summary','discuss','explain','please','about',
        'using','citations','should','issue','sample','table','arguments','decision',
        'panic','embrace','research','reliable','sources','consider','sides','based',
        'scientific','knowledge','following','justify','required','references','apa'
    ]);
    return (text.toLowerCase().match(/\b[a-z]{4,}\b/g) || [])
        .filter(w => !skip.has(w))
        .slice(0, 6)
        .join(' ') || text.substring(0, 80);
};

// ─── Author formatting (OpenAlex format: {given, family}) ────────────────────

// Returns LAST NAME(S) ONLY for use in in-text citations
const fmtAuthorLastOnly = (s, style = 'apa') => {
    const authors = (s.authors || []).filter(a => a.family && a.family.length > 1);
    if (authors.length > 0) {
        if (authors.length === 1) return authors[0].family;
        if (authors.length === 2) return style === 'mla'
            ? `${authors[0].family} and ${authors[1].family}`
            : `${authors[0].family} & ${authors[1].family}`;
        return `${authors[0].family} et al.`;
    }
    // Plain string fallback — extract last word as surname
    const raw = (s.author || s.displayName || '').trim();
    if (!raw || raw === 'Unknown') return 'Unknown';
    const names = raw.split(/,\s*(?=[A-Z])|\s+(?:&|and)\s+/i).map(n => n.trim()).filter(Boolean);
    const last = n => n.split(/\s+/).pop();
    if (names.length === 1) return last(names[0]);
    if (names.length === 2) return style === 'mla'
        ? `${last(names[0])} and ${last(names[1])}`
        : `${last(names[0])} & ${last(names[1])}`;
    return `${last(names[0])} et al.`;
};

// ─── Task format detection ───────────────────────────────────────────────────

const detectTaskFormat = userTask => {
    const t = userTask.toLowerCase();
    // Table/structured assignment with for/against columns
    if (/arguments?\s+for|arguments?\s+against|for\s*\(embrace\)|against\s*\(panic\)|table.*organiz/i.test(userTask)) return 'table';
    if (/\?\s*$|\?\s*\n|(?:^|\n)\s*(?:a\)|b\)|1\.|2\.)|\banswer\b|\brespond to\b/im.test(userTask)) return 'questions';
    if (/\b(?:list|bullet|enumerate|outline)\b/.test(t)) return 'list';
    if (/\b(?:essay|argue|argument|thesis|discuss at length|write about)\b/.test(t)) return 'essay';
    return 'general';
};

// ─── HTML builders ───────────────────────────────────────────────────────────

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
        text = text.replace(new RegExp(eu), `\x00A\x00${doiUrl}\x00/A\x00`);
    }
    text = text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    return text
        .replace(/\x00I\x00/g,'<i>').replace(/\x00\/I\x00/g,'</i>')
        .replace(/\x00A\x00/g,`<a href="${doiUrl}" target="_blank">`)
        .replace(/\x00\/A\x00/g,'</a>');
};

const buildBibliographyHTML = (sources, style, type, insertionOrder = null) => {
    if (!sources?.length) return { html: '', plain: '' };
    const isApa = style.includes('apa');
    const isMla = style.includes('mla');
    const isFootnotes = type === 'footnotes';
    const title = isFootnotes ? 'Notes' : isMla ? 'Works Cited' : isApa ? 'References' : 'Bibliography';

    const sorted = isFootnotes
        ? (insertionOrder || sources)
        : [...sources].sort((a, b) => {
            const ka = (a.authors?.[0]?.family || a.author || 'zzz').toLowerCase();
            const kb = (b.authors?.[0]?.family || b.author || 'zzz').toLowerCase();
            return ka.localeCompare(kb);
        });

    const wrapStyle = `font-family:'Times New Roman',Times,serif;font-size:12pt;line-height:2;color:#000;background:#fff;padding:20px;`;
    const titleStyle = `text-align:center;margin-bottom:24px;font-weight:normal;font-family:'Times New Roman',Times,serif;font-size:12pt;`;
    const entryStyle = `text-indent:-36px;padding-left:36px;margin:0 0 24px 0;line-height:2;font-family:'Times New Roman',Times,serif;font-size:12pt;color:#000;`;

    let html = `<div class="bibliography" style="${wrapStyle}"><p style="${titleStyle}">${title}</p>`;
    let plain = `${title}\n\n`;

    sorted.forEach((s, i) => {
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
    const base = `font-family:'Times New Roman',Times,serif;font-size:12pt;line-height:2;color:#000;`;
    if (hasHtml) {
        return `<div style="${base}">` +
            text.split(/\n\n+/).map(p => `<p style="margin:0;text-indent:36px;">${p.replace(/\n/g,'<br>')}</p>`).join('\n') +
            `</div>`;
    }
    return `<div style="${base}">` +
        text.split(/\n\n+/).map(p =>
            `<p style="margin:0;text-indent:36px;">${p.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>')}</p>`
        ).join('\n') +
        `</div>`;
};

// ─── Main handler ─────────────────────────────────────────────────────────────

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        const { action, task, options = {} } = req.body;
        const GEMINI = process.env.GEMINI_API_KEY;

        // ── PLAN ──────────────────────────────────────────────────────────────
        if (action === 'plan') {
            const steps = [{ tool: 'RESEARCH', action: 'Find academic sources' }];
            if (options.enableWrite !== false) steps.push({ tool: 'WRITE', action: 'Write response' });
            if (options.enableHumanize) steps.push({ tool: 'HUMANIZE', action: 'Humanize text' });
            if (options.enableCite) steps.push({ tool: 'CITE', action: `Add ${options.citationType || 'in-text'} citations` });
            if (options.enableQuotes) steps.push({ tool: 'QUOTES', action: 'Insert quotes with transitions' });
            if (options.enableGrade) steps.push({ tool: 'GRADE', action: 'Grade work' });
            return res.status(200).json({ success: true, plan: { steps } });
        }

        // ── EXECUTE STEP ──────────────────────────────────────────────────────
        if (action === 'execute_step') {
            const { step, context = {}, options = {} } = req.body;
            const result = { success: true, output: '', type: 'text' };

            switch (step.tool.toUpperCase()) {

                // ── RESEARCH ────────────────────────────────────────────────
                case 'RESEARCH': {
                    const topic = extractTopic(context.task || '');
                    const style = options.citationStyle || 'apa7';
                    console.log('[Agent] Research topic:', topic, 'Style:', style);

                    const papers = await SourceFinderAPI.searchTopic(topic, 12, style);
                    if (!papers?.length) { result.output = { sources: [] }; result.type = 'research'; break; }

                    // Ensure citations are generated for ALL sources
                    const sourcesWithCitations = papers.map(p => ({
                        id: p.id,
                        title: p.title,
                        url: p.url,
                        doi: p.doi,
                        venue: p.venue,
                        author: p.author,
                        authors: p.authors || [],
                        year: p.year,
                        displayName: p.author || p.displayName,
                        text: p.abstract || p.text,
                        citation: p.citation || SourceFinderAPI._formatCitation(p, style),
                        citationSource: p.citationSource || 'generated',
                        volume: p.volume || null,
                        issue: p.issue || null,
                        pages: p.pages || null
                    }));

                    console.log('[Agent] RESEARCH:', sourcesWithCitations.filter(s => s.citationSource === 'crossref').length, '/', sourcesWithCitations.length, 'Crossref');
                    result.output = { sources: sourcesWithCitations };
                    result.type = 'research';
                    break;
                }

                // ── WRITE ────────────────────────────────────────────────────
                case 'WRITE': {
                    const { researchSources = [], task: userTask, uploadedFile, uploadedFiles = [] } = context;

                    const allFiles = uploadedFiles.length > 0 ? uploadedFiles : (uploadedFile ? [uploadedFile] : []);
                    const imageFiles = allFiles.filter(f => f.type?.startsWith('image/'));
                    const pdfFiles = allFiles.filter(f => f.type === 'application/pdf');
                    const otherFiles = allFiles.filter(f => !f.type?.startsWith('image/') && f.type !== 'application/pdf');

                    let pdfContext = '';
                    for (const pdf of pdfFiles) {
                        try {
                            const pdfText = await GeminiAPI.vision(
                                `Extract and summarize all key information from this PDF document thoroughly.`,
                                GEMINI, [pdf]
                            );
                            pdfContext += `\nUPLOADED DOCUMENT (${pdf.name}):\n${pdfText}\n`;
                        } catch(e) { console.error('[Agent] PDF extraction failed:', e.message); }
                    }
                    const fileContext = otherFiles.length > 0
                        ? `\nUSER FILES: ${otherFiles.map(f=>f.name).join(', ')} - consider this context.\n` : '';

                    // Source abstracts for ideas only
                    const sourceInfo = researchSources.slice(0, 10).map((s, i) =>
                        `SOURCE ${i+1} [Author: ${fmtAuthorLastOnly(s)} (${s.year})]:\nTitle: "${s.title}"\nKey info: ${(s.text || '').substring(0, 400) || 'N/A'}`
                    ).join('\n\n');

                    const fmt = detectTaskFormat(userTask);

                    let formatInstructions = '';
                    if (fmt === 'table') {
                        formatInstructions = `FORMAT — STRUCTURED TABLE ASSIGNMENT:
This task requires a specific structured format. Output EXACTLY this structure, with each section clearly labeled:

ARGUMENTS FOR (EMBRACE):
- Write 4-6 distinct arguments in favour, covering: health benefits, scientific progress, economic benefits, parental rights, personal/social benefits
- Each argument: 2-3 sentences with specific details
- Separate each argument with a blank line

ARGUMENTS AGAINST (PANIC):
- Write 4-6 distinct arguments against, covering: ethical concerns, safety risks, social inequality, eugenics, long-term unknowns, commodification of life
- Each argument: 2-3 sentences with specific details
- Separate each argument with a blank line

DECISION:
State clearly: "I choose to [panic/embrace]" and give a one-sentence reason

JUSTIFICATION:
3-4 paragraphs explaining your decision, covering multiple dimensions (health, social, ethical, economic). Be thorough and specific. APA in-text citations will be added in a later step — do NOT include any citations now.

Do NOT include an APA References section — that will be added separately.`;
                    } else if (fmt === 'questions') {
                        formatInstructions = `FORMAT — ANSWER EACH QUESTION:
- Answer each question directly, keeping the original numbering/labels
- Each answer: thorough and specific
- Plain text only — no markdown`;
                    } else if (fmt === 'list') {
                        formatInstructions = `FORMAT — LIST:
- Clear, organized structure
- Plain text only — no markdown`;
                    } else if (fmt === 'essay') {
                        formatInstructions = `FORMAT — ACADEMIC ESSAY:
- Strong thesis with 2-3 clear reasons
- Body: one argument per paragraph with topic sentence, evidence, analysis
- Conclusion: synthesis, not summary
- Vary sentence structure; paraphrase sources; formal academic tone`;
                    } else {
                        formatInstructions = `FORMAT:
- Match the format the task requires
- Plain text only — no markdown unless the task needs it`;
                    }

                    const prompt = `Complete the following task accurately and appropriately.

TASK:
${userTask}
${pdfContext}${fileContext}
${researchSources.length > 0 ? `\nRESEARCH SOURCES (use for ideas and content — do NOT include citations, author names, or references in your output):\n${sourceInfo}` : ''}

${formatInstructions}

CRITICAL RULES:
- Do NOT include any citations, author names, source references, or bibliography of any kind
- Do NOT add a reference list or "Sources:" section at the end
- Do NOT mention specific researchers, papers, or organisations by name
- Plain text output only — no markdown bold, headers, or bullet symbols unless the format requires them
${imageFiles.length > 0 ? '- Carefully analyze and describe the uploaded image(s) as part of the response.' : ''}

Complete the task now:`;

                    const rawText = imageFiles.length > 0
                        ? await GeminiAPI.vision(prompt, GEMINI, imageFiles)
                        : await GeminiAPI.chat(prompt, GEMINI);

                    const plainText = stripMarkdown(stripRefs(stripSourceAppendix(rawText)));
                    result.output = plainText;
                    result.outputHtml = buildEssayHTML(plainText);
                    result.type = 'text';
                    break;
                }

                // ── HUMANIZE ─────────────────────────────────────────────────
                case 'HUMANIZE': {
                    const input = context.previousOutput || '';
                    if (!input) { result.output = ''; result.outputHtml = ''; break; }

                    const mockReq = { method: 'POST', body: { text: input, tone: 'Academic' } };
                    let humanizedResult = '';
                    const mockRes = { setHeader: ()=>{}, status: ()=>({ end:()=>{}, json: d=>{ humanizedResult=d; } }) };
                    await humanizerHandler(mockReq, mockRes);

                    const humanized = (humanizedResult.success && humanizedResult.result)
                        ? humanizedResult.result
                        : stripMarkdown(await GeminiAPI.chat(
                            `Rewrite naturally while keeping academic quality. Plain text only.\n\n${input}`,
                            GEMINI
                        ));

                    result.output = humanized;
                    result.outputHtml = buildEssayHTML(humanized);
                    result.type = 'text';
                    break;
                }

                // ── CITE ──────────────────────────────────────────────────────
                case 'CITE': {
                    const sources = context.researchSources || [];
                    const style = options.citationStyle || 'apa7';
                    const type = options.citationType || 'in-text';
                    const isApa = style.includes('apa');
                    const isMla = style.includes('mla');

                    // Get the essay — prefer previousOutput, fall back to task text
                    const rawInput = (context.previousOutput || '').trim() || (context.task || '').trim();
                    // Strip any existing in-text citations so we can insert clean ones
                    const input = stripExistingCitations(stripSourceAppendix(stripRefs(rawInput)));

                    // Helper: build bibliography and set result fields, then break
                    const finish = (essayText, citedSources, insertionOrder = null) => {
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

                    if (!sources.length) { finish(input, []); break; }
                    if (!input)          { finish('', sources); break; }

                    // Ensure all sources have generated citations
                    const sourcesWithCitations = sources.map(s => ({
                        ...s,
                        citation: s.citation || SourceFinderAPI._formatCitation(s, style)
                    }));

                    // Build compact source list showing exact in-text key model must use
                    const sourceList = sourcesWithCitations.slice(0, 12).map((s, i) => {
                        const lastName = fmtAuthorLastOnly(s, isMla ? 'mla' : 'apa');
                        const inTextKey = isApa
                            ? `(${lastName}, ${s.year})`
                            : isMla
                                ? `(${lastName})`
                                : `(${lastName} ${s.year})`;
                        return `[${i+1}] USE IN TEXT AS: ${inTextKey}\n    Author: ${s.author || lastName} | Year: ${s.year}\n    Title: "${s.title}"\n    About: ${(s.text || '').substring(0, 200) || 'N/A'}`;
                    }).join('\n\n');

                    let citationFormat = '';
                    if (type === 'in-text') {
                        if (isApa) citationFormat = `APA 7th — EXACT FORMAT: parenthetical = (LastName, Year) | narrative = LastName (Year). Copy the "USE IN TEXT AS" key exactly from the source list.`;
                        else if (isMla) citationFormat = `MLA 9th — EXACT FORMAT: (LastName). No year. Copy the "USE IN TEXT AS" key exactly.`;
                        else citationFormat = `Chicago — EXACT FORMAT: (LastName Year). Copy the "USE IN TEXT AS" key exactly.`;
                    } else if (type === 'footnotes') {
                        citationFormat = `Superscript footnotes numbered sequentially (¹²³…). Each use of a source gets its own new number.`;
                    }

                    const prompt = `Your job is to insert accurate APA in-text citations into the essay below.

ESSAY (citation-free — do NOT invent author names from the essay text):
${input}

SOURCES — use ONLY these. Copy the "USE IN TEXT AS" key exactly as written. Do not alter, invent, or assume any other author names:
${sourceList}

CITATION FORMAT: ${citationFormat}

STRICT RULES:
1. Only cite where a claim clearly matches a listed source's topic — if no source fits, leave that sentence uncited
2. Never invent citations — if you are unsure which source matches, skip it
3. Use the "USE IN TEXT AS" key VERBATIM — do not guess or paraphrase author names
4. Vary citation introduction patterns naturally across the text
5. Do NOT add a reference list, bibliography, or "Sources:" section at the end of the essay
6. Do NOT cite sources that are not in the list above

Return ONLY the essay with citations inserted. Nothing else:`;

                    let citedText = await GeminiAPI.chat(prompt, GEMINI);
                    citedText = stripMarkdown(stripRefs(stripSourceAppendix(citedText)));

                    // ── Footnotes: fix missing superscripts then renumber ──
                    if (type === 'footnotes') {
                        const fixPrompt = `Check this essay. Wherever an author name appears without a footnote superscript, add the correct one based on the numbering pattern. Do not change anything else. Do not add a reference list.

ESSAY:
${citedText}

SOURCES:
${sourceList}

Return the corrected essay only:`;
                        citedText = stripMarkdown(stripRefs(stripSourceAppendix(await GeminiAPI.chat(fixPrompt, GEMINI))));

                        // Renumber sequentially
                        const superToNum = {'¹':1,'²':2,'³':3,'⁴':4,'⁵':5,'⁶':6,'⁷':7,'⁸':8,'⁹':9,'⁰':0};
                        const toSuper = n => String(n).split('').map(d=>'⁰¹²³⁴⁵⁶⁷⁸⁹'[+d]).join('');
                        let normalized = citedText.replace(/<sup>(\d+)<\/sup>/gi, (_,n)=>toSuper(parseInt(n)));
                        const allMatches = [...normalized.matchAll(/[¹²³⁴⁵⁶⁷⁸⁹⁰]+/g)];
                        const parseSuper = str => {
                            const n = parseInt(str.split('').map(c=>superToNum[c]??0).join(''));
                            if (n > 0 && n <= sources.length) return [n];
                            return str.split('').map(c=>superToNum[c]).filter(n=>n>0&&n<=sources.length);
                        };
                        const noteEntries = [], matchToNewNums = new Map();
                        allMatches.forEach((m, idx) => {
                            const nums = parseSuper(m[0]).map(sNum => {
                                const src = sources[sNum-1]; if (!src) return null;
                                noteEntries.push(src); return noteEntries.length;
                            }).filter(Boolean);
                            if (nums.length) matchToNewNums.set(idx, nums);
                        });
                        let rewritten = normalized, offset = 0;
                        allMatches.forEach((m, idx) => {
                            const nums = matchToNewNums.get(idx); if (!nums?.length) return;
                            const sup = nums.map(toSuper).join('');
                            rewritten = rewritten.slice(0, m.index+offset) + sup + rewritten.slice(m.index+offset+m[0].length);
                            offset += sup.length - m[0].length;
                        });
                        finish(rewritten, sourcesWithCitations, noteEntries);
                        break;
                    }

                    finish(citedText, sourcesWithCitations);
                    break;
                }

                // ── QUOTES ───────────────────────────────────────────────────
                case 'QUOTES': {
                    const input = context.previousOutput || '';
                    const sources = context.researchSources || [];
                    if (!input || !sources.length) { result.output=input; result.outputHtml=buildEssayHTML(input); result.type='text'; break; }

                    const quotesFromSources = sources.slice(0, 10).map(s => {
                        const author = fmtAuthorLastOnly(s);
                        const sentences = (s.text || '').match(/[^.!?]+[.!?]+/g) || [];
                        const good = sentences.find(sent =>
                            sent.length > 40 && sent.length < 250 &&
                            /show|found|suggest|demonstrate|indicate|reveal|important|significant|evidence/i.test(sent)
                        ) || sentences.find(s => s.length > 50 && s.length < 200) || sentences[0] || '';
                        return { author, year: s.year, title: s.title, quote: good.trim() };
                    }).filter(q => q.quote);

                    const quotesList = quotesFromSources.map((q,i) =>
                        `[${i+1}] ${q.author} (${q.year}): "${q.quote}" — From: "${q.title}"`
                    ).join('\n\n');

                    const prompt = `Insert 4-6 direct quotes into this essay with analytical transitions.

ESSAY:
${input}

QUOTES:
${quotesList}

INSTRUCTIONS:
1. Find the best places to insert each quote to strengthen the argument
2. Use an analytical transition sentence before each quote explaining why it matters
3. Follow each quote with 1-2 sentences of your own analysis
4. Keep ALL existing text and citations intact
5. Do NOT add a bibliography or reference list

Return the essay with quotes inserted:`;

                    const withQuotes = stripMarkdown(await GeminiAPI.chat(prompt, GEMINI));
                    result.output = withQuotes;
                    result.outputHtml = buildEssayHTML(withQuotes);
                    result.type = 'text';
                    break;
                }

                // ── GRADE ────────────────────────────────────────────────────
                case 'GRADE': {
                    const text = context.previousOutput || '';
                    if (!text) { result.output={grade:'N/A',feedback:'No text to grade.'}; result.type='grade'; break; }

                    const mockReq = {
                        method: 'POST',
                        body: {
                            text,
                            instructions: context.task || '',
                            rubric: context.rubric || '',
                            files: (context.uploadedFiles||[]).map(f=>({name:f.name,type:f.type,content:f.data,isBase64:true}))
                        }
                    };
                    let gradeResult = null;
                    const mockRes = { setHeader:()=>{}, status:()=>({ end:()=>{}, json:d=>{ gradeResult=d; } }) };
                    await graderHandler(mockReq, mockRes);

                    const feedback = gradeResult?.result || 'Grading completed.';
                    const gradeMatch = feedback.match(/(?:Overall\s+)?Grade[:\s]*([A-F][+-]?|\d+[\/.]\d+)/i)
                        || feedback.match(/([A-F][+-]?)\s*(?:\/|out of|\()/i);

                    result.output = { grade: gradeMatch ? gradeMatch[1].toUpperCase() : '—', feedback };
                    result.type = 'grade';
                    break;
                }

                default:
                    result.output = 'Unknown step';
            }

            return res.status(200).json(result);
        }

        return res.status(400).json({ success: false, error: 'Invalid action' });

    } catch(e) {
        console.error('[Agent] Error:', e);
        return res.status(500).json({ success: false, error: e.message });
    }
}
