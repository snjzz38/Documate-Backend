// api/features/humanizer.js
import { GeminiAPI } from '../utils/geminiAPI.js';

function getRandomTemperature() {
    return 0.5 + Math.random(); // 0.5 to 1.5
}

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
    // NEW
    "alterations": "changes", "alteration": "change"
};

function applyWordSwaps(text) {
    let result = text;
    for (const [bad, good] of Object.entries(BANNED_WORDS)) {
        result = result.replace(new RegExp(`\\b${bad}\\b`, 'gi'), good);
    }
    return result;
}

function postProcess(text, logs) {
    let result = text;

    // --- 1. Normalize quotes/apostrophes ---
    result = result.replace(/[''`´]/g, "'");
    result = result.replace(/[""„]/g, '"');

    // --- 2. Fix missing space after comma ---
    result = result.replace(/,([a-zA-Z])/g, ', $1');

    logs.push('Starting pattern removal...');

    // --- 3. Sentence-level isn't/it's fixes ---
    const sentences = result.split(/(?<=[.!?])\s+/);
    const fixedSentences = [];

    for (let sentence of sentences) {
        const lowerSentence = sentence.toLowerCase();

        if (lowerSentence.includes("isn't") && lowerSentence.includes("it's")) {
            logs.push('Found isn\'t...it\'s in: ' + sentence.substring(0, 40) + '...');
            const itsIndex = lowerSentence.lastIndexOf("it's");
            if (itsIndex !== -1) {
                const afterIts = sentence.substring(itsIndex + 5).trim();
                const isntIndex = lowerSentence.indexOf("isn't");
                const subject = sentence.substring(0, isntIndex).trim();
                sentence = subject + " is " + afterIts;
                logs.push('Fixed to: ' + sentence.substring(0, 40) + '...');
            }
        }

        if (lowerSentence.includes("isn't simply") || lowerSentence.includes("isn't just") || lowerSentence.includes("isn't merely")) {
            logs.push('Found isn\'t simply/just in: ' + sentence.substring(0, 40) + '...');
            const itsMatch = sentence.match(/it's (.+)$/i) || sentence.match(/it is (.+)$/i);
            if (itsMatch) {
                const isntIndex = lowerSentence.indexOf("isn't");
                const subject = sentence.substring(0, isntIndex).trim();
                sentence = subject + " is " + itsMatch[1];
                logs.push('Fixed to: ' + sentence.substring(0, 40) + '...');
            }
        }

        fixedSentences.push(sentence);
    }

    // Handle "X isn't Y. It's Z." split across sentences
    for (let i = 0; i < fixedSentences.length - 1; i++) {
        const current = fixedSentences[i].toLowerCase();
        const next = fixedSentences[i + 1].toLowerCase();
        if (current.includes("isn't") && next.startsWith("it's ")) {
            logs.push('Found split pattern across sentences');
            const isntIndex = fixedSentences[i].toLowerCase().indexOf("isn't");
            const subject = fixedSentences[i].substring(0, isntIndex).trim();
            const afterIts = fixedSentences[i + 1].substring(5);
            fixedSentences[i] = subject + " is " + afterIts;
            fixedSentences[i + 1] = '';
        }
    }

    result = fixedSentences.filter(s => s.length > 0).join(' ');

    // --- 4. Regex pattern fixes ---
    result = result.replace(/isn't (simply |just |merely |)?([^,\.]+),\s*(it's|it is) ([^\.]+)\./gi, (m, mod, x, pronoun, y) => {
        logs.push('Fixed: isn\'t X, it\'s/is Y');
        return `is ${y}.`;
    });
    result = result.replace(/isn't (simply |just |merely |)?([^,\.]+),(it's|it is) ([^\.]+)\./gi, (m, mod, x, pronoun, y) => {
        logs.push('Fixed: isn\'t X,it\'s Y (no space)');
        return `is ${y}.`;
    });
    result = result.replace(/isn't (simply |just |merely |)?([^\.]+)\.\s*[Ii]t'?s ([^\.]+)\./gi, (m, mod, x, y) => {
        logs.push('Fixed: isn\'t X. It\'s Y (split)');
        return `is ${y}.`;
    });
    result = result.replace(/[Ii]t's not [^,]+,\s*(it's|it is) ([^\.]+)\./g, (m, pronoun, y) => {
        logs.push('Fixed: it\'s not X, it\'s Y');
        return `It's ${y}.`;
    });
    result = result.replace(/[Ii]t's not about [^,]+,\s*(it's|it is) about ([^\.]+)\./g, (m, pronoun, y) => {
        logs.push('Fixed: it\'s not about X');
        return `It's about ${y}.`;
    });
    result = result.replace(/doesn't (simply |just |merely )?([^,]+),\s*(it's|it is|it) ([^\.]+)\./gi, (m, mod, x, pronoun, y) => {
        logs.push('Fixed: doesn\'t X, it Y');
        return `does ${x} and ${y}.`;
    });
    result = result.replace(/aren't (simply |just |merely |)?([^,]+),\s*(but|they) ([^\.]+)\./gi, (m, mod, x, conj, y) => {
        logs.push('Fixed: aren\'t X, but Y');
        return `are ${y}.`;
    });
    result = result.replace(/([^\.]+) isn't ([^\.]+)\.\s*[Ii]t'?s ([^\.]+)\./g, (m, subj, x, z) => {
        logs.push('Fixed: split isn\'t/It\'s pattern');
        return `${subj} is ${z}.`;
    });
    result = result.replace(/not (simply |just |merely )?[^,]+,\s*(it's|it is) /gi, () => {
        logs.push('Fixed: not just mid-sentence');
        return '';
    });
    result = result.replace(/The (basic |real |fundamental )?(choice|question|issue|decision) (isn't|is not) ([^,]+),\s*but ([^\.]+)\./gi, (m, adj, noun, neg, x, y) => {
        logs.push('Fixed: The choice isn\'t X but Y');
        return `The ${adj || ''}${noun} is ${y}.`;
    });
    result = result.replace(/([Ww]e face a )(decision|choice) not between ([^,]+),\s*but between ([^\.]+)\./gi, (m, prefix, noun, x, y) => {
        logs.push('Fixed: decision not between X but Y');
        return `${prefix}${noun} between ${y}.`;
    });

    // --- 5. Remove filler phrases ---
    result = result.replace(/To be clear,\s*/gi, '');
    result = result.replace(/This is an? important point because\s*/gi, '');

    // --- 6. Structural fixes ---
    if (/;/.test(result)) {
        result = result.replace(/;/g, '.');
        logs.push('Fixed: semicolons → periods');
    }
    if (/[—–]/.test(result)) {
        result = result.replace(/\s*[—–]\s*/g, ', ');
        logs.push('Fixed: em dashes → commas');
    }
    if (/,\s*which\s+/i.test(result)) {
        result = result.replace(/,\s*which\s+(\w+)/gi, '. It $1');
        logs.push('Fixed: ", which" → ". It"');
    }

    // --- 7. Add contractions ---
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

    // --- 8. Grammar fixes (MUST come AFTER contractions to avoid "an speeding up") ---
    // Fix "a" before vowels — but skip before contractions like "an isn't"
    result = result.replace(/\ba ([aeiouAEIOU][a-zA-Z])/g, 'an $1');

    // --- 9. Capitalisation fixes ---
    // Fix lowercase after period/!/? 
    result = result.replace(/([.!?])\s+([a-z])/g, (m, punct, letter) => `${punct} ${letter.toUpperCase()}`);
    // Fix sentence starting with lowercase
    result = result.replace(/^([a-z])/, (m, letter) => letter.toUpperCase());
    // Fix "so," that begins a sentence fragment (common Gemini artifact)
    result = result.replace(/\.\s+so,\s+/gi, '. So, ');

    // --- 10. Cleanup ---
    result = result.replace(/\.\s*\./g, '.');
    result = result.replace(/\s{2,}/g, ' ');
    result = result.trim();

    return result;
}

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

        let processed = applyWordSwaps(text);
        logs.push('Applied banned word replacements');

        const prompt = `Rewrite this text to sound like a human wrote it. Keep the academic tone.

TEXT:
"${processed}"

SENTENCE VARIETY (most important rule):
- Mix sentence lengths aggressively: some sentences should be under 8 words, others over 30.
- Vary how sentences start: use "Since", "Because", "While", "By", "When", "Although", "For", "In fact" — not always a noun phrase.
- Vary sentence types: simple, compound, complex. Don't string together three compound sentences in a row.
- High burstiness: short punchy sentence. Then a longer, more elaborate one that builds on the idea and connects related concepts. Short again.

ABSOLUTE RULES — NEVER USE:
1. NEVER "it's not X, it's Y" or "isn't X, it's Y" in any form
2. NEVER "isn't simply/just/merely X, it is Y"
3. NEVER "doesn't just X, it Y"
4. NEVER "not about X, it's about Y"
5. NEVER split contrasts: "X isn't Y. It's Z."
6. NEVER "The choice isn't X, but Y"
7. NEVER semicolons or em dashes
8. NEVER ", which" relative clauses
9. NEVER "To be clear," or "This is an important point"
10. NEVER participial openers like "Burning fossil fuels, ... " or "Releasing greenhouse gases, ..."

When emphasising something, state it directly:
- BAD: "isn't simply wise, it is necessary"
- GOOD: "is necessary"

Use contractions naturally: it's, don't, we're, that's.
Connect ideas with: and, but, because, while, since, as, though.

Output ONLY the rewritten text, nothing else.`;

        logs.push('Sending to Gemini...');

        const temperature = getRandomTemperature();
        logs.push(`Temperature: ${temperature.toFixed(2)}`);

        const result_raw = await GeminiAPI.chat(prompt, GEMINI_KEY, temperature);
        let result = result_raw.trim().replace(/^["']|["']$/g, '');

        logs.push(`Gemini response (first 150 chars): ${result.substring(0, 150)}...`);

        result = postProcess(result, logs);
        result = applyWordSwaps(result);

        logs.push(`Final: ${result.length} chars`);

        return res.status(200).json({ success: true, result, logs });

    } catch (error) {
        logs.push(`ERROR: ${error.message}`);
        return res.status(500).json({ success: false, error: error.message, logs });
    }
}

export { postProcess as PostProcessor, BANNED_WORDS as AI_VOCAB_SWAPS, applyWordSwaps as killEmDashes };
