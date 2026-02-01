// api/features/grader.js
import { GeminiAPI } from '../utils/geminiAPI.js';

export default async function handler(req, res) {
    // CORS Setup
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        const { text, instructions, apiKey } = req.body;
        const GEMINI_KEY = apiKey || process.env.GEMINI_API_KEY; // Grader uses Gemini

        if (!text) throw new Error("No text provided to grade.");

        // SAFETY: Truncate text to avoid 413 Payload Too Large / Token limits
        // Gemini Pro has a large window, but let's be safe (~30k chars)
        const safeText = text.substring(0, 30000); 

        const prompt = `
            TASK: You are a strict, academic professor grading this student's work.
            
            INSTRUCTIONS: ${instructions || "Grade this text based on clarity, grammar, and flow."}
            
            STUDENT TEXT:
            "${safeText}"
            
            OUTPUT FORMAT:
            Provide a letter grade (A, B, C, etc.) followed by bullet points of specific feedback. 
            Be constructive but rigorous.
        `;

        // Using the stream=false approach for the Grader to return a single JSON
        // (Or reuse the chat method which returns text)
        const feedback = await GeminiAPI.chat(prompt, GEMINI_KEY);

        return res.status(200).json({ success: true, result: feedback });

    } catch (error) {
        console.error("Grader Error:", error);
        return res.status(500).json({ success: false, error: error.message });
    }
}
