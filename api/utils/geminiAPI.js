// api/utils/geminiAPI.js

const GEMINI_MODELS = [
  "gemma-3-27b-it",
  "gemini-3-flash-preview",
  "gemini-2.5-pro",
  "gemini-2.5-flash-lite",
  "gemini-2.5-flash",
  "gemini-2.0-flash",
  "gemini-2.0-flash-lite",
  "gemma-3-12b-it",
  "gemma-3-4b-it",
  "gemma-3-1b-it",
];

export const GeminiAPI = {
  /**
   * STREAMING VERSION
   * Usage:
   * for await (const chunk of GeminiAPI.chatStream(prompt, apiKey)) { ... }
   */
  async *chatStream(promptText, apiKey) {
    if (!apiKey) throw new Error("Missing Gemini API Key");

    let lastError = null;

    for (let attempt = 0; attempt < GEMINI_MODELS.length; attempt++) {
      const currentModel = GEMINI_MODELS[0];

      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${currentModel}:streamGenerateContent?key=${apiKey}`;

        const res = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Accept": "text/event-stream",
          },
          body: JSON.stringify({
            contents: [{ parts: [{ text: promptText }] }],
          }),
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error?.message || `Status ${res.status}`);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder("utf-8");

        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          const lines = buffer.split("\n");
          buffer = lines.pop(); // keep incomplete chunk

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;

            // Gemini streams as: data: {json}
            if (trimmed.startsWith("data:")) {
              const jsonStr = trimmed.replace(/^data:\s*/, "");

              if (jsonStr === "[DONE]") return;

              try {
                const parsed = JSON.parse(jsonStr);

                const textChunk =
                  parsed.candidates?.[0]?.content?.parts?.[0]?.text;

                if (textChunk) {
                  yield textChunk;
                }
              } catch {
                // Ignore malformed partial JSON
              }
            }
          }
        }

        return; // successful completion

      } catch (err) {
        lastError = err;

        // Rotate failed model to end
        const failedModel = GEMINI_MODELS.shift();
        GEMINI_MODELS.push(failedModel);
      }
    }

    throw new Error(
      `All Gemini models failed. Last error: ${lastError?.message}`
    );
  },

  /**
   * NORMAL (NON-STREAMING) VERSION
   * Usage:
   * const text = await GeminiAPI.chat(prompt, apiKey);
   */
  async chat(promptText, apiKey) {
    let fullText = "";

    for await (const chunk of this.chatStream(promptText, apiKey)) {
      fullText += chunk;
    }

    return fullText;
  },
};
