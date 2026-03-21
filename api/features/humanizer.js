// api/features/humanizer.js - V2: More Human, Less AI
// Bans EM dashes, adds colloquial language, uses unexpected word choices
import { GroqAPI } from '../utils/groqAPI.js';

// ==========================================================================
// BANNED PUNCTUATION - EM DASHES ARE FORBIDDEN
// ==========================================================================
const BANNED_PUNCTUATION = [
    '\u2014',  // EM dash
    '\u2013',  // EN dash  
    '—',      // EM dash alternate
    '–',      // EN dash alternate
    ' - ',    // Spaced hyphen used as dash
    ' -- ',   // Double hyphen
];

// ==========================================================================
// VOCABULARY REPLACEMENT MAP - EXPANDED WITH UNEXPECTED CHOICES
// ==========================================================================
const AI_VOCAB_SWAPS = {
    // === CORPORATE/FORMAL BUZZWORDS ===
    "leverage": ["use", "tap into", "work with", "grab"],
    "utilize": ["use", "work with", "put to work"],
    "implement": ["use", "set up", "roll out", "do"],
    "facilitate": ["help", "make easier", "smooth out"],
    "optimize": ["improve", "tweak", "tune up", "fix up"],
    "enhance": ["improve", "bump up", "boost", "beef up"],
    "streamline": ["simplify", "clean up", "trim down"],
    "synergy": ["teamwork", "combo", "working together"],
    "paradigm": ["way of thinking", "model", "approach"],
    "methodology": ["method", "way", "approach", "how-to"],
    "framework": ["structure", "setup", "system", "plan"],
    "robust": ["strong", "solid", "sturdy", "tough"],
    "scalable": ["growable", "expandable", "flexible"],
    "seamless": ["smooth", "easy", "without hiccups"],
    "holistic": ["whole", "complete", "full-picture"],
    "innovative": ["new", "fresh", "creative", "clever"],
    "cutting-edge": ["latest", "newest", "modern", "fresh"],
    "state-of-the-art": ["latest", "newest", "top-notch"],
    "best practices": ["good methods", "smart ways", "what works"],
    "actionable": ["useful", "doable", "practical"],
    "impactful": ["powerful", "strong", "meaningful"],
    
    // === AI-FAVORITE TRANSITIONS ===
    "Furthermore": ["Also", "Plus", "And", "On top of that"],
    "Moreover": ["Also", "What's more", "And", "Besides"],
    "Additionally": ["Also", "Plus", "And", "Too"],
    "Subsequently": ["Then", "After", "Next", "Later"],
    "Consequently": ["So", "Because of this", "As a result"],
    "Nevertheless": ["Still", "But", "Even so", "Yet"],
    "Notwithstanding": ["Despite this", "Even so", "Still"],
    "Henceforth": ["From now on", "Going forward", "After this"],
    "Whereby": ["where", "through which", "so that"],
    "Thereof": ["of it", "of this", "from it"],
    "Wherein": ["where", "in which", "inside"],
    "Heretofore": ["before now", "until this point", "previously"],
    "In conclusion": ["To wrap up", "All in all", "Bottom line"],
    "In summary": ["To sum up", "Basically", "Long story short"],
    "It is worth noting": ["Worth mentioning", "Interestingly", "Note that"],
    "It should be noted": ["Keep in mind", "Remember", "Note"],
    
    // === STUFFY ACADEMIC WORDS ===
    "elucidate": ["explain", "clear up", "spell out", "break down"],
    "delineate": ["outline", "map out", "lay out", "sketch"],
    "ascertain": ["figure out", "find out", "discover", "learn"],
    "endeavor": ["try", "attempt", "effort", "shot"],
    "commence": ["start", "begin", "kick off", "get going"],
    "terminate": ["end", "stop", "finish", "wrap up"],
    "ameliorate": ["improve", "make better", "fix", "help"],
    "exacerbate": ["worsen", "make worse", "aggravate"],
    "mitigate": ["reduce", "lessen", "ease", "soften"],
    "precipitate": ["cause", "trigger", "spark", "set off"],
    "substantiate": ["prove", "back up", "support", "show"],
    "corroborate": ["confirm", "back up", "support", "verify"],
    "juxtapose": ["compare", "put side by side", "contrast"],
    "proliferate": ["spread", "grow", "multiply", "boom"],
    "underscore": ["highlight", "emphasize", "stress", "point out"],
    "delve": ["dig into", "explore", "look at", "get into"],
    "encompasses": ["includes", "covers", "has", "takes in"],
    "constitutes": ["is", "makes up", "forms"],
    "signify": ["mean", "show", "represent", "indicate"],
    "denote": ["mean", "show", "represent", "mark"],
    "pertaining": ["about", "related to", "concerning", "on"],
    "aforementioned": ["mentioned", "said", "this", "the above"],
    
    // === PRETENTIOUS DESCRIPTORS ===
    "myriad": ["many", "tons of", "loads of", "countless"],
    "plethora": ["lots", "bunch", "plenty", "heap"],
    "multifaceted": ["complex", "many-sided", "varied"],
    "comprehensive": ["full", "complete", "thorough", "total"],
    "paramount": ["crucial", "key", "top", "main"],
    "pivotal": ["key", "crucial", "central", "main"],
    "crucial": ["key", "important", "vital", "must-have"],
    "imperative": ["necessary", "must", "essential", "needed"],
    "quintessential": ["perfect example", "classic", "typical"],
    "ubiquitous": ["everywhere", "all over", "common"],
    "profound": ["deep", "big", "major", "serious"],
    "intrinsic": ["built-in", "natural", "core", "basic"],
    "inherent": ["built-in", "natural", "basic"],
    "conducive": ["helpful", "good for", "favorable"],
    "commensurate": ["matching", "proportional", "equal"],
    "far-reaching": ["wide", "broad", "extensive", "big"],
    "wide-ranging": ["broad", "varied", "diverse", "wide"],
    "overarching": ["main", "overall", "big-picture"],
    "underlying": ["basic", "core", "root", "beneath"],
    
    // === CORPORATE ACTION WORDS ===
    "harness": ["use", "tap", "capture", "grab"],
    "cultivate": ["build", "grow", "develop", "nurture"],
    "foster": ["encourage", "support", "build", "grow"],
    "bolster": ["strengthen", "boost", "support", "prop up"],
    "augment": ["add to", "boost", "increase", "expand"],
    "amplify": ["increase", "boost", "grow", "magnify"],
    "catalyze": ["spark", "trigger", "kick-start", "drive"],
    "galvanize": ["motivate", "energize", "spark", "rally"],
    "spearhead": ["lead", "drive", "head", "champion"],
    "champion": ["support", "push for", "back", "promote"],
    "navigate": ["handle", "deal with", "work through", "manage"],
    "traverse": ["cross", "go through", "travel", "move through"],
    "transcend": ["go beyond", "rise above", "surpass", "exceed"],
    "revolutionize": ["transform", "change", "shake up", "remake"],
    "transform": ["change", "shift", "remake", "redo"],
    "evolving": ["changing", "growing", "shifting", "developing"],
    "redefine": ["change", "reshape", "remake", "reimagine"],
    "reshape": ["change", "remake", "reform", "redo"],
    
    // === AI FAVORITE PHRASES ===
    "It's important to note": ["Note that", "Keep in mind", "Remember"],
    "It is essential to": ["You need to", "Make sure to", "Don't forget to"],
    "In order to": ["To", "For", "So you can"],
    "Due to the fact that": ["Because", "Since", "As"],
    "In light of": ["Given", "Because of", "Considering"],
    "With regard to": ["About", "On", "Regarding"],
    "In terms of": ["For", "About", "When it comes to"],
    "At this point in time": ["Now", "Currently", "Right now"],
    "In the realm of": ["In", "Within", "For"],
    "In the domain of": ["In", "Within", "For"],
    "With respect to": ["About", "Regarding", "On"],
    "testament": ["proof", "sign", "evidence", "example"],
    "landscape": ["scene", "field", "world", "area"],
    "realm": ["area", "field", "world", "space"],
    "domain": ["area", "field", "sphere", "zone"],
    "sphere": ["area", "field", "world", "zone"],
    "tapestry": ["mix", "blend", "combination", "collection"],
    "symphony": ["mix", "blend", "harmony", "combo"],
    
    // === VERB FORMS TO AVOID ===
    "empowered": ["helped", "enabled", "let", "allowed"],
    "empowering": ["helping", "enabling", "letting"],
    "showcasing": ["showing", "displaying", "presenting"],
    "showcased": ["showed", "displayed", "presented"],
    "utilizing": ["using", "working with"],
    "leveraging": ["using", "tapping into"],
    "facilitating": ["helping", "enabling", "making easier"],
    "implementing": ["using", "setting up", "putting in place"],
    "accompanied": ["with", "along with", "plus"],
    "accompanied by": ["with", "along with"],
    
    // === COLLOQUIAL UPGRADES (make it sound more natural) ===
    "very": ["really", "super", "pretty", "quite"],
    "significant": ["big", "major", "serious", "real"],
    "significantly": ["a lot", "way more", "much more", "really"],
    "extremely": ["really", "super", "incredibly", "crazy"],
    "particularly": ["especially", "really", "specifically"],
    "essentially": ["basically", "really", "pretty much"],
    "fundamentally": ["basically", "at its core", "really"],
    "inherently": ["naturally", "by nature", "basically"],
    "predominantly": ["mostly", "mainly", "largely"],
    "primarily": ["mainly", "mostly", "chiefly", "largely"],
    "ultimately": ["in the end", "finally", "eventually"],
    "accordingly": ["so", "therefore", "as a result"],
    "invariably": ["always", "every time", "without fail"],
    "presumably": ["probably", "likely", "I'd guess"],
    "ostensibly": ["supposedly", "apparently", "seemingly"],
    "manifestly": ["clearly", "obviously", "plainly"],
    "indubitably": ["definitely", "for sure", "no doubt"],
};

// ==========================================================================
// HUMAN FILLER PHRASES - Add natural hesitation and flow
// ==========================================================================
const HUMAN_FILLERS = {
    'start': [
        "Look,", "Honestly,", "The thing is,", "Here's the deal:", 
        "So basically,", "Truth is,", "Real talk:", "Let me put it this way:"
    ],
    'mid': [
        "I mean,", "you know,", "basically,", "in a way,", 
        "sort of", "kind of", "more or less", "to be fair,"
    ],
    'emphasis': [
        "actually", "really", "genuinely", "seriously", 
        "legitimately", "truly", "honestly"
    ]
};

// ==========================================================================
// TONE STRATEGIES - MORE COLLOQUIAL
// ==========================================================================
const STRATEGIES = {
    'Casual': [
        { 
            name: "The Friend", 
            instruction: "Write like you're explaining to a friend over coffee. Use 'you' and 'I'. Short sentences. It's okay to start sentences with 'And' or 'But'."
        },
        { 
            name: "The Real Talker", 
            instruction: "Be direct and honest. Skip the fluff. Say what you mean. Use phrases like 'here's the thing' and 'bottom line'."
        },
        { 
            name: "The Storyteller", 
            instruction: "Make it flow naturally. Add small observations. Use 'honestly' and 'actually' naturally. Let thoughts connect loosely."
        }
    ],
    'Academic': [
        { 
            name: "The Clear Thinker", 
            instruction: "Explain complex ideas simply. No jargon. If a 5th grader couldn't get it, simplify more. Stay formal but not stiff."
        },
        { 
            name: "The Evidence Person", 
            instruction: "Focus on facts and logic. Connect ideas with 'because', 'so', and 'which means'. Keep it grounded and clear."
        },
        { 
            name: "The Careful Writer", 
            instruction: "Be precise but readable. One idea per sentence. Use 'this shows' and 'this suggests' to connect thoughts."
        }
    ],
    'Professional': [
        { 
            name: "The Straight Shooter", 
            instruction: "Get to the point fast. No fluff. Action words. Confident but not arrogant. Clear and direct."
        },
        { 
            name: "The Problem Solver", 
            instruction: "Focus on what matters. Present solutions clearly. Use 'the key is' and 'what works is'. Practical and grounded."
        },
        { 
            name: "The Collaborator", 
            instruction: "Inclusive language. 'We' instead of 'you'. Suggest rather than command. Warm but professional."
        }
    ]
};

// ==========================================================================
// POST-PROCESSING PIPELINE
// ==========================================================================
const PostProcessor = {
    // 0. KILL EM DASHES FIRST - This is priority
    killEmDashes(text) {
        let processed = text;
        // Replace all forms of em/en dashes
        processed = processed.replace(/\u2014/g, ',');  // EM dash → comma
        processed = processed.replace(/\u2013/g, ',');  // EN dash → comma
        processed = processed.replace(/—/g, ',');       // EM dash alt → comma
        processed = processed.replace(/–/g, ',');       // EN dash alt → comma
        processed = processed.replace(/ - /g, ', ');    // spaced hyphen → comma
        processed = processed.replace(/ -- /g, ', ');   // double hyphen → comma
        // Clean up double commas
        processed = processed.replace(/,\s*,/g, ',');
        processed = processed.replace(/,\s+,/g, ',');
        return processed;
    },

    // 1. Force Word Replacement with random selection
    forceWordReplacements(text) {
        let processed = text;
        for (const [bad, goods] of Object.entries(AI_VOCAB_SWAPS)) {
            const regex = new RegExp(`\\b${bad}\\b`, 'gi');
            if (regex.test(processed)) {
                // Random selection for variety
                const replacement = goods[Math.floor(Math.random() * goods.length)];
                processed = processed.replace(regex, (match) => {
                    // Preserve capitalization
                    if (match[0] === match[0].toUpperCase()) {
                        return replacement.charAt(0).toUpperCase() + replacement.slice(1);
                    }
                    return replacement;
                });
            }
        }
        return processed;
    },

    // 2. Fix AI-style participle phrases
    fixParticiplePatterns(text) {
        let fixed = text;
        // "X, making Y" → "X. This makes Y" or "X, which makes Y"
        fixed = fixed.replace(/, making /gi, '. This makes ');
        fixed = fixed.replace(/, creating /gi, '. This creates ');
        fixed = fixed.replace(/, leading to /gi, '. This leads to ');
        fixed = fixed.replace(/, resulting in /gi, '. This results in ');
        fixed = fixed.replace(/, causing /gi, '. This causes ');
        fixed = fixed.replace(/, enabling /gi, '. This enables ');
        fixed = fixed.replace(/, allowing /gi, '. This allows ');
        fixed = fixed.replace(/, ensuring /gi, '. This ensures ');
        fixed = fixed.replace(/, providing /gi, '. This provides ');
        fixed = fixed.replace(/, offering /gi, '. This offers ');
        // Fix other AI participle patterns
        fixed = fixed.replace(/fundamentally altering/gi, 'fundamentally changes');
        fixed = fixed.replace(/empowered ([a-z]+)/gi, 'helped $1');
        fixed = fixed.replace(/accompanied by/gi, 'with');
        fixed = fixed.replace(/showcasing/gi, 'showing');
        fixed = fixed.replace(/utilizing/gi, 'using');
        fixed = fixed.replace(/leveraging/gi, 'using');
        fixed = fixed.replace(/facilitating/gi, 'helping with');
        fixed = fixed.replace(/implementing/gi, 'putting in place');
        return fixed;
    },

    // 3. Add natural contractions for casual/professional
    injectContractions(text, aggressive = false) {
        let processed = text;
        const contractions = [
            [/\bdo not\b/gi, "don't"],
            [/\bdoes not\b/gi, "doesn't"],
            [/\bis not\b/gi, "isn't"],
            [/\bare not\b/gi, "aren't"],
            [/\bcan not\b/gi, "can't"],
            [/\bcannot\b/gi, "can't"],
            [/\bwill not\b/gi, "won't"],
            [/\bwould not\b/gi, "wouldn't"],
            [/\bshould not\b/gi, "shouldn't"],
            [/\bcould not\b/gi, "couldn't"],
            [/\bhas not\b/gi, "hasn't"],
            [/\bhave not\b/gi, "haven't"],
            [/\bwas not\b/gi, "wasn't"],
            [/\bwere not\b/gi, "weren't"],
            [/\bI am\b/gi, "I'm"],
            [/\bI have\b/gi, "I've"],
            [/\bI will\b/gi, "I'll"],
            [/\bI would\b/gi, "I'd"],
        ];
        
        // Additional aggressive contractions for casual tone
        const aggressiveContractions = [
            [/\bit is\b/gi, "it's"],
            [/\bthat is\b/gi, "that's"],
            [/\bwhat is\b/gi, "what's"],
            [/\bhere is\b/gi, "here's"],
            [/\bthere is\b/gi, "there's"],
            [/\bthey are\b/gi, "they're"],
            [/\bwe are\b/gi, "we're"],
            [/\byou are\b/gi, "you're"],
            [/\blet us\b/gi, "let's"],
            [/\bgoing to\b/gi, "gonna"],
            [/\bwant to\b/gi, "wanna"],
        ];
        
        contractions.forEach(([regex, replacement]) => {
            processed = processed.replace(regex, replacement);
        });
        
        if (aggressive) {
            aggressiveContractions.forEach(([regex, replacement]) => {
                processed = processed.replace(regex, replacement);
            });
        }
        
        return processed;
    },

    // 4. Vary sentence structure - break up long sentences
    varySentenceStructure(text) {
        let processed = text;
        
        // Break up sentences with multiple "and"s
        processed = processed.replace(/([^.!?]{60,}?), and ([^.!?]{30,}?), and ([^.!?]+\.)/g, '$1. Also, $2. And $3');
        
        // Convert some "which" clauses to new sentences
        processed = processed.replace(/, which is ([^,\.]+)/gi, '. This is $1');
        processed = processed.replace(/, which means ([^,\.]+)/gi, '. This means $1');
        processed = processed.replace(/, which shows ([^,\.]+)/gi, '. This shows $1');
        
        return processed;
    },

    // 5. Fix common AI typos and artifacts
    fixTyposAndArtifacts(text) {
        let fixed = text;
        fixed = fixed.replace(/computs\b/g, 'computing');
        fixed = fixed.replace(/showcass\b/g, 'shows');
        fixed = fixed.replace(/changs\b/g, 'changes');
        fixed = fixed.replace(/\s{2,}/g, ' ');
        // Remove AI preambles
        const preambles = [
            /^Here's the rewritten text[:\.]?\s*/i,
            /^Here is the rewritten text[:\.]?\s*/i,
            /^Rewritten version[:\.]?\s*/i,
            /^Sure,? here is the rewritten text[:\.]?\s*/i,
            /^Below is the rewritten text[:\.]?\s*/i,
            /^Here's a rewritten version[:\.]?\s*/i,
            /^I've rewritten the text[:\.]?\s*/i,
            /^Here's my rewrite[:\.]?\s*/i,
        ];
        preambles.forEach(p => { fixed = fixed.replace(p, ''); });
        // Remove trailing/leading quotes if they wrap entire text
        fixed = fixed.replace(/^["']|["']$/g, '');
        return fixed.trim();
    },

    // 6. Add occasional human uncertainty markers (for casual tone)
    addHumanMarkers(text, tone) {
        if (tone !== 'Casual') return text;
        
        let processed = text;
        const sentences = processed.split(/(?<=[.!?])\s+/);
        
        // Only add markers occasionally (roughly 10% of sentences)
        const marked = sentences.map((sentence, i) => {
            if (i > 0 && Math.random() < 0.1 && sentence.length > 30) {
                const fillers = HUMAN_FILLERS.mid;
                const filler = fillers[Math.floor(Math.random() * fillers.length)];
                // Insert after first 2-3 words
                const words = sentence.split(' ');
                if (words.length > 4) {
                    const insertPos = 2 + Math.floor(Math.random() * 2);
                    words.splice(insertPos, 0, filler);
                    return words.join(' ');
                }
            }
            return sentence;
        });
        
        return marked.join(' ');
    },

    // Full pipeline
    process(text, tone) {
        let result = text;
        
        // PRIORITY: Kill em dashes first
        result = this.killEmDashes(result);
        
        // Clean AI artifacts
        result = this.fixTyposAndArtifacts(result);
        
        // Replace AI vocabulary with natural words
        result = this.forceWordReplacements(result);
        
        // Fix AI participle patterns
        result = this.fixParticiplePatterns(result);
        
        // Vary sentence structure
        result = this.varySentenceStructure(result);
        
        // Add contractions based on tone
        if (tone === 'Casual') {
            result = this.injectContractions(result, true);
            result = this.addHumanMarkers(result, tone);
        } else if (tone === 'Professional') {
            result = this.injectContractions(result, false);
        }
        
        // Final em dash check (in case any were introduced)
        result = this.killEmDashes(result);
        
        // Clean up multiple spaces
        result = result.replace(/\s{2,}/g, ' ').trim();
        
        return result;
    }
};

// ==========================================================================
// HELPER FUNCTIONS
// ==========================================================================

function analyzeInputTone(text) {
    const lower = text.toLowerCase();
    
    // Check for casual markers
    const casualMarkers = ["i'm", "i've", "you're", "we're", "don't", "can't", "won't", "gonna", "wanna", "kinda", "sorta", "yeah", "yep", "nope", "hey", "okay", "cool"];
    let casualScore = casualMarkers.filter(w => lower.includes(w)).length;
    
    // Check for academic markers  
    const academicMarkers = ['utilize', 'leverage', 'delve', 'facilitate', 'underscore', 'comprehensive', 'exacerbate', 'methodology', 'furthermore', 'consequently', 'nevertheless', 'henceforth', 'whereas', 'whereby'];
    let academicScore = academicMarkers.filter(w => lower.includes(w)).length;
    
    // Check for first person casual
    if (text.includes("I ") || text.includes("I'm") || text.includes("we're") || text.includes(" you ")) {
        casualScore += 2;
    }
    
    if (academicScore >= 3) return 'Academic';
    if (casualScore >= 2) return 'Casual';
    return 'Professional';
}

function generateVocabularyInstructions() {
    const forbidden = Object.keys(AI_VOCAB_SWAPS).slice(0, 40);
    return `ABSOLUTELY FORBIDDEN WORDS (NEVER use these):
${forbidden.slice(0, 20).map(w => `• ${w}`).join('\n')}

ALSO AVOID:
${forbidden.slice(20, 40).map(w => `• ${w}`).join('\n')}

CRITICAL: NEVER use EM dashes (—) or EN dashes (–). Use commas, periods, or "and" instead.`;
}

function dynamicChunking(text) {
    const sentences = text.match(/[^.!?\n]+[.!?\n]+(\s|$)/g) || [text];
    const filtered = sentences.filter(s => s.trim().length > 0);
    const MAX_CHUNKS = 6;
    let sentencesPerChunk = Math.ceil(filtered.length / MAX_CHUNKS);
    if (sentencesPerChunk < 1) sentencesPerChunk = 1;
    
    const chunks = [];
    let current = "";
    let count = 0;
    
    for (let i = 0; i < filtered.length; i++) {
        current += filtered[i];
        count++;
        if (count >= sentencesPerChunk || i === filtered.length - 1) {
            if (current.trim().length > 0) chunks.push(current.trim());
            current = "";
            count = 0;
        }
    }
    return chunks;
}

function buildPrompt(chunk, tone, vocabRules, strategy) {
    const dashWarning = `
CRITICAL PUNCTUATION RULE:
❌ NEVER use EM dashes (—) or EN dashes (–)
❌ NEVER write " - " with spaces around a hyphen
✅ Use commas, periods, or conjunctions (and, but, so) instead
Example:
BAD: "The results—which were surprising—changed everything."
GOOD: "The results, which were surprising, changed everything."
GOOD: "The results were surprising. They changed everything."`;

    return `You are rewriting text to sound like a real human wrote it. Not AI. Not corporate. Human.

VOICE: ${tone}
STYLE: ${strategy.name} - ${strategy.instruction}

${vocabRules}

${dashWarning}

MORE RULES FOR NATURAL WRITING:
1. VARY SENTENCE LENGTH - Mix short punchy sentences with longer ones
2. START SOME SENTENCES WITH "And" or "But" - Real people do this
3. USE SIMPLE WORDS - "use" not "utilize", "help" not "facilitate"
4. AVOID PARTICIPLE CHAINS - NOT "X, making Y, causing Z" 
   INSTEAD: "X. This makes Y. And that causes Z."
5. BE DIRECT - Get to the point. Cut fluff.
6. ONE IDEA PER SENTENCE when possible
7. DON'T HEDGE EVERYTHING - Be confident sometimes

TEXT TO REWRITE:
"${chunk}"

OUTPUT (rewritten text only, no preamble):`;
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
        const safeText = text.substring(0, 15000);
        
        // Detect tone if not provided
        const detectedTone = tone || analyzeInputTone(safeText);
        const vocabRules = generateVocabularyInstructions();
        
        // Chunk the text
        const chunks = dynamicChunking(safeText);
        const results = [];

        console.log(`[Humanizer] Processing ${chunks.length} chunks in ${detectedTone} tone`);

        // Process each chunk
        for (let i = 0; i < chunks.length; i++) {
            const chunk = chunks[i];
            
            // Select random strategy for variety
            const strategies = STRATEGIES[detectedTone] || STRATEGIES['Professional'];
            const strategy = strategies[Math.floor(Math.random() * strategies.length)];
            
            // Build prompt
            const prompt = buildPrompt(chunk, detectedTone, vocabRules, strategy);
            
            // Call Groq
            const messages = [{ role: "user", content: prompt }];
            
            let rawDraft = await GroqAPI.chat(messages, GROQ_KEY, false);
            
            // Post-process
            let cleanDraft = PostProcessor.process(rawDraft, detectedTone);
            results.push(cleanDraft);
        }

        // Join results
        const finalOutput = results.join(' ').replace(/\s{2,}/g, ' ').trim();

        // Final safety check - absolutely no em dashes
        const ultraClean = PostProcessor.killEmDashes(finalOutput);

        return res.status(200).json({ 
            success: true, 
            result: ultraClean,
            tone: detectedTone,
            chunks: chunks.length
        });

    } catch (error) {
        console.error("Humanizer Error:", error);
        return res.status(500).json({ success: false, error: error.message });
    }
}

// ==========================================================================
// EXPORT PostProcessor for use in agent.js
// ==========================================================================
export { PostProcessor, AI_VOCAB_SWAPS, STRATEGIES, analyzeInputTone, dynamicChunking, buildPrompt };
