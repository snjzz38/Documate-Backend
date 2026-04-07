// api/utils/geminiAPI.js
const GEMINI_MODELS = [
  'gemma-4-31b-it',
  'gemini-3.1-flash-lite-preview',
  'gemma-4-26b-a4b-it',
  'gemma-3-27b-it',
  'gemini-3-flash-preview',
  'gemini-2.5-pro',
  'gemini-2.5-flash-lite',
  'gemini-2.5-flash',
  'gemma-3-12b-it',
  'gemma-3-4b-it',
  'gemma-3n-e2b-it',
  'gemma-3-1b-it'
];

export const GeminiAPI = {
    async chat(promptText, apiKey, temperature = 0.7) {
        if (!apiKey) throw new Error("Missing Gemini API Key");
        let lastError = null;
        for (let attempt = 0; attempt < GEMINI_MODELS.length; attempt++) {
            const currentModel = GEMINI_MODELS[attempt % GEMINI_MODELS.length];
            try {
                const url = `https://generativelanguage.googleapis.com/v1beta/models/${currentModel}:generateContent?key=${apiKey}`;
                const res = await fetch(url, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        contents: [{ parts: [{ text: promptText }] }],
                        generationConfig: { temperature }
                    })
                });
                if (!res.ok) {
                    const errData = await res.json().catch(() => ({}));
                    throw new Error(errData.error?.message || `Status ${res.status}`);
                }
                const data = await res.json();
                if (!data.candidates || !data.candidates[0] || !data.candidates[0].content) {
                    throw new Error("Invalid response structure from Gemini");
                }
                return data.candidates[0].content.parts[0].text;
            } catch (e) {
                lastError = e;
                const failedModel = GEMINI_MODELS.shift();
                GEMINI_MODELS.push(failedModel);
            }
        }
        throw new Error(`All Gemini models failed. Last error: ${lastError?.message}`);
    },
    async vision(promptText, apiKey, files = [], temperature = 0.7) {
        if (!apiKey) throw new Error("Missing Gemini API Key");
        let lastError = null;
        const parts = [
            ...files.map(f => ({
                inline_data: { mime_type: f.type, data: f.data }
            })),
            { text: promptText }
        ];
        for (let attempt = 0; attempt < GEMINI_MODELS.length; attempt++) {
            const currentModel = GEMINI_MODELS[0];
            try {
                const url = `https://generativelanguage.googleapis.com/v1beta/models/${currentModel}:generateContent?key=${apiKey}`;
                const res = await fetch(url, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        contents: [{ parts }],
                        generationConfig: { temperature }
                    })
                });
                if (!res.ok) {
                    const errData = await res.json().catch(() => ({}));
                    throw new Error(errData.error?.message || `Status ${res.status}`);
                }
                const data = await res.json();
                if (!data.candidates || !data.candidates[0] || !data.candidates[0].content) {
                    throw new Error("Invalid response structure from Gemini");
                }
                return data.candidates[0].content.parts[0].text;
            } catch (e) {
                lastError = e;
                const failedModel = GEMINI_MODELS.shift();
                GEMINI_MODELS.push(failedModel);
            }
        }
        throw new Error(`All Gemini models failed. Last error: ${lastError?.message}`);
    }
};
