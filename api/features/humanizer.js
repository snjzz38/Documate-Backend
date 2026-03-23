// api/features/humanizer.js
// Sentence-by-sentence: detect AI patterns and fix only those sentences
import { GroqAPI } from '../utils/groqAPI.js';

// ==========================================================================
// BANNED WORDS - Replace these with simpler alternatives
// ==========================================================================

const BANNED_WORDS = {
    "utilize": "use",
    "leverage": "use",
    "facilitate": "help",
    "optimize": "improve",
    "enhance": "improve",
    "comprehensive": "complete",
    "furthermore": "also",
    "moreover": "also",
    "additionally": "also",
    "subsequently": "then",
    "consequently": "so",
    "nevertheless": "but",
    "however": "but",
    "therefore": "so",
    "thus": "so",
    "hence": "so",
    "whereby": "where",
    "wherein": "where",
    "thereof": "of it",
    "thereby": "by this",
    "nonetheless": "still",
    "notwithstanding": "despite",
    "aforementioned": "mentioned",
    "equitable": "fair",
    "vulnerable": "at risk",
    "exacerbate": "worsen",
    "exacerbation": "worsening",
    "mitigate": "reduce",
    "paramount": "important",
    "imperative": "necessary",
    "pivotal": "key",
    "crucial": "important",
    "essential": "needed",
    "fundamental": "basic",
    "significant": "major",
    "substantial": "large",
    "numerous": "many",
    "various": "different",
    "diverse": "different",
    "multifaceted": "complex",
    "commenced": "started",
    "concluded": "ended",
    "subsequently": "then",
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
    "it is important to note": "",
    "it should be noted": "",
    "needless to say": "",
    "ensuing": "following",
    "escalating": "growing",
    "prudent": "wise",
    "depletes": "uses up",
    "erodes": "weakens",
    "evident": "clear",
    "accelerating": "speeding up"
};

// ==========================================================================
// APPLY BANNED WORD REPLACEMENTS
// ==========================================================================

function applyWordSwaps(text) {
    let result = text;
    for (const [bad, good] of Object.entries(BANNED_WORDS)) {
        const regex = new RegExp(`\\b${bad}\\b`, 'gi');
        result = result.replace(regex, good);
    }
    return result;
}

// ==========================================================================
// PATTERN DETECTION
// ==========================================================================

function detectProblems(sentence) {
    const problems = [];
    
    // Semicolons
    if (/;/.test(sentence)) {
        problems.push('semicolon');
    }
    
    // Colons (except in times like 10:30)
    if (/:\s*[a-zA-Z]/.test(sentence)) {
        problems.push('colon');
    }
    
    // "is not simply X, it is Y" / "not merely X, but Y"
    if (/not (simply|merely|just) .+[,;]\s*(it is|it's|but)/i.test(sentence)) {
        problems.push('not_simply_but');
    }
    
    // "isn't just X, it's Y" 
    if (/isn't just .+,\s*it's/i.test(sentence)) {
        problems.push('isnt_just_its');
    }
    
    // "is not simply X. It is Y" (split version)
    if (/is not (simply|merely|just)\b/i.test(sentence)) {
        problems.push('is_not_simply');
    }
    
    // "doesn't just X, it Y"
    if (/doesn't just .+,\s*it\b/i.test(sentence)) {
        problems.push('doesnt_just');
    }
    
    // "don't just X, they Y" / "do not simply X"
    if (/do(n't| not) (just|simply|merely)/i.test(sentence)) {
        problems.push('dont_just');
    }
    
    // Participle phrases
    if (/,\s*(forcing|creating|causing|making|pushing|leaving|turning|requiring|demanding|driving|sparking|straining|depleting|weakening|eroding|exacerbating|accelerating|transforming|amplifying)\s+/i.test(sentence)) {
        problems.push('participle');
    }
    
    // Em dashes
    if (/[—–]/.test(sentence)) {
        problems.push('em_dash');
    }
    
    // ", which" clauses
    if (/,\s*which\s+/i.test(sentence)) {
        problems.push('which_clause');
    }
    
    // "The choice/decision is not X, but Y"
    if (/(choice|decision|goal|point|question) is not .+,\s*(but|it is)/i.test(sentence)) {
        problems.push('choice_is_not');
    }
    
    // "To clarify," "To be clear," etc.
    if (/^(To clarify|To be clear|In other words|Put simply|Simply put|That is to say)[,:]/i.test(sentence)) {
        problems.push('clarify_phrase');
    }
    
    // "This is a critical issue:" type phrasing
    if (/This is a (critical|key|major|important|significant) (issue|point|matter|concern)[:]/i.test(sentence)) {
        problems.push('this_is_critical');
    }
    
    // "The true/real X lies in/is" 
    if (/The (true|real|actual|fundamental|core) .+ (lies|is) (not|in)/i.test(sentence)) {
        problems.push('true_x_lies');
    }
    
    return problems;
}

// ==========================================================================
// FIX SENTENCE WITH AI
// ==========================================================================

async function fixSentence(sentence, problems, apiKey, logs) {
    let instructions = [];
    
    if (problems.includes('semicolon')) {
        instructions.push('Replace semicolons with periods (make two sentences)');
    }
    if (problems.includes('colon')) {
        instructions.push('Replace colons with periods or rephrase');
    }
    if (problems.includes('not_simply_but') || problems.includes('is_not_simply')) {
        instructions.push('Remove "not simply/merely X, it is Y" - state the point directly');
    }
    if (problems.includes('isnt_just_its')) {
        instructions.push('Remove "isn\'t just X, it\'s Y" - split into two simple sentences');
    }
    if (problems.includes('doesnt_just') || problems.includes('dont_just')) {
        instructions.push('Remove "doesn\'t/don\'t just X" - use simpler direct statement');
    }
    if (problems.includes('participle')) {
        instructions.push('Remove participle phrase (", forcing/creating/pushing") - make it a separate sentence');
    }
    if (problems.includes('em_dash')) {
        instructions.push('Replace em dashes with periods');
    }
    if (problems.includes('which_clause')) {
        instructions.push('Remove ", which" - make separate sentence');
    }
    if (problems.includes('choice_is_not')) {
        instructions.push('Remove "The choice is not X, but Y" - state the choice directly');
    }
    if (problems.includes('clarify_phrase')) {
        instructions.push('Remove "To clarify/To be clear" - just state the point');
    }
    if (problems.includes('this_is_critical')) {
        instructions.push('Remove "This is a critical issue:" - just state what happens');
    }
    if (problems.includes('true_x_lies')) {
        instructions.push('Remove "The true X lies in" - state it directly');
    }
    
    const prompt = `Rewrite this sentence simply:

"${sentence}"

Fix these issues:
${instructions.join('\n')}

Rules:
- Use simple, direct language
- Split into multiple short sentences if needed
- No semicolons or colons
- No fancy transitions
- Output ONLY the rewritten text`;

    try {
        const response = await GroqAPI.chat(
            [{ role: "user", content: prompt }],
            apiKey,
            false
        );
        
        let fixed = typeof response === 'string' ? response : (response.content || response);
        fixed = fixed.trim().replace(/^["']|["']$/g, '');
        
        // Apply word swaps to the fix too
        fixed = applyWordSwaps(fixed);
        
        logs.push(`FIXED [${problems.join(',')}]: "${sentence.substring(0, 35)}..." → "${fixed.substring(0, 35)}..."`);
        return fixed;
    } catch (e) {
        logs.push(`ERROR: ${e.message}`);
        return sentence;
    }
}

// ==========================================================================
// FIX "IT'S/IT IS" STARTERS
// ==========================================================================

function fixRepeatedStarters(sentences, logs) {
    let itsCount = 0;
    let thisCount = 0;
    
    return sentences.map((s, i) => {
        // Handle "It is" / "It's"
        if (/^It('s| is)\s/i.test(s)) {
            itsCount++;
            if (itsCount > 1) {
                logs.push(`Varied "It is" #${itsCount}`);
                s = s.replace(/^It is a\s/i, 'This is a ');
                s = s.replace(/^It is the\s/i, 'This becomes the ');
                s = s.replace(/^It is\s/i, 'This ');
                s = s.replace(/^It's a\s/i, 'This is a ');
                s = s.replace(/^It's\s/i, 'This ');
            }
        }
        
        // Handle repeated "This"
        if (/^This\s/i.test(s)) {
            thisCount++;
            if (thisCount > 2) {
                logs.push(`Varied "This" #${thisCount}`);
                s = s.replace(/^This is\s/i, 'That is ');
                s = s.replace(/^This\s/i, 'That ');
            }
        }
        
        return s;
    });
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
        logs.push(`Applied ${Object.keys(BANNED_WORDS).length} word swaps`);
        
        // Step 2: Split into sentences
        const sentences = processed.match(/[^.!?]+[.!?]+/g) || [processed];
        logs.push(`Sentences: ${sentences.length}`);
        
        // Step 3: Detect problems
        const analysis = sentences.map((s, i) => ({
            index: i,
            original: s.trim(),
            problems: detectProblems(s)
        }));
        
        const problemSentences = analysis.filter(a => a.problems.length > 0);
        logs.push(`Problems: ${problemSentences.length} sentences need fixing`);
        
        problemSentences.forEach(ps => {
            logs.push(`  [${ps.index + 1}] ${ps.problems.join(', ')}`);
        });
        
        // Step 4: Fix problematic sentences
        const results = [];
        for (const item of analysis) {
            if (item.problems.length > 0) {
                const fixed = await fixSentence(item.original, item.problems, GROQ_KEY, logs);
                results.push(fixed);
            } else {
                results.push(item.original);
            }
        }
        
        // Step 5: Fix repeated starters
        const finalSentences = fixRepeatedStarters(results, logs);
        
        // Step 6: Join and final cleanup
        let finalText = finalSentences.join(' ')
            .replace(/\s{2,}/g, ' ')
            .replace(/[;]/g, '.')  // Catch any remaining semicolons
            .replace(/\.\./g, '.')
            .trim();
        
        logs.push(`Output: ${finalText.length} chars`);

        return res.status(200).json({
            success: true,
            result: finalText,
            stats: {
                totalSentences: sentences.length,
                fixedSentences: problemSentences.length,
                problems: problemSentences.map(ps => ({
                    index: ps.index + 1,
                    issues: ps.problems,
                    text: ps.original.substring(0, 50) + '...'
                }))
            },
            logs: logs
        });

    } catch (error) {
        logs.push(`ERROR: ${error.message}`);
        return res.status(500).json({ 
            success: false, 
            error: error.message,
            logs: logs 
        });
    }
}

// ==========================================================================
// EXPORTS
// ==========================================================================
export { detectProblems as PostProcessor, BANNED_WORDS as AI_VOCAB_SWAPS, applyWordSwaps as killEmDashes };
