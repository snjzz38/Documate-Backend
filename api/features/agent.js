// api/features/agent.js
import { GeminiAPI } from '../utils/geminiAPI.js';
import { GroqAPI } from '../utils/groqAPI.js';
import { SourceFinderAPI } from '../utils/sourceFinder.js';
import { AgentPrompts } from '../utils/prompts.js';
import humanizerHandler from './humanizer.js';
import graderHandler from './grader.js';

// ─── Text cleanup helpers ────────────────────────────────────────────────────

const stripMarkdown = t => t
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/`([^`]+)`/g, '$1');

// Strip AI preamble like "Here's your essay:", "Sure, here is the response:", etc.
const stripPreamble = t => t
    .replace(/^(?:(?:Here(?:'s| is)|Sure[,!]?\s*(?:here(?:'s| is))?|Okay[,!]?\s*(?:here(?:'s| is))?|Certainly[,!]?\s*(?:here(?:'s| is))?|I'(?:ve|ll)|Below is|The following is)[^\n]*\n)+/i, '')
    .trim();

// ─── Header repair ───────────────────────────────────────────────────────────
// Deterministic: find known section headers that got merged onto other lines and force them onto their own lines
const KNOWN_HEADERS = [
    'ARGUMENTS FOR (EMBRACE):',
    'ARGUMENTS AGAINST (PANIC):',
    'DECISION:',
    'JUSTIFICATION:'
];

const ensureHeaders = t => {
    let result = t;
    for (const hdr of KNOWN_HEADERS) {
        const escaped = hdr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        // If header appears mid-line (not at start of line), force a line break before it
        result = result.replace(new RegExp(`(?<!^)(?<!\\n)\\s*${escaped}`, 'gm'), `\n\n${hdr}`);
    }
    // Also catch generic all-caps headers that got merged
    result = result.replace(/([.!?])\s+((?:[A-Z][A-Z\s\(\)\/\-&]{2,}):?\s*$)/gm, '$1\n\n$2');
    // Clean up excessive newlines
    return result.replace(/\n{3,}/g, '\n\n').trim();
};

// ─── AI-powered CHECK (Groq — fast + cheap) ─────────────────────────────────
// Groq ONLY returns JSON booleans — it NEVER produces output text.
// If checks fail, we fix with deterministic code or re-prompt Gemini.
const checkWithGroq = async (text, GROQ) => {
    if (!GROQ || !text) return { pass: true };
    try {
        const messages = AgentPrompts.groqCheckMessages(text);
        const raw = await GroqAPI.chat(messages, GROQ, true);
        const jsonMatch = raw.match(/\{[\s\S]*\}/);
        if (!jsonMatch) return { pass: true };
        return JSON.parse(jsonMatch[0]);
    } catch (e) {
        console.error('[Agent] Groq check failed:', e.message);
        return { pass: true };
    }
};

// Deterministic fixes applied based on Groq check results — Groq text NEVER enters output
const applyFixes = (text, checks) => {
    let result = text;

    // Fix "Because" starts
    if (checks.hasBecauseStarts) {
        result = result
            .replace(/^(\s*[-•]\s+)Because\s+/gm, '$1')
            .replace(/^Because\s+/gm, '')
            .replace(/^(\s*[-•]\s+)([a-z])/gm, (_, p, c) => p + c.toUpperCase())
            .replace(/^([a-z])/gm, c => c.toUpperCase());
    }

    // Strip commentary sentences (transition + Author + commentary verb pattern)
    if (checks.hasCommentary || checks.hasMetaDescriptions) {
        // "Indeed/Furthermore/However, Author (Year) highlights/underscores/illustrates..."
        result = result.replace(/\s*(?:Indeed|Furthermore|Moreover|Additionally|Specifically|However|Notably|Similarly),?\s+[A-Z][a-z]+(?:'s)?(?:\s+(?:et al\.|&\s+[A-Z][a-z]+))?(?:\s*\([^)]*\))?\s+(?:specifically |directly |further |also |particularly |effectively |powerfully )?(?:address|note|highlight|underscore|emphasize|articulate|expand|detail|elaborate|caution|warn|point out|stress|echo|summarize|demonstrate|reinforce|illustrate|review|discuss|analyze|examine|explore|assert|contend|observe|remark|acknowledge|confirm|corroborate|validate|support|reveal)[^.]*\./g, '');
        // "Author (Year) highlights/underscores..." at sentence start
        result = result.replace(/\s*[A-Z][a-z]+(?:\s+(?:et al\.|(?:and|&)\s+[A-Z][a-z]+))?\s*\(\d{4}\)\s+(?:specifically |directly |further |also |particularly |effectively |powerfully )?(?:address|note|highlight|underscore|emphasize|articulate|expand|detail|elaborate|caution|warn|point out|stress|echo|summarize|demonstrate|reinforce|illustrate|review|discuss|analyze|examine|explore|assert|contend|observe|remark|acknowledge|confirm|corroborate|validate|support|reveal)[^.]*\./g, '');
        // "As Author (Year) points out/notes/highlights..."
        result = result.replace(/\s*As\s+[A-Z][a-z]+(?:\s+(?:et al\.|(?:and|&)\s+[A-Z][a-z]+))?\s*\([^)]*\)\s+[^.]*\./g, '');
        // "This highlights/underscores the importance of..."
        result = result.replace(/\s*This\s+(?:highlights?|underscores?|emphasizes?|illustrates?|demonstrates?)\s+(?:the\s+)?(?:importance|significance|need|potential|concern|risk)[^.]*\./g, '');
    }

    // Trim bullets to 3 sentences max
    if (checks.bulletsCorrectLength === false) {
        result = result.replace(/^(\s*[-•]\s+)(.+)$/gm, (match, prefix, body) => {
            const sentences = body.match(/[^.!?]+[.!?]+/g) || [body];
            if (sentences.length > 3) return prefix + sentences.slice(0, 3).join('').trim();
            return match;
        });
    }

    // Clean up double spaces and trailing whitespace
    return result.replace(/  +/g, ' ').replace(/ +\n/g, '\n').trim();
};

// Remove any bibliography/reference section the model appended to essay text
const stripRefs = t => t
    .replace(/\n\n\*?\*?(?:APA References?|References?|Works Cited|Bibliography|Notes)[:\s]*\*?\*?[\s\S]*$/i, '')
    .trim();

// Remove trailing source appendices
const stripSourceAppendix = t => t
    .replace(/\n\n(?:Sources?|References?|APA References?|Works Cited|Following instructions?|The following sources)[\s\S]*$/i, '')
    .replace(/\n\nFollowing instructions[\s\S]*$/i, '')
    .trim();

// Strip ALL existing in-text citations before re-inserting clean ones
const stripExistingCitations = t => t
    .replace(/\([A-Z][a-zA-Z\s,&.]+(?:et al\.)?[,\s]+\d{4}[a-z]?\)/g, '')
    .replace(/\b([A-Z][a-z]+(?:\s+(?:et al\.|&\s+[A-Z][a-z]+))?)\s*\(\d{4}[a-z]?\)/g, '$1')
    .replace(/\(\d{4}[a-z]?\)/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

// ─── Topic extraction ─────────────────────────────────────────────────────────

const extractTopic = text => {
    const m = text.match(/(?:issue:|about|essay on|write about)[:\s]+["']?([^"'\n.!?]{10,80})/i);
    if (m) return m[1].trim();
    const skip = new Set([
        'write','essay','paragraph','summary','discuss','explain','please','about',
        'using','citations','should','issue','sample','table','arguments','decision',
        'panic','embrace','research','reliable','sources','consider','sides','based',
        'scientific','knowledge','following','justify','required','references','apa',
        'watch','video','organize','after','weighed','state','feel','free','record',
        'voice','response','instead','expectation','evaluate','basis','limited','thought'
    ]);
    return (text.toLowerCase().match(/\b[a-z]{4,}\b/g) || [])
        .filter(w => !skip.has(w))
        .slice(0, 6)
        .join(' ') || text.substring(0, 80);
};

// ─── Author formatting (OpenAlex: {given, family}) ───────────────────────────

const fmtAuthorLastOnly = (s, style = 'apa') => {
    const authors = (s.authors || []).filter(a => a.family && a.family.length > 1);
    if (authors.length > 0) {
        if (authors.length === 1) return authors[0].family;
        if (authors.length === 2) return style === 'mla'
            ? `${authors[0].family} and ${authors[1].family}`
            : `${authors[0].family} & ${authors[1].family}`;
        return `${authors[0].family} et al.`;
    }
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

// ─── Task format detection ────────────────────────────────────────────────────

const detectTaskFormat = userTask => {
    // Table/structured assignment with explicit for/against columns
    if (/arguments?\s+for|arguments?\s+against|for\s*\(embrace\)|against\s*\(panic\)/i.test(userTask)) return 'table';
    // Step-by-step instruction format (numbered steps, bullet points defining what to do)
    if (/(?:^|\n)\s*(?:step\s*\d+|\d+[\.\)]|[•\-]\s+\w)/im.test(userTask) && !/essay/i.test(userTask)) return 'steps';
    // Explicit questions to answer
    if (/\?\s*$|\?\s*\n|(?:^|\n)\s*(?:a\)|b\)|1\.|2\.)|\banswer\b|\brespond to\b/im.test(userTask)) return 'questions';
    // List tasks
    if (/\b(?:list|bullet|enumerate|outline)\b/i.test(userTask) && !/essay/i.test(userTask)) return 'list';
    // Paragraph/short-form tasks
    if (/\b(?:paragraph|short answer|in one sentence|in a sentence|briefly explain|brief explanation|brief response|short paragraph)\b/i.test(userTask) && !/essay/i.test(userTask)) return 'paragraph';
    // Essay only when explicitly requested
    if (/\b(?:essay|argue|argument|thesis|discuss at length)\b/i.test(userTask)) return 'essay';
    // Contains a structured rubric/expectation table — treat as structured assignment
    if (/\bexpectation\b|\brubric\b|\bL1\b|\bL2\b|\bL3\b|\bL4\b/i.test(userTask)) return 'structured';
    return 'general';
};

// ─── HTML builders ─────────────────────────────────────────────────────────────

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
    const base = `font-family:'Times New Roman',Times,serif;font-size:12pt;line-height:2;color:#000;`;
    const hasHtml = /<[a-z][\s\S]*>/i.test(text);
    const esc = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    // All-caps line (optional trailing colon), e.g. "ARGUMENTS FOR (EMBRACE):" or "DECISION"
    const isHeader = s => /^[A-Z][A-Z\s\(\)\/\-&]{2,}:?\s*$/.test(s.trim()) && s.trim().length < 80;
    // Bullet/dash list item
    const isBullet = s => /^\s*[-•]\s+/.test(s);

    const renderBlock = block => {
        const lines = block.split(/\n/);
        // Single-line header
        if (lines.length === 1 && isHeader(lines[0])) {
            const content = hasHtml ? lines[0] : esc(lines[0]);
            return `<p style="margin:20px 0 4px 0;font-weight:bold;text-indent:0;">${content}</p>`;
        }
        // Block where every non-empty line is a bullet
        if (lines.every(l => !l.trim() || isBullet(l))) {
            return lines.filter(l => l.trim()).map(l => {
                const content = hasHtml ? l : esc(l);
                return `<p style="margin:0;text-indent:0;padding-left:24px;">${content}</p>`;
            }).join('\n');
        }
        // Multi-line block starting with a header, rest is content
        if (isHeader(lines[0]) && lines.length > 1) {
            const header = hasHtml ? lines[0] : esc(lines[0]);
            const rest = lines.slice(1).join('\n');
            const content = hasHtml ? rest : esc(rest);
            return `<p style="margin:20px 0 4px 0;font-weight:bold;text-indent:0;">${header}</p>` +
                   `<p style="margin:0;text-indent:36px;">${content.replace(/\n/g,'<br>')}</p>`;
        }
        // Regular essay paragraph
        const content = hasHtml ? block.replace(/\n/g,'<br>') : esc(block).replace(/\n/g,'<br>');
        return `<p style="margin:0;text-indent:36px;">${content}</p>`;
    };

    return `<div style="${base}">` +
        text.split(/\n\n+/).map(renderBlock).join('\n') +
        `</div>`;
};

// ─── Main handler ─────────────────────────────────────────────────────────────

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        const { action, options = {} } = req.body;
        const GEMINI = process.env.GEMINI_API_KEY;
        const GROQ = process.env.GROQ_API_KEY;

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

                // ── RESEARCH ─────────────────────────────────────────────────
                case 'RESEARCH': {
                    const topic = extractTopic(context.task || '');
                    const style = options.citationStyle || 'apa7';
                    console.log('[Agent] Research topic:', topic, 'Style:', style);

                    const papers = await SourceFinderAPI.searchTopic(topic, 12, style);
                    if (!papers?.length) { result.output = { sources: [] }; result.type = 'research'; break; }

                    const sources = papers.map(p => ({
                        id: p.id,
                        title: p.title, url: p.url, doi: p.doi,
                        venue: p.venue, author: p.author, authors: p.authors || [],
                        year: p.year, displayName: p.author || p.displayName,
                        text: p.abstract || p.text,
                        // Always ensure a citation string exists
                        citation: p.citation || SourceFinderAPI._formatCitation(p, style),
                        citationSource: p.citationSource || 'generated',
                        volume: p.volume || null, issue: p.issue || null, pages: p.pages || null
                    }));

                    console.log('[Agent] RESEARCH:', sources.filter(s=>s.citationSource==='crossref').length, '/', sources.length, 'Crossref');
                    result.output = { sources };
                    result.type = 'research';
                    break;
                }

                // ── WRITE ─────────────────────────────────────────────────────
                case 'WRITE': {
                    const { researchSources = [], task: userTask, uploadedFile, uploadedFiles = [] } = context;

                    const allFiles = uploadedFiles.length > 0 ? uploadedFiles : (uploadedFile ? [uploadedFile] : []);
                    const imageFiles = allFiles.filter(f => f.type?.startsWith('image/'));
                    const pdfFiles = allFiles.filter(f => f.type === 'application/pdf');
                    const otherFiles = allFiles.filter(f => !f.type?.startsWith('image/') && f.type !== 'application/pdf');

                    let pdfContext = '';
                    for (const pdf of pdfFiles) {
                        try {
                            const pdfText = await GeminiAPI.vision(`Extract and summarize all key information from this PDF thoroughly.`, GEMINI, [pdf]);
                            pdfContext += `\nUPLOADED DOCUMENT (${pdf.name}):\n${pdfText}\n`;
                        } catch(e) { console.error('[Agent] PDF extraction failed:', e.message); }
                    }
                    const fileContext = otherFiles.length > 0
                        ? `\nUSER FILES: ${otherFiles.map(f=>f.name).join(', ')} - consider this context.\n` : '';

                    const sourceInfo = researchSources.slice(0, 10).map((s, i) =>
                        `SOURCE ${i+1} [Key: ${fmtAuthorLastOnly(s)}, ${s.year}]:\nTitle: "${s.title}"\nSummary: ${(s.text||'').substring(0, 350)||'N/A'}`
                    ).join('\n\n');

                    const fmt = detectTaskFormat(userTask);
                    const formatInstructions = AgentPrompts.getWriteFormatInstructions(fmt);
                    const prompt = AgentPrompts.buildWritePrompt(
                        userTask,
                        researchSources.length > 0 ? sourceInfo : null,
                        pdfContext, fileContext,
                        formatInstructions,
                        imageFiles.length > 0
                    );

                    const rawText = imageFiles.length > 0
                        ? await GeminiAPI.vision(prompt, GEMINI, imageFiles)
                        : await GeminiAPI.chat(prompt, GEMINI);

                    let plainText = ensureHeaders(stripPreamble(stripMarkdown(stripRefs(stripSourceAppendix(rawText)))));
                    const writeChecks = await checkWithGroq(plainText, GROQ);
                    plainText = applyFixes(plainText, writeChecks);
                    result.output = plainText;
                    result.outputHtml = buildEssayHTML(plainText);
                    result.type = 'text';
                    break;
                }

                // ── HUMANIZE ──────────────────────────────────────────────────
                case 'HUMANIZE': {
                    const input = context.previousOutput || '';
                    if (!input) { result.output = ''; result.outputHtml = ''; break; }

                    // Run text through humanizerHandler
                    const runHumanizer = async text => {
                        if (!text.trim()) return text;
                        let out = '';
                        const mockReq = { method: 'POST', body: { text } };
                        const mockRes = { setHeader:()=>{}, status:()=>({ end:()=>{}, json:d=>{ out=d; } }) };
                        await humanizerHandler(mockReq, mockRes);
                        return (out.success && out.result) ? out.result : text;
                    };

                    // Split into {header, lines[]} pairs so headers are never passed to the humanizer
                    const isHdr = s => /^[A-Z][A-Z\s\(\)\/\-&]{2,}:?\s*$/.test(s.trim()) && s.trim().length < 80;
                    const inputLines = input.split('\n');
                    const sections = [];
                    let cur = null;
                    for (const line of inputLines) {
                        if (isHdr(line)) {
                            if (cur) sections.push(cur);
                            cur = { header: line.trim(), lines: [] };
                        } else {
                            if (!cur) cur = { header: '', lines: [] };
                            cur.lines.push(line);
                        }
                    }
                    if (cur) sections.push(cur);

                    // Humanize each section's body in one call (humanizer handles batching internally)
                    const humanizedSections = await Promise.all(sections.map(async section => {
                        const bodyText = section.lines.join('\n').trim();
                        if (!bodyText) return section.header;

                        const bodyLines = section.lines.filter(l => l.trim());
                        const isBulletSection = bodyLines.length > 0 && bodyLines.every(l => /^\s*[-•]\s+/.test(l));

                        let humanizedBody;
                        if (isBulletSection) {
                            // Join all bullet bodies as paragraphs — humanizer batches all sentences in one call
                            const bulletBodies = bodyLines.map(l => l.replace(/^\s*[-•]\s+/, ''));
                            const bulkText = bulletBodies.join('\n\n');
                            const humanizedBulk = await runHumanizer(bulkText);
                            // Re-split on paragraph breaks to recover individual bullets
                            const humanizedParagraphs = humanizedBulk.split(/\n{2,}/);
                            humanizedBody = bodyLines.map((_, i) => {
                                const h = (humanizedParagraphs[i] || bulletBodies[i]).trim();
                                return `- ${h}`;
                            }).join('\n');
                        } else {
                            humanizedBody = await runHumanizer(bodyText);
                        }

                        return section.header ? `${section.header}\n${humanizedBody}` : humanizedBody;
                    }));

                    const humanized = humanizedSections.join('\n\n');
                    result.output = humanized;
                    result.outputHtml = buildEssayHTML(humanized);
                    result.type = 'text';
                    break;
                }

                // ── CITE ──────────────────────────────────────────────────────
                case 'CITE': {
                    const sources = context.researchSources || [];
                    const style = options.citationStyle || 'apa7';
                    const type = options.citationType || 'bibliography';
                    const isApa = style.includes('apa');
                    const isMla = style.includes('mla');

                    const rawInput = (context.previousOutput || '').trim() || (context.task || '').trim();
                    // Strip any pre-existing citations so model inserts only clean, correct ones
                    const input = stripExistingCitations(stripSourceAppendix(stripRefs(rawInput)));

                    // Ensure all sources have a formatted citation string
                    const sourcesWithCitations = (sources.length ? sources : []).map(s => ({
                        ...s,
                        citation: s.citation || SourceFinderAPI._formatCitation(s, style)
                    }));

                    // Helper: build bibliography and populate result
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

                    if (!sourcesWithCitations.length) { finish(input, []); break; }
                    if (!input) { finish('', sourcesWithCitations); break; }

                    // Bibliography-only mode: don't touch the text, just attach the reference list
                    if (type === 'bibliography') {
                        finish(input, sourcesWithCitations);
                        break;
                    }

                    // Compact source list with exact in-text key model must copy verbatim
                    const sourceList = sourcesWithCitations.slice(0, 12).map((s, i) => {
                        const lastName = fmtAuthorLastOnly(s, isMla ? 'mla' : 'apa');
                        const inTextKey = isApa
                            ? `(${lastName}, ${s.year})`
                            : isMla ? `(${lastName})` : `(${lastName} ${s.year})`;
                        return `[${i+1}] CITE-AS: ${inTextKey}\n    Title: "${s.title}"\n    About: ${(s.text||'').substring(0,200)||'N/A'}`;
                    }).join('\n\n');

                    const citationFormat = AgentPrompts.getCitationFormat(type, isApa, isMla);
                    const citeFmt = detectTaskFormat(context.task || '');
                    const hasStructuredHeadersCite = citeFmt === 'table' || citeFmt === 'steps' || citeFmt === 'structured';
                    const prompt = AgentPrompts.buildCitePrompt(input, sourceList, citationFormat, type, hasStructuredHeadersCite);

                    let citedText = await GeminiAPI.chat(prompt, GEMINI);
                    citedText = ensureHeaders(stripPreamble(stripMarkdown(stripRefs(stripSourceAppendix(citedText)))));
                    const citeChecks = await checkWithGroq(citedText, GROQ);
                    citedText = applyFixes(citedText, citeChecks);

                    if (type === 'footnotes') {
                        const fixPrompt = AgentPrompts.buildFootnoteFixPrompt(citedText, sourceList);
                        citedText = ensureHeaders(stripPreamble(stripMarkdown(stripRefs(stripSourceAppendix(await GeminiAPI.chat(fixPrompt, GEMINI))))));

                        const superToNum={'¹':1,'²':2,'³':3,'⁴':4,'⁵':5,'⁶':6,'⁷':7,'⁸':8,'⁹':9,'⁰':0};
                        const toSuper=n=>String(n).split('').map(d=>'⁰¹²³⁴⁵⁶⁷⁸⁹'[+d]).join('');
                        let normalized=citedText.replace(/<sup>(\d+)<\/sup>/gi,(_,n)=>toSuper(parseInt(n)));
                        const allMatches=[...normalized.matchAll(/[¹²³⁴⁵⁶⁷⁸⁹⁰]+/g)];
                        const parseSuper=str=>{
                            const n=parseInt(str.split('').map(c=>superToNum[c]??0).join(''));
                            if(n>0&&n<=sources.length) return [n];
                            return str.split('').map(c=>superToNum[c]).filter(n=>n>0&&n<=sources.length);
                        };
                        const noteEntries=[],matchToNewNums=new Map();
                        allMatches.forEach((m,idx)=>{
                            const nums=parseSuper(m[0]).map(sNum=>{
                                const src=sourcesWithCitations[sNum-1]; if(!src) return null;
                                noteEntries.push(src); return noteEntries.length;
                            }).filter(Boolean);
                            if(nums.length) matchToNewNums.set(idx,nums);
                        });
                        let rewritten=normalized,offset=0;
                        allMatches.forEach((m,idx)=>{
                            const nums=matchToNewNums.get(idx); if(!nums?.length) return;
                            const sup=nums.map(toSuper).join('');
                            rewritten=rewritten.slice(0,m.index+offset)+sup+rewritten.slice(m.index+offset+m[0].length);
                            offset+=sup.length-m[0].length;
                        });
                        finish(rewritten, sourcesWithCitations, noteEntries);
                        break;
                    }

                    finish(citedText, sourcesWithCitations);
                    break;
                }

                // ── QUOTES ────────────────────────────────────────────────────
                case 'QUOTES': {
                    const input = context.previousOutput || '';
                    const sources = context.researchSources || [];
                    if (!input || !sources.length) { result.output=input; result.outputHtml=buildEssayHTML(input); result.type='text'; break; }

                    // Filter out abstract boilerplate — meta-descriptions, methodology, and vague framing
                    const isUselessQuote = s => {
                        // "This article/paper/study reviews/examines/discusses..."
                        if (/\b(?:this|the present|our|the current)\s+(?:article|paper|study|review|report|chapter|work|analysis|research|investigation|manuscript)\b/i.test(s)) return true;
                        // "We review/examine/discuss/present/describe..."
                        if (/\b(?:we|here|herein)\s+(?:review|examine|discuss|explore|present|describe|analyze|analyse|investigate|summarize|assess|aim|propose|argue|contend|consider|outline|highlight|address|focus|seek|provide)\b/i.test(s)) return true;
                        // "The aim/purpose/goal of this..."
                        if (/\bthe\s+(?:aim|purpose|goal|objective|focus|scope|intent)\s+of\s+(?:this|the)\b/i.test(s)) return true;
                        // Vague framing: "systematic review is crucial", "informed decision-making", "responsible utilization"
                        if (/\b(?:systematic review|informed decision|responsible utiliz|guiding future research|full potential|transformative impact|crucial for|broad scope of applicability)\b/i.test(s)) return true;
                        // Methodology: "In January 2019, we met at..."
                        if (/\b(?:we met|we conducted|we performed|we collected|we recruited|we selected|we identified|we searched|we assessed|we evaluated)\b/i.test(s)) return true;
                        // Too vague to be useful as a quote
                        if (/\b(?:has emerged as|has been proposed|has attracted|is widely|is increasingly|is well known|it is important)\b/i.test(s)) return true;
                        return false;
                    };

                    const quotesFromSources = sources.slice(0,10).map(s => {
                        const author = fmtAuthorLastOnly(s);
                        const sentences = (s.text||'').match(/[^.!?]+[.!?]+/g)||[];
                        const usable = sentences.filter(sent => sent.length > 40 && sent.length < 250 && !isUselessQuote(sent));
                        // Prefer sentences with concrete findings/data, fall back to any usable sentence
                        const good = usable.find(sent =>
                            /\b(?:found that|results show|data suggest|evidence indicate|led to|caused|increased|decreased|reduced|improved|associated with|correlated|resulted in|demonstrated that|revealed that|significantly)\b/i.test(sent)
                        ) || usable.find(sent => sent.length > 50) || usable[0] || '';
                        return { author, year:s.year, title:s.title, quote:good.trim() };
                    }).filter(q=>q.quote);

                    const quotesList=quotesFromSources.map((q,i)=>
                        `[${i+1}] ${q.author} (${q.year}): "${q.quote}" — From: "${q.title}"`
                    ).join('\n\n');

                    // If no usable quotes found, pass through unchanged
                    if (!quotesFromSources.length) {
                        console.log('[Agent] QUOTES: no usable quotes extracted from sources, skipping');
                        result.output = input;
                        result.outputHtml = buildEssayHTML(input);
                        result.type = 'text';
                        break;
                    }

                    const prompt = AgentPrompts.buildQuotesPrompt(input, quotesList);
                    let withQuotes=ensureHeaders(stripPreamble(stripMarkdown(await GeminiAPI.chat(prompt,GEMINI))));
                    const quoteChecks = await checkWithGroq(withQuotes, GROQ);
                    withQuotes = applyFixes(withQuotes, quoteChecks);
                    result.output=withQuotes;
                    result.outputHtml=buildEssayHTML(withQuotes);
                    result.type='text';
                    break;
                }

                // ── GRADE ──────────────────────────────────────────────────────
                case 'GRADE': {
                    const text = context.previousOutput || '';
                    if (!text) { result.output={grade:'N/A',feedback:'No text to grade.'}; result.type='grade'; break; }

                    // Build the full submission for grading:
                    // essay text + bibliography if available (grader needs to see both)
                    const citedSources = context.researchSources || [];
                    let fullSubmission = text;
                    if (citedSources.length && options.enableCite) {
                        // Append the plain-text reference list so grader can evaluate citation quality
                        const bibStyle = options.citationStyle || 'apa7';
                        const bibType = options.citationType || 'in-text';
                        const bib = buildBibliographyHTML(citedSources, bibStyle, bibType === 'footnotes' ? 'footnotes' : 'bibliography');
                        if (bib.plain) fullSubmission = text + '\n\n' + bib.plain;
                    }

                    const mockReq = {
                        method: 'POST',
                        body: {
                            text: fullSubmission,
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

                    result.output = { grade: gradeMatch?gradeMatch[1].toUpperCase():'—', feedback };
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
