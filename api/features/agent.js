// api/features/agent.js
// Agent Mode - Clean implementation using existing utilities
// 
// FLOW: RESEARCH → QUOTES → WRITE → HUMANIZE → INSERT_CITATIONS → GRADE → CITE

import { GeminiAPI } from '../utils/geminiAPI.js';
import { GroqAPI } from '../utils/groqAPI.js';
import { GoogleSearchAPI } from '../utils/googleSearch.js';
import { ScraperAPI } from '../utils/scraper.js';

// ==========================================================================
// HELPERS
// ==========================================================================
async function geminiVision(prompt, files, apiKey) {
    const models = ['gemini-2.0-flash-exp', 'gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-1.5-pro'];
    
    // Validate files
    const imageFiles = files.filter(f => f.type?.startsWith('image/') && f.data);
    if (imageFiles.length === 0) {
        throw new Error('No valid image files provided');
    }
    
    for (const model of models) {
        try {
            const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
            
            const parts = [{ text: prompt }];
            for (const file of imageFiles) {
                // Ensure base64 data doesn't have data URL prefix
                let base64Data = file.data;
                if (base64Data.includes(',')) {
                    base64Data = base64Data.split(',')[1];
                }
                parts.push({ 
                    inline_data: { 
                        mime_type: file.type, 
                        data: base64Data 
                    } 
                });
            }
            
            console.log(`[Agent] Trying vision model: ${model}`);
            
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    contents: [{ parts }], 
                    generationConfig: { temperature: 0.4, maxOutputTokens: 4096 } 
                })
            });
            
            const data = await res.json();
            
            if (data.error) {
                console.log(`[Agent] Vision ${model} error:`, data.error.message);
                continue;
            }
            
            if (data.candidates?.[0]?.content?.parts?.[0]?.text) {
                console.log(`[Agent] Vision success with ${model}`);
                return data.candidates[0].content.parts[0].text;
            }
        } catch (e) { 
            console.log(`[Agent] Vision ${model} failed:`, e.message); 
        }
    }
    
    // If all vision models fail, return a fallback message
    console.log('[Agent] All vision models failed, using fallback');
    return 'Unable to process image. Please describe the assignment requirements in the text box.';
}

function cleanSiteName(site) {
    if (!site) return 'Unknown';
    let name = site.replace(/^(www\.|https?:\/\/)/i, '').split(/[\/\?#\.]/)[0];
    const fixes = { pmc: 'NIH', ncbi: 'NIH', arxiv: 'arXiv', noaa: 'NOAA', nasa: 'NASA', epa: 'EPA', ipcc: 'IPCC', pubmed: 'PubMed' };
    if (fixes[name.toLowerCase()]) return fixes[name.toLowerCase()];
    return name.charAt(0).toUpperCase() + name.slice(1);
}

function getAuthorForCitation(source) {
    if (source.author && source.author.length > 2) return source.author;
    return source.displayName || cleanSiteName(source.site) || 'Unknown';
}

// ==========================================================================
// MAIN HANDLER
// ==========================================================================
export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        const { action, task, options = {} } = req.body;
        const GEMINI_KEY = process.env.GEMINI_API_KEY;
        const GROQ_KEY = process.env.GROQ_API_KEY;

        // ==========================================================================
        // PLAN
        // ==========================================================================
        if (action === 'plan') {
            const steps = [{ tool: 'RESEARCH', action: 'Search and gather factual information', dependsOn: null }];
            
            if (options.enableQuotes) {
                steps.push({ tool: 'QUOTES', action: 'Extract key quotes from sources', dependsOn: 0 });
            }
            if (options.enableWrite !== false) {
                steps.push({ tool: 'WRITE', action: 'Generate content following instructions', dependsOn: steps.length - 1 });
            }
            if (options.enableHumanize) {
                steps.push({ tool: 'HUMANIZE', action: 'Make text sound natural', dependsOn: steps.length - 1 });
            }
            if (options.enableCite && (options.citationType === 'in-text' || options.citationType === 'footnotes')) {
                steps.push({ tool: 'INSERT_CITATIONS', action: 'Insert in-text citations', dependsOn: steps.length - 1 });
            }
            if (options.enableGrade) {
                steps.push({ tool: 'GRADE', action: 'Check quality and criteria', dependsOn: steps.length - 1 });
            }
            if (options.enableCite) {
                const styles = { mla9: 'MLA 9th', apa7: 'APA 7th', chicago: 'Chicago' };
                const types = { bibliography: 'bibliography', 'in-text': 'in-text citations', footnotes: 'footnotes' };
                steps.push({ 
                    tool: 'CITE', 
                    action: `Format ${styles[options.citationStyle] || 'MLA 9th'} ${types[options.citationType] || 'bibliography'}`,
                    dependsOn: 0 
                });
            }

            return res.status(200).json({ success: true, plan: { understanding: task.substring(0, 150), steps } });
        }

        // ==========================================================================
        // EXECUTE STEP
        // ==========================================================================
        if (action === 'execute_step') {
            const { step, context = {}, options = {} } = req.body;
            let result = { success: true, output: '', type: 'text' };

            switch (step.tool.toUpperCase()) {
                case 'RESEARCH': {
                    let query = context.task || '';
                    let userInstructions = '';
                    
                    // Handle images
                    if (options.files?.some(f => f.type?.startsWith('image/'))) {
                        userInstructions = await geminiVision(
                            `Analyze this assignment image. Extract:
1. The main TOPIC to research
2. Required SECTIONS/FORMAT (e.g., "Arguments For", "Arguments Against", "Decision", "Justification")
3. Any citation requirements
4. Word count or other requirements

Be specific about the structure the student needs to follow.`,
                            options.files, 
                            GEMINI_KEY
                        );
                        
                        // Extract topic for search
                        const topicMatch = userInstructions.match(/(?:topic|about|research|write about|issue)[:\s]+([^.!?\n]+)/i);
                        query = topicMatch ? topicMatch[1] : query || userInstructions.substring(0, 150);
                    }
                    
                    console.log('[Agent] Research query:', query.substring(0, 100));
                    
                    // Use GoogleSearchAPI - it handles all the filtering
                    let results = await GoogleSearchAPI.search(query, null, null, GROQ_KEY);
                    
                    if (!results?.length) {
                        result.output = { text: '', sources: [], userInstructions };
                        result.type = 'research';
                        break;
                    }
                    
                    // Use ScraperAPI - it handles content extraction
                    const scraped = await ScraperAPI.scrape(results.slice(0, 10));
                    const sources = [];
                    let researchText = '';
                    
                    for (const s of scraped) {
                        const text = s.text || s.content || s.snippet || '';
                        if (text.length > 100) {
                            const author = s.meta?.author || null;
                            const site = cleanSiteName(s.meta?.siteName || s.link);
                            const displayName = author || site;
                            const year = s.meta?.year || 'n.d.';
                            
                            researchText += `\n\n[${displayName}, ${year}]\n${text.substring(0, 2000)}`;
                            sources.push({
                                id: sources.length + 1,
                                title: s.title,
                                url: s.link,
                                site,
                                author,
                                year,
                                displayName,
                                text: text.substring(0, 2000)
                            });
                        }
                    }
                    
                    result.output = { text: researchText, sources, userInstructions };
                    result.type = 'research';
                    break;
                }

                case 'QUOTES': {
                    const sources = context.researchSources || [];
                    if (!sources.length) { result.output = []; result.type = 'quotes'; break; }
                    
                    const prompt = `Extract 3-5 important factual quotes from these sources.
FORMAT (one per line): SourceName: "exact quote"

${sources.slice(0, 6).map(s => `--- ${s.displayName} (${s.year}) ---\n${s.text?.substring(0, 1500) || ''}`).join('\n\n')}

Extract 3-5 quotes:`;
                    
                    const response = await GeminiAPI.chat(prompt, GEMINI_KEY);
                    const quotes = [];
                    
                    for (const line of response.split('\n')) {
                        const match = line.match(/^([^:]+):\s*"([^"]+)"/);
                        if (match) quotes.push({ source: match[1].trim(), quote: match[2].trim() });
                    }
                    
                    result.output = quotes;
                    result.type = 'quotes';
                    break;
                }

                case 'WRITE': {
                    const { researchData = {}, extractedQuotes = [], task: userTask } = context;
                    const userInstructions = researchData.userInstructions || '';
                    
                    let prompt = `You are an expert academic writer.

CRITICAL: Follow the user's required format/structure exactly.
Use HEADINGS for sections (not tables - they're hard to type).

USER'S TASK:
${userTask}

${userInstructions ? `INSTRUCTIONS FROM UPLOADED FILE:\n${userInstructions}\n` : ''}

RESEARCH:
${researchData.text?.substring(0, 8000) || ''}

${extractedQuotes.length > 0 ? `QUOTES TO INCLUDE:\n${extractedQuotes.map((q, i) => `${i + 1}. ${q.source}: "${q.quote}"`).join('\n')}\n` : ''}

RULES:
1. Follow the user's required sections/structure
2. Use headings for organization
3. Formal academic tone
4. NO bibliography section (added separately)
5. Include quotes with attribution

Write the content now:`;
                    
                    let output = await GeminiAPI.chat(prompt, GEMINI_KEY);
                    
                    // Strip any references section
                    output = output.replace(/\n\n\*?\*?(?:References|Works Cited|Bibliography|Sources)\*?\*?:?\n[\s\S]*$/i, '').trim();
                    
                    result.output = output;
                    result.type = 'text';
                    break;
                }

                case 'HUMANIZE': {
                    const text = context.previousOutput || '';
                    if (text.length < 50) throw new Error('No text to humanize');
                    
                    const prompt = `Rewrite this to sound more natural and human-like.

RULES:
- Vary sentence structure
- Use natural transitions  
- Keep SAME structure/format
- Preserve all quotes exactly

TEXT:
${text}`;
                    result.output = await GeminiAPI.chat(prompt, GEMINI_KEY);
                    result.type = 'text';
                    break;
                }

                case 'INSERT_CITATIONS': {
                    const text = context.previousOutput || '';
                    const sources = context.researchSources || [];
                    const style = options.citationStyle || 'apa7';
                    const citationType = options.citationType || 'in-text';
                    
                    if (!text || sources.length === 0) {
                        result.output = text;
                        result.type = 'text';
                        break;
                    }
                    
                    const srcList = sources.map(s => `[${s.id}] ${getAuthorForCitation(s)} (${s.year}) - ${s.title.substring(0, 60)}`).join('\n');
                    
                    const insertPrompt = `Find where to insert citations in this text.

SOURCES:
${srcList}

TEXT:
"${text.substring(0, 6000)}"

Return JSON only:
{"insertions":[{"anchor":"3-6 exact words from text","source_id":1}]}

Rules:
- anchor = exact consecutive words from text
- Insert after factual claims
- Use 5-8 insertions spread across text
- Match source topics to claims`;

                    try {
                        const response = await GroqAPI.chat([{ role: 'user', content: insertPrompt }], GROQ_KEY, false);
                        const jsonMatch = response.match(/\{[\s\S]*\}/);
                        
                        if (jsonMatch) {
                            const data = JSON.parse(jsonMatch[0]);
                            let citedText = text;
                            const insertions = data.insertions || [];
                            const positions = [];
                            const toSuper = n => n.toString().split('').map(d => '⁰¹²³⁴⁵⁶⁷⁸⁹'[+d]).join('');
                            let fnNum = 1;
                            
                            for (const ins of insertions) {
                                if (!ins.anchor || !ins.source_id) continue;
                                const pos = citedText.toLowerCase().indexOf(ins.anchor.toLowerCase());
                                if (pos !== -1) {
                                    const src = sources.find(s => s.id === ins.source_id);
                                    if (src) {
                                        const author = getAuthorForCitation(src);
                                        let citation;
                                        if (citationType === 'footnotes') {
                                            citation = toSuper(fnNum++);
                                        } else if (style.includes('apa')) {
                                            citation = ` (${author}, ${src.year})`;
                                        } else if (style.includes('mla')) {
                                            citation = ` (${author})`;
                                        } else {
                                            citation = ` (${author} ${src.year})`;
                                        }
                                        positions.push({ pos: pos + ins.anchor.length, citation, source: src });
                                    }
                                }
                            }
                            
                            positions.sort((a, b) => b.pos - a.pos);
                            for (const p of positions) {
                                citedText = citedText.slice(0, p.pos) + p.citation + citedText.slice(p.pos);
                            }
                            
                            result.output = citedText;
                            result.citedSources = positions.map(p => p.source);
                        } else {
                            result.output = text;
                        }
                    } catch (e) {
                        console.log('[Agent] Citation insertion failed:', e.message);
                        result.output = text;
                    }
                    
                    result.type = 'text';
                    break;
                }

                case 'GRADE': {
                    const text = context.previousOutput || '';
                    const userInstructions = context.researchData?.userInstructions || context.task || '';
                    
                    if (text.length < 50) {
                        result.output = { grade: 'N/A', feedback: 'No content to grade' };
                        result.type = 'grade';
                        break;
                    }
                    
                    const prompt = `You are grading a student's work against the assignment requirements.

ASSIGNMENT REQUIREMENTS:
${userInstructions}

STUDENT'S WORK:
${text.substring(0, 6000)}

Evaluate:
1. Does it follow the required FORMAT/STRUCTURE?
2. Are all required SECTIONS present?
3. Is the CONTENT accurate and well-supported?
4. Are CITATIONS present where needed?
5. Is the QUALITY of writing appropriate?

Respond with:
GRADE: A/B/C/D/F
STRENGTHS: (2-3 bullet points)
IMPROVEMENTS: (2-3 specific suggestions)`;

                    const response = await GeminiAPI.chat(prompt, GEMINI_KEY);
                    
                    const gradeMatch = response.match(/GRADE:\s*([A-F][+-]?)/i);
                    result.output = {
                        grade: gradeMatch ? gradeMatch[1] : 'B',
                        feedback: response
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
    } catch (error) {
        console.error("[Agent] Error:", error);
        return res.status(500).json({ success: false, error: error.message });
    }
}
