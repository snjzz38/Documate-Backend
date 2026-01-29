// api/utils/groqAPI.js

// Dynamic Model List
const GROQ_MODELS = [
    "llama-3.1-8b-instant", // Usually most reliable start
    "qwen/qwen3-32b",
    "meta-llama/llama-4-maverick-17b-128e-instruct", // Hypothetical/Preview
    "meta-llama/llama-4-scout-17b-16e-instruct",
    "meta-llama/llama-guard-4-12b",
    "moonshotai/kimi-k2-instruct-0905",
    "llama3-70b-8192" // Good fallback
];

export const GroqAPI = {
    async chat(messages, apiKey, jsonMode = false) {
        if (!apiKey) throw new Error("Missing Groq API Key");

        let lastError = null;

        // Try up to 3 different models from the list to avoid infinite loops
        // but shuffle the failed one to the end for future requests (in persistent envs)
        for (let attempt = 0; attempt < GROQ_MODELS.length; attempt++) {
            const currentModel = GROQ_MODELS[0]; // Always take from top

            try {
                // console.log(`Trying Groq Model: ${currentModel}`); // Uncomment for debug
                
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

                if (!res.ok) {
                    const errData = await res.json();
                    throw new Error(errData.error?.message || `Status ${res.status}`);
                }

                const data = await res.json();
                return data.choices[0].message.content;

            } catch (e) {
                // console.warn(`Groq Model ${currentModel} Failed:`, e.message);
                lastError = e;

                // ROTATION LOGIC:
                // Remove the failed model from the front and push to the back
                const failedModel = GROQ_MODELS.shift();
                GROQ_MODELS.push(failedModel);
                
                // Continue to next iteration of loop to try the new 'top' model
            }
        }

        throw new Error(`All Groq models failed. Last error: ${lastError?.message}`);
    }
};
