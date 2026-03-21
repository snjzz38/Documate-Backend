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

    return `Rewrite this ${position} section in plain, natural English.

${contextNote}

AI DETECTION CATCHES THESE PATTERNS - AVOID ALL:
1. "not X but Y" constructions - sounds like a debate speech
2. "extends beyond" - AI loves this phrase
3. Perfect parallel structures like "X into Y and A into B"  
4. Formal verbs: "demanding", "representing", "intensifying", "transforming"
5. Passive voice: "are displaced", "is already visible"
6. Perfect grammar and sentence balance throughout
7. Words like: essential, crucial, fundamental, significant, substantial

WRITE LIKE A HUMAN ACTUALLY WRITES:
- Use normal verbs: "needs" not "demands", "shows" not "represents", "makes worse" not "exacerbates"
- Active voice mostly: "storms destroy cities" not "cities are destroyed by storms"
- Imperfect structures are fine - not every sentence needs to be balanced
- Use contractions naturally but not constantly
- Some sentences can be a bit wordy or imperfect - that's human
- Connect ideas with simple words: "and", "but", "so", "because", "which"

WORD CHOICE - USE THE SIMPLER OPTION:
- "needs" not "requires" or "demands"
- "shows" not "represents" or "demonstrates"  
- "gets worse" not "intensifies" or "escalates"
- "people leave" not "displacement occurs"
- "breaks down" not "erodes" or "deteriorates"
- "can't handle" not "unable to withstand"

EXAMPLE OF NATURAL HUMAN WRITING:
"Climate change is more than an environmental problem at this point. When you look at how droughts and floods affect poor countries, you start to see the security angle. Crops fail, people can't feed their families, and they have to move somewhere else. That puts pressure on neighboring countries, and things can spiral from there. We've already seen this happen in some regions, and it's probably going to get worse if emissions keep rising."

EXAMPLE OF AI WRITING TO AVOID:
"Climate change extends beyond environmental concerns, representing a fundamental security challenge. Rising temperatures intensify resource conflicts, displacing populations and eroding international trust. This pattern, already visible, demands immediate policy intervention to prevent escalating instability."

TEXT TO REWRITE:
"${section.content}"

CRITICAL RULES:
- Use simple, common words
- Active voice as much as possible  
- Not everything needs to be perfectly structured
- Keep the meaning but make it sound like a regular person wrote it
- NO "extends beyond", "not X but Y", or fancy parallel structures

Write naturally:`;
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
    
    // Remove fake casual phrases
    result = result.replace(/\b(Here's the thing|The thing is|You have to wonder|You know how|What worries me is|And that's alarming)[,:]?\s*/gi, '');
    
    // Remove "extends beyond" pattern
    result = result.replace(/extends beyond/gi, 'is more than');
    
    // Remove "not X but Y" patterns
    result = result.replace(/not in ([^,]+),?\s*but in/gi, 'in');
    result = result.replace(/not ([^,]+),?\s*but rather/gi, '');
    result = result.replace(/lies not in/gi, 'is about');
    
    // Remove formal/AI verb forms
    result = result.replace(/\bdemanding\b/gi, 'that needs');
    result = result.replace(/\brepresenting\b/gi, 'which is');
    result = result.replace(/\bintensifying\b/gi, 'making worse');
    result = result.replace(/\btransforming\b/gi, 'turning');
    result = result.replace(/\bescalating\b/gi, 'getting worse');
    result = result.replace(/\beroding\b/gi, 'breaking down');
    result = result.replace(/\bdepleting\b/gi, 'using up');
    
    // Simplify fancy words
    result = result.replace(/\bequitable\b/gi, 'fair');
    result = result.replace(/\bvulnerable\b/gi, 'at risk');
    result = result.replace(/\bessential\b/gi, 'needed');
    result = result.replace(/\bfundamental\b/gi, 'basic');
    result = result.replace(/\bsubstantial\b/gi, 'big');
    
    // Fix passive voice where easy
    result = result.replace(/are displaced/gi, 'have to leave');
    result = result.replace(/is already visible/gi, 'is already happening');
    result = result.replace(/are destroyed/gi, 'get destroyed');
    
    // Remove any remaining "isn't just...it's" patterns  
    result = result.replace(/isn't just ([^.]+)\.\s*It's/gi, 'is more than $1, it\'s also');
    result = result.replace(/is not just ([^.]+)\.\s*It is/gi, 'is more than $1, and');
    result = result.replace(/isn't just/gi, 'is more than');
    result = result.replace(/is not just/gi, 'is more than');
    
    // Remove perfect parallel structures
    result = result.replace(/(\w+) into (\w+) and (\w+) into (\w+)/gi, '$1 into $2, and $3 becomes $4');
    
    // Simplify "the choice is not X but Y"
    result = result.replace(/the choice is not between ([^,]+),?\s*but between/gi, 'we\'re choosing between');
    result = result.replace(/the choice is between ([^,]+) and/gi, 'it\'s either $1 or');
    
    // Remove semicolons
    result = result.replace(/;\s*/g, ', ');
    
    // Fix awkward punctuation
    result = result.replace(/\.\./g, '.');
    result = result.replace(/,,/g, ',');
    result = result.replace(/\s+,/g, ',');
    result = result.replace(/\s{2,}/g, ' ');
    
    // Clean up
    result = result.trim();
    
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
