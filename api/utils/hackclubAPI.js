// api/utils/hackclubAPI.js
// HackClub API wrapper for agent mode

export const HackClubAPI = {
    async chat(messages, apiKey, systemPrompt = null) {
        const HACKCLUB_KEY = apiKey || process.env.HACKCLUB_API_KEY;
        
        if (!HACKCLUB_KEY) {
            throw new Error("HackClub API key not configured");
        }

        const payload = {
            model: "gpt-4o",
            messages: []
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
            const response = await fetch("https://ai.hackclub.com/chat/completions", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${HACKCLUB_KEY}`
                },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`HackClub API error: ${response.status} - ${errorText}`);
            }

            const data = await response.json();
            
            if (data.choices && data.choices[0] && data.choices[0].message) {
                return data.choices[0].message.content;
            }
            
            throw new Error("Invalid response format from HackClub API");
        } catch (error) {
            console.error("[HackClubAPI] Error:", error);
            throw error;
        }
    },

    // Stream response (for longer outputs)
    async stream(messages, apiKey, systemPrompt = null, onChunk) {
        const HACKCLUB_KEY = apiKey || process.env.HACKCLUB_API_KEY;
        
        if (!HACKCLUB_KEY) {
            throw new Error("HackClub API key not configured");
        }

        const payload = {
            model: "gpt-4o",
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

        const response = await fetch("https://ai.hackclub.com/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${HACKCLUB_KEY}`
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            throw new Error(`HackClub API error: ${response.status}`);
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
