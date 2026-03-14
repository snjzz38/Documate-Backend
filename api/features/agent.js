// api/features/agent.js
// Agent Mode - Simplified research-first approach
// 
// FLOW: RESEARCH → QUOTES (optional) → WRITE → HUMANIZE (optional) → CITE (optional)
// API CALLS: Research (1 Groq + scraper), Quotes (1 Gemini), Write (1 Gemini), Humanize (1 Gemini)

import { GeminiAPI } from '../utils/geminiAPI.js';
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
    // Fix common junk names
    const fixes = { pmc: 'NIH', ncbi: 'NIH', arxiv: 'arXiv', noaa: 'NOAA', nasa: 'NASA', epa: 'EPA', ipcc: 'IPCC' };
    if (fixes[name.toLowerCase()]) return fixes[name.toLowerCase()];
    return name.charAt(0).toUpperCase() + name.slice(1);
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
                steps.push({ tool: 'WRITE', action: 'Generate content' + (options.enableQuotes ? ' with quotes' : ''), dependsOn: steps.length - 1 });
            }
            if (options.enableHumanize) {
                steps.push({ tool: 'HUMANIZE', action: 'Make text sound natural', dependsOn: steps.length - 1 });
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
                    
                    // Handle images
                    if (options.files?.some(f => f.type?.startsWith('image/'))) {
                        imageDesc = await geminiVision('Describe this image. What topic does it relate to?', options.files, GEMINI_KEY);
                        query = imageDesc.substring(0, 300);
                    }
                    
                    // Search
                    let results = await GoogleSearchAPI.search(query + ' facts', null, null, null);
                    if (!results?.length) {
                        results = await GoogleSearchAPI.search(query.split(/\s+/).slice(0, 4).join(' '), null, null, null);
                    }
                    
                    if (!results?.length) {
                        result.output = { text: imageDesc || 'No sources found.', sources: [], imageDesc };
                        result.type = 'research';
                        break;
                    }
                    
                    // Scrape
                    const scraped = await ScraperAPI.scrape(results.slice(0, 8));
                    const sources = [];
                    let researchText = '';
                    
                    for (const s of scraped) {
                        const text = s.text || s.content || s.snippet || '';
                        if (text.length > 50) {
                            const author = s.meta?.author || null;
                            const site = cleanSiteName(s.meta?.siteName || s.link);
                            const displayName = author || site;
                            
                            researchText += `\n\n[${displayName}]\n${text.substring(0, 2500)}`;
                            sources.push({
                                id: sources.length + 1,
                                title: s.title,
                                url: s.link,
                                site,
                                author,
                                year: s.meta?.year || 'n.d.',
                                displayName,
                                text: text.substring(0, 2500)
                            });
                        }
                    }
                    
                    result.output = { text: researchText, sources, imageDesc };
                    result.type = 'research';
                    break;
                }

                case 'QUOTES': {
                    const sources = context.researchSources || [];
                    if (!sources.length) { result.output = []; result.type = 'quotes'; break; }
                    
                    let prompt = `Extract 3-5 important factual quotes from these sources.
FORMAT (one per line): AuthorOrSource: "exact quote"

`;
                    sources.slice(0, 5).forEach(s => {
                        prompt += `--- ${s.displayName} ---\n${s.text?.substring(0, 1200) || ''}\n\n`;
                    });
                    
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
                    
                    let prompt = `You are an expert academic writer. Write accurate content based on the research provided.

RULES:
- Use formal academic tone, plain prose paragraphs
- NO markdown (##, **, etc.)
- NO bibliography/references section at the end
- When citing sources, mention the organization AND author when available
  Example: "According to NASA scientist Alicia Cermak..." or "Research from the NIH shows..."

TASK: ${userTask}

RESEARCH:
${researchData.text?.substring(0, 8000) || ''}
`;
                    
                    if (extractedQuotes.length > 0) {
                        prompt += `
QUOTES TO INCLUDE (use 2-3 with proper attribution):
${extractedQuotes.map((q, i) => `${i + 1}. ${q.source}: "${q.quote}"`).join('\n')}

Attribution examples:
- According to [full name/org], "quote"
- As [name] from [organization] explains, "quote"
- Research from [organization] shows that "quote"

NEVER write "[Source]" literally - use the actual names above.
`;
                    }
                    
                    prompt += '\nWrite the content now:';
                    result.output = await GeminiAPI.chat(prompt, GEMINI_KEY);
                    result.type = 'text';
                    break;
                }

                case 'HUMANIZE': {
                    const text = context.previousOutput || '';
                    if (text.length < 50) throw new Error('No text to humanize');
                    
                    const prompt = `Rewrite this to sound more natural and human-like.
RULES: Vary sentences, use natural transitions, keep same meaning/length, preserve all quotes exactly.

${text}`;
                    result.output = await GeminiAPI.chat(prompt, GEMINI_KEY);
                    result.type = 'text';
                    break;
                }

                case 'CITE': {
                    // Just pass sources through - frontend handles formatting
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
