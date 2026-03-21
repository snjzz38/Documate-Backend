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
// POST-PROCESSING - Maximum aggressive pattern breaking
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
    ];
    fakePhrases.forEach(p => { result = result.replace(p, ''); });
    
    // ===========================================
    // NUCLEAR OPTION: Kill ALL "just X, it's/they" patterns
    // ===========================================
    
    // Pattern: "isn't just X, it's Y" -> completely restructure
    result = result.replace(/isn't just ([^,\.]+),\s*it's ([^,\.]+)/gi, 'goes beyond $1 and becomes $2');
    result = result.replace(/isn't just ([^,\.]+),\s*it ([^,\.]+)/gi, 'goes beyond $1 and $2');
    result = result.replace(/isn't just ([^,\.]+)\.\s*[Ii]t's/gi, 'goes beyond $1, becoming');
    
    // Pattern: "doesn't just X, it's/it Y"
    result = result.replace(/doesn't just ([^,\.]+),\s*it's ([^,\.]+)/gi, 'does more than $1, actually $2');
    result = result.replace(/doesn't just ([^,\.]+),\s*it ([^,\.]+)/gi, 'does more than $1 and $2');
    
    // Pattern: "don't just X, they Y"
    result = result.replace(/don't just ([^,\.]+),\s*they ([^,\.]+)/gi, 'do more than $1, and $2');
    result = result.replace(/don't just ([^,\.]+),\s*they're/gi, 'do more than $1, becoming');
    
    // Pattern: "Waiting/Delaying isn't just X, it's Y"
    result = result.replace(/(Waiting|Delaying) to act isn't just ([^,\.]+),\s*it's ([^,\.]+)/gi, '$1 means $2 and also $3');
    result = result.replace(/(Waiting|Delaying) isn't just ([^,\.]+),\s*it's ([^,\.]+)/gi, '$1 means $2 and $3');
    
    // Catch any remaining "isn't just" or "doesn't just"
    result = result.replace(/isn't just/gi, 'goes beyond');
    result = result.replace(/doesn't just/gi, 'does more than');
    result = result.replace(/don't just/gi, 'do more than');
    result = result.replace(/wasn't just/gi, 'was more than');
    result = result.replace(/aren't just/gi, 'are more than');
    
    // Pattern: "The bigger X isn't" 
    result = result.replace(/The bigger (risk|threat|problem|danger|issue) isn't/gi, 'Beyond that,');
    result = result.replace(/The (real|bigger|main) (risk|threat|problem|danger|issue) (is|isn't|comes from)/gi, 'What matters here is that');
    
    // Remove ", which means" connector
    result = result.replace(/,\s*which means/gi, '. That means');
    
    // ===========================================
    // Fix repeated sentence starters
    // ===========================================
    let sentences = result.split(/(?<=[.!?])\s+/);
    let starterCounts = {};
    
    sentences = sentences.map((s, i) => {
        const firstWords = s.split(/\s+/).slice(0, 2).join(' ');
        const firstWord = s.split(/\s+/)[0];
        
        // Track starters
        starterCounts[firstWord] = (starterCounts[firstWord] || 0) + 1;
        
        // Fix "It's" - only allow once
        if (/^It's\b/i.test(s) && starterCounts["It's"] > 1) {
            if (/^It's about/i.test(s)) return s.replace(/^It's about/i, 'The question is');
            if (/^It's a/i.test(s)) return s.replace(/^It's a/i, 'This is a');
            if (/^It's the/i.test(s)) return s.replace(/^It's the/i, 'This becomes the');
            return s.replace(/^It's/i, 'This is');
        }
        
        // Fix "We're" - only allow once
        if (/^We're\b/i.test(s) && starterCounts["We're"] > 1) {
            if (/^We're already/i.test(s)) return s.replace(/^We're already/i, 'This is already');
            if (/^We're not/i.test(s)) return s.replace(/^We're not/i, 'The choice is not');
            if (/^We're choosing/i.test(s)) return s.replace(/^We're choosing/i, 'The choice comes down to');
            return s.replace(/^We're/i, 'People are');
        }
        
        // Fix "This" - only allow twice
        if (/^This\b/i.test(s) && starterCounts["This"] > 2) {
            if (/^This movement/i.test(s)) return s.replace(/^This movement/i, 'Such movement');
            if (/^This pattern/i.test(s)) return s.replace(/^This pattern/i, 'The pattern');
            return s.replace(/^This/i, 'That');
        }
        
        // Fix "The" - only allow three times
        if (/^The\b/i.test(s) && starterCounts["The"] > 3) {
            return s.replace(/^The/i, 'A');
        }
        
        return s;
    });
    result = sentences.join(' ');
    
    // ===========================================
    // Break parallel structures
    // ===========================================
    result = result.replace(/between ([^,]+) or ([^\.]+)\./gi, 'between $1, versus $2.');
    result = result.replace(/between controlled (\w+) or total (\w+)/gi, 'between managing $1 or facing $2');
    result = result.replace(/scarcity into conflict and inequality into desperation/gi, 'scarcity into conflict, with inequality breeding desperation');
    result = result.replace(/(\w+) into (\w+) and (\w+) into (\w+)/gi, '$1 into $2, while $3 breeds $4');
    
    // ===========================================
    // Simplify formal language
    // ===========================================
    const formalWords = [
        [/\bdemanding\b/gi, 'needing'],
        [/\brepresenting\b/gi, 'being'],
        [/\bintensifying\b/gi, 'worsening'],
        [/\btransforming\b/gi, 'turning'],
        [/\bescalating\b/gi, 'growing'],
        [/\beroding\b/gi, 'weakening'],
        [/\bdepleting\b/gi, 'draining'],
        [/\bequitable\b/gi, 'fair'],
        [/\bvulnerable\b/gi, 'at risk'],
        [/\bessential\b/gi, 'needed'],
        [/\bfundamental\b/gi, 'basic'],
        [/\bunstable societies\b/gi, 'weak societies'],
        [/\bfragile societies\b/gi, 'weak societies'],
    ];
    formalWords.forEach(([p, r]) => { result = result.replace(p, r); });
    
    // Fix passive voice
    result = result.replace(/are displaced/gi, 'have to move');
    result = result.replace(/are destroyed/gi, 'get destroyed');
    
    // Clean punctuation
    result = result.replace(/;\s*/g, ', ');
    result = result.replace(/\.\./g, '.');
    result = result.replace(/,,/g, ',');
    result = result.replace(/\s+,/g, ',');
    result = result.replace(/\s{2,}/g, ' ');
    
    // Fix lowercase after periods
    result = result.replace(/\.\s+([a-z])/g, (m, c) => '. ' + c.toUpperCase());
    
    result = result.trim();
    
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
