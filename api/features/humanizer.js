// api/features/humanizer.js
// Strategy: Fix AI patterns while maintaining natural sentence variety
import { GroqAPI } from '../utils/groqAPI.js';

// ==========================================================================
// BANNED WORDS
// ==========================================================================

const BANNED_WORDS = {
    "utilize": "use", "leverage": "use", "facilitate": "help",
    "optimize": "improve", "enhance": "improve", "furthermore": "also",
    "moreover": "also", "additionally": "also", "consequently": "so",
    "nevertheless": "but", "therefore": "so", "thus": "so",
    "equitable": "fair", "vulnerable": "at risk", "exacerbate": "make worse",
    "mitigate": "reduce", "paramount": "important", "imperative": "necessary",
    "pivotal": "key", "crucial": "important", "essential": "needed",
    "significant": "big", "substantial": "large", "numerous": "many",
    "commenced": "started", "concluded": "ended", "prior to": "before",
    "in order to": "to", "due to the fact that": "because",
    "ensuing": "following", "escalating": "growing", "prudent": "smart",
    "depletes": "uses up", "erodes": "weakens", "evident": "clear",
    "accelerating": "speeding up", "exacerbation": "worsening",
    "amplifies": "makes worse", "transforms": "turns"
};

function applyWordSwaps(text) {
    let result = text;
    for (const [bad, good] of Object.entries(BANNED_WORDS)) {
        result = result.replace(new RegExp(`\\b${bad}\\b`, 'gi'), good);
    }
    return result;
}

// ==========================================================================
// DETECT STRUCTURAL PROBLEMS
// ==========================================================================

function detectProblems(sentence) {
    const problems = [];
    
    // Punctuation issues
    if (/;/.test(sentence)) problems.push('semicolon');
    if (/:\s*[a-zA-Z]/.test(sentence)) problems.push('colon');
    if (/[—–]/.test(sentence)) problems.push('em_dash');
    
    // "not simply/merely/just X, it is Y" patterns
    if (/not (simply|merely|just) .+[,;]\s*(it is|it's|but)/i.test(sentence)) {
        problems.push('contrast_pattern');
    }
    if (/is not (simply|merely|just)\b/i.test(sentence)) {
        problems.push('is_not_simply');
    }
    if (/isn't (just|simply|merely) .+,\s*it's/i.test(sentence)) {
        problems.push('isnt_just');
    }
    if (/(doesn't|don't|does not|do not) (just|simply|merely)/i.test(sentence)) {
        problems.push('doesnt_just');
    }
    
    // "The choice is not X, but Y"
    if (/(choice|decision|question) is not .+,\s*but\b/i.test(sentence)) {
        problems.push('choice_not_but');
    }
    
    // Participle chains
    if (/,\s*(forcing|creating|causing|making|pushing|leaving|turning|requiring|demanding|driving|sparking|straining|transforming|amplifying)\s+/i.test(sentence)) {
        problems.push('participle');
    }
    
    // ", which" clauses
    if (/,\s*which\s+/i.test(sentence)) {
        problems.push('which_clause');
    }
    
    // Filler phrases
    if (/^(To clarify|To be clear|In other words|Put simply|That is to say|It should be noted|It is important)[,:]/i.test(sentence)) {
        problems.push('filler_phrase');
    }
    
    // "This is a critical/key issue" 
    if (/This is a (critical|key|major|important) (issue|point|matter)/i.test(sentence)) {
        problems.push('this_is_critical');
    }
    
    // "The true/real/main X lies/is/comes from"
    if (/The (true|real|actual|core|main|primary) .+ (lies|is|comes from)\b/i.test(sentence)) {
        problems.push('true_x_pattern');
    }
    
    // "This isn't about X" at start
    if (/^This isn't about/i.test(sentence)) {
        problems.push('this_isnt_about');
    }
    
    // Parallel structure: "X into Y and A into B"
    if (/\w+ (into|to|from) \w+ and \w+ (into|to|from) \w+/i.test(sentence)) {
        problems.push('parallel_structure');
    }
    
    // Dramatic phrases
    if (/(unfolding|playing out|happening) (before our eyes|in plain sight|right now)/i.test(sentence)) {
        problems.push('dramatic_phrase');
    }
    
    return problems;
}

// ==========================================================================
// FIX INDIVIDUAL SENTENCE
// ==========================================================================

async function fixSentence(sentence, problems, apiKey, logs) {
    let instructions = [];
    
    if (problems.includes('semicolon')) {
        instructions.push('Split at semicolon into two sentences');
    }
    if (problems.includes('colon')) {
        instructions.push('Remove colon, rephrase naturally');
    }
    if (problems.includes('em_dash')) {
        instructions.push('Replace em dash with period or comma');
    }
    if (problems.includes('contrast_pattern') || problems.includes('is_not_simply') || problems.includes('isnt_just')) {
        instructions.push('Remove the "not simply X, it is Y" contrast. Just state the main point.');
    }
    if (problems.includes('choice_not_but')) {
        instructions.push('Remove "The choice is not X, but Y" - just state what we should choose');
    }
    if (problems.includes('doesnt_just')) {
        instructions.push('Remove "doesn\'t/don\'t just" - state directly what happens');
    }
    if (problems.includes('participle')) {
        instructions.push('Remove participle phrase (like ", pushing X"). Make it a separate sentence.');
    }
    if (problems.includes('which_clause')) {
        instructions.push('Remove ", which" clause. Make it a separate sentence.');
    }
    if (problems.includes('filler_phrase')) {
        instructions.push('Remove "To clarify" or similar filler. Just state the point.');
    }
    if (problems.includes('this_is_critical')) {
        instructions.push('Remove "This is a critical issue" - just describe what happens');
    }
    if (problems.includes('true_x_pattern')) {
        instructions.push('Remove "The main/true danger comes from" - state the danger directly');
    }
    if (problems.includes('this_isnt_about')) {
        instructions.push('Rephrase "This isn\'t about X" to state what it IS about');
    }
    if (problems.includes('parallel_structure')) {
        instructions.push('Break up the parallel "X into Y and A into B" - make two separate statements');
    }
    if (problems.includes('dramatic_phrase')) {
        instructions.push('Remove dramatic phrasing like "unfolding in plain sight" - be more direct');
    }
    
    const prompt = `Rewrite this sentence naturally:

"${sentence}"

Changes needed:
${instructions.join('\n')}

Important: Write like a human would. Vary your phrasing. Output ONLY the rewritten text.`;

    try {
        const response = await GroqAPI.chat([{ role: "user", content: prompt }], apiKey, false);
        let fixed = typeof response === 'string' ? response : (response.content || response);
        fixed = fixed.trim().replace(/^["']|["']$/g, '');
        fixed = applyWordSwaps(fixed);
        
        logs.push(`FIXED: "${sentence.substring(0, 30)}..." → "${fixed.substring(0, 30)}..."`);
        return fixed;
    } catch (e) {
        logs.push(`ERROR: ${e.message}`);
        return sentence;
    }
}

// ==========================================================================
// ANALYZE SENTENCE LENGTH PATTERNS
// ==========================================================================

function analyzeFlow(sentences) {
    // Check if too many short sentences in a row
    const lengths = sentences.map(s => s.split(/\s+/).length);
    const issues = [];
    
    let shortStreak = 0;
    for (let i = 0; i < lengths.length; i++) {
        if (lengths[i] < 8) {
            shortStreak++;
            if (shortStreak >= 3) {
                issues.push({ index: i, type: 'too_many_short' });
            }
        } else {
            shortStreak = 0;
        }
    }
    
    return issues;
}

// ==========================================================================
// COMBINE SHORT SENTENCES
// ==========================================================================

async function combineShortSentences(sentences, apiKey, logs) {
    const flowIssues = analyzeFlow(sentences);
    
    if (flowIssues.length === 0) {
        return sentences;
    }
    
    logs.push(`Found ${flowIssues.length} choppy sections to smooth out`);
    
    // Find runs of short sentences and combine them
    const result = [...sentences];
    const processed = new Set();
    
    for (const issue of flowIssues) {
        const idx = issue.index;
        if (processed.has(idx) || processed.has(idx - 1) || processed.has(idx - 2)) continue;
        
        // Get 2-3 short sentences to combine
        const start = Math.max(0, idx - 2);
        const toMerge = sentences.slice(start, idx + 1).filter(s => s.split(/\s+/).length < 10);
        
        if (toMerge.length >= 2) {
            const combined = toMerge.join(' ');
            
            const prompt = `Combine these choppy sentences into one or two flowing sentences:

"${combined}"

Rules:
- Keep all the information
- Make it flow naturally
- Use "and", "but", "because", "when" to connect ideas
- Output ONLY the rewritten text`;

            try {
                const response = await GroqAPI.chat([{ role: "user", content: prompt }], apiKey, false);
                let fixed = typeof response === 'string' ? response : (response.content || response);
                fixed = fixed.trim().replace(/^["']|["']$/g, '');
                fixed = applyWordSwaps(fixed);
                
                // Replace the sentences
                result[start] = fixed;
                for (let i = start + 1; i <= idx && i < result.length; i++) {
                    if (toMerge.includes(sentences[i])) {
                        result[i] = ''; // Mark for removal
                        processed.add(i);
                    }
                }
                processed.add(start);
                
                logs.push(`COMBINED ${toMerge.length} sentences at position ${start}`);
            } catch (e) {
                logs.push(`Error combining: ${e.message}`);
            }
        }
    }
    
    return result.filter(s => s.length > 0);
}

// ==========================================================================
// FIX REPEATED STARTERS
// ==========================================================================

function fixRepeatedStarters(sentences, logs) {
    let counts = { 'It': 0, 'This': 0, 'The': 0, 'They': 0, 'We': 0 };
    
    return sentences.map((s, i) => {
        for (const starter of Object.keys(counts)) {
            const regex = new RegExp(`^${starter}\\s`, 'i');
            if (regex.test(s)) {
                counts[starter]++;
                if (counts[starter] > 2) {
                    logs.push(`Varied "${starter}" starter #${counts[starter]}`);
                    // Simple variations
                    if (starter === 'This') {
                        return s.replace(/^This\s/i, 'That ');
                    }
                    if (starter === 'It') {
                        return s.replace(/^It is\s/i, 'That is ').replace(/^It\s/i, 'That ');
                    }
                    if (starter === 'The') {
                        return s.replace(/^The\s/i, 'A ');
                    }
                }
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
        
        // Step 1: Word swaps
        let processed = applyWordSwaps(text);
        
        // Step 2: Split sentences
        let sentences = processed.match(/[^.!?]+[.!?]+/g) || [processed];
        sentences = sentences.map(s => s.trim());
        logs.push(`Sentences: ${sentences.length}`);
        
        // Step 3: Detect and fix AI patterns
        const analysis = sentences.map((s, i) => ({
            index: i,
            original: s,
            problems: detectProblems(s)
        }));
        
        const problemCount = analysis.filter(a => a.problems.length > 0).length;
        logs.push(`Sentences with AI patterns: ${problemCount}`);
        
        const fixed = [];
        for (const item of analysis) {
            if (item.problems.length > 0) {
                logs.push(`[${item.index + 1}] Problems: ${item.problems.join(', ')}`);
                const result = await fixSentence(item.original, item.problems, GROQ_KEY, logs);
                fixed.push(result);
            } else {
                fixed.push(item.original);
            }
        }
        
        // Step 4: Combine choppy sentences for better flow
        logs.push('Checking sentence flow...');
        const smoothed = await combineShortSentences(fixed, GROQ_KEY, logs);
        
        // Step 5: Fix repeated starters
        const varied = fixRepeatedStarters(smoothed, logs);
        
        // Step 6: Final assembly
        let finalText = varied.join(' ')
            .replace(/\s{2,}/g, ' ')
            .replace(/[;]/g, '.')
            .replace(/\.\./g, '.')
            .trim();
        
        logs.push(`Output: ${finalText.length} chars`);

        return res.status(200).json({
            success: true,
            result: finalText,
            stats: {
                inputSentences: sentences.length,
                outputSentences: varied.length,
                patternsFixed: problemCount,
                sentencesCombined: sentences.length - varied.length
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
export { detectProblems as PostProcessor, BANNED_WORDS as AI_VOCAB_SWAPS, applyWordSwaps as killEmDashes };
