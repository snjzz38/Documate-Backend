// api/features/humanizer.js
// Strategy: Academic but natural tone - subtle humanization, not casual garbage
import { GroqAPI } from '../utils/groqAPI.js';

// ==========================================================================
// BANNED WORDS - Replace with simpler alternatives
// ==========================================================================

const BANNED_WORDS = {
    // Formal academic words
    "utilize": "use",
    "leverage": "use", 
    "facilitate": "help",
    "optimize": "improve",
    "enhance": "improve",
    "comprehensive": "complete",
    "methodology": "method",
    "paradigm": "model",
    "Subsequently": "Then",
    "subsequently": "then",
    "Consequently": "So",
    "consequently": "so",
    "Furthermore": "Also",
    "furthermore": "also",
    "Moreover": "Also",
    "moreover": "also",
    "Additionally": "Also",
    "additionally": "also",
    "Nevertheless": "But",
    "nevertheless": "but",
    "Nonetheless": "Still",
    "nonetheless": "still",
    "Therefore": "So",
    "therefore": "so",
    "Thus": "So",
    "thus": "so",
    "Hence": "So",
    "hence": "so",
    "Whereby": "where",
    "whereby": "where",
    "Thereof": "of it",
    "thereof": "of it",
    "Thereby": "by this",
    "thereby": "by this",
    
    // Fancy adjectives
    "equitable": "fair",
    "vulnerable": "at risk",
    "paramount": "important",
    "imperative": "necessary",
    "pivotal": "key",
    "crucial": "important",
    "essential": "needed",
    "fundamental": "basic",
    "significant": "major",
    "substantial": "large",
    "numerous": "many",
    "multifaceted": "complex",
    "myriad": "many",
    "plethora": "many",
    "prudent": "wise",
    "gravest": "worst",
    "grave": "serious",
    "accelerating": "speeding up",
    "depletes": "drains",
    "erodes": "weakens",
    
    // Fancy verbs
    "exacerbate": "worsen",
    "exacerbates": "worsens",
    "mitigate": "reduce",
    "mitigates": "reduces",
    "commenced": "started",
    "concluded": "ended",
    "endeavor": "try",
    "ascertain": "find out",
    "procure": "get",
    "disseminate": "spread",
    "elucidate": "explain",
    "exemplify": "show",
    "constitute": "make up",
    "necessitate": "require",
    "perpetuate": "continue",
    "exacerbating": "worsening",
    "intensifying": "growing",
    "amplifies": "increases",
    "amplifying": "increasing",
    "diminishes": "reduces",
    "precipitates": "causes",
    "engenders": "creates",
    
    // Wordy phrases
    "prior to": "before",
    "in order to": "to",
    "due to the fact that": "because",
    "for the purpose of": "to",
    "in the event that": "if",
    "at this point in time": "now",
    "in light of": "because of",
    "with regard to": "about",
    "in terms of": "for",
    "on the other hand": "but",
    "as a result": "so",
    "in addition": "also",
    "in conclusion": "finally",
    "it is important to note that": "",
    "it should be noted that": "",
    "needless to say": "",
    "it goes without saying": "",
    
    // AI-specific tells
    "delve": "explore",
    "delves": "explores",
    "realm": "area",
    "landscape": "situation",
    "robust": "strong",
    "leverage": "use",
    "synergy": "cooperation",
    "holistic": "complete",
    "proactive": "active",
    "streamline": "simplify",
    "incentivize": "encourage"
};

function applyWordSwaps(text) {
    let result = text;
    for (const [bad, good] of Object.entries(BANNED_WORDS)) {
        const regex = new RegExp(`\\b${bad}\\b`, 'gi');
        result = result.replace(regex, (match) => {
            // Preserve capitalization
            if (match[0] === match[0].toUpperCase()) {
                return good.charAt(0).toUpperCase() + good.slice(1);
            }
            return good;
        });
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

    const logs = [];
    
    try {
        const { text, apiKey } = req.body;
        const GROQ_KEY = apiKey || process.env.GROQ_API_KEY;
        
        if (!text) throw new Error("No text provided.");
        
        logs.push(`Input: ${text.length} chars`);
        
        // Step 1: Apply word swaps first
        let processed = applyWordSwaps(text);
        logs.push('Applied banned word replacements');
        
        // Step 2: Send to AI for natural rewriting with BETTER prompt
        const prompt = `Rewrite this text naturally. Keep the academic tone but make it flow better.

TEXT:
"${processed}"

IMPORTANT RULES:

1. COMBINE related short sentences using "and", "but", "because", "while", "since":
   BAD: "Climate change is a crisis. It affects everyone. We need action."
   GOOD: "Climate change is a crisis that affects everyone, and we need action."

2. VARY sentence lengths - mix short, medium, and longer sentences naturally

3. Use contractions: "it is" → "it's", "does not" → "doesn't", "they are" → "they're"

4. NEVER USE these AI patterns:
   - "isn't just X, it's Y" or any variation
   - "doesn't just X, it Y"
   - "The choice isn't X. It's Y."
   - Starting sentences with "This" repeatedly
   - Semicolons or em dashes
   - ", which" clauses

5. When you want to contrast two things, DON'T use "isn't just X, it's Y". Instead:
   - "X matters, but Y matters more"
   - "Beyond X, there's Y"
   - "X is important. Y is even more so."

GOOD EXAMPLE:
"Climate change has become a security crisis that goes beyond melting ice. Rising temperatures make conflicts over water and food worse, and countries already struggling get pushed to their limits. The nations least responsible often face the worst consequences. When droughts destroy crops, people lose everything and have to move, which strains borders and weakens trust between countries."

Output ONLY the rewritten text.`;

        logs.push('Sending to Groq...');
        
        const response = await GroqAPI.chat([{ role: "user", content: prompt }], GROQ_KEY, false);
        let result = typeof response === 'string' ? response : (response.content || response);
        result = result.trim().replace(/^["']|["']$/g, '');
        
        logs.push(`Groq response (first 150 chars): ${result.substring(0, 150)}...`);
        
        // Step 3: Post-process to catch remaining AI patterns
        result = postProcess(result, logs);
        
        // Step 4: Combine short sentences
        result = combineShortSentences(result, logs);
        
        // Step 5: Apply word swaps again (AI might reintroduce banned words)
        result = applyWordSwaps(result);
        
        // Step 6: Final cleanup
        result = result.replace(/\s{2,}/g, ' ').trim();
        
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
// COMBINE SHORT SENTENCES
// ==========================================================================

function combineShortSentences(text, logs) {
    const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
    if (sentences.length < 2) return text;
    
    const result = [];
    let i = 0;
    
    while (i < sentences.length) {
        const current = sentences[i].trim();
        const next = sentences[i + 1]?.trim();
        
        const currentWords = current.split(/\s+/).length;
        const nextWords = next ? next.split(/\s+/).length : 999;
        
        // If both sentences are short (under 10 words), try to combine
        if (currentWords < 10 && nextWords < 10 && next) {
            // Check if they can be naturally combined
            const combined = tryCombine(current, next);
            if (combined) {
                result.push(combined);
                logs.push(`Combined: "${current.substring(0, 20)}..." + "${next.substring(0, 20)}..."`);
                i += 2;
                continue;
            }
        }
        
        result.push(current);
        i++;
    }
    
    return result.join(' ');
}

function tryCombine(s1, s2) {
    // Remove periods for combining
    const a = s1.replace(/[.!?]+$/, '').trim();
    const b = s2.replace(/[.!?]+$/, '').trim();
    const bLower = b.charAt(0).toLowerCase() + b.slice(1);
    
    // Pattern: "X is Y. It Z" → "X is Y, and it Z"
    if (/^(It|They|This|That|These|Those)\s/i.test(b)) {
        return `${a}, and ${bLower}.`;
    }
    
    // Pattern: "X happens. Y happens" → "X happens, and Y happens"
    if (!b.startsWith('But') && !b.startsWith('However') && !b.startsWith('And')) {
        // Check if subjects are different enough
        const aSubject = a.split(/\s+/)[0];
        const bSubject = b.split(/\s+/)[0];
        if (aSubject !== bSubject) {
            return `${a}, and ${bLower}.`;
        }
    }
    
    return null; // Don't combine
}

// ==========================================================================
// POST-PROCESSING
// ==========================================================================

function postProcess(text, logs) {
    let result = text;
    
    // Fix missing spaces after commas (common AI error)
    result = result.replace(/,([a-zA-Z])/g, ', $1');
    
    // Remove semicolons - split into sentences
    result = result.replace(/;/g, '.');
    
    // Remove em dashes
    result = result.replace(/[—–]/g, ',');
    result = result.replace(/\s*,\s*,/g, ',');
    
    // ===========================================
    // AGGRESSIVE: Fix "isn't just X, it's Y" patterns
    // These are THE main AI tells - must eliminate
    // ===========================================
    
    // "it's not just X, it's Y" → "it goes beyond X. It's also Y"
    result = result.replace(/[Ii]t's not just ([^,]+),\s*it's ([^\.]+)\./gi, (m, x, y) => {
        logs.push(`Fixed: it's not just pattern`);
        return `It goes beyond ${x.trim()}. It's also ${y.trim()}.`;
    });
    
    // "isn't just X, it's Y" → split into two sentences
    result = result.replace(/isn't just ([^,]+),\s*it's ([^\.]+)\./gi, (m, x, y) => {
        logs.push(`Fixed: isn't just pattern`);
        return `goes beyond ${x.trim()}. It's also ${y.trim()}.`;
    });
    
    // "aren't just X, they're Y" → split
    result = result.replace(/aren't just ([^,]+),\s*they're ([^\.]+)\./gi, (m, x, y) => {
        logs.push(`Fixed: aren't just pattern`);
        return `go beyond ${x.trim()}. They're also ${y.trim()}.`;
    });
    
    // "doesn't just X, it Y" → split  
    result = result.replace(/doesn't just ([^,]+),\s*it ([^\.]+)\./gi, (m, x, y) => {
        logs.push(`Fixed: doesn't just comma pattern`);
        return `does more than ${x.trim()}. It also ${y.trim()}.`;
    });
    
    // "doesn't just X. it Y" (with period, lowercase it) → split
    result = result.replace(/doesn't just ([^\.]+)\.\s*it ([^\.]+)\./gi, (m, x, y) => {
        logs.push(`Fixed: doesn't just period pattern`);
        return `does more than ${x.trim()}. It ${y.trim()}.`;
    });
    
    // "don't just X, they're Y" → split
    result = result.replace(/don't just ([^,]+),\s*they're ([^\.]+)\./gi, (m, x, y) => {
        logs.push(`Fixed: don't just they're pattern`);
        return `do more than ${x.trim()}. They're ${y.trim()}.`;
    });
    result = result.replace(/don't just ([^,]+),\s*they ([^\.]+)\./gi, (m, x, y) => {
        logs.push(`Fixed: don't just they pattern`);
        return `do more than ${x.trim()}. They ${y.trim()}.`;
    });
    
    // "The choice/real threat isn't X. It's Y" → combine differently
    result = result.replace(/The (choice|threat|issue|problem|question|answer) isn't ([^\.]+)\.\s*[Ii]t's ([^\.]+)\./gi, (m, noun, x, y) => {
        logs.push(`Fixed: The ${noun} isn't. It's pattern`);
        return `The real ${noun} is ${y.trim()}, not ${x.trim()}.`;
    });
    
    // Generic "X isn't Y. It's Z" split pattern
    result = result.replace(/([A-Z][^\.]+) isn't ([^\.]+)\.\s*[Ii]t's ([^\.]+)\./g, (m, subj, x, y) => {
        logs.push(`Fixed: generic isn't. It's pattern`);
        return `${subj} is ${y.trim()}, not ${x.trim()}.`;
    });
    
    // "The choice isn't X, but Y" → simplify
    result = result.replace(/The (choice|issue|question|decision) isn't ([^,]+),\s*but ([^\.]+)\./gi, (m, noun, x, y) => {
        logs.push(`Fixed: isn't X, but Y pattern`);
        return `The real ${noun} is ${y.trim()}, not ${x.trim()}.`;
    });
    
    // "isn't between X. It's between Y" pattern
    result = result.replace(/isn't between ([^\.]+)\.\s*[Ii]t's between ([^\.]+)\./gi, (m, x, y) => {
        logs.push(`Fixed: isn't between. It's between pattern`);
        return `is between ${y.trim()}, not ${x.trim()}.`;
    });
    
    // "The real X isn't Y. it's Z" (with lowercase it's after period)
    result = result.replace(/The real ([a-z]+) isn't ([^\.]+)\.\s*it's ([^\.]+)\./gi, (m, noun, x, y) => {
        logs.push(`Fixed: The real X isn't. it's pattern`);
        return `The real ${noun} is ${y.trim()}, not just ${x.trim()}.`;
    });
    
    // Catch any remaining "just X, it's/they're" patterns
    result = result.replace(/n't just ([^,]+),\s*it's/gi, " goes beyond $1. It's");
    result = result.replace(/n't just ([^,]+),\s*they're/gi, " go beyond $1. They're");
    
    // Fix lowercase "it" after period
    result = result.replace(/\.\s*it\s+/g, '. It ');
    
    // ===========================================
    // Fix "This [verb]s" patterns
    // ===========================================
    result = result.replace(/^This (strains|creates|causes|leads|forces|pushes|makes|turns|means|requires|demands|puts|increases|worsens)/gim, 'That $1');
    result = result.replace(/\. This (strains|creates|causes|leads|forces|pushes|makes|turns|means|requires|demands|puts|increases|worsens)/gi, '. That $1');
    
    // Fix ", which" clauses
    result = result.replace(/,\s*which\s+(\w+)/gi, '. It $1');
    
    // Add contractions if missing
    result = result.replace(/\bit is\b/gi, "it's");
    result = result.replace(/\bthat is\b/gi, "that's");
    result = result.replace(/\bdoes not\b/gi, "doesn't");
    result = result.replace(/\bdo not\b/gi, "don't");
    result = result.replace(/\bcannot\b/gi, "can't");
    result = result.replace(/\bwill not\b/gi, "won't");
    result = result.replace(/\bwould not\b/gi, "wouldn't");
    result = result.replace(/\bshould not\b/gi, "shouldn't");
    result = result.replace(/\bcould not\b/gi, "couldn't");
    result = result.replace(/\bthey are\b/gi, "they're");
    result = result.replace(/\bwe are\b/gi, "we're");
    result = result.replace(/\bare not\b/gi, "aren't");
    result = result.replace(/\bis not\b/gi, "isn't");
    result = result.replace(/\bwas not\b/gi, "wasn't");
    result = result.replace(/\bwere not\b/gi, "weren't");
    result = result.replace(/\bhas not\b/gi, "hasn't");
    result = result.replace(/\bhave not\b/gi, "haven't");
    
    // Fix double periods
    result = result.replace(/\.\./g, '.');
    result = result.replace(/\s{2,}/g, ' ');
    
    // Fix "not X, but Y" → simpler phrasing
    result = result.replace(/not about (.+?),\s*but about/gi, 'about');
    result = result.replace(/not (.+?),\s*but rather/gi, '$1. Instead,');
    
    // Trim
    result = result.trim();
    
    logs.push('Post-processing complete');
    
    return result;
}

// ==========================================================================
// EXPORTS (for agent.js compatibility)
// ==========================================================================
export { postProcess as PostProcessor, BANNED_WORDS as AI_VOCAB_SWAPS, applyWordSwaps as killEmDashes };
