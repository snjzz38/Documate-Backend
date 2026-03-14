// api/features/agent.js
// Agent Mode - AI orchestrates multiple tools based on user task

import { GeminiAPI } from '../utils/geminiAPI.js';
import { GroqAPI } from '../utils/groqAPI.js';
import { GoogleSearchAPI } from '../utils/googleSearch.js';
import { ScraperAPI } from '../utils/scraper.js';

// ==========================================================================
// GEMINI VISION - For processing images/PDFs
// ==========================================================================
async function geminiVision(prompt, files, apiKey) {
    const models = [
        'gemini-2.0-flash',
        'gemini-1.5-flash',
        'gemini-1.5-pro'
    ];
    
    for (const model of models) {
        try {
            const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
            
            // Build parts array with text and images
            const parts = [{ text: prompt }];
            
            for (const file of files) {
                if (file.type.startsWith('image/')) {
                    parts.push({
                        inline_data: {
                            mime_type: file.type,
                            data: file.data
                        }
                    });
                } else if (file.type === 'application/pdf') {
                    // PDFs need different handling - for now just note them
                    parts[0].text += `\n\n[PDF attached: ${file.name}]`;
                }
            }
            
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts }],
                    generationConfig: {
                        temperature: 0.7,
                        maxOutputTokens: 4096
                    }
                })
            });
            
            const data = await response.json();
            
            if (data.candidates?.[0]?.content?.parts?.[0]?.text) {
                return data.candidates[0].content.parts[0].text;
            }
            
            if (data.error) {
                console.log(`[Agent] Gemini ${model} error:`, data.error.message);
                continue;
            }
        } catch (e) {
            console.log(`[Agent] Gemini ${model} failed:`, e.message);
            continue;
        }
    }
    
    throw new Error('All Gemini models failed for vision request');
}

const AGENT_SYSTEM_PROMPT = `You are an AI writing assistant. Create a plan using ONLY the enabled tools.

Available tools:
- WRITE: Generate essay/document content (can analyze images if attached)
- HUMANIZE: Make text sound more natural
- CITE: Find sources and create bibliography

OUTPUT FORMAT (JSON only):
{
  "understanding": "Brief summary",
  "steps": [{"tool": "WRITE|HUMANIZE|CITE", "action": "Description", "input": "Content needed", "dependsOn": null}]
}

CRITICAL: Only include steps for tools that are ENABLED in the options. If enableWrite is false, do NOT include WRITE step.`;

const WRITE_SYSTEM_PROMPT = `You are an expert academic writer. Write clear, well-structured content.

ABSOLUTE RULES:
- Use formal academic tone
- Write in plain prose paragraphs
- Do NOT use markdown formatting (no ##, **, etc.)
- Do NOT include citations like [1], [2], (Author Year)
- Do NOT add Works Cited or References
- Just output the essay text in plain paragraphs`;

const HUMANIZE_SYSTEM_PROMPT = `Rewrite the text to sound more natural and human-like.

ABSOLUTE RULES - FOLLOW EXACTLY:
- Vary sentence structure and length
- Use natural transitions
- Keep the same meaning and approximate length
- NEVER add citations like [1], [2], [3], (Author Year), (Smith, 2020), etc.
- NEVER add Works Cited, References, or Bibliography
- If the input has citation markers, REMOVE them
- Output ONLY the rewritten text with NO citation markers`;

// ==========================================================================
// MAIN HANDLER
// ==========================================================================
export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        const { action, task, options = {}, groqKey, googleKey } = req.body;

        const GEMINI_KEY = process.env.GEMINI_API_KEY;
        const GROQ_KEY = groqKey || process.env.GROQ_API_KEY;
        const GOOGLE_KEY = googleKey || process.env.GOOGLE_SEARCH_API_KEY;

        // ==========================================================================
        // ACTION: PLAN
        // ==========================================================================
        if (action === 'plan') {
            if (!task || task.length < 10) {
                throw new Error("Please provide a detailed task description");
            }

            // Build prompt with file descriptions if present
            let fileContext = '';
            if (options.files && options.files.length > 0) {
                fileContext = '\n\nATTACHED FILES:\n' + options.files.map(f => `- ${f.name} (${f.type})`).join('\n');
                fileContext += '\n(Files will be processed with the task)';
            }

            const prompt = `${AGENT_SYSTEM_PROMPT}\n\nTASK: ${task}${fileContext}\n\nOPTIONS: ${JSON.stringify({...options, files: undefined})}\n\nRespond with JSON only.`;
            const response = await GeminiAPI.chat(prompt, GEMINI_KEY);
            
            let plan;
            try {
                const cleaned = response.replace(/```json\n?/g, '').replace(/```\n?/g, '');
                const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
                plan = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
                if (!plan) throw new Error("No plan");
            } catch (e) {
                throw new Error("Failed to generate execution plan");
            }

            return res.status(200).json({ success: true, plan });
        }

        // ==========================================================================
        // ACTION: EXECUTE_STEP
        // ==========================================================================
        if (action === 'execute_step') {
            const { step, context = {}, options = {} } = req.body;
            if (!step || !step.tool) throw new Error("Invalid step");

            let result = { success: true, output: '', type: 'text' };
            
            // Build file context if files are attached
            let fileContext = '';
            if (options.files && options.files.length > 0) {
                // For text-based files, we could extract content
                // For images/PDFs, just note they're attached
                fileContext = '\n\n[Attached files: ' + options.files.map(f => f.name).join(', ') + ']';
            }

            switch (step.tool.toUpperCase()) {
                case 'WRITE': {
                    const prompt = `${WRITE_SYSTEM_PROMPT}\n\nTask: ${step.action}\n\nDetails: ${step.input || context.task || ''}${fileContext}`;
                    result.output = await GeminiAPI.chat(prompt, GEMINI_KEY);
                    break;
                }

                case 'HUMANIZE': {
                    const text = step.input || context.previousOutput || '';
                    if (!text) throw new Error("No text to humanize");
                    const prompt = `${HUMANIZE_SYSTEM_PROMPT}\n\nText to rewrite:\n\n${text}`;
                    result.output = await GeminiAPI.chat(prompt, GEMINI_KEY);
                    break;
                }

                case 'CITE': {
                    const searchContext = step.input || context.previousOutput || context.task || '';
                    const raw = await GoogleSearchAPI.search(searchContext, GOOGLE_KEY, null, GROQ_KEY);
                    
                    if (!raw || raw.length === 0) {
                        result.output = [];
                        result.type = 'citations';
                        break;
                    }

                    const sources = await ScraperAPI.scrape(raw);
                    const style = options.citationStyle || 'mla9';
                    
                    const citations = sources.slice(0, 8).map((s, i) => ({
                        id: i + 1,
                        author: s.meta?.author || cleanSiteName(s.title),
                        year: s.meta?.year || 'n.d.',
                        title: s.title || 'Untitled',
                        url: s.doi ? `https://doi.org/${s.doi}` : s.link,
                        site: cleanSiteName(s.meta?.siteName || s.title)
                    }));

                    result.output = citations;
                    result.type = 'citations';
                    break;
                }

                default:
                    throw new Error(`Unknown tool: ${step.tool}`);
            }

            return res.status(200).json(result);
        }

        // ==========================================================================
        // ACTION: BUILD_BIBLIOGRAPHY
        // ==========================================================================
        if (action === 'build_bibliography') {
            const { citations, style = 'mla9' } = req.body;
            
            if (!citations || citations.length === 0) {
                return res.status(200).json({ success: true, bibliography: '' });
            }

            // Sort alphabetically by author
            const sorted = [...citations].sort((a, b) => 
                a.author.toLowerCase().localeCompare(b.author.toLowerCase())
            );

            const bibTitle = style.includes('mla') ? 'Works Cited' : 
                            style.includes('apa') ? 'References' : 'Bibliography';

            // Build HTML bibliography
            let bibHtml = `<div style="font-family: 'Times New Roman', Times, serif; font-size: 12pt; text-align: center; margin-bottom: 16px;">${bibTitle}</div>`;
            
            sorted.forEach(c => {
                const urlHtml = `<a href="${c.url}" target="_blank" style="color: #1a73e8;">${c.url}</a>`;
                let entry;
                
                if (style.includes('apa')) {
                    entry = `${c.author}. (${c.year}). ${c.title}. <i>${c.site}</i>. ${urlHtml}`;
                } else if (style.includes('mla')) {
                    entry = `${c.author}. "${c.title}." <i>${c.site}</i>, ${c.year}, ${urlHtml}.`;
                } else {
                    entry = `${c.author}. "${c.title}." <i>${c.site}</i>. ${c.year}. ${urlHtml}.`;
                }
                
                bibHtml += `<p style="font-family: 'Times New Roman', Times, serif; font-size: 12pt; text-indent: -36px; padding-left: 36px; margin: 0 0 8px 0; line-height: 2;">${entry}</p>`;
            });

            return res.status(200).json({ success: true, bibliography: bibHtml });
        }

        throw new Error("Invalid action");

    } catch (error) {
        console.error("[Agent] Error:", error);
        return res.status(500).json({ success: false, error: error.message });
    }
}

// ==========================================================================
// HELPERS
// ==========================================================================
function cleanSiteName(site) {
    if (!site) return 'Unknown';
    return String(site)
        .replace(/^www\./, '')
        .replace(/^https?:\/\//, '')
        .replace(/\.(com|org|edu|net|gov|io)$/i, '')
        .replace(/[→\-–|]/g, ' ')
        .trim()
        .split(/[.\s]/)[0] || 'Unknown';
}
