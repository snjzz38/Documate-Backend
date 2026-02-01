// api/features/humanizer.js
import { GroqAPI } from '../utils/groqAPI.js';

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        const { text, apiKey, model } = req.body; // model can be passed from frontend rotation
        const GROQ_KEY = apiKey || process.env.GROQ_API_KEY;

        if (!text) throw new Error("No text provided.");

        // SAFETY: Truncate to ~12k chars to prevent 413/400 errors on Llama-3-8b
        const safeText = text.substring(0, 12000);

        const messages = [
            {
                role: "system",
                content: "You are an expert editor. Rewrite the following text to make it sound more natural, human, and engaging. Remove robotic phrasing. Keep the same meaning."
            },
            {
                role: "user",
                content: safeText
            }
        ];

        // Pass false for jsonMode (Humanizer returns text)
        const result = await GroqAPI.chat(messages, GROQ_KEY, false);

        return res.status(200).json({ success: true, result: result });

    } catch (error) {
        console.error("Humanizer Error:", error);
        return res.status(500).json({ success: false, error: error.message });
    }
}
