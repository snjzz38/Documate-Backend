// api/features/humanizer.js
// Uses AI proofreader to detect and fix AI patterns dynamically
import { GroqAPI } from '../utils/groqAPI.js';

// ==========================================================================
// CONSTANTS
// ==========================================================================

const SIMPLE_SWAPS = {
    "utilize": "use", "leverage": "use", "facilitate": "help",
    "optimize": "improve", "enhance": "improve", "comprehensive": "full",
    "furthermore": "also", "moreover": "and", "additionally": "also",
    "subsequently": "then", "consequently": "so", "nevertheless": "but",
    "demonstrate": "show", "significant": "major", "numerous": "many",
    "prior to": "before", "in order to": "to", "due to the fact that": "because"
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

function applySwaps(text) {
    let result = text;
    for (const [bad, good] of Object.entries(SIMPLE_SWAPS)) {
        result = result.replace(new RegExp(`\\b${bad}\\b`, 'gi'), good);
    }
    return result;
}

function cleanOutput(text) {
    let cleaned = text;
    cleaned = cleaned.replace(/^(Here's|Here is|Below is|Sure|I've rewritten|Rewritten)[^:.\n]*[:.]\s*/gi, '');
    cleaned = cleaned.replace(/^["']|["']$/g, '');
    return cleaned.trim();
}

// ==========================================================================
// SECTION DETECTION
// ==========================================================================

function detectSections(text) {
    const lines = text.split('\n');
    const sections = [];
    let currentSection = { title: '', content: [] };
    
    for (const line of lines) {
        const trimmed = line.trim();
        const isHeader = /^#{1,3}\s+/.test(trimmed) || 
                        (/^[A-Z][^.!?]*$/.test(trimmed) && trimmed.length < 60 && trimmed.length > 3) ||
                        /^(Introduction|Conclusion|Summary|Background|Causes?|Effects?|Impacts?|Solutions?)/i.test(trimmed);
        
        if (isHeader && trimmed.length > 0) {
            if (currentSection.content.length > 0) {
                sections.push({ title: currentSection.title, content: currentSection.content.join(' ').trim() });
            }
            currentSection = { title: trimmed.replace(/^#+\s*/, ''), content: [] };
        } else if (trimmed.length > 0) {
            currentSection.content.push(trimmed);
        }
    }
    
    if (currentSection.content.length > 0) {
        sections.push({ title: currentSection.title, content: currentSection.content.join(' ').trim() });
    }
    
    return sections.length > 0 ? sections : [{ title: '', content: text.trim() }];
}

// ==========================================================================
// HUMANIZATION PROMPT - STRICT
// ==========================================================================

function buildHumanizePrompt(section, index, totalSections) {
    const position = index === 0 ? 'OPENING' : index === totalSections - 1 ? 'CLOSING' : 'MIDDLE';

    return `Rewrite this ${position} section to sound human-written.

ABSOLUTE BANS - YOU MUST NOT USE:
1. "isn't just X, it's Y" - BANNED in any form
2. "doesn't just X, it Y" - BANNED  
3. "don't just X, they Y" - BANNED
4. Participle phrases: ", forcing X", ", creating Y", ", pushing Z", ", turning X" - ALL BANNED
5. Starting sentences with "It's" more than ONCE - BANNED
6. "The goal/decision isn't X. It's Y" - BANNED
7. ", which" clauses - BANNED

HOW TO WRITE INSTEAD:
- Short direct sentences: "Climate change is a security threat."
- Simple connectors: "Droughts destroy crops and people leave."
- "because" and "when": "When crops fail, people migrate."
- Start with subjects: "Rising temperatures cause droughts."
- Break long sentences into two shorter ones.

GOOD:
"Climate change threatens global security. Rising temperatures cause droughts and destroy crops. People lose their livelihoods and have to move somewhere else. This puts pressure on neighboring countries."

BAD (never write like this):
"Climate change isn't just environmental, it's a security crisis, forcing communities to compete, creating tensions, and pushing societies toward collapse."

TEXT:
"${section.content}"

Rewrite following the rules:`;}

// ==========================================================================
// AI PROOFREADER - With detailed logging
// ==========================================================================

async function proofreadForAIPatterns(text, apiKey) {
    const prompt = `You are an AI detection expert. Find sentences with AI patterns and rewrite them.

TEXT:
"${text}"

PATTERNS TO FIND AND FIX:
1. "isn't just X, it's Y" - any variation
2. "doesn't just X, it Y" or "don't just X, they Y"
3. Participle phrases: ", forcing X", ", creating Y", ", pushing Z", ", turning X"
4. "The goal/decision isn't X. It's Y."
5. Multiple "It's" sentence starters
6. ", which" clauses

RESPOND WITH ONLY JSON:
{
  "fixes": [
    {"original": "exact sentence", "fixed": "rewrite"}
  ]
}

Return {"fixes": []} if no issues found.`;

    const messages = [{ role: "user", content: prompt }];
    
    try {
        const response = await GroqAPI.chat(messages, apiKey, false);
        
        // LOG THE RAW RESPONSE
        console.log('[Proofreader] Raw AI response:');
        console.log('---START---');
        console.log(response);
        console.log('---END---');
        
        // Extract JSON from response
        let jsonStr = response.trim();
        
        // Handle markdown code blocks
        const codeMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (codeMatch) {
            jsonStr = codeMatch[1].trim();
            console.log('[Proofreader] Extracted from code block');
        }
        
        // Find JSON object
        const objMatch = jsonStr.match(/\{[\s\S]*\}/);
        if (objMatch) {
            jsonStr = objMatch[0];
        }
        
        console.log('[Proofreader] Parsing JSON:', jsonStr.substring(0, 200) + '...');
        
        const parsed = JSON.parse(jsonStr);
        console.log(`[Proofreader] Found ${parsed.fixes?.length || 0} fixes:`);
        if (parsed.fixes) {
            parsed.fixes.forEach((f, i) => {
                console.log(`  Fix ${i + 1}: "${f.original?.substring(0, 50)}..." -> "${f.fixed?.substring(0, 50)}..."`);
            });
        }
        
        return parsed.fixes || [];
        
    } catch (e) {
        console.error('[Proofreader] Parse error:', e.message);
        console.error('[Proofreader] This usually means the AI did not return valid JSON');
        return [];
    }
}

function applyFixes(text, fixes) {
    let result = text;
    
    for (const fix of fixes) {
        if (fix.original && fix.fixed && fix.original.length > 10) {
            // Escape special regex chars
            const escaped = fix.original.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            try {
                const regex = new RegExp(escaped, 'gi');
                result = result.replace(regex, fix.fixed);
            } catch (e) {
                // If regex fails, try direct replacement
                result = result.split(fix.original).join(fix.fixed);
            }
        }
    }
    
    return result;
}

// ==========================================================================
// BASIC POST-PROCESSING
// ==========================================================================

function postProcess(text, sectionTitle) {
    let result = cleanOutput(text);
    result = killEmDashes(result);
    result = applySwaps(result);
    result = result.replace(/\s{2,}/g, ' ').trim();
    
    if (sectionTitle) {
        result = sectionTitle + '\n' + result;
    }
    
    return result;
}

// ==========================================================================
// FALLBACK REGEX FIXES - For patterns that always slip through
// ==========================================================================

function applyFallbackFixes(text) {
    let result = text;
    
    // Pattern 1: "isn't just X, it's Y" - all variations
    result = result.replace(/isn't just ([^,]+),\s*it's ([^\.]+)\./gi, (_, x, y) => {
        return `goes beyond ${x.trim()}. ${y.trim().charAt(0).toUpperCase() + y.trim().slice(1)}.`;
    });
    
    // Pattern 2: "doesn't just X, it Y"
    result = result.replace(/doesn't just ([^,]+),\s*it ([^\.]+)\./gi, (_, x, y) => {
        return `does more than ${x.trim()}. It also ${y.trim()}.`;
    });
    
    // Pattern 3: "don't just X, they Y"
    result = result.replace(/don't just ([^,]+),\s*they ([^\.]+)\./gi, (_, x, y) => {
        return `do more than ${x.trim()}. They ${y.trim()}.`;
    });
    
    // Pattern 4: Split contrast "X isn't about Y. It's about Z"
    result = result.replace(/The (decision|choice|question|goal|point) isn't about ([^\.]+)\.\s*It's about ([^\.]+)\./gi, (_, noun, y, z) => {
        return `The ${noun} comes down to ${z.trim()}, not ${y.trim()}.`;
    });
    
    // Pattern 5: "isn't about X or Y. It's about Z"  
    result = result.replace(/isn't about ([^\.]+)\.\s*It's about ([^\.]+)\./gi, (_, x, y) => {
        return `is really about ${y.trim()}.`;
    });
    
    // Pattern 6: Participle chains ", forcing/creating/pushing X"
    const participles = ['forcing', 'creating', 'causing', 'making', 'pushing', 'leaving', 'turning', 'driving', 'demanding', 'requiring'];
    for (const p of participles) {
        const regex = new RegExp(`,\\s*${p}\\s+([^,\\.]+)[\\.\\,]`, 'gi');
        result = result.replace(regex, (match, captured) => {
            const verb = p.replace(/ing$/, '');
            const presentVerb = verb + (verb.endsWith('e') ? 's' : 'es');
            return `. This ${presentVerb} ${captured.trim()}.`;
        });
    }
    
    // Pattern 7: Triple parallel "X, X, and X"
    result = result.replace(/(\w+)s ([^,]+),\s*\1s ([^,]+),\s*and\s*\1s ([^\.]+)\./gi, (_, verb, a, b, c) => {
        return `${verb}s ${a.trim()} and ${b.trim()}, and also ${verb}s ${c.trim()}.`;
    });
    
    // Pattern 8: "between X and Y" at end
    result = result.replace(/between ([^,]+) and ([^\.]+)\.$/gi, (_, x, y) => {
        return `between ${x.trim()} or ${y.trim()}.`;
    });
    
    // Pattern 9: Multiple "It's" at sentence start - vary them
    const sentences = result.split(/(?<=[.!?])\s+/);
    let itsCount = 0;
    const varied = sentences.map(s => {
        if (/^It's\s/i.test(s)) {
            itsCount++;
            if (itsCount > 1) {
                // Vary subsequent "It's"
                if (/^It's about/i.test(s)) return s.replace(/^It's about/i, 'This concerns');
                if (/^It's a/i.test(s)) return s.replace(/^It's a/i, 'This is a');
                if (/^It's the/i.test(s)) return s.replace(/^It's the/i, 'This represents the');
                if (/^It's needed/i.test(s)) return s.replace(/^It's needed/i, 'This is necessary');
                return s.replace(/^It's/i, 'This is');
            }
        }
        return s;
    });
    result = varied.join(' ');
    
    // Clean up any double periods or spaces
    result = result.replace(/\.\./g, '.');
    result = result.replace(/\s{2,}/g, ' ');
    
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

    try {
        const { text, apiKey, model } = req.body;
        const GROQ_KEY = apiKey || process.env.GROQ_API_KEY;
        
        // Model selection - can be passed in request body
        // Options: 'llama-3.1-70b-versatile', 'mixtral-8x7b-32768', 'llama-3.1-8b-instant'
        const selectedModel = model || 'llama-3.1-70b-versatile';
        console.log(`[Humanizer] Using model: ${selectedModel}`);
        
        if (!text) throw new Error("No text provided.");
        if (text.length < 10) throw new Error("Text too short.");

        const safeText = text.substring(0, 20000);
        
        // Step 1: Detect sections
        const sections = detectSections(safeText);
        console.log(`[Humanizer] Processing ${sections.length} sections`);
        
        // Step 2: Humanize each section
        const humanizedParts = [];
        
        for (let i = 0; i < sections.length; i++) {
            const section = sections[i];
            const prompt = buildHumanizePrompt(section, i, sections.length);
            const messages = [{ role: "user", content: prompt }];
            
            console.log(`[Humanizer] Section ${i + 1}/${sections.length} - sending to Groq...`);
            // NOTE: GroqAPI.chat needs to accept model as 4th parameter
            // Update groqAPI.js to support: GroqAPI.chat(messages, apiKey, stream, model)
            let rawResult = await GroqAPI.chat(messages, GROQ_KEY, false, selectedModel);
            
            console.log(`[Humanizer] Section ${i + 1} raw response (first 200 chars):`);
            console.log(rawResult.substring(0, 200) + '...');
            
            let processed = postProcess(rawResult, section.title);
            humanizedParts.push(processed);
        }
        
        // Step 3: Combine sections
        let combined = humanizedParts.join('\n\n');
        combined = killEmDashes(combined);
        
        console.log('[Humanizer] Combined text before proofreader:');
        console.log(combined.substring(0, 500) + '...');
        
        // Step 4: AI Proofreader - detect and fix remaining AI patterns
        console.log('[Humanizer] Running AI proofreader...');
        const fixes = await proofreadForAIPatterns(combined, GROQ_KEY);
        
        if (fixes.length > 0) {
            console.log(`[Humanizer] Applying ${fixes.length} AI-detected fixes`);
            combined = applyFixes(combined, fixes);
        } else {
            console.log('[Humanizer] Proofreader found no fixes (or failed)');
        }
        
        // Step 5: Fallback regex for patterns that ALWAYS slip through
        console.log('[Humanizer] Applying fallback pattern fixes...');
        const beforeFallback = combined;
        combined = applyFallbackFixes(combined);
        
        if (beforeFallback !== combined) {
            console.log('[Humanizer] Fallback fixes made changes');
        } else {
            console.log('[Humanizer] Fallback fixes made no changes');
        }
        
        // Final cleanup
        const finalOutput = combined.replace(/\s{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
        
        console.log('[Humanizer] Final output (first 300 chars):');
        console.log(finalOutput.substring(0, 300) + '...');

        return res.status(200).json({
            success: true,
            result: finalOutput,
            sections: sections.length,
            fixes: fixes.length,
            model: selectedModel
        });

    } catch (error) {
        console.error("Humanizer Error:", error);
        return res.status(500).json({ success: false, error: error.message });
    }
}
        return res.status(500).json({ success: false, error: error.message });
    }
}

// ==========================================================================
// EXPORTS
// ==========================================================================
export { postProcess as PostProcessor, SIMPLE_SWAPS as AI_VOCAB_SWAPS, detectSections as dynamicChunking, killEmDashes };
