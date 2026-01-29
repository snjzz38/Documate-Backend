// api/groqAPI.js
export const GroqAPI = {
    // Centralize model choice
    MODEL: "llama-3.3-70b-versatile",

    async chat(messages, apiKey, jsonMode = false) {
        if (!apiKey) throw new Error("Missing Groq API Key");

        try {
            const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${apiKey}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    model: this.MODEL,
                    messages: messages,
                    temperature: 0.1, // Low temp for factual tasks
                    response_format: jsonMode ? { type: "json_object" } : undefined
                })
            });

            const data = await res.json();

            if (!res.ok) {
                console.error("Groq Raw Error:", data);
                throw new Error(data.error?.message || "Groq API Error");
            }

            return data.choices[0].message.content;
        } catch (e) {
            console.error("Groq Network Error:", e);
            throw e;
        }
    }
};
