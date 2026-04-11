// api/features/humanizer.js
import { GeminiAPI } from '../utils/geminiAPI.js';
import { HumanizerPrompts } from '../utils/prompts.js';

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
    "exacerbate": "worsen", "exacerbates": "worsens", "exacerbating": "worsening", "exacerbated": "worsened",
    "mitigate": "reduce", "mitigates": "reduces", "mitigating": "reducing",
    "intensify": "worsen", "intensifies": "worsens", "intensifying": "worsening", "intensified": "worsened",
    "escalate": "grow", "escalates": "grows", "escalating": "growing", "escalation": "growth",
    "amplify": "increase", "amplifies": "increases", "amplifying": "increasing",
    "transform": "turn", "transforms": "turns", "transforming": "turning",
    "burgeon": "grow", "burgeons": "grows", "burgeoning": "growing",
    "fundamental": "basic", "fundamentally": "basically",
    "comprehensive": "full", "comprehensively": "fully",
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
    "predominantly": "mainly", "unparalleled": "unmatched",
    "unmistakable": "obvious", "destabilize": "weaken"
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
    const raw = text.match(/[^.!?]+[.!?]+[\s]*/g) || [text];
    return raw.map(s => s.trim()).filter(s => s.length > 0);
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

    // ===========================================
    // CONTRAST PATTERN FIXES
    // ===========================================
    
    // "don't just X, but also Y" → "X and Y"
    result = result.replace(/don't just ([^,]+),\s*but also ([^\.]+)/gi, (m, x, y) => {
        logs.push('Fixed: don\'t just X, but also Y');
        return `${x} and ${y}`;
    });
    
    // "don't only X, but also Y" → "X and Y"
    result = result.replace(/don't only ([^,]+),\s*but also (in )?([^\.]+)/gi, (m, x, inWord, y) => {
        logs.push('Fixed: don\'t only X, but also Y');
        return `${x} and ${y}`;
    });
    
    // "doesn't just X, but also Y" → "X and Y"
    result = result.replace(/doesn't just ([^,]+),\s*but also ([^\.]+)/gi, (m, x, y) => {
        logs.push('Fixed: doesn\'t just X, but also Y');
        return `${x} and ${y}`;
    });
    
    // "isn't simply X, but rather Y" → "is Y"
    result = result.replace(/isn't (simply |just |merely )?([^,]+),\s*but rather ([^\.]+)/gi, (m, mod, x, y) => {
        logs.push('Fixed: isn\'t X, but rather Y');
        return `is ${y}`;
    });
    
    // "isn't just to X, but rather to Y" → "is to Y"
    result = result.replace(/isn't (simply |just |merely )?to ([^,]+),\s*but rather to ([^\.]+)/gi, (m, mod, x, y) => {
        logs.push('Fixed: isn\'t to X, but rather to Y');
        return `is to ${y}`;
    });
    
    // "not between X, but between Y" → "between Y"
    result = result.replace(/not between ([^,]+),\s*but between ([^\.]+)/gi, (m, x, y) => {
        logs.push('Fixed: not between X, but between Y');
        return `between ${y}`;
    });
    
    // "rather than X over Y" at end of sentence - remove
    result = result.replace(/,\s*rather than [^\.]+\./gi, (m) => {
        logs.push('Fixed: removed trailing "rather than"');
        return '.';
    });
    
    // ===========================================
    // AI FILLER PHRASES
    // ===========================================
    result = result.replace(/,?\s*as a matter of course\.?/gi, '.');
    result = result.replace(/\bWe're essentially\b/gi, "We're");
    result = result.replace(/\bessentially\b/gi, '');
    result = result.replace(/\bIt's worth noting that\b/gi, '');
    result = result.replace(/\bIt should be noted that\b/gi, '');
    result = result.replace(/\bmore than simply\b/gi, 'more than');
    result = result.replace(/\bthe sole workable\b/gi, 'the only');
    result = result.replace(/\bas this approach is\b/gi, 'and this is');

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

    // More regex pattern fixes
    result = result.replace(/isn't (simply |just |merely |)?([^,\.]+),\s*(it's|it is) ([^\.]+)\./gi, (m, mod, x, pronoun, y) => { logs.push('Fixed: isn\'t X, it\'s Y'); return `is ${y}.`; });
    result = result.replace(/[Ii]t's not [^,]+,\s*(it's|it is) ([^\.]+)\./g, (m, pronoun, y) => { logs.push('Fixed: it\'s not X, it\'s Y'); return `It's ${y}.`; });
    result = result.replace(/doesn't (simply |just |merely )?([^,]+),\s*(it's|it is|it) ([^\.]+)\./gi, (m, mod, x, pronoun, y) => { logs.push('Fixed: doesn\'t X, it Y'); return `does ${x} and ${y}.`; });
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

        // Step 2: Split into paragraphs (preserves \n\n separators for multi-block input)
        const temperature = getRandomTemperature();
        logs.push(`Temperature: ${temperature.toFixed(2)}`);

        const inputParagraphs = processed.split(/\n\n+/).filter(p => p.trim().length > 0);
        logs.push(`Paragraphs: ${inputParagraphs.length}`);

        // Step 3: Humanize each paragraph in parallel — each paragraph = 1 batched Gemini call
        const humanizedParagraphs = await Promise.all(inputParagraphs.map(async (para) => {
            const sentences = splitIntoSentences(para);

            // Deduplicate sentences within paragraph
            const seen = new Set();
            const unique = sentences.filter(s => {
                const key = s.trim().toLowerCase();
                if (seen.has(key)) { logs.push(`Removed duplicate: "${s.substring(0, 40)}"`); return false; }
                seen.add(key);
                return true;
            });

            if (unique.length === 0) return '';

            const prompt = HumanizerPrompts.buildBatchPrompt(unique);
            try {
                const raw = await GeminiAPI.chat(prompt, GEMINI_KEY, temperature);
                const lines = raw.split('\n');
                const humanized = unique.map((original, i) => {
                    const prefix = new RegExp(`^\\s*${i + 1}[.):] ?`);
                    const line = lines.find(l => prefix.test(l));
                    if (line) {
                        const text = line.replace(prefix, '').trim().replace(/^["']|["']$/g, '');
                        return text || original;
                    }
                    return original;
                });
                // Dedup output in case model generated duplicate sentences
                const outSeen = new Set();
                const deduped = humanized.filter(s => {
                    const key = s.trim().toLowerCase();
                    if (outSeen.has(key)) { logs.push(`Removed output dup: "${s.substring(0, 40)}"`); return false; }
                    outSeen.add(key);
                    return true;
                });
                logs.push(`Para OK (${unique.length} → ${deduped.length} sentences)`);
                return deduped.join(' ');
            } catch (err) {
                logs.push(`Para FAILED (${err.message}), using originals`);
                return unique.join(' ');
            }
        }));

        // Step 4: Post-process each paragraph, then rejoin
        const processedParagraphs = humanizedParagraphs
            .filter(p => p.trim())
            .map(p => postProcess(p, logs));
        let result = processedParagraphs.join('\n\n');

        // Step 5: Final word swap pass (applied to full result)
        result = applyWordSwaps(result);

        logs.push(`Final: ${result.length} chars`);

        return res.status(200).json({ success: true, result, logs });

    } catch (error) {
        logs.push(`ERROR: ${error.message}`);
        return res.status(500).json({ success: false, error: error.message, logs });
    }
}

export { postProcess as PostProcessor, BANNED_WORDS as AI_VOCAB_SWAPS, applyWordSwaps as killEmDashes };
