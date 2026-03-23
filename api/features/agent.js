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

    return `Rewrite this ${position} section naturally.

${contextNote}

THE PROBLEM: AI writing uses uniform short sentences. Every sentence is 10-15 words. Every sentence is a simple declaration. This makes it detectable.

WHAT YOU MUST DO:
1. MIX sentence lengths dramatically:
   - Some SHORT: "That changes everything." (3-6 words)
   - Some MEDIUM: "Rising temperatures make resource conflicts worse." (8-12 words)  
   - Some LONG with clauses: "When droughts wipe out harvests in regions that were already struggling to feed their populations, the resulting migration puts pressure on neighboring countries that may not have the resources to help." (25-35 words)

2. USE COMPLEX STRUCTURES sometimes:
   - Embedded clauses: "The climate crisis, which has already displaced millions, threatens to destabilize entire regions."
   - Conditional: "If emissions continue rising, these problems will multiply."
   - Cause chains: "Droughts destroy crops, which forces families to migrate, which then strains the resources of wherever they end up."

3. COMBINE related ideas into single longer sentences instead of chopping everything up.

BANNED:
- "isn't just X, it's Y" - any version of this
- Starting with "It's" more than once
- "The real/bigger problem/threat/risk is"
- Perfect parallel endings like "between X and Y"
- Lists of exactly three things

EXAMPLE OF GOOD VARIED WRITING:
"Climate change has become a security issue. The connection isn't obvious at first, but when you look at how drought and extreme weather affect already unstable regions, the pattern becomes clear. Crops fail, water runs short, and people who can no longer survive where they are have to move somewhere else, which puts pressure on neighboring countries that may already be stretched thin. We've watched this play out in several regions over the past decade, and without serious intervention, it's going to accelerate."

EXAMPLE OF BAD UNIFORM WRITING (what AI typically produces):
"Climate change is a security issue. It affects many countries. Rising temperatures cause droughts. Droughts cause migration. Migration strains borders. This is already happening. We need to act now."

TEXT TO REWRITE:
"${section.content}"

Write with varied sentence lengths and some complex structures:`;
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
    // NUCLEAR: Kill ALL "just X, it's/they're" patterns
    // ===========================================
    
    // Pattern: "isn't just X, it's Y"
    result = result.replace(/isn't just (.*?),\s*it's (.*?)([\.!\?])/gi, 'goes beyond $1 to $2$3');
    result = result.replace(/isn't just (.*?),\s*it (.*?)([\.!\?])/gi, 'goes beyond $1 and $2$3');
    
    // Pattern: "aren't just X, they're Y" - THIS WAS MISSING
    result = result.replace(/aren't just (.*?),\s*they're (.*?)([\.!\?])/gi, 'go beyond $1 to $2$3');
    result = result.replace(/aren't just (.*?),\s*they (.*?)([\.!\?])/gi, 'go beyond $1 and $2$3');
    
    // Pattern: "doesn't just X, it's Y"
    result = result.replace(/doesn't just (.*?),\s*it's (.*?)([\.!\?])/gi, 'does more than $1 and $2$3');
    result = result.replace(/doesn't just (.*?),\s*it (.*?)([\.!\?])/gi, 'does more than $1 and $2$3');
    
    // Pattern: "don't just X, they're Y" - THIS WAS MISSING  
    result = result.replace(/don't just (.*?),\s*they're (.*?)([\.!\?])/gi, 'do more than $1 and end up $2$3');
    result = result.replace(/don't just (.*?),\s*they (.*?)([\.!\?])/gi, 'do more than $1 and $2$3');
    
    // Pattern: "aren't optional, they're" - specific case
    result = result.replace(/aren't optional,\s*they're/gi, 'are necessary and');
    
    // Pattern: "wasn't just X, it was Y"
    result = result.replace(/wasn't just (.*?),\s*it (.*?)([\.!\?])/gi, 'was more than $1 and $2$3');
    
    // Catch ALL remaining "[verb]n't just" patterns
    result = result.replace(/isn't just /gi, 'goes beyond ');
    result = result.replace(/aren't just /gi, 'go beyond ');
    result = result.replace(/doesn't just /gi, 'does more than ');
    result = result.replace(/don't just /gi, 'do more than ');
    result = result.replace(/wasn't just /gi, 'was more than ');
    result = result.replace(/weren't just /gi, 'were more than ');
    
    // Non-contraction versions
    result = result.replace(/is not just /gi, 'goes beyond ');
    result = result.replace(/are not just /gi, 'go beyond ');
    result = result.replace(/do not just /gi, 'do more than ');
    result = result.replace(/does not just /gi, 'does more than ');
    
    // "not just about X" patterns
    result = result.replace(/not just about /gi, 'more than ');
    result = result.replace(/more than just /gi, 'more than ');
    
    // ===========================================
    // Fix triple parallel structures "X, X, and Y"
    // ===========================================
    result = result.replace(/strains ([^,]+),\s*strains ([^,]+),\s*and/gi, 'strains $1 and $2, and also');
    result = result.replace(/(\w+)s ([^,]+),\s*\1s ([^,]+),\s*and\s*(\w+)s/gi, '$1s $2, $3, and $4s');
    
    // ===========================================
    // Fix "the decision/choice isn't about X, it's about Y"
    // ===========================================
    result = result.replace(/The (decision|choice) isn't about (.*?),\s*it's about (.*?)([\.!\?])/gi, 'This comes down to $3, not $2$4');
    result = result.replace(/isn't about choosing between (.*?),\s*it's about/gi, 'comes down to');
    result = result.replace(/isn't about (.*?) versus (.*?)\./gi, 'is really about something else entirely.');
    
    // Fix "between X or Y" at end (bad parallel)
    result = result.replace(/between ([\w\s]+) or (facing |having )?([\w\s]+)\.$/gi, ': either $1, or $3.');
    
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
        
        // SECOND PASS: Apply critical pattern fixes again on combined output
        // These patterns keep slipping through
        finalOutput = finalOutput.replace(/isn't just (.*?),\s*it's (.*?)([\.!\?])/gi, 'goes beyond $1 to $2$3');
        finalOutput = finalOutput.replace(/doesn't just (.*?),\s*it (.*?)([\.!\?])/gi, 'does more than $1 and $2$3');
        finalOutput = finalOutput.replace(/don't just (.*?),\s*they (.*?)([\.!\?])/gi, 'do more than $1 and $2$3');
        finalOutput = finalOutput.replace(/aren't just (.*?),\s*they're (.*?)([\.!\?])/gi, 'go beyond $1 to $2$3');
        finalOutput = finalOutput.replace(/The (decision|choice) isn't about (.*?),\s*it's about (.*?)([\.!\?])/gi, 'This comes down to $3, not $2$4');
        finalOutput = finalOutput.replace(/strains ([^,]+),\s*strains ([^,]+),\s*and/gi, 'strains $1 and $2, while also');
        finalOutput = finalOutput.replace(/isn't just /gi, 'goes beyond ');
        finalOutput = finalOutput.replace(/doesn't just /gi, 'does more than ');
        finalOutput = finalOutput.replace(/don't just /gi, 'do more than ');
        
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
