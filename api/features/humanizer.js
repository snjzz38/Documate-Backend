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
        /Here's the thing[,:]\s*/gi,
        /The thing is[,:]\s*/gi,
        /To be clear[,:]\s*/gi,
        /To be fair[,:]\s*/gi,
        /Let's be honest[,:]\s*/gi,
        /The reality is[,:]\s*/gi,
        /The truth is[,:]\s*/gi,
        /The fact is[,:]\s*/gi,
    ];
    fakePhrases.forEach(p => { result = result.replace(p, ''); });
    
    // ===========================================
    // NUCLEAR: Kill ALL "just X, it's" patterns with broad regex
    // ===========================================
    
    // Most common pattern: "isn't just [anything], it's [anything]"
    // Using lazy match .*? to catch everything between
    result = result.replace(/isn't just (.*?),\s*it's (.*?)([\.!\?])/gi, 'goes beyond $1 and actually $2$3');
    result = result.replace(/isn't just (.*?),\s*it (.*?)([\.!\?])/gi, 'goes beyond $1 and $2$3');
    
    // "doesn't just X, it's/it Y"
    result = result.replace(/doesn't just (.*?),\s*it's (.*?)([\.!\?])/gi, 'does more than $1, actually $2$3');
    result = result.replace(/doesn't just (.*?),\s*it (.*?)([\.!\?])/gi, 'does more than $1 and $2$3');
    
    // "don't just X, they Y"
    result = result.replace(/don't just (.*?),\s*they (.*?)([\.!\?])/gi, 'do more than $1 and $2$3');
    
    // "wasn't just X, it was Y"
    result = result.replace(/wasn't just (.*?),\s*it (.*?)([\.!\?])/gi, 'was more than $1 and $2$3');
    
    // Catch stragglers - any remaining "n't just" 
    result = result.replace(/isn't just /gi, 'goes beyond ');
    result = result.replace(/doesn't just /gi, 'does more than ');
    result = result.replace(/don't just /gi, 'do more than ');
    result = result.replace(/wasn't just /gi, 'was more than ');
    result = result.replace(/aren't just /gi, 'are more than ');
    result = result.replace(/weren't just /gi, 'were more than ');
    
    // Also catch "not just X, it's Y" without contraction
    result = result.replace(/is not just (.*?),\s*it's/gi, 'goes beyond $1 and becomes');
    result = result.replace(/is not just /gi, 'goes beyond ');
    result = result.replace(/are not just /gi, 'are more than ');
    result = result.replace(/do not just /gi, 'do more than ');
    result = result.replace(/does not just /gi, 'does more than ');
    
    // "not just about X" patterns
    result = result.replace(/not just about /gi, 'more than ');
    result = result.replace(/more than just /gi, 'more than ');
    
    // ===========================================
    // Fix "The bigger/real X" patterns
    // ===========================================
    result = result.replace(/The (bigger|real|main|true) (risk|threat|problem|danger|issue|concern) (is|isn't|comes from)/gi, 'What matters is');
    result = result.replace(/What matters here is that how/gi, 'What matters is how'); // Fix awkward phrasing
    
    // ===========================================
    // Fix ", which means" and similar connectors
    // ===========================================
    result = result.replace(/,\s*which means/gi, '. That means');
    result = result.replace(/,\s*which is why/gi, '. That is why');
    
    // ===========================================
    // Fix "It's" at start - replace ALL instances after first
    // ===========================================
    let sentences = result.split(/(?<=[.!?])\s+/);
    let itsFound = false;
    let thisCount = 0;
    let theCount = 0;
    
    sentences = sentences.map((s) => {
        // Handle "It's" - only first one allowed
        if (/^It's /i.test(s)) {
            if (itsFound) {
                // Replace subsequent "It's"
                s = s.replace(/^It's a /i, 'This represents a ');
                s = s.replace(/^It's the /i, 'This becomes the ');
                s = s.replace(/^It's about /i, 'The issue is ');
                s = s.replace(/^It's /i, 'This is ');
            }
            itsFound = true;
        }
        
        // Handle "This" - only two allowed
        if (/^This /i.test(s)) {
            thisCount++;
            if (thisCount > 2) {
                s = s.replace(/^This is /i, 'That is ');
                s = s.replace(/^This /i, 'That ');
            }
        }
        
        // Handle "The" - only three allowed
        if (/^The /i.test(s)) {
            theCount++;
            if (theCount > 3) {
                s = s.replace(/^The /i, 'A ');
            }
        }
        
        return s;
    });
    result = sentences.join(' ');
    
    // ===========================================
    // Fix parallel structures
    // ===========================================
    result = result.replace(/between ([\w\s]+) and ([\w\s]+)\.$/gi, 'between $1 or facing $2.');
    result = result.replace(/,\s*but between /gi, '. The real choice is ');
    result = result.replace(/scarcity into conflict and inequality into/gi, 'scarcity into conflict, while inequality turns to');
    
    // ===========================================
    // Simplify formal language
    // ===========================================
    const formalWords = [
        [/\bMass displacement\b/gi, 'Large-scale migration'],
        [/\bweak societies\b/gi, 'struggling regions'],
        [/\bequitable\b/gi, 'fair'],
        [/\bvulnerable\b/gi, 'at risk'],
        [/\bessential\b/gi, 'needed'],
    ];
    formalWords.forEach(([p, r]) => { result = result.replace(p, r); });
    
    // ===========================================
    // Clean up
    // ===========================================
    result = result.replace(/;\s*/g, ', ');
    result = result.replace(/\.\./g, '.');
    result = result.replace(/,,/g, ',');
    result = result.replace(/\s+,/g, ',');
    result = result.replace(/\s{2,}/g, ' ');
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
