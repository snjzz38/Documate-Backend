
// api/features/humanizer.js
import { GroqAPI } from '../utils/groqAPI.js';

// ==========================================================================
// VOCABULARY REPLACEMENT MAP (Mirrors Frontend)
// ==========================================================================
const AI_VOCAB_SWAPS = {
    "far-reaching": ["huge", "big", "wide", "global", "major"],
    "widespread": ["common", "everywhere", "normal"],
    "harness": ["use", "work with", "control"],
    "enhance": ["better", "improve", "help"],
    "evolving": ["changing", "growing", "shifting"],
    "redefined": ["changed", "redone", "new"],
    "pop up": ["appear", "start", "happen"],
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
    "employ": ["use", "hire"],
    "testament": ["proof", "sign"],
    "symphony": ["mix", "group", "set"],
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
    "periods": ["times", "years"],
    "marks": ["is", "shows"],
    "reshapes": ["changes", "moves"],
    "fosters": ["helps", "grows", "aids"],
    "underscores": ["shows", "points out"],
    "amplifies": ["increases", "raises"],
    "optimize": ["improve", "make best"],
    "deploy": ["use", "put to work"],
    "navigate": ["move through", "handle"],
    "initiative": ["plan", "effort"],
    "framework": ["plan", "structure", "system"],
    "methodology": ["method", "way", "approach"],
    "strive": ["try", "work hard"],
    "endeavor": ["try", "effort"],
    "robust": ["strong", "tough"],
    "scalable": ["able to grow"],
    "seamless": ["smooth", "easy"],
    "dynamic": ["active", "changing"],
    "holistic": ["whole", "full", "complete"],
    "marked": ["signaled", "shown", "said"],
    "adopt": ["take", "use", "start"],
    "adoption": ["use", "start", "taking"],
    "reflects": ["shows", "is"],
    "influencing": ["changing", "moving", "affecting"],
    "interacting": ["talking", "meeting", "working"],
    "transformative": ["changing", "big", "huge"],
    "quest": ["drive", "goal", "want"],
    "profound": ["big", "deep", "huge"],
    "fundamentally": ["at the core", "really", "totally"],
    "empower": ["help", "give power to", "let"],
    "empowered": ["helped", "let", "allowed"],
    "accompanied": ["with", "plus", "and added"],
    "versatility": ["range", "skills", "uses"],
    "Furthermore": ["Also", "Plus", "And"],
    "Moreover": ["Also", "Plus", "And"],
    "Additionally": ["Also", "Plus", "And"],
    "Subsequently": ["Then", "After", "Next"],
    "Consequently": ["So", "Thus", "Hence"],
    "Nevertheless": ["Still", "But", "Yet"],
    "Notwithstanding": ["Despite", "Even so"],
    "Henceforth": ["From now", "Going forward"],
    "Whereby": ["where", "by which"],
    "Thereof": ["of it", "of this"],
    "Wherein": ["where", "in which"],
    "commencing": ["starting", "beginning"],
    "pertaining": ["about", "related to"],
    "aforementioned": ["mentioned", "said", "this"],
    "heretofore": ["before", "until now"],
    "inasmuch": ["since", "because"]
};

// ==========================================================================
// TONE STRATEGIES
// ==========================================================================
const STRATEGIES = {
    'Casual': [
        { name: "The Sentence Builder", instruction: "Make sentences simple. Connect them with 'and', 'but', 'so'." },
        { name: "The Casual Writer", instruction: "Write like you're texting a smart friend. No big words." },
        { name: "The Storyteller", instruction: "Make it flow like a conversation. Use 'you' and 'we'." }
    ],
    'Academic': [
        { name: "The Plain Writer", instruction: "Explain simply but keep it formal. No complex phrases." },
        { name: "The Fact Scribe", instruction: "Write facts clearly. Connect them with logic words." },
        { name: "The Clear Scholar", instruction: "Be precise but readable. Avoid jargon where possible." }
    ],
    'Professional': [
        { name: "The Direct Pro", instruction: "State actions clearly. Be concise and confident." },
        { name: "The Streamliner", instruction: "Merge ideas smoothly. Keep momentum." },
        { name: "The Executive", instruction: "Get to the point. Value the reader's time." }
    ]
};

// ==========================================================================
// POST-PROCESSING PIPELINE
// ==========================================================================
const PostProcessor = {
    // 1. Force Word Replacement
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

    // 2. Fix Specific Hallucinated Participles
    fixSpecificParticiples(text) {
        let fixed = text;
        fixed = fixed.replace(/fundamentally altering/gi, "fundamentally alters");
        fixed = fixed.replace(/empowered ([\w\s]+)/gi, "helped $1");
        fixed = fixed.replace(/accompanied by/gi, "with");
        fixed = fixed.replace(/exclusive area of/gi, "only for");
        fixed = fixed.replace(/showcasing/gi, "showing");
        fixed = fixed.replace(/utilizing/gi, "using");
        fixed = fixed.replace(/leveraging/gi, "using");
        fixed = fixed.replace(/facilitating/gi, "helping");
        fixed = fixed.replace(/implementing/gi, "using");
        return fixed;
    },

    // 3. Fix Participle Lists
    fixParticipleLists(text) {
        const regex = /, (\w+)ing\b/g;
        return text.replace(regex, (match, verbIng) => {
            let base = verbIng.replace(/ing$/, '');
            let verbS = base;
            if (base.endsWith('e')) verbS = base + 's';
            else if (base.endsWith('ss') || base.endsWith('x') || base.endsWith('ch') || base.endsWith('sh')) verbS = base + 'es';
            else verbS = base + 's';
            return ` and ${verbS}`;
        });
    },

    // 4. Fix Common AI Typos
    fixCommonTypos(text) {
        let fixed = text;
        fixed = fixed.replace(/computs\b/g, "computing");
        fixed = fixed.replace(/showcass\b/g, "shows");
        fixed = fixed.replace(/changs\b/g, "changes");
        fixed = fixed.replace(/\s{2,}/g, ' ');
        return fixed;
    },

    // 5. Syntax Shuffle
    shuffleSyntax(text) {
        const patterns = [
            { regex: /^(Because ([^,]+)),\s*(.*)$/gm, replace: "$3 $1" },
            { regex: /^(Since ([^,]+)),\s*(.*)$/gm, replace: "$3 $1" },
            { regex: /^(Although ([^,]+)),\s*(.*)$/gm, replace: "$3 $1" }
        ];
        let shuffled = text;
        // Only apply 50% of the time for variety
        if (Math.random() > 0.5) {
            patterns.forEach(p => { shuffled = shuffled.replace(p.regex, p.replace); });
        }
        return shuffled;
    },

    // 6. Inject Contractions
    injectContractions(text) {
        let processed = text;
        processed = processed.replace(/\bdo not\b/gi, "don't");
        processed = processed.replace(/\bdoes not\b/gi, "doesn't");
        processed = processed.replace(/\bis not\b/gi, "isn't");
        processed = processed.replace(/\bare not\b/gi, "aren't");
        processed = processed.replace(/\bcan not\b/gi, "can't");
        processed = processed.replace(/\bcannot\b/gi, "can't");
        processed = processed.replace(/\bwill not\b/gi, "won't");
        processed = processed.replace(/\bwould not\b/gi, "wouldn't");
        processed = processed.replace(/\bshould not\b/gi, "shouldn't");
        processed = processed.replace(/\bcould not\b/gi, "couldn't");
        processed = processed.replace(/\bhas not\b/gi, "hasn't");
        processed = processed.replace(/\bhave not\b/gi, "haven't");
        processed = processed.replace(/\bwas not\b/gi, "wasn't");
        processed = processed.replace(/\bwere not\b/gi, "weren't");
        processed = processed.replace(/\bit is\b/gi, "it's");
        processed = processed.replace(/\bthat is\b/gi, "that's");
        processed = processed.replace(/\bwhat is\b/gi, "what's");
        processed = processed.replace(/\bhere is\b/gi, "here's");
        processed = processed.replace(/\bthere is\b/gi, "there's");
        return processed;
    },

    // 7. Clean AI Output
    cleanOutput(text) {
        let cleaned = text;
        const preambles = [
            "Here's the rewritten text",
            "Here is the rewritten text",
            "Rewritten version:",
            "Sure, here is the rewritten text",
            "Below is the rewritten text",
            "Here's a rewritten version",
            "I've rewritten the text"
        ];
        preambles.forEach(p => {
            const regex = new RegExp(`^${p}[:\\.\\s]*`, "gim");
            cleaned = cleaned.replace(regex, "");
        });
        cleaned = cleaned.replace(/^["']|["']$/g, '');
        cleaned = cleaned.replace(/^-\s+/gm, '');
        cleaned = cleaned.replace(/—/g, ' and ').replace(/–/g, ' and ');
        return cleaned.trim();
    },

    // Full pipeline
    process(text, tone) {
        let result = this.cleanOutput(text);
        result = this.forceWordReplacements(result);
        result = this.fixSpecificParticiples(result);
        result = this.fixCommonTypos(result);
        result = this.fixParticipleLists(result);
        result = this.shuffleSyntax(result);
        // Only inject contractions for Casual tone
        if (tone === 'Casual') {
            result = this.injectContractions(result);
        }
        return result;
    }
};

// ==========================================================================
// HELPER FUNCTIONS
// ==========================================================================

function analyzeInputTone(text) {
    const academicMarkers = ['utilize', 'leverage', 'delve', 'facilitate', 'underscore', 'comprehensive', 'exacerbate', 'methodology', 'furthermore', 'consequently'];
    let score = 0;
    academicMarkers.forEach(w => {
        if (text.toLowerCase().includes(w)) score++;
    });
    if (score > 2) return 'Academic';
    if (text.includes("I ") || text.includes("I'm") || text.includes("we're") || text.includes("you")) return 'Casual';
    return 'Professional';
}

function generateVocabularyInstructions() {
    const forbidden = Object.keys(AI_VOCAB_SWAPS).slice(0, 30); // Top 30 most common
    return `FORBIDDEN WORDS (never use these):\n${forbidden.map(w => `- ${w}`).join('\n')}`;
}

function dynamicChunking(text) {
    const rawSentences = text.match(/[^.!?\n]+[.!?\n]+(\s|$)/g) || [text];
    const sentences = rawSentences.filter(s => s.trim().length > 0);
    const totalSentences = sentences.length;
    const MAX_CHUNKS = 6;
    let sentencesPerChunk = Math.ceil(totalSentences / MAX_CHUNKS);
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

function buildPrompt(chunk, tone, vocabRules, strategy) {
    return `SYSTEM: You are a human writer. Rewrite text to sound simple and natural.
VOICE: ${tone}

${vocabRules}

CRITICAL "NATURAL" RULES:
1. **NO PARTICIPLE PHRASES**:
   - BANNED: "altering", "accompanying", "empowered", "enhancing", "facilitating", "utilizing", "leveraging"
   - DO NOT use these to connect sentences.
   - BAD: "AI helps, making life easier."
   - GOOD: "AI helps and makes life easier."

2. **SIMPLE COMPOUND SENTENCES**:
   - Connect ideas with "and", "so", "because", "but".
   - Avoid complex dependent clauses.
   - Keep sentences under 25 words when possible.

3. **SPELLING & GRAMMAR**:
   - Ensure "computing" not "computs".
   - Ensure "shows" not "showcass".
   - Double-check verb forms.

4. **NO METADATA**:
   - Just output the rewritten text.
   - No explanations, no preambles.

5. **STYLE: ${strategy.name}**
   - ${strategy.instruction}

TEXT TO REWRITE:
"${chunk}"

OUTPUT (rewritten text only):`;
}

// ==========================================================================
// MAIN HANDLER
// ==========================================================================
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

        // Safety limit
        const safeText = text.substring(0, 12000);
        
        // Detect tone if not provided
        const detectedTone = tone || analyzeInputTone(safeText);
        const vocabRules = generateVocabularyInstructions();
        
        // Chunk the text
        const chunks = dynamicChunking(safeText);
        const results = [];

        // Process each chunk
        for (let i = 0; i < chunks.length; i++) {
            const chunk = chunks[i];
            
            // Select random strategy for variety
            const strategies = STRATEGIES[detectedTone] || STRATEGIES['Professional'];
            const strategy = strategies[Math.floor(Math.random() * strategies.length)];
            
            // Build prompt
            const prompt = buildPrompt(chunk, detectedTone, vocabRules, strategy);
            
            // Call Groq
            const messages = [
                { role: "user", content: prompt }
            ];
            
            let rawDraft = await GroqAPI.chat(messages, GROQ_KEY, false);
            
            // Post-process
            let cleanDraft = PostProcessor.process(rawDraft, detectedTone);
            results.push(cleanDraft);
        }

        // Join results
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
