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
    
    // Rotate writing styles for variety
    const styles = [
        "explaining to a curious friend who asked about this",
        "writing a thoughtful opinion piece",
        "teaching someone who wants to understand the nuances",
        "having a serious conversation about something you care about"
    ];
    const style = styles[index % styles.length];

    let contextNote = '';
    if (prevSummary) contextNote += `[Connects from: ${prevSummary}] `;
    if (nextSummary) contextNote += `[Leads to: ${nextSummary}]`;

    return `You're ${style}. Rewrite this ${position} section.

${contextNote}

THE PROBLEM WITH AI WRITING (avoid all of these):
1. The "isn't just X. It's Y" pattern - AI uses this constantly. NEVER use it.
2. Starting sentences with "It's" repeatedly  
3. Perfect three-part lists: "X, Y, and Z"
4. Every sentence being a confident declaration
5. Uniform sentence lengths
6. Semicolons and em dashes
7. No personality - just facts stated flatly

WHAT MAKES WRITING SOUND HUMAN:
1. Thinking out loud: "The thing is..." "What worries me is..." "You have to wonder..."
2. Mixing confidence with uncertainty: "probably", "it seems", "arguably"
3. Occasional questions (real or rhetorical)
4. Uneven development - some points get more attention than others
5. Sentence variety: fragments okay. Longer complex sentences also fine.
6. Personal reactions embedded in facts: "And that's alarming because..."
7. Connecting words that aren't robotic: "Look," "Granted," "Sure," "Still,"

REWRITE THIS:
"${section.content}"

${section.title ? `Keep the topic "${section.title}" but express it naturally.` : ''}

CRITICAL: 
- DO NOT use "isn't just" or "is not just" ANYWHERE
- DO NOT start multiple sentences with "It's" or "This is"  
- DO NOT use semicolons or em dashes
- DO keep all the same information and meaning
- DO sound like a real person with opinions wrote this

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
    
    // Remove any remaining "isn't just...it's" patterns
    result = result.replace(/isn't just ([^.]+)\.\s*It's/gi, 'goes beyond $1. What we face is');
    result = result.replace(/is not just ([^.]+)\.\s*It is/gi, 'goes beyond $1. What we see is');
    result = result.replace(/isn't just/gi, 'goes beyond');
    result = result.replace(/is not just/gi, 'goes beyond');
    
    // Fix repeated "It's" at sentence starts
    const sentences = result.split(/(?<=[.!?])\s+/);
    let lastStartedWithIts = false;
    const fixed = sentences.map(s => {
        const startsWithIts = /^It's\b/i.test(s) || /^It is\b/i.test(s);
        if (startsWithIts && lastStartedWithIts) {
            // Replace with alternatives
            const alts = ['This means', 'What happens is', 'The result:', 'We see'];
            const alt = alts[Math.floor(Math.random() * alts.length)];
            s = s.replace(/^It's\b/i, alt).replace(/^It is\b/i, alt);
        }
        lastStartedWithIts = startsWithIts;
        return s;
    });
    result = fixed.join(' ');
    
    // Remove semicolons
    result = result.replace(/;\s*/g, '. ');
    
    // Fix double periods
    result = result.replace(/\.\./g, '.');
    
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
