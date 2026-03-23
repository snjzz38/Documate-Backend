// api/features/humanizer.js
// Sentence-by-sentence approach: only fix sentences with AI patterns
import { GroqAPI } from '../utils/groqAPI.js';

// ==========================================================================
// PATTERN DETECTION - Check if a sentence has problems
// ==========================================================================

function detectProblems(sentence) {
    const problems = [];
    
    // "isn't just X, it's Y" pattern
    if (/isn't just .+,\s*it's/i.test(sentence)) {
        problems.push('isnt_just_its');
    }
    
    // "doesn't just X, it Y" pattern
    if (/doesn't just .+,\s*it\b/i.test(sentence)) {
        problems.push('doesnt_just_it');
    }
    
    // "don't just X, they Y" pattern
    if (/don't just .+,\s*they/i.test(sentence)) {
        problems.push('dont_just_they');
    }
    
    // Participle phrases: ", forcing X", ", creating Y", etc.
    if (/,\s*(forcing|creating|causing|making|pushing|leaving|turning|requiring|demanding|driving|sparking|straining|depleting|weakening)\s+/i.test(sentence)) {
        problems.push('participle');
    }
    
    // Em dashes
    if (/[—–]|(\s-\s)/.test(sentence)) {
        problems.push('em_dash');
    }
    
    // ", which" clauses
    if (/,\s*which\s+/i.test(sentence)) {
        problems.push('which_clause');
    }
    
    // "The choice/decision isn't X, it's Y"
    if (/(choice|decision|goal|point) isn't .+,\s*it's/i.test(sentence)) {
        problems.push('choice_isnt_its');
    }
    
    return problems;
}

// ==========================================================================
// FIX A SINGLE SENTENCE
// ==========================================================================

async function fixSentence(sentence, problems, apiKey, logs) {
    let instructions = [];
    
    if (problems.includes('isnt_just_its')) {
        instructions.push('Remove "isn\'t just X, it\'s Y" - split into two ideas');
    }
    if (problems.includes('doesnt_just_it')) {
        instructions.push('Remove "doesn\'t just X, it Y" - use simpler phrasing');
    }
    if (problems.includes('dont_just_they')) {
        instructions.push('Remove "don\'t just X, they Y" - split into two sentences');
    }
    if (problems.includes('participle')) {
        instructions.push('Remove participle phrase (", forcing X" or ", creating Y") - make separate sentence');
    }
    if (problems.includes('em_dash')) {
        instructions.push('Replace em dashes with periods or commas');
    }
    if (problems.includes('which_clause')) {
        instructions.push('Remove ", which" clause - make separate sentence');
    }
    if (problems.includes('choice_isnt_its')) {
        instructions.push('Remove "choice isn\'t X, it\'s Y" - state choice directly');
    }
    
    const prompt = `Fix this sentence:

"${sentence}"

Instructions:
${instructions.join('\n')}

Rules:
- Keep same meaning
- May split into 2 sentences if needed
- Output ONLY the fixed text, nothing else`;

    try {
        const response = await GroqAPI.chat(
            [{ role: "user", content: prompt }],
            apiKey,
            false
        );
        
        let fixed = typeof response === 'string' ? response : (response.content || response);
        fixed = fixed.trim().replace(/^["']|["']$/g, '');
        
        logs.push(`FIXED: "${sentence.substring(0, 30)}..." → "${fixed.substring(0, 30)}..."`);
        return fixed;
    } catch (e) {
        logs.push(`ERROR fixing: ${e.message}`);
        return sentence;
    }
}

// ==========================================================================
// FIX MULTIPLE "IT'S" STARTERS (without AI)
// ==========================================================================

function fixItsStarters(sentences, logs) {
    let itsCount = 0;
    
    return sentences.map((s, i) => {
        if (/^It's\s/i.test(s)) {
            itsCount++;
            if (itsCount > 1) {
                logs.push(`Varied "It's" #${itsCount}: sentence ${i + 1}`);
                if (/^It's a\s/i.test(s)) return s.replace(/^It's a\s/i, 'This is a ');
                if (/^It's the\s/i.test(s)) return s.replace(/^It's the\s/i, 'This becomes the ');
                if (/^It's about\s/i.test(s)) return s.replace(/^It's about\s/i, 'This concerns ');
                return s.replace(/^It's\s/i, 'This ');
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
        
        // Step 1: Split into sentences
        const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
        logs.push(`Sentences: ${sentences.length}`);
        
        // Step 2: Detect problems in each sentence
        const analysis = sentences.map((s, i) => ({
            index: i,
            original: s.trim(),
            problems: detectProblems(s)
        }));
        
        const problemSentences = analysis.filter(a => a.problems.length > 0);
        logs.push(`Problems found: ${problemSentences.length} sentences`);
        
        problemSentences.forEach(ps => {
            logs.push(`  [${ps.index + 1}] ${ps.problems.join(', ')}: "${ps.original.substring(0, 40)}..."`);
        });
        
        // Step 3: Fix only problematic sentences (one by one)
        const results = [];
        for (const item of analysis) {
            if (item.problems.length > 0) {
                const fixed = await fixSentence(item.original, item.problems, GROQ_KEY, logs);
                results.push(fixed);
            } else {
                results.push(item.original);
            }
        }
        
        // Step 4: Fix multiple "It's" starters
        const finalSentences = fixItsStarters(results, logs);
        
        // Step 5: Join and clean
        let finalText = finalSentences.join(' ').replace(/\s{2,}/g, ' ').trim();
        
        logs.push(`Output: ${finalText.length} chars`);

        return res.status(200).json({
            success: true,
            result: finalText,
            stats: {
                totalSentences: sentences.length,
                fixedSentences: problemSentences.length,
                problems: problemSentences.map(ps => ({
                    sentence: ps.original.substring(0, 50) + '...',
                    issues: ps.problems
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
// EXPORTS (for agent.js compatibility)
// ==========================================================================
const SIMPLE_SWAPS = {
    "utilize": "use", "leverage": "use", "furthermore": "also",
    "moreover": "and", "additionally": "also", "consequently": "so"
};

function killEmDashes(text) {
    return text.replace(/[—–]/g, ', ').replace(/\s-\s/g, ', ');
}

export { detectProblems as PostProcessor, SIMPLE_SWAPS as AI_VOCAB_SWAPS, killEmDashes };
