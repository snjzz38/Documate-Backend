// api/features/humanizer.js
// NEW APPROACH: Score sentences, only fix problematic ones, verify fixes
import { GroqAPI } from '../utils/groqAPI.js';

// ==========================================================================
// BANNED WORDS
// ==========================================================================

const BANNED_WORDS = {
    "utilize": "use", "leverage": "use", "facilitate": "help",
    "optimize": "improve", "comprehensive": "complete", "methodology": "method",
    "furthermore": "also", "moreover": "also", "additionally": "also",
    "consequently": "so", "nevertheless": "but", "therefore": "so",
    "thus": "so", "hence": "so", "whereby": "where",
    "equitable": "fair", "vulnerable": "at risk", "paramount": "important",
    "imperative": "necessary", "pivotal": "key", "crucial": "important",
    "essential": "needed", "fundamental": "basic", "significant": "major",
    "substantial": "large", "numerous": "many", "prudent": "wise",
    "exacerbate": "worsen", "exacerbates": "worsens", "mitigate": "reduce",
    "commenced": "started", "concluded": "ended", "engenders": "creates",
    "gravest": "worst", "accelerating": "speeding up", "depletes": "drains",
    "erodes": "weakens", "intensify": "increase", "intensifies": "increases",
    "resilience": "strength", "spiraling": "getting worse"
};

function applyWordSwaps(text) {
    let result = text;
    for (const [bad, good] of Object.entries(BANNED_WORDS)) {
        result = result.replace(new RegExp(`\\b${bad}\\b`, 'gi'), good);
    }
    return result;
}

// ==========================================================================
// PATTERN DETECTION WITH SCORING
// ==========================================================================

const AI_PATTERNS = [
    { regex: /n't just [^,]+,\s*(it's|they're|it |they )/i, name: "isnt_just_its", score: 10 },
    { regex: /n't just [^\.]+\.\s*(it's|it )/i, name: "isnt_just_period", score: 10 },
    { regex: /n't (between|about|choosing) [^,]+,?\s*(but |it's)/i, name: "isnt_but", score: 10 },
    { regex: /n't [^\.]+\.\s*[Ii]t's /i, name: "split_isnt_its", score: 9 },
    { regex: /,\s*(forcing|creating|causing|pushing|turning|making)\s+/i, name: "participle", score: 7 },
    { regex: /[;]/i, name: "semicolon", score: 5 },
    { regex: /[—–]/i, name: "em_dash", score: 5 },
    { regex: /,\s*which\s+/i, name: "which_clause", score: 6 },
    { regex: /^This (strains|creates|causes|leads|forces)/i, name: "this_verbs", score: 4 },
    { regex: /the (real|true|main|core) (threat|danger|issue|problem)/i, name: "the_real", score: 5 },
];

function scoreSentence(sentence) {
    let totalScore = 0;
    const matches = [];
    
    for (const pattern of AI_PATTERNS) {
        if (pattern.regex.test(sentence)) {
            totalScore += pattern.score;
            matches.push(pattern.name);
        }
    }
    
    return { score: totalScore, matches };
}

// ==========================================================================
// TARGETED SENTENCE FIXER
// ==========================================================================

async function fixSentence(sentence, matches, apiKey, logs, attempt = 1) {
    if (attempt > 2) {
        logs.push(`  Gave up after 2 attempts, using fallback`);
        return fallbackFix(sentence, matches);
    }
    
    const prompt = `Rewrite this sentence to remove AI patterns. Keep the meaning.

SENTENCE: "${sentence}"

PROBLEMS DETECTED: ${matches.join(', ')}

RULES:
- If it has "isn't just X, it's Y": Split into two simple sentences or rephrase completely
- If it has "doesn't just X, it Y": Say "does more than X" or rephrase
- If it has participle (", forcing X"): Make it a separate sentence
- NO semicolons, NO em dashes, NO ", which"
- Use contractions naturally
- Keep it academic but natural

BAD: "Climate change isn't just environmental, it's a security crisis."
GOOD: "Climate change is a security crisis, not just an environmental one."

BAD: "Delaying action doesn't just warm the planet, it risks instability."  
GOOD: "Delaying action warms the planet and risks instability."

Output ONLY the fixed sentence(s), nothing else.`;

    try {
        const response = await GroqAPI.chat([{ role: "user", content: prompt }], apiKey, false);
        let fixed = typeof response === 'string' ? response : (response.content || response);
        fixed = fixed.trim().replace(/^["']|["']$/g, '');
        
        // Verify the fix doesn't have the same patterns
        const newScore = scoreSentence(fixed);
        if (newScore.score >= 8) {
            logs.push(`  Attempt ${attempt} still has patterns (score ${newScore.score}), retrying...`);
            return fixSentence(sentence, matches, apiKey, logs, attempt + 1);
        }
        
        logs.push(`  Fixed (score ${newScore.score}): "${fixed.substring(0, 50)}..."`);
        return fixed;
        
    } catch (e) {
        logs.push(`  Error: ${e.message}, using fallback`);
        return fallbackFix(sentence, matches);
    }
}

// ==========================================================================
// FALLBACK REGEX FIXES (when AI fails)
// ==========================================================================

function fallbackFix(sentence, matches) {
    let result = sentence;
    
    // Fix missing spaces
    result = result.replace(/,([a-zA-Z])/g, ', $1');
    
    // Fix "n't just X, it's/they're Y" → split
    result = result.replace(/(.+)n't just ([^,]+),\s*(it's|they're) ([^\.]+)\./gi, 
        (m, subj, x, pronoun, y) => `${subj} does more than ${x}. ${pronoun === "it's" ? "It" : "They"} also ${y}.`);
    
    // Fix "n't just X. it's Y" (with period)
    result = result.replace(/(.+)n't just ([^\.]+)\.\s*[Ii]t's ([^\.]+)\./gi,
        (m, subj, x, y) => `${subj} does more than ${x}. It ${y}.`);
    
    // Fix "isn't X, but Y" / "isn't X but Y"
    result = result.replace(/(.+) isn't ([^,]+),?\s*but ([^\.]+)\./gi,
        (m, subj, x, y) => `${subj} is ${y}, not ${x}.`);
    
    // Fix participles
    result = result.replace(/,\s*(forcing|creating|causing|pushing|turning|making)\s+([^,\.]+)([,\.])/gi,
        (m, verb, rest, punct) => `. This ${verb.replace(/ing$/, 'es')} ${rest}${punct}`);
    
    // Fix semicolons and em dashes
    result = result.replace(/;/g, '.');
    result = result.replace(/[—–]/g, ',');
    
    // Fix ", which"
    result = result.replace(/,\s*which\s+(\w+)/gi, '. It $1');
    
    // Clean up
    result = result.replace(/\.\./g, '.');
    result = result.replace(/\s{2,}/g, ' ');
    
    return result.trim();
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
        
        // Step 1: Apply word swaps
        let processed = applyWordSwaps(text);
        
        // Step 2: Split into sentences
        const sentences = processed.match(/[^.!?]+[.!?]+/g) || [processed];
        logs.push(`Found ${sentences.length} sentences`);
        
        // Step 3: Score each sentence
        const scored = sentences.map((s, i) => {
            const { score, matches } = scoreSentence(s.trim());
            return { index: i, text: s.trim(), score, matches };
        });
        
        // Log scores
        scored.forEach(s => {
            if (s.score > 0) {
                logs.push(`[${s.index + 1}] Score ${s.score}: ${s.matches.join(', ')} - "${s.text.substring(0, 40)}..."`);
            }
        });
        
        // Step 4: Fix sentences with score >= 5
        const results = [];
        for (const item of scored) {
            if (item.score >= 5) {
                logs.push(`Fixing sentence ${item.index + 1}...`);
                const fixed = await fixSentence(item.text, item.matches, GROQ_KEY, logs);
                results.push(fixed);
            } else {
                results.push(item.text);
            }
        }
        
        // Step 5: Join and final cleanup
        let finalText = results.join(' ');
        finalText = applyWordSwaps(finalText); // Apply swaps again
        finalText = finalText.replace(/,([a-zA-Z])/g, ', $1'); // Fix missing spaces
        finalText = finalText.replace(/\s{2,}/g, ' ').trim();
        
        // Step 6: Final score check
        const finalScore = scoreSentence(finalText);
        logs.push(`Final text score: ${finalScore.score}`);
        
        return res.status(200).json({
            success: true,
            result: finalText,
            stats: {
                sentences: sentences.length,
                fixed: scored.filter(s => s.score >= 5).length,
                finalScore: finalScore.score
            },
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
export { scoreSentence as PostProcessor, BANNED_WORDS as AI_VOCAB_SWAPS, applyWordSwaps as killEmDashes };
