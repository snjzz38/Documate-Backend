// api/utils/groqAPI.js
const GROQ_MODELS = [
    "llama-3.3-70b-versatile", // Best instruction following
    "llama-3.1-70b-versatile",
    "mixtral-8x7b-32768",
    "gemma2-9b-it"
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
                        response_format: jsonMode ? { type: "json_object" } : undefined
                    })
                });

                if (!res.ok) throw new Error(`Groq ${res.status}`);

                const data = await res.json();
                let content = data.choices[0].message.content;

                // CLEANER: Remove <think> tags if model outputs them
                content = content.replace(/<think>[\s\S]*?<\/think>/g, "").trim();

                return content;

            } catch (e) {
                lastError = e;
                // Rotation logic: move failed to end
                const failed = GROQ_MODELS.shift();
                GROQ_MODELS.push(failed);
            }
        }
        throw new Error(`AI Service Failed: ${lastError?.message}`);
    }
};
