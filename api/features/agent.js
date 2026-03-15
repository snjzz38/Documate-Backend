// api/features/agent.js
// Agent Mode - Research-first with post-humanize citation insertion
// 
// FLOW: RESEARCH → WRITE (follows instructions) → HUMANIZE → INSERT_CITATIONS
// This ensures humanization doesn't break citations

import { GeminiAPI } from '../utils/geminiAPI.js';
import { GroqAPI } from '../utils/groqAPI.js';
import { GoogleSearchAPI } from '../utils/googleSearch.js';
import { ScraperAPI } from '../utils/scraper.js';

// ==========================================================================
// HELPERS
// ==========================================================================
async function geminiVision(prompt, files, apiKey) {
    for (const model of ['gemini-2.0-flash', 'gemini-1.5-flash']) {
        try {
            const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
            const parts = [{ text: prompt }];
            
            for (const file of files) {
                if (file.type?.startsWith('image/')) {
                    parts.push({ inline_data: { mime_type: file.type, data: file.data } });
                }
            }
            
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ contents: [{ parts }], generationConfig: { temperature: 0.7, maxOutputTokens: 4096 } })
            });
            
            const data = await res.json();
            if (data.candidates?.[0]?.content?.parts?.[0]?.text) {
                return data.candidates[0].content.parts[0].text;
            }
        } catch (e) { console.log(`[Agent] Vision ${model} failed:`, e.message); }
    }
    throw new Error('Vision API failed');
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
        // PLAN - Flow: RESEARCH → QUOTES → WRITE → HUMANIZE → INSERT_CITATIONS → CITE
        // ==========================================================================
        if (action === 'plan') {
            const steps = [{ tool: 'RESEARCH', action: 'Search and gather factual information', dependsOn: null }];
            
            // QUOTES extracts quotes from research
            if (options.enableQuotes) {
                steps.push({ tool: 'QUOTES', action: 'Extract key quotes from sources', dependsOn: 0 });
            }
            
            if (options.enableWrite !== false) {
                steps.push({ tool: 'WRITE', action: 'Generate content following instructions', dependsOn: steps.length - 1 });
            }
            if (options.enableHumanize) {
                steps.push({ tool: 'HUMANIZE', action: 'Make text sound natural', dependsOn: steps.length - 1 });
            }
            // Citation insertion happens AFTER humanize so it doesn't get mangled
            if (options.enableCite && (options.citationType === 'in-text' || options.citationType === 'footnotes')) {
                steps.push({ tool: 'INSERT_CITATIONS', action: 'Insert in-text citations', dependsOn: steps.length - 1 });
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

            return res.status(200).json({ 
                success: true, 
                plan: { understanding: task.substring(0, 150), steps } 
            });
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
                    let imageDesc = null;
                    let userInstructions = '';
                    
                    // Handle images - extract instructions AND format requirements
                    if (options.files?.some(f => f.type?.startsWith('image/'))) {
                        imageDesc = await geminiVision(
                            `Analyze this assignment/instructions image carefully.

1. EXTRACT THE EXACT FORMAT/STRUCTURE REQUIRED:
   - If there's a table, describe its columns and what goes in each
   - If there are specific sections (e.g., "Arguments For", "Arguments Against", "Decision", "Justification"), list them
   - Note any specific formatting requirements

2. EXTRACT THE TOPIC/QUESTION:
   - What is the main topic to research?
   - What specific question needs to be answered?

3. EXTRACT ANY CITATION REQUIREMENTS:
   - What citation style is required?
   - Are in-text citations required?

Be specific and detailed about the FORMAT the student needs to follow.`, 
                            options.files, 
                            GEMINI_KEY
                        );
                        userInstructions = imageDesc;
                        
                        // Extract topic for search - look for the main subject
                        const topicPatterns = [
                            /(?:topic|about|regarding|research|write about|issue)[:\s]+([^.!?\n]+)/i,
                            /(?:designer babies|gene editing|CRISPR|genetic engineering)/i,
                            /(?:should we|ethics of|implications of)\s+([^.!?\n]+)/i
                        ];
                        
                        for (const pattern of topicPatterns) {
                            const match = imageDesc.match(pattern);
                            if (match) {
                                query = match[1] || match[0];
                                break;
                            }
                        }
                        if (!query || query.length < 5) {
                            query = imageDesc.substring(0, 150);
                        }
                    }
                    
                    // Search with topic-specific query - be specific
                    console.log('[Agent] Research query:', query.substring(0, 80));
                    let results = await GoogleSearchAPI.search(query + ' ethics research', null, null, null);
                    if (!results?.length) {
                        results = await GoogleSearchAPI.search(query.split(/\s+/).slice(0, 5).join(' '), null, null, null);
                    }
                    
                    if (!results?.length) {
                        result.output = { text: '', sources: [], userInstructions };
                        result.type = 'research';
                        break;
                    }
                    
                    // Scrape and build sources
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
                    
                    result.output = { text: researchText, sources, userInstructions, imageDesc };
                    result.type = 'research';
                    break;
                }

                case 'QUOTES': {
                    const sources = context.researchSources || [];
                    if (!sources.length) { 
                        result.output = []; 
                        result.type = 'quotes'; 
                        break; 
                    }
                    
                    let prompt = `Extract 3-5 important factual quotes from these sources. Each quote should be a complete sentence.

FORMAT (exactly like this, one per line):
SourceName: "exact quote from the text"

SOURCES:
`;
                    sources.slice(0, 6).forEach(s => {
                        prompt += `\n--- ${s.displayName} (${s.year}) ---\n${s.text?.substring(0, 1500) || ''}\n`;
                    });
                    
                    prompt += `\nExtract 3-5 quotes using the source names above:`;
                    
                    const response = await GeminiAPI.chat(prompt, GEMINI_KEY);
                    const quotes = [];
                    
                    for (const line of response.split('\n')) {
                        const match = line.match(/^([^:]+):\s*"([^"]+)"/);
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
                    const { researchData = {}, extractedQuotes = [], task: userTask } = context;
                    const userInstructions = researchData.userInstructions || '';
                    
                    let prompt = `You are an expert academic writer who follows instructions EXACTLY.

═══════════════════════════════════════════════════════════════
CRITICAL: FOLLOW THE USER'S FORMAT EXACTLY
═══════════════════════════════════════════════════════════════

If the instructions specify a TABLE with columns like:
- "Arguments For" | "Arguments Against" → Create that exact table
- "Decision" section → Include a Decision section
- "Justification" section → Include a Justification section

If the instructions ask for specific sections, include EXACTLY those sections.
DO NOT create your own structure - copy the structure from the instructions.

USER'S TASK:
${userTask}

${userInstructions ? `═══════════════════════════════════════════════════════════════
INSTRUCTIONS FROM UPLOADED FILE (FOLLOW THIS FORMAT):
═══════════════════════════════════════════════════════════════
${userInstructions}
` : ''}

RESEARCH SOURCES (use these facts in your writing):
${researchData.text?.substring(0, 8000) || ''}

${extractedQuotes.length > 0 ? `
═══════════════════════════════════════════════════════════════
QUOTES TO INCLUDE (incorporate 2-3 of these with attribution):
═══════════════════════════════════════════════════════════════
${extractedQuotes.map((q, i) => `${i + 1}. ${q.source}: "${q.quote}"`).join('\n')}

Use these quotes naturally: According to [Source], "quote..." or As [Source] explains, "quote..."
` : ''}

WRITING RULES:
1. Follow the EXACT structure/format from the instructions
2. If a table is required, create the table with the specified columns
3. Use formal academic tone
4. DO NOT add a bibliography/references section (added separately)
5. Include the quotes naturally with attribution
6. NO markdown headers (##) unless the format requires them

Write the content now, matching the user's required format EXACTLY:`; 
                    
                    result.output = await GeminiAPI.chat(prompt, GEMINI_KEY);
                    result.type = 'text';
                    break;
                }

                case 'HUMANIZE': {
                    const text = context.previousOutput || '';
                    if (text.length < 50) throw new Error('No text to humanize');
                    
                    const prompt = `Rewrite this to sound more natural and human-like.

RULES: 
- Vary sentence structure and length
- Use natural transitions
- Keep the SAME structure/format as the original
- Keep the same meaning and approximate length
- Preserve all source attributions (e.g., "According to NASA...")

TEXT:
${text}`;
                    result.output = await GeminiAPI.chat(prompt, GEMINI_KEY);
                    result.type = 'text';
                    break;
                }

                case 'INSERT_CITATIONS': {
                    // Use Groq to find where to insert citations, similar to citation.js
                    const text = context.previousOutput || '';
                    const sources = context.researchSources || [];
                    const style = options.citationStyle || 'apa7';
                    const citationType = options.citationType || 'in-text';
                    
                    if (!text || sources.length === 0) {
                        result.output = text;
                        result.type = 'text';
                        break;
                    }
                    
                    // Build source list for Groq
                    const srcList = sources.map(s => {
                        const author = getAuthorForCitation(s);
                        return `[${s.id}] ${author} (${s.year}) - ${s.title.substring(0, 60)}`;
                    }).join('\n');
                    
                    const insertPrompt = `Find where to insert citations in this text. Match sources to claims.

SOURCES:
${srcList}

TEXT:
"${text.substring(0, 6000)}"

Return JSON only:
{"insertions":[{"anchor":"3-6 exact consecutive words from text","source_id":1}]}

Rules:
- anchor must be EXACT words from the text
- Insert after sentences that make factual claims
- Use 5-8 insertions spread across the text
- Match source topics to claim topics`;

                    try {
                        const response = await GroqAPI.chat([{ role: 'user', content: insertPrompt }], GROQ_KEY, false);
                        const jsonMatch = response.match(/\{[\s\S]*\}/);
                        
                        if (jsonMatch) {
                            const data = JSON.parse(jsonMatch[0]);
                            let citedText = text;
                            const insertions = data.insertions || [];
                            
                            // Sort by position (find each anchor) and insert in reverse order
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
                            
                            // Insert in reverse order to preserve positions
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

                case 'CITE': {
                    // Pass sources through - frontend handles final formatting
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
