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
// BANNED WORDS
// ==========================================================================

const BANNED_WORDS = {
    "utilize": "use", "leverage": "use", "facilitate": "help",
    "optimize": "improve", "comprehensive": "complete", "methodology": "method",
    "furthermore": "also", "moreover": "also", "additionally": "also",
    "consequently": "so", "nevertheless": "but", "therefore": "so",
    "thus": "so", "hence": "so", "whereby": "where",
    "equitable": "fair", "vulnerable": "exposed", "paramount": "important",
    "imperative": "necessary", "pivotal": "key", "crucial": "important",
    "essential": "needed", "fundamental": "basic", "significant": "major",
    "substantial": "large", "numerous": "many", "prudent": "wise",
    "exacerbate": "worsen", "exacerbates": "worsens", "mitigate": "reduce",
    "commenced": "started", "concluded": "ended", "engenders": "creates",
    "gravest": "worst", "accelerating": "speeding up", "depletes": "drains",
    "erodes": "weakens", "intensify": "increase", "intensifies": "increases",
    "resilience": "strength", "spiraling": "getting worse",
    "ensuing": "following", "evident": "clear", "escalating": "growing",
    "merely": "just", "amplifies": "increases", "transforms": "turns",
    "transforming": "turning", "withstand": "survive", "comprises": "includes", 
    "constitutes": "is", "represents": "is", "undermines": "weakens"
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
    
    // Fix missing spaces
    result = result.replace(/,([a-zA-Z])/g, ', $1');
    
    // Fix lowercase letter after period (handles ". it's" and ".it's")
    result = result.replace(/\.(\s*)([a-z])/g, (m, space, letter) => `.${space || ' '}${letter.toUpperCase()}`);
    
    // Fix sentence starting with lowercase (at beginning of text)
    result = result.replace(/^([a-z])/, (m, letter) => letter.toUpperCase());
    
    // ===========================================
    // AGGRESSIVE: Remove "it's not X, it's Y" patterns
    // ===========================================
    
    // "it's not X, it's Y" → "it's Y"
    result = result.replace(/[Ii]t's not [^,]+,\s*it's ([^\.]+)\./g, (m, y) => {
        logs.push('Fixed: it\'s not X, it\'s Y');
        return `It's ${y}.`;
    });
    
    // "it's not about X, it's about Y" → "it's about Y"
    result = result.replace(/[Ii]t's not about [^,]+,\s*it's about ([^\.]+)\./g, (m, y) => {
        logs.push('Fixed: it\'s not about X');
        return `It's about ${y}.`;
    });
    
    // "isn't just X, it's Y" → "is Y"
    result = result.replace(/isn't just [^,]+,\s*it's ([^\.]+)\./gi, (m, y) => {
        logs.push('Fixed: isn\'t just X, it\'s Y');
        return `is ${y}.`;
    });
    
    // "doesn't just X, it Y" → "does X and Y"
    result = result.replace(/doesn't just ([^,]+),\s*it ([^\.]+)\./gi, (m, x, y) => {
        logs.push('Fixed: doesn\'t just X, it Y');
        return `${x} and ${y}.`;
    });
    
    // Split pattern: "X isn't Y. It's Z" → "X is Z"
    result = result.replace(/([A-Z][^\.]+) isn't [^\.]+\.\s*It's ([^\.]+)\./g, (m, subj, z) => {
        logs.push('Fixed: split isn\'t/It\'s pattern');
        return `${subj} is ${z}.`;
    });
    
    // "not just X, it's Y" mid-sentence
    result = result.replace(/not just [^,]+,\s*it's ([^\.]+)/gi, (m, y) => {
        logs.push('Fixed: not just mid-sentence');
        return y;
    });
    
    // ===========================================
    
    // Remove semicolons - split into sentences
    if (/;/.test(result)) {
        result = result.replace(/;/g, '.');
        logs.push('Fixed: semicolons → periods');
    }
    
    // Remove em dashes - replace with comma
    if (/[—–]/.test(result)) {
        result = result.replace(/\s*[—–]\s*/g, ', ');
        logs.push('Fixed: em dashes → commas');
    }
    
    // Fix participle phrases: ", establishing X" → ". This establishes X"
    result = result.replace(/,\s*(establishing|extending|addressing|creating|forcing|pushing|turning|making|causing|driving|putting)\s+/gi, 
        (m, verb) => {
            logs.push(`Fixed: participle "${verb}"`);
            const base = verb.toLowerCase().replace(/ing$/, '');
            const conjugated = base + (base.endsWith('e') ? 's' : 'es');
            return `. This ${conjugated} `;
        });
    
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
1. NEVER use "it's not X, it's Y" or any variation (this is the #1 AI tell)
2. NEVER use "isn't just X, it's Y" 
3. NEVER use "doesn't just X, it Y"
4. NEVER use "not about X, it's about Y"
5. NEVER split into "X isn't Y. It's Z." across two sentences
6. NEVER use semicolons or em dashes
7. NEVER use ", which" clauses

When you want to emphasize something, DON'T contrast it. Just state what it IS:
- BAD: "It's not just environmental, it's about security"
- GOOD: "This is fundamentally a security issue"
- BAD: "It's not about X, it's about Y"  
- GOOD: "The core issue is Y"

WRITING STYLE:
- Vary sentence lengths naturally
- Use contractions: "it's", "don't", "we're", "that's"
- Connect ideas with "and", "but", "because"
- Start occasional sentences with "And" or "But"

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
