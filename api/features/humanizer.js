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
    "resilience": "strength", "spiraling": "getting worse",
    "ensuing": "following", "evident": "clear", "escalating": "growing",
    "merely": "just", "amplifies": "increases", "transforms": "turns",
    "withstand": "survive", "comprises": "includes", "constitutes": "is"
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
    // "isn't/doesn't/aren't just X, it's Y" patterns (contractions)
    { regex: /n't just [^,]+,\s*(it's|they're|it |they )/i, name: "nt_just_its", score: 10 },
    { regex: /n't just [^\.]+\.\s*(it's|it |It )/i, name: "nt_just_period", score: 10 },
    
    // "is not/does not/are not" patterns (no contractions)
    { regex: /is not (just|merely|simply|only) [^,\.]+[,\.]\s*(it is|It is|it's|It's)/i, name: "is_not_just", score: 10 },
    { regex: /does not (just|merely|simply|only) [^,\.]+[,\.]\s*(it |It )/i, name: "does_not_just", score: 10 },
    { regex: /do not (just|merely|simply|only) [^,\.]+[,\.]\s*(but|they)/i, name: "do_not_just", score: 10 },
    { regex: /are not (just|merely|simply|only) [^,\.]+[,\.]\s*(they|but)/i, name: "are_not_just", score: 10 },
    
    // "not X, but Y" patterns
    { regex: /not (between|about|choosing) [^,]+,\s*but\b/i, name: "not_but", score: 10 },
    { regex: /is not [^,]+,\s*but\b/i, name: "is_not_but", score: 10 },
    
    // Split across sentences: "X is not Y. It is Z"
    { regex: /is not [^\.]+\.\s*It is\b/i, name: "split_is_not", score: 9 },
    { regex: /n't [^\.]+\.\s*[Ii]t's?\b/i, name: "split_nt_it", score: 9 },
    
    // Filler phrases
    { regex: /^To clarify[,:]/i, name: "to_clarify", score: 8 },
    { regex: /^(In other words|Put simply|That is to say)[,:]/i, name: "filler", score: 8 },
    { regex: /This is a (critical|key|important|major) (issue|point|matter)/i, name: "this_is_critical", score: 8 },
    
    // Formal phrasing
    { regex: /The (danger|threat|problem|issue|risk) lies in/i, name: "danger_lies", score: 7 },
    { regex: /The (real|true|main|core|fundamental) (threat|danger|issue)/i, name: "the_real", score: 6 },
    
    // Participles
    { regex: /,\s*(forcing|creating|causing|pushing|turning|making|driving)\s+/i, name: "participle", score: 7 },
    
    // Punctuation
    { regex: /[;]/i, name: "semicolon", score: 5 },
    { regex: /[—–]/i, name: "em_dash", score: 5 },
    { regex: /,\s*which\s+/i, name: "which_clause", score: 6 },
    
    // This + verb
    { regex: /^This (strains|creates|causes|leads|forces|transforms|amplifies)/i, name: "this_verbs", score: 5 },
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
    
    // ===== NON-CONTRACTION PATTERNS =====
    
    // "is not merely/simply/just X. It is Y" → combine
    result = result.replace(/(.+) is not (merely|simply|just|only) ([^\.]+)\.\s*It is ([^\.]+)\./gi,
        (m, subj, mod, x, y) => `${subj} is ${y}, not just ${x}.`);
    
    // "does not merely/simply X, it Y" / "does not merely X. It Y"
    result = result.replace(/(.+) does not (merely|simply|just) ([^,\.]+)[,\.]\s*[Ii]t ([^\.]+)\./gi,
        (m, subj, mod, x, y) => `${subj} does more than ${x}. It also ${y}.`);
    
    // "do not simply X, but Y"
    result = result.replace(/(.+) do not (merely|simply|just) ([^,]+),\s*but ([^\.]+)\./gi,
        (m, subj, mod, x, y) => `${subj} do more than ${x}. They also ${y}.`);
    
    // "is not X, but Y" / "is not between X, but between Y"
    result = result.replace(/(.+) is not ([^,]+),\s*but ([^\.]+)\./gi,
        (m, subj, x, y) => `${subj} is ${y}, not ${x}.`);
    
    // "The choice is not between X, but between Y"
    result = result.replace(/The (choice|decision|question) is not between ([^,]+),\s*but between ([^\.]+)\./gi,
        (m, noun, x, y) => `The ${noun} is between ${y}, not ${x}.`);
    
    // ===== CONTRACTION PATTERNS =====
    
    // "n't just X, it's/they're Y" → split
    result = result.replace(/(.+)n't just ([^,]+),\s*(it's|they're) ([^\.]+)\./gi, 
        (m, subj, x, pronoun, y) => `${subj} does more than ${x}. ${pronoun === "it's" ? "It" : "They"} also ${y}.`);
    
    // "n't just X. it's Y" (with period)
    result = result.replace(/(.+)n't just ([^\.]+)\.\s*[Ii]t's? ([^\.]+)\./gi,
        (m, subj, x, y) => `${subj} does more than ${x}. It ${y}.`);
    
    // "isn't X, but Y"
    result = result.replace(/(.+) isn't ([^,]+),?\s*but ([^\.]+)\./gi,
        (m, subj, x, y) => `${subj} is ${y}, not ${x}.`);
    
    // ===== FILLER PHRASES =====
    
    // "To clarify," - just remove it
    result = result.replace(/^To clarify,\s*/i, '');
    result = result.replace(/^In other words,\s*/i, '');
    result = result.replace(/^Put simply,\s*/i, '');
    
    // "This is a critical issue" → simpler
    result = result.replace(/This is a (critical|key|important|major) (issue|point|matter)[,:]?\s*(because)?/gi, 
        'The key point is that');
    
    // "The danger/threat lies in" → simpler
    result = result.replace(/The (danger|threat|problem|risk) lies in\b/gi, 'The $1 is');
    
    // ===== OTHER PATTERNS =====
    
    // Fix participles
    result = result.replace(/,\s*(forcing|creating|causing|pushing|turning|making|driving)\s+([^,\.]+)([,\.])/gi,
        (m, verb, rest, punct) => `. This ${verb.replace(/ing$/, 'es')} ${rest}${punct}`);
    
    // Fix semicolons and em dashes
    result = result.replace(/;/g, '.');
    result = result.replace(/[—–]/g, ',');
    
    // Fix ", which"
    result = result.replace(/,\s*which\s+(\w+)/gi, '. It $1');
    
    // Add contractions
    result = result.replace(/\bIt is\b/g, "It's");
    result = result.replace(/\bThey are\b/g, "They're");
    result = result.replace(/\bdoes not\b/gi, "doesn't");
    result = result.replace(/\bdo not\b/gi, "don't");
    result = result.replace(/\bis not\b/gi, "isn't");
    result = result.replace(/\bare not\b/gi, "aren't");
    
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
