// api/features/humanizer.js
import { GroqAPI } from '../utils/groqAPI.js';

// ==========================================================================
// CONSTANTS
// ==========================================================================

const BANNED_WORDS = [
    "furthermore", "moreover", "additionally", "subsequently", "consequently",
    "nevertheless", "utilize", "leverage", "facilitate", "optimize", "enhance",
    "comprehensive", "multifaceted", "paradigm", "methodology", "underscore",
    "delve", "realm", "landscape", "crucial", "pivotal", "myriad", "plethora"
];

const SIMPLE_SWAPS = {
    "utilize": "use", "leverage": "use", "facilitate": "help", "optimize": "improve",
    "enhance": "improve", "comprehensive": "full", "furthermore": "also",
    "moreover": "and", "additionally": "also", "subsequently": "then",
    "consequently": "so", "nevertheless": "but", "demonstrate": "show",
    "significant": "major", "numerous": "many", "prior to": "before",
    "in order to": "to", "due to the fact that": "because"
};

// ==========================================================================
// UTILITY FUNCTIONS
// ==========================================================================

function killEmDashes(text) {
    return text
        .replace(/\u2014/g, ', ')
        .replace(/\u2013/g, ', ')
        .replace(/—/g, ', ')
        .replace(/–/g, ', ')
        .replace(/ - /g, ', ')
        .replace(/,\s*,/g, ',')
        .replace(/\s{2,}/g, ' ')
        .trim();
}

function applySwaps(text) {
    let result = text;
    for (const [bad, good] of Object.entries(SIMPLE_SWAPS)) {
        result = result.replace(new RegExp(`\\b${bad}\\b`, 'gi'), good);
    }
    return result;
}

function cleanOutput(text) {
    let cleaned = text;
    cleaned = cleaned.replace(/^(Here's|Here is|Below is|Sure|I've rewritten|Rewritten|I have rewritten)[^:.\n]*[:.]\s*/gi, '');
    cleaned = cleaned.replace(/^["']|["']$/g, '');
    return cleaned.trim();
}

// ==========================================================================
// SECTION DETECTION
// ==========================================================================

function detectSections(text) {
    const lines = text.split('\n');
    const sections = [];
    let currentSection = { title: '', content: [] };
    
    for (const line of lines) {
        const trimmed = line.trim();
        const isHeader = /^#{1,3}\s+/.test(trimmed) || 
                        (/^[A-Z][^.!?]*$/.test(trimmed) && trimmed.length < 60 && trimmed.length > 3) ||
                        /^(Introduction|Conclusion|Summary|Background|Causes?|Effects?|Impacts?|Solutions?)/i.test(trimmed);
        
        if (isHeader && trimmed.length > 0) {
            if (currentSection.content.length > 0) {
                sections.push({ title: currentSection.title, content: currentSection.content.join(' ').trim() });
            }
            currentSection = { title: trimmed.replace(/^#+\s*/, ''), content: [] };
        } else if (trimmed.length > 0) {
            currentSection.content.push(trimmed);
        }
    }
    
    if (currentSection.content.length > 0) {
        sections.push({ title: currentSection.title, content: currentSection.content.join(' ').trim() });
    }
    
    return sections.length > 0 ? sections : [{ title: '', content: text.trim() }];
}

// ==========================================================================
// PLANNING REQUEST
// ==========================================================================

async function planEssay(sections, apiKey) {
    if (sections.length <= 1) return {};
    
    const sectionList = sections.map((s, i) => 
        `${i + 1}. ${s.content.substring(0, 120)}...`
    ).join('\n');
    
    const prompt = `Summarize each section in 10 words or less:\n${sectionList}`;
    const messages = [{ role: "user", content: prompt }];
    
    try {
        const plan = await GroqAPI.chat(messages, apiKey, false);
        const summaries = {};
        plan.split('\n').forEach((line, i) => {
            const cleaned = line.replace(/^\d+[\.\)]\s*/, '').trim();
            if (cleaned) summaries[i] = cleaned;
        });
        return summaries;
    } catch (e) {
        return {};
    }
}

// ==========================================================================
// HUMANIZATION PROMPT - The key to beating detection
// ==========================================================================

function buildPrompt(section, index, totalSections, prevSummary, nextSummary) {
    const position = index === 0 ? 'OPENING' : index === totalSections - 1 ? 'CLOSING' : 'MIDDLE';
    
    let contextNote = '';
    if (prevSummary) contextNote += `[Follows from: ${prevSummary}] `;
    if (nextSummary) contextNote += `[Leads into: ${nextSummary}]`;

    return `Rewrite this ${position} section to read naturally.

${contextNote}

WHAT AI WRITING LOOKS LIKE (avoid this):
- Short choppy sentences that don't connect: "X is a problem. It causes Y. This leads to Z."
- Fake casual phrases: "Here's the thing:", "You have to wonder", "The thing is"
- The pattern "isn't just X, it's Y" or "isn't just X. It's Y"
- Every sentence being its own isolated statement
- Rhetorical questions that feel forced
- Lists of three: "X, Y, and Z"

WHAT NATURAL WRITING LOOKS LIKE:
- Sentences that BUILD on each other with real logical connections
- Some longer sentences with embedded clauses: "The warming climate, which has already displaced millions, threatens to destabilize regions that can least afford instability."
- Mix of simple and complex structures occurring naturally
- Ideas that flow: when you finish one sentence, the next one should feel inevitable
- Occasional shorter sentence for emphasis, but not choppy
- Subordinate clauses: "because", "although", "while", "given that", "even as"

EXAMPLE OF NATURAL FLOW:
"Climate change has moved beyond environmental concern into the realm of security threat. Rising temperatures don't just melt ice caps; they dry out farmland, intensify storms, and push already unstable regions toward breaking points. When crops fail repeatedly, people migrate, and mass migration creates pressures that even stable governments struggle to manage. The challenge now is whether the international community can coordinate a response before these pressures become unmanageable."

EXAMPLE OF AI-SOUNDING WRITING (avoid):
"Climate change is a serious threat. It's not just about the environment. It's about security. Rising temperatures cause problems. These problems include droughts and storms. People are forced to move. This creates pressure on borders. We need to act now."

REWRITE THIS TEXT:
"${section.content}"

RULES:
- Make sentences CONNECT logically to each other
- Use subordinating conjunctions naturally (because, although, while, as, since, when)
- Some sentences should be longer with embedded clauses
- No fake casual phrases like "here's the thing" or "you have to wonder"
- No "isn't just X, it's Y" pattern
- No semicolons or em dashes
- Keep all the original meaning and information

Write the rewritten version only:`;
}

// ==========================================================================
// POST-PROCESSING
// ==========================================================================

function postProcess(text, sectionTitle) {
    let result = text;
    
    // Clean AI artifacts
    result = cleanOutput(result);
    
    // Kill em dashes
    result = killEmDashes(result);
    
    // Apply word swaps
    result = applySwaps(result);
    
    // Remove fake casual phrases that AI uses to sound human
    result = result.replace(/\b(Here's the thing|The thing is|You have to wonder|You know how|What worries me is|And that's alarming)[,:]?\s*/gi, '');
    result = result.replace(/\bLook,\s*/gi, '');
    result = result.replace(/\bGranted,\s*/gi, '');
    result = result.replace(/\bSure,\s*/gi, '');
    
    // Remove any remaining "isn't just...it's" patterns
    result = result.replace(/isn't just ([^.]+)\.\s*It's/gi, (_, x) => `extends beyond ${x.trim()}, becoming`);
    result = result.replace(/is not just ([^.]+)\.\s*It is/gi, (_, x) => `extends beyond ${x.trim()}, becoming`);
    result = result.replace(/isn't just/gi, 'extends beyond');
    result = result.replace(/is not just/gi, 'extends beyond');
    result = result.replace(/not just ([^,]+),\s*(it's|but)/gi, 'beyond $1, ');
    
    // Fix repeated sentence starters
    const sentences = result.split(/(?<=[.!?])\s+/);
    const starterCount = {};
    const fixed = sentences.map((s, i) => {
        const firstWord = s.split(/\s+/)[0];
        starterCount[firstWord] = (starterCount[firstWord] || 0) + 1;
        
        // If same starter used 3+ times, try to vary
        if (starterCount[firstWord] >= 3) {
            if (/^(It|This|The|These|That|There)\b/i.test(s)) {
                // Try to combine with previous sentence using conjunction
                if (i > 0 && sentences[i-1] && !sentences[i-1].endsWith('?')) {
                    return ', and ' + s.charAt(0).toLowerCase() + s.slice(1);
                }
            }
        }
        return s;
    });
    result = fixed.join(' ').replace(/\.\s*,\s*and/g, ', and');
    
    // Remove semicolons
    result = result.replace(/;\s*/g, ', ');
    
    // Fix awkward punctuation
    result = result.replace(/\.\./g, '.');
    result = result.replace(/,,/g, ',');
    result = result.replace(/\s+,/g, ',');
    
    // Clean spacing
    result = result.replace(/\s{2,}/g, ' ').trim();
    
    // Restore title if needed
    if (sectionTitle) {
        result = sectionTitle + '\n' + result;
    }
    
    return result;
}

// ==========================================================================
// MAIN HANDLER
// ==========================================================================

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        const { text, apiKey } = req.body;
        const GROQ_KEY = apiKey || process.env.GROQ_API_KEY;
        
        if (!text) throw new Error("No text provided.");
        if (text.length < 10) throw new Error("Text too short.");

        const safeText = text.substring(0, 20000);
        
        // Detect sections
        const sections = detectSections(safeText);
        console.log(`[Humanizer] Processing ${sections.length} sections`);
        
        // Get section summaries for context
        const summaries = await planEssay(sections, GROQ_KEY);
        
        // Process each section
        const results = [];
        
        for (let i = 0; i < sections.length; i++) {
            const section = sections[i];
            const prevSummary = summaries[i - 1] || null;
            const nextSummary = summaries[i + 1] || null;
            
            const prompt = buildPrompt(section, i, sections.length, prevSummary, nextSummary);
            const messages = [{ role: "user", content: prompt }];
            
            let rawResult = await GroqAPI.chat(messages, GROQ_KEY, false);
            let processed = postProcess(rawResult, section.title);
            
            results.push(processed);
        }
        
        // Assemble final output
        let finalOutput = results.join('\n\n');
        finalOutput = killEmDashes(finalOutput);
        finalOutput = finalOutput.replace(/\s{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();

        return res.status(200).json({
            success: true,
            result: finalOutput,
            sections: sections.length
        });

    } catch (error) {
        console.error("Humanizer Error:", error);
        return res.status(500).json({ success: false, error: error.message });
    }
}

// ==========================================================================
// EXPORTS
// ==========================================================================
export { postProcess as PostProcessor, SIMPLE_SWAPS as AI_VOCAB_SWAPS, detectSections as dynamicChunking, killEmDashes };
