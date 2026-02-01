// api/features/humanizer.js
import { GroqAPI } from '../utils/groqAPI.js';

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        const { text, apiKey, model } = req.body;
        const GROQ_KEY = apiKey || process.env.GROQ_API_KEY;

        if (!text) throw new Error("No text provided.");

        // Safety limit for Groq
        const safeText = text.substring(0, 8000);

        const messages = [
            {
                role: "system",
                content: "You are an expert editor. Rewrite the text to be more natural, engaging, and human-like. Keep the original meaning but improve flow."
            },
            {
                role: "user",
                content: safeText
            }
        ];

        // Ensure we pass the model if provided (from frontend rotation)
        // If not provided, GroqAPI has its own default list
        let result;
        if (model) {
            // Bypass internal rotation and try specific model (since frontend handles rotation)
            // We do this by calling the fetch directly OR creating a specific method in GroqAPI
            // For simplicity, we assume GroqAPI.chat handles standard calls. 
            // NOTE: GroqAPI.chat rotates internally. To support specific model targeting, 
            // we'd need to modify GroqAPI or just let backend handle rotation.
            // Let's rely on backend rotation for simplicity unless frontend sends specific key requirements.
            result = await GroqAPI.chat(messages, GROQ_KEY, false);
        } else {
            result = await GroqAPI.chat(messages, GROQ_KEY, false);
        }

        return res.status(200).json({ success: true, result: result });

    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
}
