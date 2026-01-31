// api/utils/groqAPI.js

// FIXED: Removed smart quote at the end of the last model
const GROQ_MODELS = [
    "qwen/qwen3-32b",
    "llama-3.1-8b-instant",
    "meta-llama/llama-4-maverick-17b-128e-instruct",
    "meta-llama/llama-4-scout-17b-16e-instruct",
    "meta-llama/llama-guard-4-12b",
    "meta-llama/llama-prompt-guard-2-22m",
    "meta-llama/llama-prompt-guard-2-86m",
    "moonshotai/kimi-k2-instruct-0905" // Fixed quote here
];

export const GroqAPI = {
    async chat(messages, apiKey, jsonMode = false) {
        if (!apiKey) throw new Error("Missing Groq API Key");

        let lastError = null;

        // Rotation Logic: Try models in order. If one fails, move it to the back.
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
                        // Only send response_format if jsonMode is true
                        response_format: jsonMode ? { type: "json_object" } : undefined
                    })
                });

                const data = await res.json();

                if (!res.ok) {
                    const errorMsg = data.error?.message || `Status ${res.status}`;
                    
                    // Specific handling for 400 Bad Request (often caused by strict JSON mode issues)
                    if (res.status === 400 && jsonMode) {
                        // console.warn("Groq 400 received in JSON mode. Retrying as text...");
                        // Recursively try again with jsonMode disabled for this specific model
                        return this.chat(messages, apiKey, false);
                    }
                    
                    throw new Error(errorMsg);
                }

                let content = data.choices[0].message.content;
                
                // Clean internal thought chains (DeepSeek/Reasoning models often output these tags)
                return content.replace(/<think>[\s\S]*?<\/think>/g, "").trim();

            } catch (e) {
                lastError = e;
                // Rotate: Move the failed model to the end of the array
                const failed = GROQ_MODELS.shift();
                GROQ_MODELS.push(failed);
                // The loop continues with the new first element
            }
        }

        throw new Error(`AI Service Failed: ${lastError?.message}`);
    }
};
