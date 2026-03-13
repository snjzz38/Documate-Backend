// api/utils/hackclubAPI.js
// HackClub API wrapper - uses Cloudflare Worker proxy

// Replace YOUR_WORKER_NAME with your Cloudflare worker subdomain
// Example: if your worker URL is hackclub-proxy.johndoe.workers.dev, use that
const WORKER_URL = "https://hackclub-proxy.documate-ai-document-assistant.workers.dev";

export const HackClubAPI = {
    /**
     * Send a chat request to HackClub AI
     * @param {string|Array} messages - Message string or array of {role, content}
     * @param {string} apiKey - Optional API key (uses worker's key if not provided)
     * @param {string} systemPrompt - Optional system prompt
     * @param {string} model - Model to use (default: qwen/qwen3-32b)
     */
    async chat(messages, apiKey = null, systemPrompt = null, model = "qwen/qwen3-32b") {
        const payload = {
            model,
            messages: [],
            stream: false
        };

        // Add system prompt if provided
        if (systemPrompt) {
            payload.messages.push({ role: "system", content: systemPrompt });
        }

        // Add conversation messages
        if (Array.isArray(messages)) {
            payload.messages.push(...messages);
        } else {
            payload.messages.push({ role: "user", content: messages });
        }

        try {
            const response = await fetch(WORKER_URL, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(payload)
            });

            const data = await response.json();

            if (!response.ok || !data.success) {
                throw new Error(data.error || `API error: ${response.status}`);
            }

            return data.content;
        } catch (error) {
            console.error("[HackClubAPI] Error:", error);
            throw error;
        }
    },

    /**
     * Stream a chat response
     * @param {string|Array} messages - Message string or array
     * @param {string} apiKey - Optional API key
     * @param {string} systemPrompt - Optional system prompt
     * @param {function} onChunk - Callback for each chunk
     * @param {string} model - Model to use
     */
    async stream(messages, apiKey = null, systemPrompt = null, onChunk = null, model = "qwen/qwen3-32b") {
        const payload = {
            model,
            messages: [],
            stream: true
        };

        if (systemPrompt) {
            payload.messages.push({ role: "system", content: systemPrompt });
        }

        if (Array.isArray(messages)) {
            payload.messages.push(...messages);
        } else {
            payload.messages.push({ role: "user", content: messages });
        }

        const response = await fetch(WORKER_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || `API error: ${response.status}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let fullText = "";

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value);
            const lines = chunk.split('\n').filter(line => line.startsWith('data: '));

            for (const line of lines) {
                const data = line.slice(6);
                if (data === '[DONE]') continue;

                try {
                    const parsed = JSON.parse(data);
                    const content = parsed.choices?.[0]?.delta?.content || '';
                    if (content) {
                        fullText += content;
                        if (onChunk) onChunk(content);
                    }
                } catch (e) {
                    // Skip unparseable chunks
                }
            }
        }

        return fullText;
    }
};
