// api/features/agent.js
// Agent Mode - Research-first approach with proper quote and citation integration
// 
// API CALLS PER RUN:
// - RESEARCH: 1 Groq (query) + SearXNG + scraper calls
// - QUOTES: 1 Gemini (extract quotes from research)
// - WRITE: 1 Gemini
// - HUMANIZE: 1 Gemini  
// - CITE: 0 (uses citation.js formatting)

import { GeminiAPI } from '../utils/geminiAPI.js';
import { GoogleSearchAPI } from '../utils/googleSearch.js';
import { ScraperAPI } from '../utils/scraper.js';

// ==========================================================================
// GEMINI VISION - For processing images
// ==========================================================================
async function geminiVision(prompt, files, apiKey) {
    const models = ['gemini-2.0-flash', 'gemini-1.5-flash'];
    
    for (const model of models) {
        try {
            const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
            
            const parts = [{ text: prompt }];
            
            for (const file of files) {
                if (file.type?.startsWith('image/')) {
                    parts.push({
                        inline_data: {
                            mime_type: file.type,
                            data: file.data
                        }
                    });
                }
            }
            
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts }],
                    generationConfig: { temperature: 0.7, maxOutputTokens: 4096 }
                })
            });
            
            const data = await response.json();
            if (data.candidates?.[0]?.content?.parts?.[0]?.text) {
                return data.candidates[0].content.parts[0].text;
            }
        } catch (e) {
            console.log(`[Agent] Vision ${model} failed:`, e.message);
        }
    }
    throw new Error('Vision API failed');
}

// ==========================================================================
// CITATION FORMATTING (reuses logic from citation.js)
// ==========================================================================
function cleanSiteName(site) {
    if (!site) return 'Unknown';
    return site
        .replace(/^(www\.|https?:\/\/)/i, '')
        .replace(/\.(com|org|edu|gov|net|io|co).*$/i, '')
        .split(/[\/\?#]/)[0]
        .split('.')[0]
        .replace(/[-_]/g, ' ')
        .split(' ')
        .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
        .join(' ')
        .substring(0, 30);
}

function formatBibEntry(source, style) {
    const s = String(style || 'mla9').toLowerCase();
    const author = source.author || cleanSiteName(source.site);
    const title = source.title || 'Untitled';
    const site = cleanSiteName(source.site);
    const year = source.year || 'n.d.';
    const url = source.url || '';
    
    if (s.includes('apa')) {
        return `${author}. (${year}). ${title}. <i>${site}</i>. <a href="${url}" target="_blank" style="color:#1a73e8;">${url}</a>`;
    }
    if (s.includes('mla')) {
        return `${author}. "${title}." <i>${site}</i>, ${year}, <a href="${url}" target="_blank" style="color:#1a73e8;">${url}</a>.`;
    }
    // Chicago
    return `${author}. "${title}." <i>${site}</i>. ${year}. <a href="${url}" target="_blank" style="color:#1a73e8;">${url}</a>.`;
}

// ==========================================================================
// PROMPTS
// ==========================================================================
const WRITE_PROMPT = `You are an expert academic writer. Write accurate, well-structured content based on the provided research.

RULES:
- Use formal academic tone with plain prose paragraphs
- NO markdown formatting (no ##, **, etc.)
- NO Works Cited or References section
- Base your writing on the research provided`;

const HUMANIZE_PROMPT = `Rewrite this text to sound more natural and human-like while keeping all quotes intact.

RULES:
- Vary sentence structure and length
- Use natural transitions
- Keep the same meaning and length
- PRESERVE all quoted text and attributions exactly as written
- Output ONLY the rewritten text`;

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
        // ACTION: PLAN - Create execution plan
        // ==========================================================================
        if (action === 'plan') {
            const steps = [];
            
            // ALWAYS start with research
            steps.push({
                tool: 'RESEARCH',
                action: 'Search and gather factual information',
                input: task,
                dependsOn: null
            });
            
            // QUOTES step - extract quotes from research (if enabled)
            if (options.enableQuotes) {
                steps.push({
                    tool: 'QUOTES',
                    action: 'Extract key quotes from sources',
                    input: 'Uses research results',
                    dependsOn: 0
                });
            }
            
            // WRITE uses research (and quotes if available)
            if (options.enableWrite !== false) {
                steps.push({
                    tool: 'WRITE',
                    action: 'Generate content with research' + (options.enableQuotes ? ' and quotes' : ''),
                    input: 'Uses research' + (options.enableQuotes ? ' and quotes' : ''),
                    dependsOn: options.enableQuotes ? 1 : 0
                });
            }
            
            // HUMANIZE if enabled
            if (options.enableHumanize) {
                steps.push({
                    tool: 'HUMANIZE',
                    action: 'Make the text sound natural',
                    input: 'Uses previous output',
                    dependsOn: steps.length - 1
                });
            }
            
            // CITE formats sources (no extra API call)
            if (options.enableCite) {
                steps.push({
                    tool: 'CITE',
                    action: `Format bibliography in ${options.citationStyle || 'MLA 9th'} style`,
                    input: 'Uses sources from research',
                    dependsOn: 0
                });
            }

            const plan = {
                understanding: `${task.substring(0, 150)}${task.length > 150 ? '...' : ''}`,
                steps
            };

            return res.status(200).json({ success: true, plan });
        }

        // ==========================================================================
        // ACTION: EXECUTE_STEP
        // ==========================================================================
        if (action === 'execute_step') {
            const { step, context = {}, options = {} } = req.body;
            if (!step || !step.tool) throw new Error("Invalid step");

            let result = { success: true, output: '', type: 'text' };
            const hasImages = options.files?.some(f => f.type?.startsWith('image/'));

            switch (step.tool.toUpperCase()) {
                // ============================================================
                // RESEARCH - Search web and scrape content
                // ============================================================
                case 'RESEARCH': {
                    let searchQuery = context.task || step.input || '';
                    let imageDescription = null;
                    
                    // If image attached, describe it first
                    if (hasImages && options.files) {
                        const descPrompt = `Analyze this image. What is the main topic? What key concepts does it relate to? Provide a description for research purposes.`;
                        imageDescription = await geminiVision(descPrompt, options.files, GEMINI_KEY);
                        searchQuery = imageDescription.substring(0, 300);
                    }
                    
                    console.log('[Agent] Research query:', searchQuery.substring(0, 100));
                    
                    // Search - use simple query for short inputs
                    let searchResults;
                    if (searchQuery.split(/\s+/).length <= 10) {
                        searchResults = await GoogleSearchAPI.search(searchQuery + ' facts research', null, null, null);
                    } else {
                        searchResults = await GoogleSearchAPI.search(searchQuery, null, null, GROQ_KEY);
                    }
                    
                    // Fallback search
                    if (!searchResults || searchResults.length === 0) {
                        const simpleQuery = searchQuery.split(/\s+/).slice(0, 5).join(' ') + ' overview';
                        searchResults = await GoogleSearchAPI.search(simpleQuery, null, null, null);
                    }
                    
                    if (!searchResults || searchResults.length === 0) {
                        result.output = { 
                            text: imageDescription || 'Unable to find sources.', 
                            sources: [],
                            imageDescription 
                        };
                        result.type = 'research';
                        break;
                    }
                    
                    // Scrape results
                    const sources = await ScraperAPI.scrape(searchResults.slice(0, 8));
                    
                    let researchText = '';
                    const validSources = [];
                    
                    for (const source of sources) {
                        const text = source.text || source.content || source.snippet || '';
                        if (text.length > 50) {
                            researchText += `\n\n[Source: ${source.title}]\n${text.substring(0, 3000)}`;
                            validSources.push({
                                title: source.title,
                                url: source.link,
                                site: source.meta?.siteName || new URL(source.link).hostname.replace('www.', ''),
                                author: source.meta?.author || null,
                                year: source.meta?.year || new Date().getFullYear().toString(),
                                doi: source.doi || null,
                                text: text.substring(0, 3000) // Store for quote extraction
                            });
                        }
                    }
                    
                    console.log('[Agent] Found', validSources.length, 'sources');
                    
                    result.output = {
                        text: researchText,
                        sources: validSources,
                        imageDescription
                    };
                    result.type = 'research';
                    break;
                }

                // ============================================================
                // QUOTES - Extract quotes from research (1 Gemini call)
                // ============================================================
                case 'QUOTES': {
                    const sources = context.researchSources || [];
                    
                    if (sources.length === 0) {
                        result.output = [];
                        result.type = 'quotes';
                        break;
                    }
                    
                    // Build prompt to extract quotes
                    let prompt = `Extract 3-5 important, factual quotes from these sources. Each quote should be a complete sentence that makes a strong point.

FORMAT YOUR RESPONSE EXACTLY LIKE THIS (one per line):
SOURCE_NAME: "Exact quote from the source."

SOURCES:\n`;
                    
                    sources.slice(0, 5).forEach(s => {
                        const authorOrSite = s.author || cleanSiteName(s.site);
                        prompt += `\n--- ${authorOrSite} (${s.title}) ---\n${s.text?.substring(0, 1500) || ''}\n`;
                    });
                    
                    prompt += `\nExtract 3-5 of the best quotes. Use the exact wording from the sources:`;
                    
                    const response = await GeminiAPI.chat(prompt, GEMINI_KEY);
                    
                    // Parse quotes from response
                    const quotes = [];
                    const lines = response.split('\n').filter(l => l.includes('"'));
                    
                    for (const line of lines) {
                        const match = line.match(/^([^:]+):\s*"([^"]+)"/);
                        if (match) {
                            quotes.push({
                                source: match[1].trim(),
                                quote: match[2].trim()
                            });
                        }
                    }
                    
                    console.log('[Agent] Extracted', quotes.length, 'quotes');
                    
                    result.output = quotes;
                    result.type = 'quotes';
                    break;
                }

                // ============================================================
                // WRITE - Generate content using research and quotes
                // ============================================================
                case 'WRITE': {
                    const research = context.researchData || {};
                    const researchText = research.text || '';
                    const imageDesc = research.imageDescription || '';
                    const userTask = context.task || '';
                    const quotes = context.extractedQuotes || [];
                    
                    let prompt = WRITE_PROMPT + '\n\n';
                    prompt += `TASK: ${userTask}\n\n`;
                    
                    if (imageDesc) {
                        prompt += `IMAGE ANALYSIS:\n${imageDesc}\n\n`;
                    }
                    
                    if (researchText) {
                        prompt += `RESEARCH:\n${researchText.substring(0, 8000)}\n\n`;
                    }
                    
                    // Add quotes if available
                    if (quotes.length > 0) {
                        prompt += `═══════════════════════════════════════════════════════════════
REQUIRED QUOTES - YOU MUST INCORPORATE THESE INTO YOUR WRITING:
═══════════════════════════════════════════════════════════════
Use these exact quotes with proper attribution. Examples of how to integrate:
- According to [Source], "[quote]"
- [Source] states that "[quote]"
- As [Source] explains, "[quote]"
- Research from [Source] shows that "[quote]"

QUOTES TO INCLUDE:\n`;
                        quotes.forEach((q, i) => {
                            prompt += `${i + 1}. ${q.source}: "${q.quote}"\n`;
                        });
                        prompt += `\nYou MUST include at least 2-3 of these quotes with attribution.
═══════════════════════════════════════════════════════════════\n\n`;
                    }
                    
                    prompt += 'Write the content now:';
                    
                    result.output = await GeminiAPI.chat(prompt, GEMINI_KEY);
                    result.type = 'text';
                    break;
                }

                // ============================================================
                // HUMANIZE - Make text more natural (preserves quotes)
                // ============================================================
                case 'HUMANIZE': {
                    const text = step.input || context.previousOutput || '';
                    if (!text || text.length < 50) throw new Error("No text to humanize");
                    
                    const prompt = `${HUMANIZE_PROMPT}\n\nText to rewrite:\n\n${text}`;
                    result.output = await GeminiAPI.chat(prompt, GEMINI_KEY);
                    result.type = 'text';
                    break;
                }

                // ============================================================
                // CITE - Format bibliography (no API call, uses citation.js logic)
                // ============================================================
                case 'CITE': {
                    const sources = context.researchSources || [];
                    const style = options.citationStyle || 'mla9';
                    
                    // Format each source
                    const formatted = sources.map(s => ({
                        ...s,
                        formatted: formatBibEntry(s, style)
                    }));
                    
                    result.output = formatted;
                    result.type = 'citations';
                    break;
                }

                default:
                    throw new Error(`Unknown tool: ${step.tool}`);
            }

            return res.status(200).json(result);
        }

        throw new Error(`Unknown action: ${action}`);

    } catch (error) {
        console.error("[Agent] Error:", error);
        return res.status(500).json({ success: false, error: error.message });
    }
}
