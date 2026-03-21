// api/features/humanizer.js
// Focus: Burstiness, perplexity variation, natural sentence structures
import { GroqAPI } from '../utils/groqAPI.js';

// ==========================================================================
// 1. CONSTANTS - Banned words, phrases, and punctuation
// ==========================================================================

const BANNED_WORDS = [
    // AI transitions
    "furthermore", "moreover", "additionally", "subsequently", "consequently",
    "nevertheless", "notwithstanding", "henceforth", "whereby", "thereof",
    "wherein", "heretofore", "aforementioned", "pertaining",
    // Corporate speak
    "leverage", "utilize", "implement", "facilitate", "optimize", "enhance",
    "streamline", "synergy", "paradigm", "methodology", "framework", "robust",
    "scalable", "seamless", "holistic", "innovative", "cutting-edge",
    // Stuffy academic
    "elucidate", "delineate", "ascertain", "endeavor", "commence", "terminate",
    "ameliorate", "exacerbate", "mitigate", "precipitate", "substantiate",
    "corroborate", "juxtapose", "proliferate", "underscore", "delve",
    // Pretentious
    "myriad", "plethora", "multifaceted", "comprehensive", "paramount",
    "pivotal", "imperative", "quintessential", "ubiquitous", "profound",
    // AI favorites
    "landscape", "realm", "domain", "sphere", "tapestry", "symphony",
    "testament", "beacon", "harbinger", "catalyst"
];

const WORD_SWAPS = {
    "utilize": "use", "leverage": "use", "implement": "set up", "facilitate": "help",
    "optimize": "improve", "enhance": "improve", "comprehensive": "full",
    "furthermore": "also", "moreover": "also", "additionally": "also",
    "subsequently": "then", "consequently": "so", "nevertheless": "still",
    "crucial": "key", "significant": "big", "fundamental": "basic",
    "demonstrate": "show", "indicate": "show", "illustrate": "show",
    "numerous": "many", "various": "different", "substantial": "large",
    "commence": "start", "terminate": "end", "acquire": "get",
    "sufficient": "enough", "insufficient": "not enough", "excessive": "too much",
    "prior to": "before", "subsequent to": "after", "in order to": "to",
    "due to the fact that": "because", "in light of": "given",
    "with regard to": "about", "in terms of": "for", "pertaining to": "about"
};

// ==========================================================================
// 2. CORE FUNCTIONS - EM dash removal, word replacement
// ==========================================================================

function killEmDashes(text) {
    return text
        .replace(/\u2014/g, ',')
        .replace(/\u2013/g, ',')
        .replace(/—/g, ',')
        .replace(/–/g, ',')
        .replace(/ - /g, ', ')
        .replace(/ -- /g, ', ')
        .replace(/--/g, ', ')
        .replace(/,\s*,/g, ',')
        .replace(/\s{2,}/g, ' ');
}

function swapWords(text) {
    let result = text;
    for (const [bad, good] of Object.entries(WORD_SWAPS)) {
        const regex = new RegExp(`\\b${bad}\\b`, 'gi');
        result = result.replace(regex, good);
    }
    return result;
}

function cleanAIArtifacts(text) {
    let cleaned = text;
    // Remove preambles
    cleaned = cleaned.replace(/^(Here's|Here is|Below is|Sure,|I've rewritten|Rewritten)[^:]*:\s*/i, '');
    cleaned = cleaned.replace(/^["']|["']$/g, '');
    // Fix spacing
    cleaned = cleaned.replace(/\s{2,}/g, ' ').trim();
    return cleaned;
}

// ==========================================================================
// 3. BURSTINESS & PERPLEXITY - Randomize sentence characteristics
// ==========================================================================

function generateBurstinessProfile() {
    // Create a random profile that varies sentence length targets
    // Burstiness = high variance in sentence length
    const profiles = [
        { short: 0.4, medium: 0.3, long: 0.3 },  // More short sentences
        { short: 0.2, medium: 0.5, long: 0.3 },  // Balanced
        { short: 0.3, medium: 0.3, long: 0.4 },  // More complex
        { short: 0.5, medium: 0.3, long: 0.2 },  // Punchy style
        { short: 0.25, medium: 0.5, long: 0.25 }, // Mostly medium
    ];
    return profiles[Math.floor(Math.random() * profiles.length)];
}

function generatePerplexityLevel() {
    // Perplexity = unpredictability of word choice
    // Higher = more unexpected word combinations
    const levels = [
        { name: "conversational", vocab: "simple", complexity: "low" },
        { name: "thoughtful", vocab: "mixed", complexity: "medium" },
        { name: "analytical", vocab: "precise", complexity: "medium" },
        { name: "direct", vocab: "plain", complexity: "low" },
        { name: "exploratory", vocab: "varied", complexity: "high" },
    ];
    return levels[Math.floor(Math.random() * levels.length)];
}

// ==========================================================================
// 4. SENTENCE STRUCTURE PATTERNS - Randomized per chunk
// ==========================================================================

const SENTENCE_STRUCTURES = [
    // Basic patterns
    { pattern: "SVO", desc: "Subject-Verb-Object: 'The policy reduces emissions.'" },
    { pattern: "SVA", desc: "Subject-Verb-Adverb: 'Temperatures rise sharply.'" },
    { pattern: "SVOO", desc: "Subject-Verb-Object-Object: 'This gives countries options.'" },
    
    // Inverted/varied
    { pattern: "Adverb-SV", desc: "Start with adverb: 'Clearly, this matters.'" },
    { pattern: "Object-SV", desc: "Front the object: 'This problem, we can solve.'" },
    { pattern: "Conditional", desc: "'If X happens, then Y.' or 'When X, Y follows.'" },
    
    // Compound
    { pattern: "SV-and-SV", desc: "Two clauses with 'and': 'X happens and Y follows.'" },
    { pattern: "SV-but-SV", desc: "Contrast with 'but': 'X seems true, but Y matters more.'" },
    { pattern: "SV-so-SV", desc: "Cause-effect: 'X happened, so Y changed.'" },
    
    // Questions & fragments (human-like)
    { pattern: "Rhetorical", desc: "Ask then answer: 'Why does this matter? Because...' " },
    { pattern: "Fragment", desc: "Occasional fragment: 'Not just theory. Reality.'" },
    
    // Complex
    { pattern: "Because-SV", desc: "Start with reason: 'Because X, we see Y.'" },
    { pattern: "While-SV", desc: "Contrast while: 'While X seems true, Y is the reality.'" },
];

function getRandomStructures(count = 4) {
    const shuffled = [...SENTENCE_STRUCTURES].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, count);
}

// ==========================================================================
// 5. NATURAL COLLOQUIALISMS - Subtle, not informal
// ==========================================================================

const COLLOQUIAL_TOUCHES = {
    // Sentence starters (use sparingly ~10%)
    starters: [
        "The thing is,", "Here's what matters:", "Look at it this way:",
        "Put simply,", "In practice,", "The reality is",
    ],
    // Transitional phrases
    transitions: [
        "That said,", "At the same time,", "On the flip side,",
        "Even so,", "Still,", "Then again,",
    ],
    // Emphasis (use rarely ~5%)
    emphasis: [
        "actually", "really", "in fact", "clearly", "notably",
    ],
    // Hedges for nuance
    hedges: [
        "tends to", "often", "generally", "in most cases", "typically",
    ],
};

function shouldAddColloquialism() {
    return Math.random() < 0.12; // 12% chance
}

function getRandomColloquialism(type) {
    const options = COLLOQUIAL_TOUCHES[type];
    return options[Math.floor(Math.random() * options.length)];
}

// ==========================================================================
// 6. CHUNKING WITH CONTEXT PRESERVATION
// ==========================================================================

function smartChunk(text) {
    // Split by paragraphs first, then by sentence groups
    const paragraphs = text.split(/\n\n+/);
    const chunks = [];
    
    for (const para of paragraphs) {
        const sentences = para.match(/[^.!?]+[.!?]+/g) || [para];
        
        // Group 3-5 sentences per chunk for context
        let current = [];
        for (let i = 0; i < sentences.length; i++) {
            current.push(sentences[i].trim());
            if (current.length >= 3 + Math.floor(Math.random() * 3) || i === sentences.length - 1) {
                if (current.length > 0) {
                    chunks.push(current.join(' '));
                }
                current = [];
            }
        }
    }
    
    return chunks.filter(c => c.trim().length > 0);
}

// ==========================================================================
// 7. BUILD PROMPT - With context, structure patterns, and variation
// ==========================================================================

function buildPrompt(chunk, chunkIndex, totalChunks, previousOutput = '') {
    const burstiness = generateBurstinessProfile();
    const perplexity = generatePerplexityLevel();
    const structures = getRandomStructures(4);
    
    // Context from previous chunk (last 2 sentences)
    let contextNote = '';
    if (previousOutput && chunkIndex > 0) {
        const prevSentences = previousOutput.match(/[^.!?]+[.!?]+/g) || [];
        const lastTwo = prevSentences.slice(-2).join(' ').trim();
        if (lastTwo) {
            contextNote = `\nPREVIOUS CONTEXT (maintain flow from this): "${lastTwo}"`;
        }
    }

    // Position-aware instructions
    let positionNote = '';
    if (chunkIndex === 0) {
        positionNote = 'This is the OPENING. Start strong but natural.';
    } else if (chunkIndex === totalChunks - 1) {
        positionNote = 'This is the CONCLUSION. Wrap up naturally without clichés.';
    } else {
        positionNote = 'This is a MIDDLE section. Maintain momentum and flow.';
    }

    const structureList = structures.map(s => `• ${s.pattern}: ${s.desc}`).join('\n');

    return `Rewrite this text to sound naturally human-written. Vary your approach.

${positionNote}
${contextNote}

SENTENCE LENGTH MIX for this section:
• ${Math.round(burstiness.short * 100)}% short (under 12 words)
• ${Math.round(burstiness.medium * 100)}% medium (12-20 words)  
• ${Math.round(burstiness.long * 100)}% longer (20+ words)

VOCABULARY STYLE: ${perplexity.name} (${perplexity.vocab} words, ${perplexity.complexity} complexity)

USE THESE SENTENCE STRUCTURES (mix them):
${structureList}

CRITICAL RULES:
1. NO em dashes (—) or en dashes (–). Use commas or periods instead.
2. NO words like: ${BANNED_WORDS.slice(0, 15).join(', ')}
3. VARY how sentences start. Not every sentence begins with "The" or "This"
4. Keep all citations and references exactly as written
5. Be direct. Cut filler words.
6. Occasional short sentence. For impact.

TEXT TO REWRITE:
"${chunk}"

OUTPUT (rewritten text only):`;
}

// ==========================================================================
// 8. POST-PROCESS - Final cleanup
// ==========================================================================

function postProcess(text) {
    let result = text;
    
    // Kill em dashes
    result = killEmDashes(result);
    
    // Clean AI artifacts
    result = cleanAIArtifacts(result);
    
    // Swap banned words
    result = swapWords(result);
    
    // Fix common AI patterns
    result = result.replace(/, making /gi, '. This makes ');
    result = result.replace(/, leading to /gi, '. This leads to ');
    result = result.replace(/, resulting in /gi, '. This results in ');
    result = result.replace(/, causing /gi, '. This causes ');
    result = result.replace(/, enabling /gi, '. This enables ');
    result = result.replace(/, allowing /gi, '. This allows ');
    
    // Clean up
    result = result.replace(/\s{2,}/g, ' ').trim();
    
    return result;
}

// ==========================================================================
// 9. MAIN HANDLER
// ==========================================================================

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        const { text, tone, apiKey } = req.body;
        const GROQ_KEY = apiKey || process.env.GROQ_API_KEY;
        
        if (!text) throw new Error("No text provided.");
        if (text.length < 10) throw new Error("Text too short.");

        const safeText = text.substring(0, 15000);
        const chunks = smartChunk(safeText);
        const results = [];
        let previousOutput = '';

        console.log(`[Humanizer] Processing ${chunks.length} chunks`);

        for (let i = 0; i < chunks.length; i++) {
            const prompt = buildPrompt(chunks[i], i, chunks.length, previousOutput);
            const messages = [{ role: "user", content: prompt }];
            
            let rawResult = await GroqAPI.chat(messages, GROQ_KEY, false);
            let processed = postProcess(rawResult);
            
            results.push(processed);
            previousOutput = processed; // Pass to next chunk for context
        }

        // Final assembly
        let finalOutput = results.join(' ').replace(/\s{2,}/g, ' ').trim();
        
        // Final em dash paranoia check
        finalOutput = killEmDashes(finalOutput);

        return res.status(200).json({
            success: true,
            result: finalOutput,
            chunks: chunks.length
        });

    } catch (error) {
        console.error("Humanizer Error:", error);
        return res.status(500).json({ success: false, error: error.message });
    }
}

// ==========================================================================
// EXPORTS for agent.js
// ==========================================================================
export { 
    postProcess as PostProcessor, 
    WORD_SWAPS as AI_VOCAB_SWAPS, 
    SENTENCE_STRUCTURES as STRATEGIES,
    smartChunk as dynamicChunking,
    killEmDashes
};
