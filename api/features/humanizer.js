// api/features/humanizer.js
// Using Gemini API - produces cleaner output than Groq
import { GeminiAPI } from '../utils/geminiAPI.js';

// ==========================================================================
// RANDOM TEMPERATURE - Varies between 0.5 and 1.5 for each request
// ==========================================================================

function getRandomTemperature() {
    return 0.5 + Math.random(); // Returns 0.5 to 1.5
}

// ==========================================================================
// BANNED WORDS - Full words and common conjugations
// ==========================================================================

const BANNED_WORDS = {
    // Formal verbs and conjugations
    "utilize": "use", "utilizes": "uses", "utilizing": "using", "utilized": "used",
    "leverage": "use", "leverages": "uses", "leveraging": "using", "leveraged": "used",
    "facilitate": "help", "facilitates": "helps", "facilitating": "helping",
    "optimize": "improve", "optimizes": "improves", "optimizing": "improving",
    "necessitate": "require", "necessitates": "requires", "necessitating": "requiring",
    "exacerbate": "worsen", "exacerbates": "worsens", "exacerbating": "worsening", "exacerbated": "worsened",
    "mitigate": "reduce", "mitigates": "reduces", "mitigating": "reducing",
    "intensify": "worsen", "intensifies": "worsens", "intensifying": "worsening", "intensified": "worsened",
    "escalate": "grow", "escalates": "grows", "escalating": "growing", "escalation": "growth",
    "amplify": "increase", "amplifies": "increases", "amplifying": "increasing",
    "transform": "turn", "transforms": "turns", "transforming": "turning",
    "burgeon": "grow", "burgeons": "grows", "burgeoning": "growing",
    "destabilize": "weaken", "destabilizes": "weakens", "destabilizing": "weakening",
    "exacerbate": "worsen", "exacerbates": "worsens", "exacerbated": "worsened",
    
    // Formal adjectives/adverbs
    "fundamental": "basic", "fundamentally": "basically",
    "comprehensive": "complete", "comprehensively": "completely",
    "robust": "strong", "robustly": "strongly",
    "viable": "workable", "viability": "workability",
    "systemic": "system-wide", "systemically": "throughout",
    "readily": "easily", "considerable": "major", "considerably": "greatly",
    "apparent": "clear", "apparently": "clearly",
    "prolonged": "long", "arable": "farmable",
    "pre-existing": "existing", "preexisting": "existing",
    "unmistakable": "clear", "proactively": "early",
    
    // Transitions
    "furthermore": "also", "moreover": "also", "additionally": "also",
    "consequently": "so", "nevertheless": "but", "therefore": "so",
    "thus": "so", "hence": "so", "whereby": "where",
    
    // Other formal words
    "equitable": "fair", "vulnerable": "exposed", "paramount": "important",
    "imperative": "necessary", "pivotal": "key", "crucial": "important",
    "essential": "needed", "significant": "major",
    "substantial": "large", "numerous": "many", "prudent": "wise",
    "commenced": "started", "concluded": "ended", "engenders": "creates",
    "gravest": "worst", "accelerating": "speeding up", "depletes": "drains",
    "erodes": "weakens", "resilience": "strength", "spiraling": "getting worse",
    "ensuing": "following", "evident": "clear", "merely": "just",
    "withstand": "survive", "comprises": "includes", "constitutes": "is",
    "represents": "is", "undermines": "weakens"
};

function applyWordSwaps(text) {
    let result = text;
    for (const [bad, good] of Object.entries(BANNED_WORDS)) {
        result = result.replace(new RegExp(`\\b${bad}\\b`, 'gi'), good);
    }
    return result;
}

// ==========================================================================
// POST-PROCESSING - Fix remaining patterns (semicolons, em dashes, participles)
// ==========================================================================

function postProcess(text, logs) {
    let result = text;
    
    // FIRST: Normalize all quote/apostrophe characters to standard ASCII
    result = result.replace(/[''`´]/g, "'");  // Normalize apostrophes
    result = result.replace(/[""„]/g, '"');   // Normalize quotes
    
    // Fix missing spaces
    result = result.replace(/,([a-zA-Z])/g, ', $1');
    
    logs.push('Starting pattern removal...');
    
    // ===========================================
    // SIMPLE STRING APPROACH: Split into sentences and fix each
    // ===========================================
    
    const sentences = result.split(/(?<=[.!?])\s+/);
    logs.push(`Split into ${sentences.length} sentences`);
    
    const fixedSentences = [];
    
    for (let i = 0; i < sentences.length; i++) {
        let sentence = sentences[i];
        const lowerSentence = sentence.toLowerCase();
        
        // Debug: check each sentence for the patterns
        const hasIsnt = lowerSentence.includes("isn't") || lowerSentence.includes("isn\u2019t");
        const hasIts = lowerSentence.includes("it's") || lowerSentence.includes("it\u2019s");
        
        if (hasIsnt || hasIts) {
            logs.push(`Sentence ${i}: hasIsnt=${hasIsnt}, hasIts=${hasIts}`);
            logs.push(`  Text: "${sentence.substring(0, 60)}..."`);
        }
        
        // Check for "isn't ... it's" pattern in same sentence
        if (hasIsnt && hasIts) {
            logs.push('MATCH: Found isn\'t...it\'s in sentence ' + i);
            
            // Normalize apostrophes first
            sentence = sentence.replace(/[\u2018\u2019\u0060\u00B4]/g, "'");
            const lowerNormalized = sentence.toLowerCase();
            
            // Find position of "it's" and keep only what comes after
            const itsIndex = lowerNormalized.lastIndexOf("it's");
            if (itsIndex !== -1) {
                const afterIts = sentence.substring(itsIndex + 5).trim();
                const isntIndex = lowerNormalized.indexOf("isn't");
                const subject = sentence.substring(0, isntIndex).trim();
                sentence = subject + " is " + afterIts;
                logs.push('Fixed to: ' + sentence.substring(0, 50) + '...');
            }
        }
        
        fixedSentences.push(sentence);
    }
    
    result = fixedSentences.join(' ');
    
    // ===========================================
    // Also check for split patterns across sentences
    // ===========================================
    
    // Handle "X isn't Y. It's Z." - combine into "X is Z."
    for (let i = 0; i < fixedSentences.length - 1; i++) {
        const current = fixedSentences[i].toLowerCase();
        const next = fixedSentences[i + 1].toLowerCase();
        
        if (current.includes("isn't") && next.startsWith("it's ")) {
            logs.push('Found split pattern across sentences');
            const isntIndex = fixedSentences[i].toLowerCase().indexOf("isn't");
            const subject = fixedSentences[i].substring(0, isntIndex).trim();
            const afterIts = fixedSentences[i + 1].substring(5); // Remove "It's "
            fixedSentences[i] = subject + " is " + afterIts;
            fixedSentences[i + 1] = ''; // Mark for removal
        }
    }
    
    result = fixedSentences.filter(s => s.length > 0).join(' ');
    
    // ===========================================
    // Other fixes
    // ===========================================
    
    // "isn't simply/just/merely X, it's Y" or "isn't simply X, it is Y" (with or without space after comma)
    result = result.replace(/isn't (simply |just |merely |)?([^,\.]+),\s*(it's|it is) ([^\.]+)\./gi, (m, mod, x, pronoun, y) => {
        logs.push('Fixed: isn\'t X, it\'s/is Y');
        return `is ${y}.`;
    });
    
    // Same pattern but NO space after comma: "isn't just wise,it's"
    result = result.replace(/isn't (simply |just |merely |)?([^,\.]+),(it's|it is) ([^\.]+)\./gi, (m, mod, x, pronoun, y) => {
        logs.push('Fixed: isn\'t X,it\'s Y (no space)');
        return `is ${y}.`;
    });
    
    // "isn't simply X. It's Y" or "isn't simply X. it's Y" (split with period)
    result = result.replace(/isn't (simply |just |merely |)?([^\.]+)\.\s*[Ii]t'?s ([^\.]+)\./gi, (m, mod, x, y) => {
        logs.push('Fixed: isn\'t X. It\'s Y (split)');
        return `is ${y}.`;
    });
    
    // "it's not X, it's Y" - any spacing
    result = result.replace(/[Ii]t's not [^,]+,\s*(it's|it is) ([^\.]+)\./g, (m, pronoun, y) => {
        logs.push('Fixed: it\'s not X, it\'s Y');
        return `It's ${y}.`;
    });
    
    // "it's not about X, it's about Y"
    result = result.replace(/[Ii]t's not about [^,]+,\s*(it's|it is) about ([^\.]+)\./g, (m, pronoun, y) => {
        logs.push('Fixed: it\'s not about X');
        return `It's about ${y}.`;
    });
    
    // "doesn't just X, it Y" - any spacing
    result = result.replace(/doesn't (simply |just |merely )?([^,]+),\s*(it's|it is|it) ([^\.]+)\./gi, (m, mod, x, pronoun, y) => {
        logs.push('Fixed: doesn\'t X, it Y');
        return `does ${x} and ${y}.`;
    });
    
    // "aren't just X, but Y"
    result = result.replace(/aren't (simply |just |merely |)?([^,]+),\s*(but|they) ([^\.]+)\./gi, (m, mod, x, conj, y) => {
        logs.push('Fixed: aren\'t X, but Y');
        return `are ${y}.`;
    });
    
    // ===========================================
    // NEW: "but rather" and "but also" contrast patterns
    // ===========================================
    
    // "isn't simply X, but rather Y" → "is Y"
    result = result.replace(/isn't (simply |just |merely |)?([^,]+),\s*but rather ([^\.]+)\./gi, (m, mod, x, y) => {
        logs.push('Fixed: isn\'t X, but rather Y');
        return `is ${y}.`;
    });
    
    // "isn't just to X, but rather to Y" → "is to Y"
    result = result.replace(/isn't (simply |just |merely |)?to ([^,]+),\s*but rather to ([^\.]+)\./gi, (m, mod, x, y) => {
        logs.push('Fixed: isn\'t to X, but rather to Y');
        return `is to ${y}.`;
    });
    
    // "don't just X, but also Y" → "X and also Y"
    result = result.replace(/don't (simply |just |merely )?([^,]+),\s*but also ([^\.]+)\./gi, (m, mod, x, y) => {
        logs.push('Fixed: don\'t just X, but also Y');
        return `${x} and also ${y}.`;
    });
    
    // "doesn't just X, but also Y" → "X and also Y"
    result = result.replace(/doesn't (simply |just |merely )?([^,]+),\s*but also ([^\.]+)\./gi, (m, mod, x, y) => {
        logs.push('Fixed: doesn\'t just X, but also Y');
        return `${x} and also ${y}.`;
    });
    
    // "not just X, but also Y" mid-sentence → "X and Y"
    result = result.replace(/not (simply |just |merely )?([^,]+),\s*but also ([^,\.]+)/gi, (m, mod, x, y) => {
        logs.push('Fixed: not just X, but also Y');
        return `${x} and ${y}`;
    });
    
    // "a decision not between X, but between Y" → "a decision between Y"
    result = result.replace(/(decision|choice) not between ([^,]+),\s*but between ([^\.]+)\./gi, (m, noun, x, y) => {
        logs.push('Fixed: decision not between X but between Y');
        return `${noun} between ${y}.`;
    });
    
    // ===========================================
    
    // Split pattern: "X isn't Y. It's Z" or "X isn't Y. it's Z"
    result = result.replace(/([^\.]+) isn't ([^\.]+)\.\s*[Ii]t'?s ([^\.]+)\./g, (m, subj, x, z) => {
        logs.push('Fixed: split isn\'t/It\'s pattern');
        return `${subj} is ${z}.`;
    });
    
    // "not just X, it's Y" mid-sentence - any spacing
    result = result.replace(/not (simply |just |merely )?[^,]+,\s*(it's|it is) /gi, (m) => {
        logs.push('Fixed: not just mid-sentence');
        return '';
    });
    
    // "The choice/question isn't X, but Y"
    result = result.replace(/The (basic |real |fundamental )?(choice|question|issue|decision) (isn't|is not) ([^,]+),\s*but ([^\.]+)\./gi, (m, adj, noun, neg, x, y) => {
        logs.push('Fixed: The choice isn\'t X but Y');
        return `The ${adj || ''}${noun} is ${y}.`;
    });
    
    // "We face a decision not between X, but between Y"
    result = result.replace(/([Ww]e face a )(decision|choice) not between ([^,]+),\s*but between ([^\.]+)\./gi, (m, prefix, noun, x, y) => {
        logs.push('Fixed: decision not between X but Y');
        return `${prefix}${noun} between ${y}.`;
    });
    
    // ===========================================
    // Fix grammar errors
    // ===========================================
    result = result.replace(/\ba ([aeiou])/gi, 'an $1'); // "a important" → "an important"
    
    // ===========================================
    // Fix lowercase after period
    // ===========================================
    result = result.replace(/\.(\s*)([a-z])/g, (m, space, letter) => `.${space || ' '}${letter.toUpperCase()}`);
    
    // Fix sentence starting with lowercase
    result = result.replace(/^([a-z])/, (m, letter) => letter.toUpperCase());
    
    // ===========================================
    // Remove filler phrases
    // ===========================================
    result = result.replace(/To be clear,\s*/gi, '');
    result = result.replace(/This is an? important point because\s*/gi, '');
    
    // ===========================================
    // Other fixes
    // ===========================================
    
    // Remove semicolons
    if (/;/.test(result)) {
        result = result.replace(/;/g, '.');
        logs.push('Fixed: semicolons → periods');
    }
    
    // Remove em dashes
    if (/[—–]/.test(result)) {
        result = result.replace(/\s*[—–]\s*/g, ', ');
        logs.push('Fixed: em dashes → commas');
    }
    
    // Fix ", which" clauses
    if (/,\s*which\s+/i.test(result)) {
        result = result.replace(/,\s*which\s+(\w+)/gi, '. It $1');
        logs.push('Fixed: ", which" → ". It"');
    }
    
    // Add contractions
    result = result.replace(/\bIt is\b/g, "It's");
    result = result.replace(/\bthat is\b/gi, "that's");
    result = result.replace(/\bdoes not\b/gi, "doesn't");
    result = result.replace(/\bdo not\b/gi, "don't");
    result = result.replace(/\bis not\b/gi, "isn't");
    result = result.replace(/\bare not\b/gi, "aren't");
    result = result.replace(/\bwe are\b/gi, "we're");
    result = result.replace(/\bthey are\b/gi, "they're");
    result = result.replace(/\bcannot\b/gi, "can't");
    result = result.replace(/\bwill not\b/gi, "won't");
    
    // Clean up double periods and spaces
    result = result.replace(/\.\s*\./g, '.');
    result = result.replace(/\s{2,}/g, ' ');
    result = result.trim();
    
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

    const logs = [];
    
    try {
        const { text, apiKey } = req.body;
        const GEMINI_KEY = apiKey || process.env.GEMINI_API_KEY;
        
        if (!text) throw new Error("No text provided.");
        if (!GEMINI_KEY) throw new Error("No Gemini API key provided.");
        
        logs.push(`Input: ${text.length} chars`);
        
        // Step 1: Apply word swaps first
        let processed = applyWordSwaps(text);
        logs.push('Applied banned word replacements');
        
        // Step 2: Send to Gemini for natural rewriting
        const prompt = `Rewrite this text to sound like a human wrote it. Keep the academic tone.

TEXT:
"${processed}"

ABSOLUTE RULES - NEVER USE THESE PATTERNS:
1. NEVER "it's not X, it's Y" or "isn't X, it's Y" - ANY variation of this
2. NEVER "isn't simply/just/merely X, it is Y"
3. NEVER "doesn't just X, it Y"
4. NEVER "not about X, it's about Y"
5. NEVER split contrasts across sentences: "X isn't Y. It's Z."
6. NEVER "The choice isn't X, but Y"
7. NEVER semicolons or em dashes
8. NEVER ", which" clauses
9. NEVER "To be clear," or "This is an important point"

When emphasizing something, state what it IS directly:
- BAD: "isn't simply wise, it is necessary"
- GOOD: "is necessary" or "is essential"

WRITING REQUIREMENTS:
- Vary vocabulary - don't repeat the same words
- Vary sentence structure - mix simple, compound, and complex sentences
- Use different sentence starters - don't begin multiple sentences the same way
- Use contractions naturally: "it's", "don't", "we're"
- Connect ideas with "and", "but", "because", "while", "since"

Output ONLY the rewritten text, nothing else.`;

        logs.push('Sending to Gemini...');
        
        // Random temperature for varied outputs
        const temperature = getRandomTemperature();
        logs.push(`Temperature: ${temperature.toFixed(2)}`);
        
        // GeminiAPI.chat returns a string directly
        const result_raw = await GeminiAPI.chat(prompt, GEMINI_KEY, temperature);
        let result = result_raw.trim().replace(/^["']|["']$/g, '');
        
        logs.push(`Gemini response (first 150 chars): ${result.substring(0, 150)}...`);
        
        // Step 3: Post-process to fix remaining patterns
        result = postProcess(result, logs);
        
        // Step 4: Apply word swaps again (AI might reintroduce some)
        result = applyWordSwaps(result);
        
        logs.push(`Final: ${result.length} chars`);

        return res.status(200).json({
            success: true,
            result: result,
            logs: logs
        });

    } catch (error) {
        logs.push(`ERROR: ${error.message}`);
        return res.status(500).json({ success: false, error: error.message, logs: logs });
    }
}

// ==========================================================================
// EXPORTS
// ==========================================================================
export { postProcess as PostProcessor, BANNED_WORDS as AI_VOCAB_SWAPS, applyWordSwaps as killEmDashes };
