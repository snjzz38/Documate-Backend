const ALL_GEMINI_MODELS = [
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
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        const { studentText, contextFiles, instructions, apiKey } = req.body;
        const GEMINI_KEY = apiKey || process.env.GEMINI_API_KEY;

        const parts = [{ text: "SYSTEM: You are an expert academic grader. Provide specific, constructive feedback." }];
        if (instructions) parts.push({ text: `\nINSTRUCTIONS:\n${instructions}` });
        
        if (contextFiles && Array.isArray(contextFiles)) {
            contextFiles.forEach(f => {
                if (f.type === 'text') parts.push({ text: `\n[FILE: ${f.name}]: ${f.content}` });
                else if (f.base64) parts.push({ inlineData: { mimeType: f.mimeType, data: f.base64 } });
            });
        }
        parts.push({ text: `\nSTUDENT WORK:\n${studentText}\n\nTASK: Grade based ONLY on materials. Use bold Markdown headers.` });

        let resultText = null;
        let lastError = null;

        for (const model of ALL_GEMINI_MODELS) {
            try {
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
                    break;
                }
            } catch (e) {
                lastError = e;
            }
        }

        if (!resultText) throw lastError || new Error("All models failed");
        return res.status(200).json({ success: true, data: resultText });

    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
}
