// api/features/agent.js
// Agent Mode - Research-first approach with proper image handling
// 
// API CALLS PER RUN:
// - RESEARCH: 1 Groq (query gen) + 1-4 SearXNG + scraper calls
// - WRITE: 1 Gemini
// - HUMANIZE: 1 Gemini  
// - CITE: 0 (just formatting)
// - Image description: 1 Gemini Vision (if image attached)
//
// Typical run (Write+Humanize+Cite): ~3-4 Gemini + 1 Groq + searches

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
// PROMPTS
// ==========================================================================
const WRITE_PROMPT = `You are an expert academic writer. Use the PROVIDED RESEARCH to write accurate, well-sourced content.

CRITICAL RULES:
- Base your writing ONLY on the RESEARCH PROVIDED - do not make up facts
- Use formal academic tone with plain prose paragraphs
- NO markdown formatting (no ##, **, etc.)
- NO in-text citations like [1], [2], (Author, Year)
- NO Works Cited or References section
- Output ONLY the essay/content text`;

const HUMANIZE_PROMPT = `Rewrite this text to sound more natural and human-like.

RULES:
- Vary sentence structure and length
- Use natural transitions
- Keep the same meaning and approximate length
- Remove any citation markers if present
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
        // ACTION: PLAN - Create execution plan (no API calls, just builds steps)
        // ==========================================================================
        if (action === 'plan') {
            const steps = [];
            
            // ALWAYS start with research to get real facts
            steps.push({
                tool: 'RESEARCH',
                action: 'Search and gather factual information on the topic',
                input: task,
                dependsOn: null
            });
            
            // WRITE uses research results
            if (options.enableWrite !== false) {
                steps.push({
                    tool: 'WRITE',
                    action: `Generate content based on research`,
                    input: 'Uses research from step 1',
                    dependsOn: 0
                });
            }
            
            // HUMANIZE if enabled
            if (options.enableHumanize) {
                steps.push({
                    tool: 'HUMANIZE',
                    action: 'Make the text sound more natural',
                    input: 'Uses output from previous step',
                    dependsOn: steps.length - 1
                });
            }
            
            // CITE formats sources found during research (no extra search)
            if (options.enableCite) {
                steps.push({
                    tool: 'CITE',
                    action: `Format bibliography in ${options.citationStyle || 'MLA 9th'} style`,
                    input: 'Uses sources from research step',
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
                // API calls: 1 Groq (query) + SearXNG + scraper
                // ============================================================
                case 'RESEARCH': {
                    let searchQuery = context.task || step.input || '';
                    let imageDescription = null;
                    
                    // If image attached, describe it first to understand the topic
                    if (hasImages && options.files) {
                        const descPrompt = `Analyze this image carefully. What is the main topic or subject? What key concepts, terms, or themes does it relate to? Provide a detailed description that could be used to research this topic.`;
                        imageDescription = await geminiVision(descPrompt, options.files, GEMINI_KEY);
                        // Use image description to inform search
                        searchQuery = imageDescription.substring(0, 300);
                    }
                    
                    // Search for sources
                    const searchResults = await GoogleSearchAPI.search(searchQuery, null, null, GROQ_KEY);
                    
                    if (!searchResults || searchResults.length === 0) {
                        result.output = { 
                            text: imageDescription || 'No sources found.', 
                            sources: [],
                            imageDescription 
                        };
                        result.type = 'research';
                        break;
                    }
                    
                    // Scrape top results for content
                    const sources = await ScraperAPI.scrape(searchResults.slice(0, 8));
                    
                    // Build research text from scraped content
                    let researchText = '';
                    const validSources = [];
                    
                    for (const source of sources) {
                        if (source.text && source.text.length > 100) {
                            researchText += `\n\n[Source: ${source.title}]\n${source.text.substring(0, 2500)}`;
                            validSources.push({
                                title: source.title,
                                url: source.link,
                                site: source.meta?.siteName || new URL(source.link).hostname.replace('www.', ''),
                                author: source.meta?.author || null,
                                year: source.meta?.year || new Date().getFullYear().toString(),
                                doi: source.doi || null
                            });
                        }
                    }
                    
                    result.output = {
                        text: researchText || 'Limited information found.',
                        sources: validSources,
                        imageDescription
                    };
                    result.type = 'research';
                    break;
                }

                // ============================================================
                // WRITE - Generate content using research
                // API calls: 1 Gemini
                // ============================================================
                case 'WRITE': {
                    const research = context.researchData || {};
                    const researchText = research.text || '';
                    const imageDesc = research.imageDescription || '';
                    const userTask = context.task || '';
                    
                    // Build the writing prompt
                    let prompt = WRITE_PROMPT + '\n\n';
                    prompt += `USER REQUEST: ${userTask}\n\n`;
                    
                    if (imageDesc) {
                        prompt += `IMAGE ANALYSIS:\n${imageDesc}\n\n`;
                    }
                    
                    if (researchText) {
                        prompt += `FACTUAL RESEARCH (base your writing on this):\n${researchText.substring(0, 10000)}\n\n`;
                    }
                    
                    prompt += 'Now write the requested content using ONLY the facts from the research above. Do not invent information:';
                    
                    result.output = await GeminiAPI.chat(prompt, GEMINI_KEY);
                    result.type = 'text';
                    break;
                }

                // ============================================================
                // HUMANIZE - Make text more natural
                // API calls: 1 Gemini
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
                // CITE - Format sources from research (no API calls)
                // ============================================================
                case 'CITE': {
                    const sources = context.researchSources || [];
                    result.output = sources;
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
