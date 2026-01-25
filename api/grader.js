// api/documate/grader.js

const DEFAULT_GEMINI_MODELS = [
  'gemma-3-27b-it',
  'gemini-3-flash-preview',
  'gemini-2.5-pro',
  'gemini-2.5-flash-lite',
  'gemini-2.5-flash',
  'gemini-2.0-flash',
  'gemini-2.0-flash-lite',
  'gemma-3-12b-it',
  'gemma-3-4b-it',
  'gemma-3-1b-it'
];

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        const { studentText, contextFiles, instructions, apiKey } = req.body;
        const GEMINI_KEY = apiKey || process.env.GEMINI_API_KEY;

        // 1. Construct Gemini "Parts"
        const parts = [{ text: "SYSTEM: You are an expert academic grader. Provide specific, constructive feedback." }];
        if (instructions) parts.push({ text: `\nINSTRUCTIONS:\n${instructions}` });
        
        // Handle Files (Base64)
        if (contextFiles && Array.isArray(contextFiles)) {
            contextFiles.forEach(f => {
                if (f.type === 'text') {
                    parts.push({ text: `\n[FILE: ${f.name}]: ${f.content}` });
                } else if (f.base64) {
                    // Gemini REST API Inline Data
                    parts.push({
                        inlineData: {
                            mimeType: f.mimeType,
                            data: f.base64
                        }
                    });
                }
            });
        }
        parts.push({ text: `\nSTUDENT WORK:\n${studentText}\n\nTASK: Grade based ONLY on materials. Use bold Markdown headers.` });

        // 2. Call Gemini with Rotation
        let resultText = null;
        let lastError = null;

        for (const model of DEFAULT_GEMINI_MODELS) {
            try {
                // Note: Using generateContent (non-streaming) for Vercel stability
                const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_KEY}`;
                
                const response = await fetch(url, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ contents: [{ parts: parts }] })
                });

                if (!response.ok) throw new Error(`Status ${response.status}`);
                const data = await response.json();
                
                if (data.candidates && data.candidates[0].content) {
                    resultText = data.candidates[0].content.parts[0].text;
                    break; // Success
                }
            } catch (e) {
                console.warn(`Model ${model} failed:`, e.message);
                lastError = e;
            }
        }

        if (!resultText) throw lastError || new Error("All models failed");

        return res.status(200).json({ success: true, data: resultText });

    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
}
