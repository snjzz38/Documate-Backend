// --- CONFIGURATION ---
const DEFAULT_GROQ_MODELS = [
  "qwen/qwen3-32b",
  "llama-3.1-8b-instant",
  "meta-llama/llama-4-maverick-17b-128e-instruct",
  "meta-llama/llama-4-scout-17b-16e-instruct",
  "meta-llama/llama-guard-4-12b",
  "meta-llama/llama-prompt-guard-2-22m",
  "meta-llama/llama-prompt-guard-2-86m",
  "moonshotai/kimi-k2-instruct-0905”,
];

const AI_VOCAB_SWAPS = {
    "far-reaching": ["huge"], "widespread": ["common"], "harness": ["use"],
    "enhance": ["improve"], "evolving": ["changing"], "redefined": ["changed"],
    "crucial": ["key"], "pivotal": ["main"], "imperative": ["must"],
    "facilitate": ["help"], "exacerbate": ["worsen"], "mitigate": ["fix"],
    "underscore": ["show"], "delve": ["dig"], "leverage": ["use"],
    "utilize": ["use"], "employ": ["use"], "testament": ["proof"],
    "revolutionize": ["change"], "paradigm shift": ["big change"],
    "multifaceted": ["complex"], "realm": ["world"], "landscape": ["scene"],
    "comprehensive": ["full"], "capabilities": ["skills"], "optimize": ["improve"],
    "seamless": ["smooth"], "dynamic": ["active"], "holistic": ["whole"],
    "transformative": ["big"], "profound": ["deep"], "fundamentally": ["really"],
    "empower": ["help"], "versatility": ["range"]
};

const STRATEGIES = {
    'Casual': "Make sentences simple. Connect them with 'and'. Stop using big words.",
    'Academic': "Explain simply. No complex phrases. Write facts clearly.",
    'Professional': "State actions clearly. Merge ideas. Keep it flowing."
};

function postProcessText(text) {
    let processed = text.replace(/^(Here is|Sure,|Below is).*?:/gim, "").trim();
    processed = processed.replace(/^["']|["']$/g, '');

    for (const [bad, goods] of Object.entries(AI_VOCAB_SWAPS)) {
        const regex = new RegExp(`\\b${bad}\\b`, 'gi');
        if (regex.test(processed)) processed = processed.replace(regex, goods[0]);
    }

    processed = processed.replace(/fundamentally altering/gi, "fundamentally alters");
    processed = processed.replace(/empowered ([\w\s]+)/gi, "helped $1");
    processed = processed.replace(/accompanied by/gi, "with");
    processed = processed.replace(/computs\b/g, "computing");
    processed = processed.replace(/showcass\b/g, "shows");
    processed = processed.replace(/\bdo not\b/gi, "don't");
    processed = processed.replace(/\bcan not\b/gi, "can't");

    return processed;
}

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        const { text, tone, isPersonal, apiKey } = req.body;
        const GROQ_KEY = apiKey || process.env.GROQ_API_KEY;
        const selectedStrategy = STRATEGIES[tone] || STRATEGIES['Professional'];
        
        const prompt = `
            SYSTEM: You are a human writer. Rewrite text to sound simple and natural.
            VOICE: ${tone}. PERSONAL: ${isPersonal}.
            INSTRUCTION: ${selectedStrategy}
            CRITICAL: NO PARTICIPLE PHRASES (e.g., "altering", "enhancing"). Use compound sentences.
            TEXT: "${text.substring(0, 4000)}"
        `;

        let resultText = null;
        let lastError = null;

        for (const model of DEFAULT_GROQ_MODELS) {
            try {
                const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
                    method: "POST",
                    headers: { "Authorization": `Bearer ${GROQ_KEY}`, "Content-Type": "application/json" },
                    body: JSON.stringify({
                        model: model,
                        messages: [{ role: "user", content: prompt }],
                        temperature: 0.7
                    })
                });

                if (!response.ok) throw new Error(`Status ${response.status}`);
                const data = await response.json();
                resultText = data.choices[0].message.content;
                break; 
            } catch (e) {
                console.warn(`Model ${model} failed:`, e.message);
                lastError = e;
            }
        }

        if (!resultText) throw lastError || new Error("All models failed");

        return res.status(200).json({ success: true, text: postProcessText(resultText) });

    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
}
