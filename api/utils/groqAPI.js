// api/utils/groqAPI.js

// Ordered by reliability
const GROQ_MODELS = [
    "llama-3.3-70b-versatile", // Best for complex tasks
    "llama-3.1-8b-instant",    // Fast, good fallback
    "mixtral-8x7b-32768"       // Large context window
];

export const GroqAPI = {
    async chat(messages, apiKey, jsonMode = false) {
        if (!apiKey) throw new Error("Missing Groq API Key");

        let lastError = null;

        for (const model of GROQ_MODELS) {
            try {
                const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
                    method: "POST",
                    headers: {
                        "Authorization": `Bearer ${apiKey}`,
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                        model: model,
                        messages: messages,
                        temperature: 0.1,
                        // Only send response_format if jsonMode is true
                        response_format: jsonMode ? { type: "json_object" } : undefined
                    })
                });

                const data = await res.json();

                if (!res.ok) {
                    const errorMsg = data.error?.message || `Status ${res.status}`;
                    
                    // IF 400 (Bad Request), it might be JSON mode failing. 
                    // Retry immediately without rotation, but disable JSON mode for this model.
                    if (res.status === 400 && jsonMode) {
                        // console.warn("Groq 400 received in JSON mode. Retrying as text...");
                        return this.chat(messages, apiKey, false);
                    }
                    
                    throw new Error(errorMsg);
                }

                let content = data.choices[0].message.content;
                // Clean internal thought chains (DeepSeek style)
                return content.replace(/<think>[\s\S]*?<\/think>/g, "").trim();

            } catch (e) {
                lastError = e;
                // Rotate model for next attempt
                const failed = GROQ_MODELS.shift();
                GROQ_MODELS.push(failed);
            }
        }

        throw new Error(`AI Service Failed: ${lastError?.message}`);
    }
};
