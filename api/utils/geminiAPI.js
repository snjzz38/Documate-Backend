// api/utils/geminiAPI.js
const GEMINI_MODELS = [
  'gemma-4-31b-it',
  'gemini-3.1-flash-lite-preview',
  'gemma-4-26b-A4b-it',
  'gemma-3-27b-it',
  'gemini-3-flash-preview',
  'gemini-2.5-pro',
  'gemini-2.5-flash-lite',
  'gemini-2.5-flash',
  'gemma-3-12b-it',
  'gemma-3-4b-it',
  'gemma-3-1b-it'
];

// Strip thinking/reasoning tokens that Gemma 4 models include in their output.
// These appear as <think>...</think> blocks or similar reasoning traces.
const stripThinking = text => {
    if (!text) return text;
    // Remove <think>...</think> blocks (Gemma 4 chain-of-thought)
    let stripped = text.replace(/<think>[\s\S]*?<\/think>/gi, '');
    // Remove **Attempt N:** style reasoning traces that appear before the real answer
    stripped = stripped.replace(/\*\*Attempt \d+:\*\*[\s\S]*?(?=\*\*Attempt \d+:\*\*|\n\n(?!\*))/gi, '');
    // If the model dumped a long reasoning preamble ending with a final answer marker, keep only what follows
    const finalAnswerMatch = stripped.match(/(?:\*\*Final [Aa]nswer[:\*]*|The (?:final |)(?:answer|rewrite) is[:\s]+)([\s\S]+)$/i);
    if (finalAnswerMatch) return finalAnswerMatch[1].trim();
    return stripped.trim();
};

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
                const raw = data.candidates[0].content.parts[0].text;
                return stripThinking(raw);
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
                const raw = data.candidates[0].content.parts[0].text;
                return stripThinking(raw);
            } catch (e) {
                lastError = e;
                const failedModel = GEMINI_MODELS.shift();
                GEMINI_MODELS.push(failedModel);
            }
        }
        throw new Error(`All Gemini models failed. Last error: ${lastError?.message}`);
    }
};
