// api/features/humanizer.js
import { GroqAPI } from '../utils/groqAPI.js';

// ==========================================================================
// HUMANIZER PROMPT ENGINEERING (The "Anti-AI" Logic)
// ==========================================================================
const HumanizerLogic = {
    buildSystemPrompt(tone, isPersonal) {
        // 1. The "Banned" Lexicon (Words that trigger AI detectors)
        const aiStopWords =.join(", ");

        // 2. Formatting the Persona
        let toneInstruction = "Maintain a neutral, clear, and natural human tone.";
        if (tone && tone.toLowerCase() === "academic") {
            toneInstruction = "Maintain an academic but authentically human tone. Use sophisticated vocabulary without relying on rigid, formulaic transitions. Avoid robotic objectivity.";
        } else if (tone && tone.toLowerCase() === "casual") {
            toneInstruction = "Use a casual, conversational tone. Use contractions, everyday idioms, and a relaxed pacing.";
        }

        let personalInstruction = "";
        if (isPersonal) {
            personalInstruction = "Use first-person pronouns ('I', 'my', 'we'). Inject a subtle sense of personal perspective, opinion, or lived experience where appropriate.";
        }

        // 3. The Master System Prompt
        return `
            You are an expert human copywriter and editor. Your sole objective is to rewrite AI-generated text so that it reads as 100% authentically human and bypasses all AI detection algorithms (like GPTZero or Turnitin).

            CRITICAL LINGUISTIC RULES (FAILING THESE MEANS FAILURE):
            
            1. **MAXIMIZE BURSTINESS (Sentence Length Variance)**: 
               - AI writes in uniform sentence lengths. Humans DO NOT.
               - You MUST drastically vary your sentence lengths. 
               - Write short, punchy sentences (3-6 words). Follow them with longer, complex, flowing sentences (20+ words). 
            
            2. **MAXIMIZE PERPLEXITY (Unpredictable Phrasing)**:
               - Avoid the most obvious next-word choices.
               - Use natural human phrasing, subtle idioms, and dynamic vocabulary.
               
            3. **BANNED AI VOCABULARY**:
               - NEVER use these highly detectable AI words: ${aiStopWords}.
               - DO NOT start paragraphs with mechanical transitions like "Firstly", "Additionally", "Moreover", or "In conclusion". Transition ideas conceptually instead.

            4. **STRUCTURAL IMPERFECTIONS**:
               - It is okay to occasionally start a sentence with "But", "And", or "Because" (humans do this frequently).
               - Use em-dashes (—) or parentheses for side-thoughts naturally.
               - Remove robotic symmetry (e.g., if paragraph 1 has 3 points, paragraph 2 doesn't need exactly 3 points).

            TONE SETTINGS:
            - ${toneInstruction}
            - ${personalInstruction}

            TASK:
            Rewrite the provided text using the rules above. Keep the core semantic meaning and facts intact. DO NOT add any conversational filler like "Here is the humanized text." Output ONLY the final rewritten text.
        `;
    }
};

// ==========================================================================
// MAIN HANDLER
// ==========================================================================
export default async function handler(req, res) {
    // 1. CORS Headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        const { text, tone, isPersonal, apiKey, model } = req.body;
        
        // Logging for Vercel Dashboard
        const keyType = apiKey ? "CUSTOM" : "SERVERLESS";
        console.log(` Request. Key: ${keyType} | Tone: ${tone || 'Standard'} | Personal: ${!!isPersonal}`);

        const GROQ_KEY = apiKey || process.env.GROQ_API_KEY;

        if (!text) throw new Error("No text provided to humanize.");

        // SAFETY: Truncate to prevent 413 (Payload Too Large) or 400 Context Window errors
        // 12,000 chars is roughly 3,000 tokens, perfectly safe for Llama-3 8B/70B
        const safeText = text.substring(0, 12000);

        // Build the sophisticated messages payload
        const messages =;

        // Execute via Groq API (jsonMode = false because we want raw markdown/text)
        console.log(` Processing with Groq...`);
        let result = await GroqAPI.chat(messages, GROQ_KEY, false);

        // Cleanup: Sometimes AI ignores instructions and wraps text in quotes or adds preambles
        result = result.replace(/^|$/g, ''); // Strip leading/trailing quotes
        result = result.replace(/^(Here is the .*?:\n+)/i, ''); // Strip "Here is the rewritten text:"

        console.log(` Success.`);
        return res.status(200).json({ success: true, result: result.trim() });

    } catch (error) {
        console.error(" Error:", error.message);
        return res.status(500).json({ success: false, error: error.message });
    }
}
