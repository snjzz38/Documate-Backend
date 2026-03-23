// api/features/humanizer.js
import { GroqAPI } from '../utils/groqAPI.js';

// ==========================================================================
// CONSTANTS
// ==========================================================================

const SIMPLE_SWAPS = {
    "utilize": "use", "leverage": "use", "facilitate": "help",
    "optimize": "improve", "enhance": "improve", "comprehensive": "full",
    "furthermore": "also", "moreover": "and", "additionally": "also",
    "subsequently": "then", "consequently": "so", "nevertheless": "but"
};

// ==========================================================================
// UTILITY FUNCTIONS
// ==========================================================================

function killEmDashes(text) {
    return text
        .replace(/\u2014/g, ', ')
        .replace(/\u2013/g, ', ')
        .replace(/—/g, ', ')
        .replace(/–/g, ', ')
        .replace(/ - /g, ', ')
        .replace(/,\s*,/g, ',')
        .replace(/\s{2,}/g, ' ')
        .trim();
}

function cleanOutput(text) {
    let cleaned = text;
    cleaned = cleaned.replace(/^(Here's|Here is|Below is|Sure|I've rewritten|Rewritten)[^:.\n]*[:.]\s*/gi, '');
    cleaned = cleaned.replace(/^["']|["']$/g, '');
    return cleaned.trim();
}

// ==========================================================================
// CORE FIX FUNCTION - All pattern fixes in one place
// ==========================================================================

function fixAIPatterns(text, logs) {
    let result = text;
    let fixCount = 0;
    
    // Fix 1: "isn't just X, it's Y" 
    const before1 = result;
    result = result.replace(/isn't just ([^,]+),\s*it's ([^\.]+)\./gi, (m, x, y) => {
        logs.push(`Fixed "isn't just" pattern: ${m.substring(0, 50)}...`);
        return `goes beyond ${x.trim()} and actually ${y.trim()}.`;
    });
    if (before1 !== result) fixCount++;
    
    // Fix 2: "doesn't just X, it Y"
    const before2 = result;
    result = result.replace(/doesn't just ([^,]+),\s*it ([^\.]+)\./gi, (m, x, y) => {
        logs.push(`Fixed "doesn't just" pattern: ${m.substring(0, 50)}...`);
        return `does more than ${x.trim()} and ${y.trim()}.`;
    });
    if (before2 !== result) fixCount++;
    
    // Fix 3: "don't just X, they Y"
    const before3 = result;
    result = result.replace(/don't just ([^,]+),\s*they ([^\.]+)\./gi, (m, x, y) => {
        logs.push(`Fixed "don't just" pattern: ${m.substring(0, 50)}...`);
        return `do more than ${x.trim()} and ${y.trim()}.`;
    });
    if (before3 !== result) fixCount++;
    
    // Fix 4: "The choice/decision isn't X. It's Y" (split across sentences)
    const before4 = result;
    result = result.replace(/The (choice|decision) isn't ([^\.]+)\.\s*(It's|The real choice is) ([^\.]+)\./gi, (m, noun, x, _, y) => {
        logs.push(`Fixed split contrast pattern: ${m.substring(0, 50)}...`);
        return `The real ${noun} is ${y.trim()}, not ${x.trim()}.`;
    });
    if (before4 !== result) fixCount++;
    
    // Fix 5: Participle chains ", forcing/creating/pushing X"
    const participles = ['forcing', 'creating', 'causing', 'making', 'pushing', 'leaving', 'turning', 'requiring'];
    for (const p of participles) {
        const before = result;
        const regex = new RegExp(`,\\s*${p}\\s+([^,\\.]+)([\\.,])`, 'gi');
        result = result.replace(regex, (m, captured, punct) => {
            logs.push(`Fixed participle "${p}": ${m.substring(0, 40)}...`);
            const verb = p.replace(/ing$/, '');
            const present = verb.endsWith('e') ? verb + 's' : verb + 'es';
            return `. This ${present} ${captured.trim()}${punct}`;
        });
        if (before !== result) fixCount++;
    }
    
    // Fix 6: Multiple "It's" at start - vary them
    const sentences = result.split(/(?<=[.!?])\s+/);
    let itsCount = 0;
    const varied = sentences.map(s => {
        if (/^It's\s/i.test(s)) {
            itsCount++;
            if (itsCount > 1) {
                logs.push(`Varied "It's" starter #${itsCount}: ${s.substring(0, 30)}...`);
                if (/^It's a\s/i.test(s)) return s.replace(/^It's a\s/i, 'This is a ');
                if (/^It's the\s/i.test(s)) return s.replace(/^It's the\s/i, 'This represents the ');
                if (/^It's risking/i.test(s)) return s.replace(/^It's risking/i, 'This risks');
                return s.replace(/^It's\s/i, 'This is ');
            }
        }
        return s;
    });
    result = varied.join(' ');
    
    // Clean up
    result = result.replace(/\.\./g, '.');
    result = result.replace(/\s{2,}/g, ' ');
    
    logs.push(`Total pattern fixes applied: ${fixCount}`);
    
    return result;
}

// ==========================================================================
// HUMANIZATION PROMPT
// ==========================================================================

function buildPrompt(content) {
    return `Rewrite this text to sound human-written.

STRICT RULES - DO NOT USE:
1. "isn't just X, it's Y" - BANNED
2. "doesn't just X, it Y" - BANNED  
3. "don't just X, they Y" - BANNED
4. Participle phrases like ", forcing X", ", creating Y" - BANNED
5. Starting multiple sentences with "It's" - BANNED
6. "The choice isn't X. It's Y." - BANNED

WRITE LIKE THIS INSTEAD:
- Short clear sentences
- Use "and", "but", "so", "because"
- Start sentences with different words
- Break complex ideas into separate sentences

TEXT TO REWRITE:
"${content}"

Rewrite naturally:`;
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
        const { text, apiKey, model } = req.body;
        const GROQ_KEY = apiKey || process.env.GROQ_API_KEY;
        const selectedModel = model || null;
        
        logs.push(`Request received, text length: ${text?.length || 0}`);
        logs.push(`Requested model: ${selectedModel || 'default'}`);
        
        if (!text) throw new Error("No text provided.");
        if (text.length < 10) throw new Error("Text too short.");

        // Step 1: Call Groq to humanize
        logs.push('Step 1: Sending to Groq for humanization...');
        const prompt = buildPrompt(text.substring(0, 15000));
        const messages = [{ role: "user", content: prompt }];
        
        const groqResponse = await GroqAPI.chat(messages, GROQ_KEY, false, selectedModel);
        
        // Handle both string and object responses
        let humanized, usedModel;
        if (typeof groqResponse === 'string') {
            humanized = groqResponse;
            usedModel = 'unknown';
        } else {
            humanized = groqResponse.content || groqResponse;
            usedModel = groqResponse.model || 'unknown';
        }
        
        logs.push(`Groq responded with model: ${usedModel}`);
        logs.push(`Raw response (first 150 chars): ${humanized.substring(0, 150)}...`);
        
        // Step 2: Clean output
        logs.push('Step 2: Cleaning output...');
        let result = cleanOutput(humanized);
        result = killEmDashes(result);
        
        // Apply simple word swaps
        for (const [bad, good] of Object.entries(SIMPLE_SWAPS)) {
            result = result.replace(new RegExp(`\\b${bad}\\b`, 'gi'), good);
        }
        
        logs.push(`After cleaning (first 150 chars): ${result.substring(0, 150)}...`);
        
        // Step 3: Apply pattern fixes
        logs.push('Step 3: Applying AI pattern fixes...');
        const beforeFixes = result;
        result = fixAIPatterns(result, logs);
        
        const changesApplied = (beforeFixes !== result);
        logs.push(`Pattern fixes changed text: ${changesApplied}`);
        
        // Final cleanup
        result = result.replace(/\s{2,}/g, ' ').trim();
        
        logs.push(`Final result (first 200 chars): ${result.substring(0, 200)}...`);

        return res.status(200).json({
            success: true,
            result: result,
            model: usedModel,
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
export { fixAIPatterns as PostProcessor, SIMPLE_SWAPS as AI_VOCAB_SWAPS, killEmDashes };
