// api/features/humanizer.js
import { GroqAPI } from '../utils/groqAPI.js';

const AI_VOCAB_SWAPS = {
    "far-reaching": ["huge", "big", "wide", "global", "major"],
    "widespread": ["common", "everywhere", "normal"],
    "harness": ["use", "work with", "control"],
    "enhance": ["better", "improve", "help"],
    "evolving": ["changing", "growing", "shifting"],
    "redefined": ["changed", "redone", "new"],
    "crucial": ["key", "vital", "must-have"],
    "pivotal": ["key", "major", "main"],
    "imperative": ["must", "have to", "needed"],
    "facilitate": ["help", "ease", "make easy"],
    "exacerbate": ["make worse", "hurt"],
    "mitigate": ["stop", "fix", "help"],
    "underscore": ["show", "point out"],
    "delve": ["look at", "check", "dig into"],
    "leverage": ["use", "work with"],
    "utilize": ["use"],
    "employ": ["use"],
    "testament": ["proof", "sign"],
    "revolutionize": ["change", "fix", "update"],
    "paradigm shift": ["big change", "new way"],
    "multifaceted": ["complex", "mixed", "many-sided"],
    "realm": ["world", "area", "field"],
    "landscape": ["world", "scene", "view"],
    "domain": ["area", "field", "part"],
    "comprehensive": ["full", "complete", "total"],
    "signify": ["mean", "show"],
    "constitutes": ["is", "makes"],
    "capabilities": ["skills", "powers", "abilities"],
    "fosters": ["helps", "grows", "aids"],
    "underscores": ["shows", "points out"],
    "amplifies": ["increases", "raises"],
    "optimize": ["improve", "make best"],
    "deploy": ["use", "put to work"],
    "navigate": ["move through", "handle"],
    "framework": ["plan", "structure", "system"],
    "methodology": ["method", "way", "approach"],
    "strive": ["try", "work hard"],
    "robust": ["strong", "tough"],
    "seamless": ["smooth", "easy"],
    "holistic": ["whole", "full", "complete"],
    "transformative": ["changing", "big", "huge"],
    "profound": ["big", "deep", "huge"],
    "fundamentally": ["at the core", "really", "totally"],
    "empower": ["help", "give power to", "let"],
    "Furthermore": ["Also", "Plus", "And"],
    "Moreover": ["Also", "Plus", "And"],
    "Additionally": ["Also", "Plus", "And"],
    "Subsequently": ["Then", "After", "Next"],
    "Consequently": ["So", "Thus", "Hence"],
    "Nevertheless": ["Still", "But", "Yet"],
    "aforementioned": ["mentioned", "said", "this"],
    "commencing": ["starting", "beginning"],
    "pertaining": ["about", "related to"],
};

const PostProcessor = {
    forceWordReplacements(text) {
        let processed = text;
        for (const [bad, goods] of Object.entries(AI_VOCAB_SWAPS)) {
            const regex = new RegExp(`\\b${bad}\\b`, 'gi');
            if (regex.test(processed)) {
                processed = processed.replace(regex, goods[0]);
            }
        }
        return processed;
    },

    fixParticiples(text) {
        let fixed = text;
        fixed = fixed.replace(/fundamentally altering/gi, "fundamentally alters");
        fixed = fixed.replace(/accompanied by/gi, "with");
        fixed = fixed.replace(/showcasing/gi, "showing");
        fixed = fixed.replace(/utilizing/gi, "using");
        fixed = fixed.replace(/leveraging/gi, "using");
        fixed = fixed.replace(/facilitating/gi, "helping");
        fixed = fixed.replace(/implementing/gi, "using");
        return fixed;
    },

    cleanOutput(text) {
        let cleaned = text;
        const preambles = [
            "Here's the rewritten text",
            "Here is the rewritten text",
            "Rewritten version:",
            "Sure, here is",
            "Below is the rewritten",
            "Here's a rewritten version",
            "I've rewritten the text",
            "Here is the humanized",
            "Here's the humanized"
        ];
        preambles.forEach(p => {
            const regex = new RegExp(`^${p}[:\\.\\s]*`, "gim");
            cleaned = cleaned.replace(regex, "");
        });
        cleaned = cleaned.replace(/^["']|["']$/g, '');
        cleaned = cleaned.replace(/^-\s+/gm, '');
        cleaned = cleaned.replace(/\s{2,}/g, ' ');
        return cleaned.trim();
    },

    // Inject imperfections that humans make
    injectHumanImperfections(text) {
        const sentences = text.split(/(?<=[.!?])\s+/);
        return sentences.map((sent, i) => {
            // Occasionally start with a conjunction (humans do this)
            if (i > 0 && Math.random() < 0.08) {
                const starters = ['And ', 'But ', 'So '];
                const starter = starters[Math.floor(Math.random() * starters.length)];
                // Only if sentence doesn't already start with one
                if (!/^(And|But|So|Yet|Or)\s/i.test(sent)) {
                    sent = starter + sent.charAt(0).toLowerCase() + sent.slice(1);
                }
            }
            return sent;
        }).join(' ');
    },

    process(text, tone) {
        let result = this.cleanOutput(text);
        result = this.forceWordReplacements(result);
        result = this.fixParticiples(result);
        if (tone === 'Casual') result = this.injectHumanImperfections(result);
        return result;
    }
};

function analyzeInputTone(text) {
    const academicMarkers = ['utilize', 'leverage', 'delve', 'facilitate', 'underscore', 'comprehensive', 'exacerbate', 'methodology', 'furthermore', 'consequently'];
    let score = 0;
    academicMarkers.forEach(w => { if (text.toLowerCase().includes(w)) score++; });
    if (score > 2) return 'Academic';
    if (text.includes("I ") || text.includes("I'm") || text.includes("we're")) return 'Casual';
    return 'Professional';
}

function dynamicChunking(text) {
    const rawSentences = text.match(/[^.!?\n]+[.!?\n]+(\s|$)/g) || [text];
    const sentences = rawSentences.filter(s => s.trim().length > 0);
    const MAX_CHUNKS = 6;
    let sentencesPerChunk = Math.ceil(sentences.length / MAX_CHUNKS);
    if (sentencesPerChunk < 1) sentencesPerChunk = 1;

    const chunks = [];
    let currentChunk = "";
    let count = 0;

    for (let i = 0; i < sentences.length; i++) {
        currentChunk += sentences[i];
        count++;
        if (count >= sentencesPerChunk || i === sentences.length - 1) {
            if (currentChunk.trim().length > 0) chunks.push(currentChunk.trim());
            currentChunk = "";
            count = 0;
        }
    }
    return chunks;
}

function buildPrompt(chunk, tone, chunkIndex, totalChunks) {
    const forbidden = Object.keys(AI_VOCAB_SWAPS).slice(0, 25).map(w => `- ${w}`).join('\n');

    // Rotate between different humanization strategies per chunk
    const strategies = [
        `Rewrite as if explaining to a smart friend. Use direct, plain language. Vary sentence length — mix short punchy sentences with longer ones.`,
        `Rewrite in a confident, direct voice. Cut unnecessary words. Start some sentences with the subject immediately. Avoid throat-clearing phrases.`,
        `Rewrite with slight informality while keeping the meaning. Use concrete words over abstract ones. Make every sentence pull its weight.`,
        `Rewrite clearly and specifically. Avoid vague academic filler. Replace passive constructions with active ones where possible.`,
        `Rewrite as a knowledgeable person would speak — precise but not stiff. Vary how sentences begin. Some short, some longer.`,
        `Rewrite naturally. Cut words that don't add meaning. Use the simplest word that still fits. Make transitions feel organic.`,
    ];
    const strategy = strategies[chunkIndex % strategies.length];

    return `You are rewriting text to sound genuinely human-written, not AI-generated.

STRATEGY: ${strategy}

FORBIDDEN WORDS — never use these:
${forbidden}

RULES:
1. Never use passive voice if active works just as well
2. Vary sentence length and structure throughout — this is critical
3. No filler phrases: "it is worth noting", "it is important to", "one must consider"
4. No transition words at the start of every sentence — mix it up
5. Keep all citations, superscripts, and footnote numbers exactly as they are
6. Keep all technical terms and proper nouns unchanged
7. Output ONLY the rewritten text — no explanations, no preamble
8. Tone: ${tone}

TEXT:
${chunk}

REWRITTEN:`;
}

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        const { text, tone, apiKey } = req.body;
        const GROQ_KEY = apiKey || process.env.GROQ_API_KEY;

        if (!text) throw new Error("No text provided.");
        if (text.length < 10) throw new Error("Text too short (minimum 10 characters).");

        const safeText = text.substring(0, 12000);
        const detectedTone = tone || analyzeInputTone(safeText);
        const chunks = dynamicChunking(safeText);
        const results = [];

        for (let i = 0; i < chunks.length; i++) {
            const prompt = buildPrompt(chunks[i], detectedTone, i, chunks.length);
            const messages = [{ role: "user", content: prompt }];
            let rawDraft = await GroqAPI.chat(messages, GROQ_KEY, false);
            let cleanDraft = PostProcessor.process(rawDraft, detectedTone);
            results.push(cleanDraft);
        }

        const finalOutput = results.join(' ').replace(/\s{2,}/g, ' ').trim();

        return res.status(200).json({
            success: true,
            result: finalOutput,
            tone: detectedTone,
            chunks: chunks.length
        });

    } catch (error) {
        console.error("Humanizer Error:", error);
        return res.status(500).json({ success: false, error: error.message });
    }
}
