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
    
    // Fix lowercase letter after period (like ". it's" → ". It's")
    result = result.replace(/\.\s+([a-z])/g, (m, letter) => `. ${letter.toUpperCase()}`);
    
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
        const prompt = `Rewrite this text to sound naturally human-written while keeping its academic tone.

TEXT:
"${processed}"

CRITICAL - AVOID THESE AI PATTERNS:
1. "isn't just X, it's Y" or "is not merely X, it is Y" - any variation of this contrast
2. "doesn't just X, it Y" or "does not simply X, it Y"  
3. "The choice is not X, but Y"
4. Split contrasts: "X is not Y. It is Z."
5. Semicolons and em dashes
6. ", which" clauses
7. Starting with "To clarify," or "This is a critical issue"
8. "The danger/threat lies in"
9. Participle phrases like ", forcing X" or ", creating Y"

INSTEAD, write like this:
- "Climate change is a security crisis, more than just an environmental one."
- "Delaying action warms the planet and risks instability."
- "The real choice is between managed change and collapse."
- Use "and", "but", "because" to connect ideas naturally
- Vary sentence lengths - mix short and medium sentences

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
