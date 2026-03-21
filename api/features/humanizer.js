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

    return `Rewrite this ${position} section in plain English.

${contextNote}

BANNED PATTERNS - DO NOT USE ANY OF THESE:
1. "isn't just X, it's Y" - BANNED (don't split across sentences either)
2. "It's" to start sentences - use MAXIMUM once in the whole text
3. "To be clear" / "The reality is" / "The truth is" - BANNED  
4. Perfect parallels like "X we can Y and Z we can't" - BANNED
5. "The real problem/threat/issue is" - BANNED
6. Semicolons - BANNED
7. Three-part lists "X, Y, and Z" - limit to one if needed

INSTEAD, WRITE LIKE THIS:
- Vary your sentence starters: "Climate...", "When...", "This...", "Countries...", "People..."
- Use simple connectors: "and", "but", "so", "because", "which means"
- Some sentences can run a bit long with multiple clauses
- Other sentences can be short.
- Don't wrap up every point perfectly - leave some ideas slightly open

GOOD EXAMPLE:
"Climate change has become a security problem, not just an environmental one. Hotter temperatures dry out farmland and make storms worse, which hits poor countries hardest. When crops fail year after year, families have to move somewhere else. That migration creates tension at borders and uses up resources that receiving countries need for their own people. We're already watching this happen in several regions."

BAD EXAMPLE (typical AI writing):
"Climate change isn't just an environmental issue, it's a security crisis. It's causing droughts and storms. It's forcing people to migrate. It's straining borders. To be clear, the real threat is instability. We need to act now."

TEXT TO REWRITE:
"${section.content}"

Write a natural version using varied sentence structures:`;
}

// ==========================================================================
// POST-PROCESSING - Aggressive pattern breaking
// ==========================================================================

function postProcess(text, sectionTitle) {
    let result = text;
    
    // Clean AI artifacts
    result = cleanOutput(result);
    
    // Kill em dashes
    result = killEmDashes(result);
    
    // Apply word swaps
    result = applySwaps(result);
    
    // Remove fake casual/transition phrases
    const fakePhrases = [
        /\bHere's the thing[,:]\s*/gi,
        /\bThe thing is[,:]\s*/gi,
        /\bTo be clear[,:]\s*/gi,
        /\bTo be fair[,:]\s*/gi,
        /\bLet's be honest[,:]\s*/gi,
        /\bThe reality is[,:]\s*/gi,
        /\bThe truth is[,:]\s*/gi,
        /\bThe fact is[,:]\s*/gi,
        /\bYou have to wonder\s*/gi,
        /\bWhat worries me is\s*/gi,
        /\bAnd that's alarming\s*/gi,
        /\bLook[,:]\s*/gi,
        /\bGranted[,:]\s*/gi,
    ];
    fakePhrases.forEach(p => { result = result.replace(p, ''); });
    
    // AGGRESSIVE: Fix ALL "isn't just X, it's Y" patterns (including split across sentences)
    result = result.replace(/isn't just ([^,\.]+)[,\.]\s*[Ii]t's/gi, 'goes beyond $1 and becomes');
    result = result.replace(/isn't just ([^,\.]+)[,\.]\s*[Ii]t is/gi, 'goes beyond $1 and becomes');
    result = result.replace(/is not just ([^,\.]+)[,\.]\s*[Ii]t's/gi, 'goes beyond $1 and becomes');
    result = result.replace(/isn't just/gi, 'goes beyond being');
    result = result.replace(/is not just/gi, 'goes beyond being');
    result = result.replace(/not just ([^,\.]+),\s*it's/gi, 'more than $1, becoming');
    
    // Remove "extends beyond" 
    result = result.replace(/extends beyond/gi, 'is more than');
    
    // Fix "It's" sentence starters - convert many to other structures
    let sentences = result.split(/(?<=[.!?])\s+/);
    let itsCount = 0;
    sentences = sentences.map((s, i) => {
        if (/^It's\b/i.test(s)) {
            itsCount++;
            if (itsCount > 1) {
                // Replace with varied alternatives
                const replacements = [
                    s.replace(/^It's\s+/i, 'This becomes '),
                    s.replace(/^It's\s+/i, 'What we see is '),
                    s.replace(/^It's\s+(a|an|the)\s+/i, 'We face $1 '),
                    s.replace(/^It's\s+about\s+/i, 'The issue is '),
                    s.replace(/^It's\s+how\s+/i, 'Consider how '),
                    s.replace(/^It's\s+not\s+/i, 'The point is not '),
                ];
                // Pick based on what fits
                for (const rep of replacements) {
                    if (rep !== s) return rep;
                }
            }
        } else if (/^It is\b/i.test(s)) {
            itsCount++;
            if (itsCount > 1) {
                return s.replace(/^It is\s+/i, 'This is ');
            }
        }
        return s;
    });
    result = sentences.join(' ');
    
    // Fix "The real X isn't/is" pattern
    result = result.replace(/The real (problem|threat|issue|danger|risk) isn't/gi, 'The bigger concern is not');
    result = result.replace(/The real (problem|threat|issue|danger|risk) is/gi, 'What matters more is');
    
    // Break perfect parallel structures
    result = result.replace(/(\w+) we can (\w+) and (\w+) we can't/gi, '$1 we can $2, versus $3 that spirals out of control');
    result = result.replace(/(\w+) into (\w+)[,]? and (\w+) into (\w+)/gi, '$1 becomes $2 while $3 turns to $4');
    result = result.replace(/between (\w+) and (\w+)$/gi, 'between $1 or $2');
    
    // Remove formal verb forms
    const formalVerbs = [
        [/\bdemanding\b/gi, 'that needs'],
        [/\brepresenting\b/gi, 'which is'],
        [/\bintensifying\b/gi, 'making worse'],
        [/\btransforming\b/gi, 'turning'],
        [/\bescalating\b/gi, 'getting worse'],
        [/\beroding\b/gi, 'wearing down'],
        [/\bdepleting\b/gi, 'draining'],
        [/\bexacerbating\b/gi, 'making worse'],
    ];
    formalVerbs.forEach(([p, r]) => { result = result.replace(p, r); });
    
    // Simplify fancy words
    const fancyWords = [
        [/\bequitable\b/gi, 'fair'],
        [/\bvulnerable\b/gi, 'at risk'],
        [/\bessential\b/gi, 'needed'],
        [/\bfundamental\b/gi, 'basic'],
        [/\bsubstantial\b/gi, 'large'],
        [/\bsignificant\b/gi, 'major'],
        [/\bcrucial\b/gi, 'important'],
        [/\becological\b/gi, 'environmental'],
        [/\bfragile communities\b/gi, 'struggling communities'],
        [/\bmass displacement\b/gi, 'people fleeing'],
    ];
    fancyWords.forEach(([p, r]) => { result = result.replace(p, r); });
    
    // Fix passive voice
    result = result.replace(/are displaced/gi, 'have to move');
    result = result.replace(/is already visible/gi, 'is already happening');
    result = result.replace(/are destroyed/gi, 'get destroyed');
    result = result.replace(/are being forced/gi, 'have to');
    
    // Remove "basic stuff like" - too casual
    result = result.replace(/basic stuff like/gi, 'basics like');
    
    // Clean punctuation
    result = result.replace(/;\s*/g, ', ');
    result = result.replace(/\.\./g, '.');
    result = result.replace(/,,/g, ',');
    result = result.replace(/\s+,/g, ',');
    result = result.replace(/\s{2,}/g, ' ');
    
    // Final cleanup
    result = result.trim();
    
    // Fix any sentences that now start with lowercase after our replacements
    result = result.replace(/\.\s+([a-z])/g, (m, c) => '. ' + c.toUpperCase());
    
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
