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

COMPLETELY BANNED - never use these patterns:
- "isn't just X, it's Y" or "doesn't just X, it Y" - ANY variation of this
- Starting sentences with "It's" more than once total
- Starting sentences with "We're" more than once total  
- ", which means" as a connector
- "The real danger/problem/threat is/comes from"
- Perfect parallels: "between X and Y" at the end
- "To be clear" / "The reality is"
- Semicolons

VARY YOUR SENTENCE STARTERS - use different ones:
"Climate...", "Rising...", "When...", "This...", "Countries...", "People...", "Droughts...", "The...", "A...", "Without..."

USE SIMPLE CONNECTORS:
"and", "but", "so", "because", "since", "as", "after", "before"

GOOD EXAMPLE (varied starters, no banned patterns):
"Climate change has moved beyond environmental concern into security territory. Rising temperatures dry out farmland and make storms more destructive, hitting poor countries hardest. When harvests fail repeatedly, families pack up and leave. That migration creates friction at borders and drains resources from host countries. Several regions are already dealing with this, and the pattern keeps accelerating."

BAD EXAMPLE (repetitive starters, banned patterns):
"It's a security crisis. It's causing problems. We're seeing this happen. We're not prepared. The real danger is instability. This isn't just about environment, it's about survival."

TEXT TO REWRITE:
"${section.content}"

Write using varied sentence starters and no banned patterns:`;
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
        /\bLook[,:]\s*/gi,
        /\bGranted[,:]\s*/gi,
    ];
    fakePhrases.forEach(p => { result = result.replace(p, ''); });
    
    // AGGRESSIVE: Fix ALL "just X, it's/it Y" patterns
    result = result.replace(/isn't just ([^,\.]+),\s*it's/gi, 'goes beyond $1 to become');
    result = result.replace(/isn't just ([^,\.]+),\s*it/gi, 'goes beyond $1 and');
    result = result.replace(/doesn't just ([^,\.]+),\s*it/gi, 'does more than $1 and');
    result = result.replace(/don't just ([^,\.]+),\s*they/gi, 'do more than $1 and');
    result = result.replace(/isn't just ([^,\.]+)\.\s*[Ii]t's/gi, 'goes beyond $1, becoming');
    result = result.replace(/isn't just/gi, 'goes beyond');
    result = result.replace(/doesn't just/gi, 'does more than');
    result = result.replace(/don't just/gi, 'do more than');
    
    // Remove "which means" right after period or at sentence start
    result = result.replace(/,\s*which means/gi, '. This means');
    
    // Fix "The real X comes from/is" pattern  
    result = result.replace(/The real (danger|problem|threat|issue|risk) (comes from|is)\s*/gi, 'The bigger concern is ');
    
    // Fix repeated "We're" starters
    let sentences = result.split(/(?<=[.!?])\s+/);
    let wereCount = 0;
    let itsCount = 0;
    sentences = sentences.map((s, i) => {
        // Handle "We're" repetition
        if (/^We're\b/i.test(s)) {
            wereCount++;
            if (wereCount > 1) {
                const alts = [
                    s.replace(/^We're\s+already\s+/i, 'This is already '),
                    s.replace(/^We're\s+not\s+/i, 'The choice is not '),
                    s.replace(/^We're\s+choosing\s+/i, 'The choice is '),
                    s.replace(/^We're\s+seeing\s+/i, 'Evidence shows '),
                    s.replace(/^We're\s+/i, 'People are '),
                ];
                for (const alt of alts) {
                    if (alt !== s) return alt;
                }
            }
        }
        // Handle "It's" repetition  
        if (/^It's\b/i.test(s)) {
            itsCount++;
            if (itsCount > 1) {
                const alts = [
                    s.replace(/^It's\s+the\s+/i, 'This is the '),
                    s.replace(/^It's\s+a\s+/i, 'This represents a '),
                    s.replace(/^It's\s+about\s+/i, 'The question is '),
                    s.replace(/^It's\s+how\s+/i, 'Consider how '),
                    s.replace(/^It's\s+/i, 'This is '),
                ];
                for (const alt of alts) {
                    if (alt !== s) return alt;
                }
            }
        }
        return s;
    });
    result = sentences.join(' ');
    
    // Break perfect parallel structures at end of sentences
    result = result.replace(/between (\w+) (\w+) and (\w+) (\w+)\.$/gi, 'between $1 $2 or $3 $4.');
    result = result.replace(/between ([^,]+) and ([^\.]+)\./gi, (match, a, b) => {
        if (a.split(' ').length > 1 && b.split(' ').length > 1) {
            return `between ${a}, or ${b}.`;
        }
        return match;
    });
    
    // Fix awkward "X becomes Y while Z turns to W" 
    result = result.replace(/(\w+) becomes (\w+) while (\w+) turns to (\w+)/gi, '$1 leads to $2, and $3 breeds $4');
    
    // Remove formal verb forms
    const formalVerbs = [
        [/\bdemanding\b/gi, 'that needs'],
        [/\brepresenting\b/gi, 'which is'],
        [/\bintensifying\b/gi, 'making worse'],
        [/\btransforming\b/gi, 'turning'],
        [/\bescalating\b/gi, 'getting worse'],
        [/\beroding\b/gi, 'wearing away'],
        [/\bdepleting\b/gi, 'draining'],
    ];
    formalVerbs.forEach(([p, r]) => { result = result.replace(p, r); });
    
    // Simplify fancy words
    const fancyWords = [
        [/\bequitable\b/gi, 'fair'],
        [/\bvulnerable\b/gi, 'at risk'],
        [/\bessential\b/gi, 'needed'],
        [/\bfundamental\b/gi, 'basic'],
        [/\bsubstantial\b/gi, 'large'],
        [/\bsignificant\b/gi, 'big'],
        [/\bcrucial\b/gi, 'key'],
        [/\becological\b/gi, 'environmental'],
        [/\bfragile communities\b/gi, 'struggling communities'],
        [/\bfragile societies\b/gi, 'unstable societies'],
        [/\bmass displacement\b/gi, 'large-scale migration'],
    ];
    fancyWords.forEach(([p, r]) => { result = result.replace(p, r); });
    
    // Fix passive voice
    result = result.replace(/are displaced/gi, 'have to move');
    result = result.replace(/is already visible/gi, 'is already happening');
    result = result.replace(/are destroyed/gi, 'get destroyed');
    result = result.replace(/are being forced/gi, 'have to');
    
    // Clean punctuation
    result = result.replace(/;\s*/g, ', ');
    result = result.replace(/\.\./g, '.');
    result = result.replace(/,,/g, ',');
    result = result.replace(/\s+,/g, ',');
    result = result.replace(/\s{2,}/g, ' ');
    
    // Fix sentences starting with lowercase after replacements
    result = result.replace(/\.\s+([a-z])/g, (m, c) => '. ' + c.toUpperCase());
    
    // Final cleanup
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
