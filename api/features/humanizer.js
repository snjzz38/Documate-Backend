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
        
        // Step 2: Send to AI for natural rewriting
        const prompt = `Rewrite this academic text to sound more natural while keeping its serious tone.

TEXT TO REWRITE:
"${processed}"

RULES:
1. Keep the academic/serious tone - this is for an essay, not a blog
2. Vary sentence lengths naturally - mix short (8-10 words), medium (12-18 words), and occasional longer ones
3. Use contractions where natural: "it is" → "it's", "does not" → "doesn't"
4. Connect some related short sentences with "and" or "but"
5. Start 1-2 sentences with "And" or "But" for natural flow
6. Avoid starting multiple sentences with "This" - vary your sentence openers

DO NOT:
- Use semicolons or em dashes
- Use ", which" clauses (break into separate sentences)
- Use "This [verb]s" pattern (like "This creates", "This leads to")
- Use transitions like "furthermore", "moreover", "consequently"
- Make it too casual or informal
- Add rhetorical questions
- Use slang or colloquialisms

GOOD EXAMPLE:
"Climate change has become a security crisis. It's not just about rising seas or melting ice anymore. When temperatures rise, conflicts over water and food get worse. Countries already struggling are pushed to their limits. And the people who did the least to cause this problem? They're often hit the hardest."

BAD EXAMPLE (too casual):
"Climate change is a total disaster, right? Like, it's not just polar bears anymore. Countries are freaking out over water and stuff."

BAD EXAMPLE (too AI-like):
"Climate change constitutes a significant security paradigm. This necessitates comprehensive policy frameworks. Furthermore, vulnerable populations face disproportionate impacts, which exacerbates existing inequalities."

Output ONLY the rewritten text.`;

        logs.push('Sending to Groq...');
        
        const response = await GroqAPI.chat([{ role: "user", content: prompt }], GROQ_KEY, false);
        let result = typeof response === 'string' ? response : (response.content || response);
        result = result.trim().replace(/^["']|["']$/g, '');
        
        logs.push(`Groq response (first 150 chars): ${result.substring(0, 150)}...`);
        
        // Step 3: Post-process to catch remaining issues
        result = postProcess(result, logs);
        
        // Step 4: Apply word swaps again (AI might reintroduce banned words)
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
// POST-PROCESSING
// ==========================================================================

function postProcess(text, logs) {
    let result = text;
    
    // Remove semicolons - split into sentences
    result = result.replace(/;/g, '.');
    
    // Remove em dashes
    result = result.replace(/[—–]/g, ',');
    result = result.replace(/\s*,\s*,/g, ',');
    
    // Fix "This [verb]s" patterns
    result = result.replace(/^This (strains|creates|causes|leads|forces|pushes|makes|turns|means|requires|demands|puts)/gim, 'That $1');
    result = result.replace(/\. This (strains|creates|causes|leads|forces|pushes|makes|turns|means|requires|demands|puts)/gi, '. That $1');
    
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
