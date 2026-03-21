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

    const bannedList = BANNED_WORDS.slice(0, 20).join(', ');

    return `Rewrite this ${position} section to sound more human while PRESERVING its structure and meaning.

${context}
RULES:
1. Keep the same ideas and flow - just make language more natural
2. Preserve any headers, citations, or technical terms exactly
3. NO em dashes (—). Use commas or periods instead
4. Avoid these words: ${bannedList}
5. Mix sentence lengths naturally - some short, some longer
6. Don't start every sentence with "The" or "This"
7. Keep transitions smooth between ideas
8. Sound like a knowledgeable person explaining, not a textbook

WHAT TO AVOID:
- Choppy disconnected sentences
- Overly casual slang
- Changing the meaning or removing important points
- Adding new information not in the original

SECTION TO REWRITE:
${section.title ? `[${section.title}]\n` : ''}${section.content}

OUTPUT the rewritten section (keep the header if present):`;
}

// ==========================================================================
// 6. POST-PROCESSING - Light touch cleanup
// ==========================================================================

function postProcess(text, originalHadHeader, headerText) {
    let result = text;
    
    // Clean AI artifacts
    result = cleanOutput(result);
    
    // Kill em dashes
    result = killEmDashes(result);
    
    // Apply word swaps
    result = applySwaps(result);
    
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
