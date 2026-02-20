// api/features/humanizer.js
import { GroqAPI } from '../utils/groqAPI.js';

// ==========================================================================
// HUMANIZER PROMPT ENGINEERING (The "Anti-AI" Logic)
// ==========================================================================
const HumanizerLogic = {
    buildSystemPrompt(tone, isPersonal) {
        // 1. The "Banned" Lexicon (Words that trigger AI detectors)
        const aiStopWords =.join(", ");

        // 2. Formatting the Persona (Gracefully handles undefined frontend variables)
        let toneInstruction = "Maintain a neutral, clear, and natural human tone.";
        if (tone && tone.toLowerCase() === "academic") {
            toneInstruction = "Maintain an academic but authentically human tone. Use sophisticated vocabulary without relying on rigid, formulaic transitions. Avoid robotic objectivity.";
        } else if (tone && tone.toLowerCase() === "casual") {
            toneInstruction = "Use a casual, conversational tone. Use everyday phrasing and a relaxed pacing.";
        }

        let personalInstruction = "";
        if (isPersonal) {
            personalInstruction = "Use first-person pronouns ('I', 'my', 'we'). Inject a subtle sense of personal perspective or lived experience where appropriate.";
        }

        // 3. The Master System Prompt
        return `
            You are an expert human editor. Your objective is to rewrite AI-generated text so that it reads as 100% authentically human and bypasses all AI detection algorithms.

            CRITICAL LINGUISTIC RULES:
            
            1. **MAXIMIZE BURSTINESS (Sentence Length Variance)**: 
               - You MUST drastically vary your sentence lengths. 
               - Mix short, punchy sentences (3-6 words) with longer, flowing ones.
            
            2. **MAXIMIZE PERPLEXITY**:
               - Use natural human phrasing. Avoid obvious next-word predictions.
               
            3. **BANNED AI VOCABULARY**:
               - NEVER use these highly detectable AI words: ${aiStopWords}.
               - DO NOT start paragraphs with mechanical transitions like "Firstly", "Additionally", or "Moreover".

            4. **STRUCTURAL IMPERFECTIONS**:
               - It is okay to occasionally start a sentence with "But", "And", or "Because".
               - Remove robotic symmetry (e.g., if paragraph 1 has 3 points, paragraph 2 doesn't need exactly 3 points).

            TONE SETTINGS:
            - ${toneInstruction}
            - ${personalInstruction}

            TASK:
            Rewrite the provided text using the rules above. Keep the core meaning intact. DO NOT add conversational filler like "Here is the text." Output ONLY the final rewritten text.
        `;
    }
};

// ==========================================================================
// MAIN HANDLER
// ==========================================================================
export default async function handler(req, res) {
    // CORS Headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    // Handle Preflight
    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        // Destructure inputs (tone and isPersonal will safely be undefined if not sent)
        const { text, tone, isPersonal, apiKey } = req.body;
        
        const GROQ_KEY = apiKey || process.env.GROQ_API_KEY;

        if (!text) throw new Error("No text provided to humanize.");

        // SAFETY: Truncate to prevent 413 (Payload Too Large)
        const safeText = text.substring(0, 12000);

        // Build the sophisticated messages payload
        const messages =;

        // Execute via Groq API
        let result = await GroqAPI.chat(messages, GROQ_KEY, false);

        // Cleanup: Strip unwanted AI preambles or surrounding quotes
        result = result.replace(/^|$/g, ''); 
        result = result.replace(/^(Here is the .*?:\n+)/i, ''); 

        return res.status(200).json({ success: true, result: result.trim() });

    } catch (error) {
        console.error("Humanizer Error:", error.message);
        return res.status(500).json({ success: false, error: error.message });
    }
}
