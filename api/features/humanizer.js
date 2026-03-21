// api/features/humanizer.js
// Section-aware humanization with context preservation
import { GroqAPI } from '../utils/groqAPI.js';

// ==========================================================================
// 1. BANNED WORDS & SIMPLE SWAPS
// ==========================================================================

const BANNED_WORDS = [
    "furthermore", "moreover", "additionally", "subsequently", "consequently",
    "nevertheless", "notwithstanding", "whereby", "thereof", "wherein",
    "aforementioned", "utilize", "leverage", "facilitate", "optimize",
    "enhance", "streamline", "paradigm", "methodology", "comprehensive",
    "multifaceted", "myriad", "plethora", "paramount", "pivotal",
    "delve", "underscore", "realm", "landscape", "tapestry", "testament"
];

const SIMPLE_SWAPS = {
    "utilize": "use", "leverage": "use", "facilitate": "help", "optimize": "improve",
    "enhance": "improve", "comprehensive": "full", "furthermore": "also",
    "moreover": "and", "additionally": "also", "subsequently": "then",
    "consequently": "so", "nevertheless": "but", "demonstrate": "show",
    "indicate": "suggest", "significant": "major", "numerous": "many",
    "sufficient": "enough", "prior to": "before", "in order to": "to",
    "due to the fact that": "because", "in terms of": "for",
    "it is important to note": "note that", "it should be noted": "note that"
};

// AI punctuation and pattern tells to fix
const AI_PATTERNS = [
    // Semicolon overuse - split into two sentences
    { regex: /;\s*it's\b/gi, replacement: ". It's" },
    { regex: /;\s*this\b/gi, replacement: ". This" },
    { regex: /;\s*they\b/gi, replacement: ". They" },
    { regex: /;\s*we\b/gi, replacement: ". We" },
    
    // Colon declarations - remove or rephrase
    { regex: /Here's the (?:key |main |real )?(?:point|thing|issue|problem):\s*/gi, replacement: "" },
    { regex: /Let's be clear:\s*/gi, replacement: "" },
    { regex: /The (?:real |key |main )?(?:point|thing|issue) is:\s*/gi, replacement: "" },
    { regex: /Here's what matters:\s*/gi, replacement: "" },
    { regex: /Bottom line:\s*/gi, replacement: "" },
    
    // "isn't just X, it's Y" pattern - vary it
    { regex: /isn't just ([^,]+),\s*it's/gi, replacement: "goes beyond $1. It's" },
    { regex: /isn't just about ([^,]+),\s*it's/gi, replacement: "is more than $1. It's" },
    { regex: /not just ([^,]+),\s*it's/gi, replacement: "more than $1. It's" },
    
    // Triple comma chains - break them up
    { regex: /,\s*([^,]{10,40}),\s*and\s+([^,]{10,40}),/gi, replacement: ", $1. And $2," },
    
    // "strains X, strains Y" repetition
    { regex: /(\w+)s ([^,]+),\s*\1s ([^,]+),\s*and/gi, replacement: "$1s $2. It also $1s $3, and" },
];

// Banned sentence starters when repeated
const VARIED_STARTERS = {
    "It's": ["This is", "That's", "We see", "What we have is"],
    "This is": ["It's", "Here we see", "What's happening is", "We're looking at"],
    "The": ["A", "One", "This", ""],  // Empty means restructure
    "There is": ["We have", "You'll find", "Look at"],
    "We need": ["The need is", "What's needed is", "This requires"],
};

// ==========================================================================
// 2. UTILITY FUNCTIONS
// ==========================================================================

function killEmDashes(text) {
    return text
        .replace(/\u2014/g, ', ')
        .replace(/\u2013/g, ', ')
        .replace(/—/g, ', ')
        .replace(/–/g, ', ')
        .replace(/ - /g, ', ')
        .replace(/ -- /g, ', ')
        .replace(/,\s*,/g, ',')
        .replace(/\s{2,}/g, ' ')
        .trim();
}

function applySwaps(text) {
    let result = text;
    for (const [bad, good] of Object.entries(SIMPLE_SWAPS)) {
        result = result.replace(new RegExp(`\\b${bad}\\b`, 'gi'), good);
    }
    return result;
}

function cleanOutput(text) {
    let cleaned = text;
    // Remove AI preambles
    cleaned = cleaned.replace(/^(Here's|Here is|Below is|Sure|I've rewritten|Rewritten)[^:.\n]*[:.]\s*/i, '');
    cleaned = cleaned.replace(/^["']|["']$/g, '');
    return cleaned.trim();
}

// ==========================================================================
// 3. SECTION DETECTION - Preserve original structure
// ==========================================================================

function detectSections(text) {
    // Split by headers or double newlines
    const lines = text.split('\n');
    const sections = [];
    let currentSection = { title: '', content: [] };
    
    for (const line of lines) {
        const trimmed = line.trim();
        
        // Detect headers (various formats)
        const isHeader = /^#{1,3}\s+/.test(trimmed) ||  // Markdown
                        /^[A-Z][^.!?]*$/.test(trimmed) && trimmed.length < 60 && trimmed.length > 3 ||  // Title case short line
                        /^(Introduction|Conclusion|Summary|Background|Overview|Causes?|Effects?|Impacts?|Solutions?|Results?|Discussion|Methods?)/i.test(trimmed);
        
        if (isHeader && trimmed.length > 0) {
            // Save previous section if it has content
            if (currentSection.content.length > 0) {
                sections.push({
                    title: currentSection.title,
                    content: currentSection.content.join('\n').trim()
                });
            }
            // Start new section
            currentSection = { title: trimmed.replace(/^#+\s*/, ''), content: [] };
        } else if (trimmed.length > 0) {
            currentSection.content.push(trimmed);
        }
    }
    
    // Don't forget last section
    if (currentSection.content.length > 0) {
        sections.push({
            title: currentSection.title,
            content: currentSection.content.join('\n').trim()
        });
    }
    
    // If no sections detected, treat whole text as one section
    if (sections.length === 0) {
        sections.push({ title: '', content: text.trim() });
    }
    
    return sections;
}

// ==========================================================================
// 4. PLANNING REQUEST - Get essay overview and section summaries
// ==========================================================================

async function planEssay(sections, apiKey) {
    const sectionList = sections.map((s, i) => 
        `Section ${i + 1}${s.title ? ` (${s.title})` : ''}: ${s.content.substring(0, 150)}...`
    ).join('\n');
    
    const prompt = `Analyze this essay structure and provide a brief plan.

SECTIONS:
${sectionList}

For each section, write ONE sentence describing:
1. What this section covers
2. How it connects to neighboring sections

Format your response as:
Section 1: [summary and connection]
Section 2: [summary and connection]
...

Be concise. Each summary should be under 25 words.`;

    const messages = [{ role: "user", content: prompt }];
    const plan = await GroqAPI.chat(messages, apiKey, false);
    
    // Parse the plan into section summaries
    const summaries = {};
    const lines = plan.split('\n');
    for (const line of lines) {
        const match = line.match(/Section\s*(\d+):\s*(.+)/i);
        if (match) {
            summaries[parseInt(match[1]) - 1] = match[2].trim();
        }
    }
    
    return summaries;
}

// ==========================================================================
// 5. HUMANIZATION PROMPT - Natural, context-aware
// ==========================================================================

function buildHumanizePrompt(section, index, total, prevSummary, nextSummary, sectionSummary) {
    // Determine position
    let position = 'middle';
    if (index === 0) position = 'opening';
    if (index === total - 1) position = 'closing';
    
    // Build context
    let context = '';
    if (prevSummary) {
        context += `PREVIOUS SECTION covered: ${prevSummary}\n`;
    }
    if (nextSummary) {
        context += `NEXT SECTION will cover: ${nextSummary}\n`;
    }
    if (sectionSummary) {
        context += `THIS SECTION is about: ${sectionSummary}\n`;
    }

    const bannedList = BANNED_WORDS.slice(0, 15).join(', ');

    return `Rewrite this ${position} section to sound naturally human while keeping its structure.

${context}
WRITING STYLE:
- Write like an informed person explaining something they know well
- Use a mix of sentence lengths (some short, some medium, occasional longer ones)
- Keep ideas flowing logically from one to the next

MUST AVOID - these are AI tells:
- Semicolons (;) - use periods instead to separate ideas
- Colons after phrases like "Here's the thing:" or "Let's be clear:" - just state it directly
- The pattern "isn't just X, it's Y" - vary how you express contrasts  
- Comma chains with 3+ items that create run-on sentences
- Starting multiple sentences with "It's" or "This is"
- Dramatic declarations like "The real point is:" or "Bottom line:"
- Em dashes (—) - use commas or periods

PRESERVE:
- The section's meaning and main points
- Any headers, citations, or technical terms
- Logical flow between paragraphs

SECTION TO REWRITE:
${section.title ? `[${section.title}]\n` : ''}${section.content}

OUTPUT the rewritten section only:`;
}

// ==========================================================================
// 6. POST-PROCESSING - Fix AI patterns, vary starters, clean punctuation
// ==========================================================================

function fixAIPatterns(text) {
    let result = text;
    for (const { regex, replacement } of AI_PATTERNS) {
        result = result.replace(regex, replacement);
    }
    return result;
}

function varyRepeatedStarters(text) {
    const sentences = text.split(/(?<=[.!?])\s+/);
    const starterCounts = {};
    
    const varied = sentences.map((sentence, i) => {
        // Check first word/phrase
        for (const [starter, alternatives] of Object.entries(VARIED_STARTERS)) {
            if (sentence.startsWith(starter)) {
                starterCounts[starter] = (starterCounts[starter] || 0) + 1;
                
                // If used more than twice, vary it
                if (starterCounts[starter] > 2 && alternatives.length > 0) {
                    const alt = alternatives[Math.floor(Math.random() * alternatives.length)];
                    if (alt) {
                        return alt + sentence.slice(starter.length);
                    }
                }
            }
        }
        return sentence;
    });
    
    return varied.join(' ');
}

function fixPunctuation(text) {
    let result = text;
    
    // Remove unnecessary semicolons (replace with periods)
    result = result.replace(/;\s+(?=[a-z])/g, '. ');
    
    // Fix double punctuation
    result = result.replace(/\.\./g, '.');
    result = result.replace(/,,/g, ',');
    result = result.replace(/\s+,/g, ',');
    
    // Reduce comma density in long sentences
    const sentences = result.split(/(?<=[.!?])\s+/);
    result = sentences.map(s => {
        const commaCount = (s.match(/,/g) || []).length;
        const wordCount = s.split(/\s+/).length;
        
        // If more than 1 comma per 8 words, it's too dense
        if (commaCount > 3 && commaCount / wordCount > 0.125) {
            // Replace middle commas with periods where sensible
            const parts = s.split(/,\s*/);
            if (parts.length > 3) {
                const mid = Math.floor(parts.length / 2);
                parts[mid] = '. ' + parts[mid].charAt(0).toUpperCase() + parts[mid].slice(1);
                return parts.join(', ').replace(', . ', '. ');
            }
        }
        return s;
    }).join(' ');
    
    return result;
}

function postProcess(text, originalHadHeader, headerText) {
    let result = text;
    
    // Clean AI artifacts
    result = cleanOutput(result);
    
    // Kill em dashes
    result = killEmDashes(result);
    
    // Apply word swaps
    result = applySwaps(result);
    
    // Fix AI patterns (semicolons, colons, repetitive structures)
    result = fixAIPatterns(result);
    
    // Fix punctuation issues
    result = fixPunctuation(result);
    
    // Vary repeated sentence starters
    result = varyRepeatedStarters(result);
    
    // Fix common AI participle patterns (but gently)
    result = result.replace(/, making it /gi, '. This makes it ');
    result = result.replace(/, leading to /gi, ', which leads to ');
    result = result.replace(/, resulting in /gi, ', which results in ');
    
    // Restore header if it was removed
    if (originalHadHeader && headerText && !result.toLowerCase().startsWith(headerText.toLowerCase().substring(0, 10))) {
        result = headerText + '\n' + result;
    }
    
    // Clean spacing
    result = result.replace(/\s{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
    
    return result;
}

// ==========================================================================
// 7. MAIN HANDLER
// ==========================================================================

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        const { text, apiKey } = req.body;
        const GROQ_KEY = apiKey || process.env.GROQ_API_KEY;
        
        if (!text) throw new Error("No text provided.");
        if (text.length < 10) throw new Error("Text too short.");

        const safeText = text.substring(0, 20000);
        
        // Step 1: Detect sections
        const sections = detectSections(safeText);
        console.log(`[Humanizer] Detected ${sections.length} sections`);
        
        // Step 2: Plan essay (get summaries for context)
        let summaries = {};
        if (sections.length > 1) {
            try {
                summaries = await planEssay(sections, GROQ_KEY);
                console.log(`[Humanizer] Generated ${Object.keys(summaries).length} section summaries`);
            } catch (e) {
                console.log('[Humanizer] Planning failed, continuing without summaries');
            }
        }
        
        // Step 3: Humanize each section with context
        const results = [];
        
        for (let i = 0; i < sections.length; i++) {
            const section = sections[i];
            const prevSummary = i > 0 ? summaries[i - 1] : null;
            const nextSummary = i < sections.length - 1 ? summaries[i + 1] : null;
            const sectionSummary = summaries[i];
            
            const prompt = buildHumanizePrompt(
                section, i, sections.length,
                prevSummary, nextSummary, sectionSummary
            );
            
            const messages = [{ role: "user", content: prompt }];
            let rawResult = await GroqAPI.chat(messages, GROQ_KEY, false);
            
            // Post-process
            const processed = postProcess(rawResult, !!section.title, section.title);
            results.push(processed);
        }
        
        // Step 4: Assemble final output
        let finalOutput = results.join('\n\n');
        
        // Final cleanup
        finalOutput = killEmDashes(finalOutput);
        finalOutput = finalOutput.replace(/\s{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();

        return res.status(200).json({
            success: true,
            result: finalOutput,
            sections: sections.length
        });

    } catch (error) {
        console.error("Humanizer Error:", error);
        return res.status(500).json({ success: false, error: error.message });
    }
}

// ==========================================================================
// EXPORTS for agent.js compatibility
// ==========================================================================
export { 
    postProcess as PostProcessor,
    SIMPLE_SWAPS as AI_VOCAB_SWAPS,
    detectSections as dynamicChunking,
    killEmDashes
};
