// api/features/humanizer.js
import { GeminiAPI } from '../utils/geminiAPI.js';

function getRandomTemperature() {
    return 0.7 + Math.random() * 0.6; // 0.7 to 1.3 — high enough for variety, low enough for grammar
}

// ==========================================================================
// BANNED WORDS
// ==========================================================================

const BANNED_WORDS = {
    "utilize": "use", "utilizes": "uses", "utilizing": "using", "utilized": "used",
    "leverage": "use", "leverages": "uses", "leveraging": "using", "leveraged": "used",
    "facilitate": "help", "facilitates": "helps", "facilitating": "helping",
    "optimize": "improve", "optimizes": "improves", "optimizing": "improving",
    "necessitate": "require", "necessitates": "requires", "necessitating": "requiring",
    "exacerbate": "worsen", "exacerbates": "worsens", "exacerbating": "worsening",
    "mitigate": "reduce", "mitigates": "reduces", "mitigating": "reducing",
    "intensify": "worsen", "intensifies": "worsens", "intensifying": "worsening", "intensified": "worsened",
    "escalate": "grow", "escalates": "grows", "escalating": "growing", "escalation": "growth",
    "amplify": "increase", "amplifies": "increases", "amplifying": "increasing",
    "transform": "turn", "transforms": "turns", "transforming": "turning",
    "burgeon": "grow", "burgeons": "grows", "burgeoning": "growing",
    "fundamental": "basic", "fundamentally": "basically",
    "comprehensive": "complete", "comprehensively": "completely",
    "robust": "strong", "robustly": "strongly",
    "viable": "workable", "viability": "workability",
    "systemic": "system-wide", "systemically": "throughout",
    "readily": "easily", "considerable": "major", "considerably": "greatly",
    "apparent": "clear", "apparently": "clearly",
    "prolonged": "long", "arable": "farmable",
    "pre-existing": "existing", "preexisting": "existing",
    "furthermore": "also", "moreover": "also", "additionally": "also",
    "consequently": "so", "nevertheless": "but", "therefore": "so",
    "thus": "so", "hence": "so", "whereby": "where",
    "equitable": "fair", "vulnerable": "exposed", "paramount": "important",
    "imperative": "necessary", "pivotal": "key", "crucial": "important",
    "essential": "needed", "significant": "major",
    "substantial": "large", "numerous": "many", "prudent": "wise",
    "commenced": "started", "concluded": "ended", "engenders": "creates",
    "gravest": "worst", "accelerating": "speeding up", "depletes": "drains",
    "erodes": "weakens", "resilience": "strength", "spiraling": "getting worse",
    "ensuing": "following", "evident": "clear", "merely": "just",
    "withstand": "survive", "comprises": "includes", "constitutes": "is",
    "represents": "is", "undermines": "weakens",
    "alterations": "changes", "alteration": "change",
    "demonstrable": "clear", "demonstrably": "clearly",
    "manifesting": "showing up", "manifests": "shows up",
    "disproportionately": "unfairly", "catastrophic": "severe",
    "intervention": "action", "trajectory": "path",
    "predominantly": "mainly", "unparalleled": "unprecedented"
};

function applyWordSwaps(text) {
    let result = text;
    for (const [bad, good] of Object.entries(BANNED_WORDS)) {
        result = result.replace(new RegExp(`\\b${bad}\\b`, 'gi'), good);
    }
    return result;
}

// ==========================================================================
// SENTENCE SPLITTER - splits text into individual sentences
// ==========================================================================

function splitIntoSentences(text) {
    // Split on .  !  ?  followed by whitespace and a capital letter (or end of string)
    const raw = text.match(/[^.!?]+[.!?]+[\s]*/g) || [text];
    return raw.map(s => s.trim()).filter(s => s.length > 0);
}

// ==========================================================================
// SINGLE SENTENCE HUMANIZER PROMPT
// ==========================================================================

function buildSentencePrompt(sentence, context) {
    return `Rewrite this single sentence so it sounds like a human wrote it. Keep the exact same meaning. Keep an academic tone.

CONTEXT (surrounding sentences — do NOT rewrite these, just use them for flow awareness):
"${context}"

SENTENCE TO REWRITE:
"${sentence}"

RULES:
1. Output ONE sentence only — no extra commentary, no quotation marks around it
2. Keep the same meaning exactly — don't add or remove facts
3. NEVER start with a participial phrase (e.g. "Burning fuels, ..." or "Releasing gases, ...")
4. NEVER use "it's not X, it's Y" or "isn't X, it's Y" constructions
5. NEVER use semicolons or em dashes
6. NEVER use ", which" relative clauses
7. Use contractions naturally where they fit: it's, don't, we're, that's
8. Vary sentence structure — if the original starts with a noun phrase, try starting with "Since", "Because", "While", "When", "Although", "For", or "By"
9. Mix sentence length — the rewritten sentence can be shorter or longer than the original
10. Use plain, direct vocabulary — no formal academic filler words

Output ONLY the rewritten sentence.`;
}

// ==========================================================================
// POST-PROCESSING
// ==========================================================================

function postProcess(text, logs) {
    let result = text;

    // Normalize quotes/apostrophes
    result = result.replace(/[''`´]/g, "'");
    result = result.replace(/[""„]/g, '"');

    // Fix missing space after comma
    result = result.replace(/,([a-zA-Z])/g, ', $1');

    logs.push('Starting pattern removal...');

    // Sentence-level isn't/it's fixes
    const sentences = result.split(/(?<=[.!?])\s+/);
    const fixedSentences = [];

    for (let sentence of sentences) {
        const lowerSentence = sentence.toLowerCase();

        if (lowerSentence.includes("isn't") && lowerSentence.includes("it's")) {
            const itsIndex = lowerSentence.lastIndexOf("it's");
            if (itsIndex !== -1) {
                const afterIts = sentence.substring(itsIndex + 5).trim();
                const isntIndex = lowerSentence.indexOf("isn't");
                const subject = sentence.substring(0, isntIndex).trim();
                sentence = subject + " is " + afterIts;
                logs.push('Fixed: isn\'t...it\'s in same sentence');
            }
        }

        if (lowerSentence.includes("isn't simply") || lowerSentence.includes("isn't just") || lowerSentence.includes("isn't merely")) {
            const itsMatch = sentence.match(/it's (.+)$/i) || sentence.match(/it is (.+)$/i);
            if (itsMatch) {
                const isntIndex = lowerSentence.indexOf("isn't");
                const subject = sentence.substring(0, isntIndex).trim();
                sentence = subject + " is " + itsMatch[1];
                logs.push('Fixed: isn\'t simply/just pattern');
            }
        }

        fixedSentences.push(sentence);
    }

    // Handle "X isn't Y. It's Z." split across sentences
    for (let i = 0; i < fixedSentences.length - 1; i++) {
        const current = fixedSentences[i].toLowerCase();
        const next = fixedSentences[i + 1].toLowerCase();
        if (current.includes("isn't") && next.startsWith("it's ")) {
            const isntIndex = fixedSentences[i].toLowerCase().indexOf("isn't");
            const subject = fixedSentences[i].substring(0, isntIndex).trim();
            const afterIts = fixedSentences[i + 1].substring(5);
            fixedSentences[i] = subject + " is " + afterIts;
            fixedSentences[i + 1] = '';
            logs.push('Fixed: split isn\'t / It\'s across sentences');
        }
    }

    result = fixedSentences.filter(s => s.length > 0).join(' ');

    // Regex pattern fixes
    result = result.replace(/isn't (simply |just |merely |)?([^,\.]+),\s*(it's|it is) ([^\.]+)\./gi, (m, mod, x, pronoun, y) => { logs.push('Fixed: isn\'t X, it\'s Y'); return `is ${y}.`; });
    result = result.replace(/isn't (simply |just |merely |)?([^,\.]+),(it's|it is) ([^\.]+)\./gi, (m, mod, x, pronoun, y) => { logs.push('Fixed: isn\'t X,it\'s Y'); return `is ${y}.`; });
    result = result.replace(/[Ii]t's not [^,]+,\s*(it's|it is) ([^\.]+)\./g, (m, pronoun, y) => { logs.push('Fixed: it\'s not X, it\'s Y'); return `It's ${y}.`; });
    result = result.replace(/[Ii]t's not about [^,]+,\s*(it's|it is) about ([^\.]+)\./g, (m, pronoun, y) => { logs.push('Fixed: it\'s not about X'); return `It's about ${y}.`; });
    result = result.replace(/doesn't (simply |just |merely )?([^,]+),\s*(it's|it is|it) ([^\.]+)\./gi, (m, mod, x, pronoun, y) => { logs.push('Fixed: doesn\'t X, it Y'); return `does ${x} and ${y}.`; });
    result = result.replace(/aren't (simply |just |merely |)?([^,]+),\s*(but|they) ([^\.]+)\./gi, (m, mod, x, conj, y) => { logs.push('Fixed: aren\'t X, but Y'); return `are ${y}.`; });
    result = result.replace(/([^\.]+) isn't ([^\.]+)\.\s*[Ii]t'?s ([^\.]+)\./g, (m, subj, x, z) => { logs.push('Fixed: split isn\'t/It\'s'); return `${subj} is ${z}.`; });
    result = result.replace(/The (basic |real |fundamental )?(choice|question|issue|decision) (isn't|is not) ([^,]+),\s*but ([^\.]+)\./gi, (m, adj, noun, neg, x, y) => { logs.push('Fixed: The choice isn\'t X but Y'); return `The ${adj || ''}${noun} is ${y}.`; });

    // Remove filler phrases
    result = result.replace(/To be clear,\s*/gi, '');
    result = result.replace(/This is an? important point because\s*/gi, '');

    // Structural fixes
    if (/;/.test(result)) { result = result.replace(/;/g, '.'); logs.push('Fixed: semicolons → periods'); }
    if (/[—–]/.test(result)) { result = result.replace(/\s*[—–]\s*/g, ', '); logs.push('Fixed: em dashes → commas'); }
    if (/,\s*which\s+/i.test(result)) { result = result.replace(/,\s*which\s+(\w+)/gi, '. It $1'); logs.push('Fixed: ", which" → ". It"'); }

    // Contractions
    result = result.replace(/\bIt is\b/g, "It's");
    result = result.replace(/\bthat is\b/gi, "that's");
    result = result.replace(/\bdoes not\b/gi, "doesn't");
    result = result.replace(/\bdo not\b/gi, "don't");
    result = result.replace(/\bis not\b/gi, "isn't");
    result = result.replace(/\bare not\b/gi, "aren't");
    result = result.replace(/\bwe are\b/gi, "we're");
    result = result.replace(/\bthey are\b/gi, "they're");
    result = result.replace(/\bcannot\b/gi, "can't");
    result = result.replace(/\bwill not\b/gi, "won't");

    // Grammar fixes — AFTER contractions
    result = result.replace(/\ba ([aeiouAEIOU][a-zA-Z])/g, 'an $1');

    // Capitalisation fixes
    result = result.replace(/([.!?])\s+([a-z])/g, (m, punct, letter) => `${punct} ${letter.toUpperCase()}`);
    result = result.replace(/^([a-z])/, (m, letter) => letter.toUpperCase());
    result = result.replace(/\.\s+so,\s+/gi, '. So, ');

    // Cleanup
    result = result.replace(/\.\s*\./g, '.');
    result = result.replace(/\s{2,}/g, ' ');
    result = result.trim();

    return result;
}

// ==========================================================================
// MAIN HANDLER
// ==========================================================================

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.status(200).end();

    const logs = [];

    try {
        const { text, apiKey } = req.body;
        const GEMINI_KEY = apiKey || process.env.GEMINI_API_KEY;

        if (!text) throw new Error("No text provided.");
        if (!GEMINI_KEY) throw new Error("No Gemini API key provided.");

        logs.push(`Input: ${text.length} chars`);

        // Step 1: Word swaps on the full input
        let processed = applyWordSwaps(text);
        logs.push('Applied banned word replacements');

        // Step 2: Split into sentences
        const sentences = splitIntoSentences(processed);
        logs.push(`Split into ${sentences.length} sentences`);

        // Step 3: Humanize each sentence individually, in parallel
        const temperature = getRandomTemperature();
        logs.push(`Temperature: ${temperature.toFixed(2)}`);

        const humanizedSentences = await Promise.all(
            sentences.map(async (sentence, i) => {
                // Build context window: 1 sentence before and after (if they exist)
                const contextParts = [];
                if (i > 0) contextParts.push(sentences[i - 1]);
                contextParts.push(`>>> ${sentence} <<<`); // mark the target sentence
                if (i < sentences.length - 1) contextParts.push(sentences[i + 1]);
                const context = contextParts.join(' ');

                const prompt = buildSentencePrompt(sentence, context);

                try {
                    const raw = await GeminiAPI.chat(prompt, GEMINI_KEY, temperature);
                    const cleaned = raw.trim().replace(/^["']|["']$/g, '');
                    logs.push(`Sentence ${i + 1}/${sentences.length}: OK`);
                    return cleaned;
                } catch (err) {
                    logs.push(`Sentence ${i + 1}/${sentences.length}: FAILED (${err.message}), using original`);
                    return sentence; // fallback to original if API call fails
                }
            })
        );

        // Step 4: Rejoin and post-process
        let result = humanizedSentences.join(' ');
        result = postProcess(result, logs);

        // Step 5: Final word swap pass (AI may reintroduce banned words)
        result = applyWordSwaps(result);

        logs.push(`Final: ${result.length} chars`);

        return res.status(200).json({ success: true, result, logs });

    } catch (error) {
        logs.push(`ERROR: ${error.message}`);
        return res.status(500).json({ success: false, error: error.message, logs });
    }
}

export { postProcess as PostProcessor, BANNED_WORDS as AI_VOCAB_SWAPS, applyWordSwaps as killEmDashes };
