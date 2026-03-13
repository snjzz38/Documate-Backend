// api/features/agent.js
// Agent Mode - AI orchestrates multiple tools based on user task

import { HackClubAPI } from '../utils/hackclubAPI.js';
import { GroqAPI } from '../utils/groqAPI.js';
import { GoogleSearchAPI } from '../utils/googleSearch.js';
import { ScraperAPI } from '../utils/scraper.js';

const AGENT_SYSTEM_PROMPT = `You are an AI writing assistant agent. You help students complete academic writing tasks by orchestrating multiple tools.

Available tools:
1. WRITE - Generate essay/document content
2. HUMANIZE - Make AI text sound more natural and human
3. CITE - Find and format academic citations
4. GRADE - Evaluate writing against rubric/instructions

When given a task, analyze what needs to be done and output a JSON plan.

OUTPUT FORMAT (JSON only):
{
  "understanding": "Brief summary of what user wants",
  "steps": [
    {
      "tool": "WRITE|HUMANIZE|CITE|GRADE",
      "action": "Description of what to do",
      "input": "What content/text this step needs",
      "dependsOn": null or step index (0-based)
    }
  ],
  "finalOutput": "Description of what user will receive"
}

RULES:
- Break complex tasks into logical steps
- Use CITE when academic sources are needed
- Use HUMANIZE after WRITE if user wants natural-sounding text
- Use GRADE only if user wants feedback on existing work
- Each step should be atomic and clear
- Order steps by dependency (citations before inserting them, etc.)`;

const WRITE_SYSTEM_PROMPT = `You are an expert academic writer. Write clear, well-structured content based on the given instructions. 
- Use formal academic tone
- Include topic sentences for each paragraph
- Support claims with reasoning
- Do NOT include citations (those will be added separately)
- Output ONLY the essay/content, no meta-commentary`;

const HUMANIZE_SYSTEM_PROMPT = `You are a writing editor. Rewrite the given text to sound more natural and human-like while preserving the meaning and academic quality.
- Vary sentence structure and length
- Use more natural transitions
- Add subtle personality without being unprofessional
- Keep the same approximate length
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
        const { 
            action,
            task,
            content,
            options = {},
            apiKey,
            groqKey,
            googleKey
        } = req.body;

        const HACKCLUB_KEY = apiKey || process.env.HACKCLUB_API_KEY;
        const GROQ_KEY = groqKey || process.env.GROQ_API_KEY;
        const GOOGLE_KEY = googleKey || process.env.GOOGLE_SEARCH_API_KEY;

        // ==========================================================================
        // ACTION: PLAN - Create execution plan from task description
        // ==========================================================================
        if (action === 'plan') {
            if (!task || task.length < 10) {
                throw new Error("Please provide a detailed task description");
            }

            const userMessage = `TASK FROM USER:\n${task}\n\nOPTIONS ENABLED:\n${JSON.stringify(options)}`;
            
            const response = await HackClubAPI.chat(userMessage, HACKCLUB_KEY, AGENT_SYSTEM_PROMPT);
            
            // Parse JSON from response
            let plan;
            try {
                const jsonMatch = response.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    plan = JSON.parse(jsonMatch[0]);
                } else {
                    throw new Error("No valid plan generated");
                }
            } catch (e) {
                console.error("[Agent] Plan parse error:", e);
                throw new Error("Failed to generate execution plan");
            }

            return res.status(200).json({ 
                success: true, 
                plan,
                rawResponse: response
            });
        }

        // ==========================================================================
        // ACTION: EXECUTE_STEP - Execute a single step from the plan
        // ==========================================================================
        if (action === 'execute_step') {
            const { step, context = {} } = req.body;
            
            if (!step || !step.tool) {
                throw new Error("Invalid step");
            }

            let result = { success: true, output: '' };

            switch (step.tool.toUpperCase()) {
                case 'WRITE': {
                    const prompt = `${step.action}\n\nINSTRUCTIONS:\n${step.input || context.task || ''}`;
                    result.output = await HackClubAPI.chat(prompt, HACKCLUB_KEY, WRITE_SYSTEM_PROMPT);
                    result.type = 'text';
                    break;
                }

                case 'HUMANIZE': {
                    const textToHumanize = step.input || context.previousOutput || '';
                    if (!textToHumanize) {
                        throw new Error("No text to humanize");
                    }
                    result.output = await HackClubAPI.chat(
                        `Rewrite this text to sound more natural:\n\n${textToHumanize}`,
                        HACKCLUB_KEY,
                        HUMANIZE_SYSTEM_PROMPT
                    );
                    result.type = 'text';
                    break;
                }

                case 'CITE': {
                    const searchContext = step.input || context.previousOutput || context.task || '';
                    
                    // Search for sources
                    const raw = await GoogleSearchAPI.search(searchContext, GOOGLE_KEY, null, GROQ_KEY);
                    
                    if (!raw || raw.length === 0) {
                        result.output = "No sources found for the given topic.";
                        result.type = 'error';
                        break;
                    }

                    // Scrape sources
                    const sources = await ScraperAPI.scrape(raw);
                    
                    // Format citations
                    const style = options.citationStyle || 'mla';
                    const citations = sources.slice(0, 8).map((s, i) => {
                        const author = s.meta?.author || cleanSiteName(s.title);
                        const year = s.meta?.year || 'n.d.';
                        const title = s.title || 'Untitled';
                        const url = s.doi ? `https://doi.org/${s.doi}` : s.link;
                        const site = cleanSiteName(s.meta?.siteName || s.title);
                        
                        return {
                            id: i + 1,
                            author,
                            year,
                            title,
                            url,
                            site,
                            formatted: formatCitation(author, year, title, site, url, style)
                        };
                    });

                    result.output = citations;
                    result.type = 'citations';
                    result.sources = sources;
                    break;
                }

                case 'GRADE': {
                    const textToGrade = step.input || context.previousOutput || '';
                    const instructions = options.rubric || 'Provide constructive feedback';
                    
                    const prompt = `Grade this student submission:\n\n${textToGrade}\n\nRUBRIC/INSTRUCTIONS:\n${instructions}`;
                    result.output = await HackClubAPI.chat(prompt, HACKCLUB_KEY);
                    result.type = 'feedback';
                    break;
                }

                default:
                    throw new Error(`Unknown tool: ${step.tool}`);
            }

            return res.status(200).json(result);
        }

        // ==========================================================================
        // ACTION: INTEGRATE_CITATIONS - Insert citations into text
        // ==========================================================================
        if (action === 'integrate_citations') {
            const { text, citations, style = 'mla' } = req.body;
            
            if (!text || !citations || citations.length === 0) {
                throw new Error("Need text and citations to integrate");
            }

            const prompt = `Insert these citations into the text at appropriate places. Return the text with in-text citations added.

TEXT:
${text}

AVAILABLE CITATIONS:
${citations.map(c => `[${c.id}] ${c.author} (${c.year}) - ${c.title}`).join('\n')}

RULES:
- Add in-text citations like (Author, Year) for APA or (Author) for MLA
- Place citations after relevant claims/statements
- Use at least 3-5 citations
- Return ONLY the text with citations inserted, nothing else`;

            const citedText = await HackClubAPI.chat(prompt, HACKCLUB_KEY);
            
            // Build bibliography
            const bibliography = citations.map(c => c.formatted).join('\n\n');

            return res.status(200).json({
                success: true,
                citedText,
                bibliography,
                citationCount: citations.length
            });
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

function formatCitation(author, year, title, site, url, style) {
    const s = String(style).toLowerCase();
    
    if (s.includes('apa')) {
        return `${author}. (${year}). ${title}. <i>${site}</i>. ${url}`;
    }
    if (s.includes('mla')) {
        return `${author}. "${title}." <i>${site}</i>, ${year}, ${url}.`;
    }
    // Chicago
    return `${author}. "${title}." <i>${site}</i>. ${year}. ${url}.`;
}
