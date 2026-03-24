// api/features/humanizer.js
// Strategy: Inject human imperfections - the AI keeps sounding too polished
import { GroqAPI } from '../utils/groqAPI.js';

// ==========================================================================
// MAIN HANDLER - Single prompt approach with strong humanization instructions
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
        
        const prompt = `Rewrite this text so it sounds like a real human wrote it, not AI.

ORIGINAL TEXT:
"${text}"

CRITICAL RULES - You MUST follow these:

1. VARY SENTENCE LENGTH DRAMATICALLY:
   - Include some very short sentences (3-5 words): "That's the problem." "It gets worse."
   - Include some medium sentences (10-15 words)
   - Include 1-2 longer sentences (20+ words) with natural flow

2. USE CONTRACTIONS:
   - "it is" → "it's"
   - "does not" → "doesn't"  
   - "that is" → "that's"
   - "we are" → "we're"

3. ADD HUMAN TOUCHES:
   - Start one sentence with "And" or "But"
   - Use "really" or "actually" once
   - Include one rhetorical question like "What happens then?" or "And what about...?"
   - Use "a lot" instead of "significantly" 
   - Use "get" or "got" somewhere

4. AVOID THESE AI PATTERNS:
   - No semicolons
   - No "This [verb]s" sentence starters (like "This strains", "This creates")
   - No ", which" clauses
   - No "furthermore", "moreover", "consequently"
   - No "it is important to note"
   - No perfect parallel structures

5. MAKE IT SLIGHTLY MESSY:
   - Don't make every sentence grammatically perfect
   - Let some ideas flow into each other naturally
   - It's okay to repeat a word occasionally

6. SOUND LIKE YOU'RE EXPLAINING TO A FRIEND:
   - Less formal, more conversational
   - Like you're talking, not writing an essay

EXAMPLE OF GOOD HUMAN WRITING:
"Climate change isn't just about polar bears anymore. It's become a security issue, and honestly? It's getting worse fast. When droughts hit, crops fail. People lose everything and have to move somewhere else. That puts pressure on other countries who weren't expecting millions of refugees showing up. And we're not doing nearly enough about it."

NOW REWRITE THE TEXT. Output ONLY the rewritten text, nothing else.`;

        logs.push('Sending to Groq with humanization prompt...');
        
        const response = await GroqAPI.chat([{ role: "user", content: prompt }], GROQ_KEY, false);
        let result = typeof response === 'string' ? response : (response.content || response);
        result = result.trim().replace(/^["']|["']$/g, '');
        
        logs.push(`Raw response (first 200 chars): ${result.substring(0, 200)}...`);
        
        // Post-processing: catch any remaining AI patterns
        result = postProcess(result, logs);
        
        logs.push(`Final output: ${result.length} chars`);

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
// POST-PROCESSING - Catch patterns the AI ignores
// ==========================================================================

function postProcess(text, logs) {
    let result = text;
    let changes = 0;
    
    // Remove semicolons
    if (/;/.test(result)) {
        result = result.replace(/;/g, '.');
        changes++;
        logs.push('Removed semicolons');
    }
    
    // Remove em dashes
    if (/[—–]/.test(result)) {
        result = result.replace(/[—–]/g, ',');
        changes++;
        logs.push('Removed em dashes');
    }
    
    // Fix "This strains/creates/causes" patterns
    result = result.replace(/\bThis (strains|creates|causes|leads|results|forces|pushes|makes|turns)\b/gi, (m, verb) => {
        changes++;
        logs.push(`Fixed "This ${verb}"`);
        return `That ${verb}`;
    });
    
    // Fix formal transitions
    const transitions = ['furthermore', 'moreover', 'consequently', 'thus', 'hence', 'therefore', 'additionally'];
    for (const t of transitions) {
        const regex = new RegExp(`\\b${t}\\b[,]?`, 'gi');
        if (regex.test(result)) {
            result = result.replace(regex, '');
            changes++;
            logs.push(`Removed "${t}"`);
        }
    }
    
    // Fix ", which" clauses - break into separate sentences
    if (/,\s*which\s+/i.test(result)) {
        result = result.replace(/,\s*which\s+(\w+)/gi, '. That $1');
        changes++;
        logs.push('Fixed ", which" clauses');
    }
    
    // Fix "is not" → "isn't" etc
    result = result.replace(/\bis not\b/gi, "isn't");
    result = result.replace(/\bare not\b/gi, "aren't");
    result = result.replace(/\bdoes not\b/gi, "doesn't");
    result = result.replace(/\bdo not\b/gi, "don't");
    result = result.replace(/\bcannot\b/gi, "can't");
    result = result.replace(/\bwill not\b/gi, "won't");
    result = result.replace(/\bIt is\b/g, "It's");
    result = result.replace(/\bThat is\b/g, "That's");
    
    // Fix "not X, but Y" patterns
    result = result.replace(/not (.+),\s*but rather\b/gi, '$1, though also');
    result = result.replace(/\brather than\b/gi, 'instead of');
    
    // Clean up
    result = result.replace(/\.\./g, '.');
    result = result.replace(/\s{2,}/g, ' ');
    result = result.trim();
    
    logs.push(`Post-processing made ${changes} changes`);
    
    return result;
}

// ==========================================================================
// EXPORTS
// ==========================================================================
export { postProcess as PostProcessor };
