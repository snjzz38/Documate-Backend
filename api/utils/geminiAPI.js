// api/utils/geminiAPI.js

const GEMINI_MODELS = [
  'gemma-3-27b-it',
  'gemini-3-flash-preview',
  'gemini-2.5-pro',
  'gemini-2.5-flash-lite',
  'gemini-2.5-flash',
  'gemma-3-12b-it',
  'gemma-3-4b-it',
  'gemma-3-1b-it'
];

async function makeRequest(model, parts, apiKey) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            contents: [{ parts }]
        })
    });

    if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error?.message || `Status ${res.status}`);
    }

    const data = await res.json();

    if (!data.candidates?.[0]?.content?.parts?.[0]?.text) {
        throw new Error("Invalid response structure from Gemini");
    }

    return data.candidates[0].content.parts[0].text;
}

export const GeminiAPI = {

    /**
     * Universal method: handles BOTH text + images
     * @param {string} promptText
     * @param {string} apiKey
     * @param {Array} files (optional) [{ mime_type, data }]
     */
    async generate(promptText, apiKey, files = []) {
        if (!apiKey) throw new Error("Missing Gemini API Key");

        let lastError = null;

        // Build parts dynamically
        const parts = [];

        // Add files first (important for Gemini)
        if (files.length > 0) {
            files.forEach(f => {
                parts.push({
                    inline_data: {
                        mime_type: f.mime_type || f.type,
                        data: f.data
                    }
                });
            });
        }

        // Add prompt last
        parts.push({ text: promptText });

        for (let i = 0; i < GEMINI_MODELS.length; i++) {
            const model = GEMINI_MODELS[0];

            try {
                const result = await makeRequest(model, parts, apiKey);
                return result;

            } catch (e) {
                lastError = e;

                // rotate model
                const failed = GEMINI_MODELS.shift();
                GEMINI_MODELS.push(failed);
            }
        }

        throw new Error(`All Gemini models failed. Last error: ${lastError?.message}`);
    }
};
