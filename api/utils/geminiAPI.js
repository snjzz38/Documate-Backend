// api/utils/geminiAPI.js
const GEMINI_MODELS = [
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-2.5-pro',
  'gemini-3-flash-preview',
  'gemini-3.1-flash-lite-preview',
  'gemma-3-27b-it',
  'gemma-3-12b-it',
  'gemma-3-4b-it',
  'gemma-3-1b-it',
  // Gemma 4 models are reasoning models that narrate their thinking — last resort only
  'gemma-4-31b-it',
  'gemma-4-26b-A4b-it',
];

const stripThinking = text => {
    if (!text) return text;

    // Remove <think>...</think> blocks
    let stripped = text.replace(/<think>[\s\S]*?<\/think>/gi, '');

    // Gemma 4 dumps reasoning as bullet lines starting with "* Word:" or "* **Word:**"
    // e.g. "* Input sentence:", "* Context:", "* Goal:", "* Constraints:", "* Attempt 1:", "* Wait,"
    // Detect if the output contains these reasoning traces
    const hasReasoningBullets = /^\s*\*\s+(?:\*\*)?(?:Input|Context|Goal|Constraint|Attempt|Wait|Check|Meaning|Rules?|Note|Final|Output|Result|Rewrite|Draft|Example|Step|Let|OK|So|Now|The|My|This|Done|Summary|Analysis|Option|Version|Hmm|Actually|Also|First|Next|Then|Here|Looking|Since|Based|Given|To summarize|In summary)[\s\S]{0,60}?:/im.test(stripped);

    if (hasReasoningBullets) {
        // Strategy: find the last non-bullet, non-empty line — that's the actual answer
        const lines = stripped.split('\n');
        // Collect all lines that are NOT reasoning bullet lines
        const answerLines = [];
        let pastReasoning = false;

        for (let i = lines.length - 1; i >= 0; i--) {
            const line = lines[i].trim();
            if (!line) continue;
            // A reasoning bullet: starts with "* " followed by a word and colon, or "* **Word**:"
            const isReasoningBullet = /^\*\s+(?:\*\*)?[A-Z][a-zA-Z\s]{0,40}(?:\*\*)?\s*:/.test(line);
            // A plain content line that's the actual answer
            if (!isReasoningBullet && !pastReasoning) {
                answerLines.unshift(line);
                // Stop collecting once we hit a reasoning bullet above us
            } else if (isReasoningBullet) {
                pastReasoning = true;
                break;
            } else {
                answerLines.unshift(line);
            }
        }

        if (answerLines.length > 0) {
            stripped = answerLines.join(' ').trim();
        }
    }

    // Remove **Attempt N:** style traces
    stripped = stripped.replace(/\*\*Attempt \d+:\*\*[\s\S]*?(?=\*\*Attempt \d+:\*\*|\n\n(?!\*))/gi, '');

    // If there's a final answer marker, keep only what follows it
    const finalAnswerMatch = stripped.match(/(?:\*\*Final [Aa]nswer[:\*]*|The (?:final |)(?:answer|rewrite) is[:\s]+)([\s\S]+)$/i);
    if (finalAnswerMatch) return finalAnswerMatch[1].trim();

    // Strip any remaining leading bullet asterisk from a single-line answer
    stripped = stripped.replace(/^\*\s+/, '');

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
