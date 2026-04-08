// api/utils/groqAPI.js

// NOTE: Smart quote fixed on the last line
const GROQ_MODELS = [
    "llama-3.1-8b-instant",
    "meta-llama/llama-4-scout-17b-16e-instruct",
    "meta-llama/llama-guard-4-12b",
    "meta-llama/llama-prompt-guard-2-22m",
    "meta-llama/llama-prompt-guard-2-86m",
    "moonshotai/kimi-k2-instruct-0905",
    "qwen/qwen3-32b"  // reasoning model — kept as last resort only
];

const stripThinking = (content, jsonMode) => {
    // Remove standard <think>...</think> blocks
    let stripped = content.replace(/<think>[\s\S]*?<\/think>/g, '').trim();

    if (jsonMode) {
        // For JSON mode: discard everything before the first '{' and after the last '}'
        // This catches qwen3 and other reasoning models that dump plain-text reasoning before the JSON
        const firstBrace = stripped.indexOf('{');
        const lastBrace = stripped.lastIndexOf('}');
        if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
            stripped = stripped.slice(firstBrace, lastBrace + 1);
        }
    }

    return stripped.trim();
};

export const GroqAPI = {
    async chat(messages, apiKey, jsonMode = false) {
        if (!apiKey) throw new Error("Missing Groq API Key");

        let lastError = null;

        // Try every model once
        for (let i = 0; i < GROQ_MODELS.length; i++) {
            const currentModel = GROQ_MODELS[0];

            try {
                const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
                    method: "POST",
                    headers: {
                        "Authorization": `Bearer ${apiKey}`,
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                        model: currentModel,
                        messages: messages,
                        temperature: 0.1,
                        response_format: jsonMode ? { type: "json_object" } : undefined
                    })
                });

                const data = await res.json();

                if (!res.ok) {
                    const errorMsg = data.error?.message || `Status ${res.status}`;
                    
                    // If JSON mode fails (400), retry immediately with text mode
                    if (res.status === 400 && jsonMode) {
                        return this.chat(messages, apiKey, false);
                    }
                    
                    throw new Error(errorMsg);
                }

                if (!data.choices || !data.choices[0]) {
                    throw new Error("Invalid Groq response structure");
                }

                const content = data.choices[0].message.content;
                return stripThinking(content, jsonMode);

            } catch (e) {
                lastError = e;
                // ROTATION LOGIC: Move failed model to end
                const failed = GROQ_MODELS.shift();
                GROQ_MODELS.push(failed);
            }
        }

        throw new Error(`AI Service Failed: ${lastError?.message}`);
    }
};
