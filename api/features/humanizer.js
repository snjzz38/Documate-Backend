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
// WORD SELECTION ALGORITHM
// Selects words based on temperature, complexity targets, and context
// ==========================================================================

// Word complexity tiers (1 = simple, 2 = medium, 3 = complex)
const WORD_ALTERNATIVES = {
    // Verbs
    "utilize": { 1: "use", 2: "use", 3: "employ" },
    "facilitate": { 1: "help", 2: "enable", 3: "support" },
    "necessitate": { 1: "need", 2: "require", 3: "demand" },
    "exacerbate": { 1: "worsen", 2: "intensify", 3: "aggravate" },
    "exacerbates": { 1: "worsens", 2: "intensifies", 3: "aggravates" },
    "exacerbated": { 1: "worsened", 2: "intensified", 3: "aggravated" },
    "mitigate": { 1: "reduce", 2: "lessen", 3: "diminish" },
    "encompasses": { 1: "includes", 2: "covers", 3: "spans" },
    "prioritizing": { 1: "focusing on", 2: "emphasizing", 3: "prioritizing" },
    "destabilize": { 1: "weaken", 2: "disrupt", 3: "undermine" },
    "intensify": { 1: "worsen", 2: "increase", 3: "heighten" },
    "intensifies": { 1: "worsens", 2: "increases", 3: "heightens" },
    "encompasses": { 1: "includes", 2: "covers", 3: "involves" },
    "undermines": { 1: "weakens", 2: "hurts", 3: "erodes" },
    "constitutes": { 1: "is", 2: "makes up", 3: "forms" },
    "comprises": { 1: "includes", 2: "contains", 3: "consists of" },
    
    // Adjectives
    "comprehensive": { 1: "full", 2: "broad", 3: "thorough" },
    "fundamental": { 1: "basic", 2: "core", 3: "central" },
    "significant": { 1: "big", 2: "major", 3: "notable" },
    "substantial": { 1: "large", 2: "major", 3: "considerable" },
    "crucial": { 1: "key", 2: "vital", 3: "critical" },
    "essential": { 1: "needed", 2: "necessary", 3: "vital" },
    "vulnerable": { 1: "at risk", 2: "exposed", 3: "susceptible" },
    "viable": { 1: "possible", 2: "workable", 3: "feasible" },
    "robust": { 1: "strong", 2: "solid", 3: "sturdy" },
    "paramount": { 1: "key", 2: "top", 3: "chief" },
    "imperative": { 1: "needed", 2: "urgent", 3: "pressing" },
    "prevalent": { 1: "common", 2: "widespread", 3: "pervasive" },
    "catastrophic": { 1: "terrible", 2: "devastating", 3: "disastrous" },
    "unprecedented": { 1: "new", 2: "unmatched", 3: "historic" },
    
    // Adverbs
    "fundamentally": { 1: "basically", 2: "at its core", 3: "inherently" },
    "significantly": { 1: "greatly", 2: "notably", 3: "markedly" },
    "subsequently": { 1: "then", 2: "later", 3: "afterward" },
    "consequently": { 1: "so", 2: "as a result", 3: "therefore" },
    "additionally": { 1: "also", 2: "plus", 3: "moreover" },
    "proactively": { 1: "early on", 2: "in advance", 3: "preemptively" },
    "readily": { 1: "easily", 2: "quickly", 3: "promptly" },
    
    // Nouns
    "methodology": { 1: "method", 2: "approach", 3: "framework" },
    "paradigm": { 1: "model", 2: "pattern", 3: "framework" },
    "infrastructure": { 1: "systems", 2: "structures", 3: "foundations" },
    "ramifications": { 1: "effects", 2: "consequences", 3: "implications" },
    "implications": { 1: "effects", 2: "results", 3: "consequences" },
    
    // Transitions (always simplify)
    "furthermore": { 1: "also", 2: "and", 3: "in addition" },
    "moreover": { 1: "also", 2: "and", 3: "besides" },
    "nevertheless": { 1: "still", 2: "but", 3: "however" },
    "nonetheless": { 1: "still", 2: "yet", 3: "even so" },
    "hence": { 1: "so", 2: "thus", 3: "therefore" },
    "whereby": { 1: "where", 2: "by which", 3: "through which" },
};

// Words to always replace (too AI-sounding regardless of complexity)
const ALWAYS_REPLACE = {
    "utilize": "use",
    "utilizes": "uses",
    "utilizing": "using",
    "leverage": "use",
    "leveraging": "using",
    "burgeoning": "growing",
    "myriad": "many",
    "plethora": "many",
    "delve": "explore",
    "pivotal": "key",
    "multifaceted": "complex",
    "holistic": "complete",
    "synergy": "cooperation",
    "paradigm": "model",
    "whereby": "where",
    "thereof": "of it",
    "thereby": "by this",
    "henceforth": "from now on",
};

// Calculate target complexity based on temperature and position in text
function getTargetComplexity(temperature, sentenceIndex, totalSentences) {
    // Base complexity from temperature (0.5-1.5 → 1-3)
    const tempComplexity = Math.min(3, Math.max(1, Math.round(temperature * 2)));
    
    // Add variation based on position (every 3rd sentence can be more complex)
    const positionBonus = (sentenceIndex % 3 === 0) ? 0.5 : 0;
    
    // Random variation (-0.5 to +0.5)
    const randomVariation = (Math.random() - 0.5);
    
    // Final complexity (1-3)
    const final = Math.min(3, Math.max(1, Math.round(tempComplexity + positionBonus + randomVariation)));
    
    return final;
}

// Select best word based on complexity target
function selectWord(word, targetComplexity) {
    const lowerWord = word.toLowerCase();
    
    // Always replace these
    if (ALWAYS_REPLACE[lowerWord]) {
        return ALWAYS_REPLACE[lowerWord];
    }
    
    // Check if we have alternatives
    if (WORD_ALTERNATIVES[lowerWord]) {
        const alternatives = WORD_ALTERNATIVES[lowerWord];
        const selected = alternatives[targetComplexity] || alternatives[2];
        
        // Preserve original capitalization
        if (word[0] === word[0].toUpperCase()) {
            return selected.charAt(0).toUpperCase() + selected.slice(1);
        }
        return selected;
    }
    
    return word;
}

// Apply word selection algorithm to text
function applyWordSelection(text, temperature, logs) {
    const sentences = text.split(/(?<=[.!?])\s+/);
    const totalSentences = sentences.length;
    
    const processedSentences = sentences.map((sentence, index) => {
        const targetComplexity = getTargetComplexity(temperature, index, totalSentences);
        
        // Replace words based on target complexity
        let processed = sentence;
        
        // First, always replace banned words
        for (const [bad, good] of Object.entries(ALWAYS_REPLACE)) {
            processed = processed.replace(new RegExp(`\\b${bad}\\b`, 'gi'), good);
        }
        
        // Then apply complexity-based selection
        for (const [word, alternatives] of Object.entries(WORD_ALTERNATIVES)) {
            const selected = alternatives[targetComplexity] || alternatives[2];
            processed = processed.replace(new RegExp(`\\b${word}\\b`, 'gi'), selected);
        }
        
        return processed;
    });
    
    logs.push(`Applied word selection with temperature ${temperature.toFixed(2)}`);
    return processedSentences.join(' ');
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
    "comprehensive": "full", "comprehensively": "fully",
    "robust": "strong", "robustly": "strongly",
    "viable": "workable", "viability": "workability",
    "systemic": "system-wide", "systemically": "throughout",
    "readily": "easily", "considerable": "major", "considerably": "greatly",
    "apparent": "clear", "apparently": "clearly",
    "prolonged": "long", "arable": "farmable",
    "pre-existing": "existing", "preexisting": "existing",
    "unmistakable": "obvious",
    "proactively": "actively",
    
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
    
    // "isn't just to X, but rather to Y" → "means Y" (better grammar)
    result = result.replace(/isn't (simply |just |merely |)?to ([^,]+),\s*but (rather )?to ([^\.]+)\./gi, (m, mod, x, rather, y) => {
        logs.push('Fixed: isn\'t to X, but rather to Y');
        return `means ${y}.`;
    });
    
    // "To X isn't just to Y, but rather to Z" → "X means Z"
    result = result.replace(/To ([^\s]+) isn't (simply |just |merely |)?to ([^,]+),\s*but (rather )?to ([^\.]+)\./gi, (m, verb, mod, x, rather, y) => {
        logs.push('Fixed: To X isn\'t to Y, but to Z');
        return `${verb.charAt(0).toUpperCase() + verb.slice(1)}ing means ${y}.`;
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
    // Fix participial phrases: ", extending X" → ". This extends X"
    // ===========================================
    const participials = ['extending', 'establishing', 'creating', 'forcing', 'pushing', 
                          'turning', 'making', 'causing', 'driving', 'putting', 'leaving',
                          'placing', 'weakening', 'strengthening', 'increasing', 'reducing',
                          'leading', 'resulting', 'producing', 'generating', 'sparking'];
    
    for (const verb of participials) {
        const pattern = new RegExp(`,\\s*${verb}\\s+`, 'gi');
        if (pattern.test(result)) {
            const base = verb.replace(/ing$/, '');
            const conjugated = base.endsWith('e') ? base + 's' : base + 'es';
            result = result.replace(pattern, `. This ${conjugated} `);
            logs.push(`Fixed: participial "${verb}"`);
        }
    }
    
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
        
        // Step 1: Apply initial word swaps
        let processed = applyWordSwaps(text);
        logs.push('Applied banned word replacements');
        
        // Step 2: Random temperature for this request
        const temperature = getRandomTemperature();
        logs.push(`Temperature: ${temperature.toFixed(2)}`);
        
        // Step 3: Send to Gemini for natural rewriting
        const prompt = `Rewrite this academic text while maintaining its meaning and scholarly tone.

TEXT:
"${processed}"

REWRITING RULES:
1. Keep the academic register but make it flow naturally
2. Vary sentence structure - mix short (8-12 words) with medium (15-20 words) and occasional longer ones
3. Use different sentence openers - rotate between subject-first, "When...", "Because...", "This...", etc.
4. Use contractions where natural: "it's", "don't", "can't", "won't"
5. Connect ideas with: and, but, because, while, since, although, as
6. NO semicolons or em dashes
7. NO patterns like "isn't X, it's Y" or "not just X, but Y" or "doesn't just X, it Y"
8. When making a point, state it directly without contrasting what it "isn't"

Output ONLY the rewritten text, nothing else.`;

        logs.push('Sending to Gemini...');
        
        const result_raw = await GeminiAPI.chat(prompt, GEMINI_KEY, temperature);
        let result = result_raw.trim().replace(/^["']|["']$/g, '');
        
        logs.push(`Gemini response (first 150 chars): ${result.substring(0, 150)}...`);
        
        // Step 4: Apply word selection algorithm based on temperature
        result = applyWordSelection(result, temperature, logs);
        
        // Step 5: Post-process to fix remaining patterns
        result = postProcess(result, logs);
        
        // Step 6: Final word swap pass (catch anything AI reintroduced)
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
