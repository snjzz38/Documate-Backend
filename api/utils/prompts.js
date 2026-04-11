// api/utils/prompts.js

// ==========================================================================
// PROMPT TEMPLATES (Modular & Reusable)
// ==========================================================================

const Templates = {
    // ------------------------------------------------------------------
    // CITATION FORMAT RULES
    // ------------------------------------------------------------------
    chicagoInText: `
CHICAGO IN-TEXT FORMAT (NO comma between author and year):
- 1 author: (LastName Year) → (Smith 2020)
- 2 authors: (LastName1 and LastName2 Year) → (West and Allen 2018)
- 3+ authors: (LastName1 et al. Year) → (Howden et al. 2007)
- No date: (LastName n.d.)
- Organization/Website: (Organization Year) → (IPCC 2023), (Greenpeace UK n.d.)

CRITICAL - NEVER USE "Unknown":
- If author is unknown, use SITE_NAME or organization name
- Example: IPCC website → (IPCC 2023) NOT (Unknown 2023)

EVERY citation MUST have a year or "n.d." - NEVER just (Author)`,

    apaInText: `
APA IN-TEXT FORMAT (WITH comma between author and year):
- 1 author: (Author, Year) → (Smith, 2020)
- 2 authors: (Author1 & Author2, Year) → (West & Allen, 2018)
- 3+ authors: (Author1 et al., Year) → (Howden et al., 2007)
- Organization: (Organization, Year) → (IPCC, 2023)

CRITICAL - NEVER USE "Unknown":
- If author is unknown, use SITE_NAME → (IPCC, 2023) NOT (Unknown, 2023)
- EVERY citation MUST include year or n.d.`,

    mlaInText: `
MLA IN-TEXT FORMAT:
- 1 author: (LastName)
- 2 authors: (LastName1 and LastName2)
- 3+ authors: (LastName1 et al.)
- Organization: (Organization Name)

Note: MLA typically omits year in parenthetical citations`,

    // ------------------------------------------------------------------
    // BIBLIOGRAPHY FORMAT RULES
    // ------------------------------------------------------------------
    chicagoBib: `
STYLE: Chicago Manual of Style (17th Edition)
FORMAT: LastName, FirstName. "Article Title." *Website Name*. Month Day, Year. URL.
- 2 authors: LastName1, FirstName1, and FirstName2 LastName2.
- 3+ authors: LastName1, FirstName1, et al.
- If DOI exists: use https://doi.org/DOI instead of URL`,

    apaBib: `
STYLE: APA 7th Edition
FORMAT: Author, A. A. (Year). Title of article. *Site Name*. URL
- 2 authors: Author1, A. A., & Author2, B. B. (Year).
- 3+ authors: List all authors with & before last`,

    mlaBib: `
STYLE: MLA 9th Edition
FORMAT: LastName, FirstName. "Article Title." *Container Title*, Date, URL.
- 2 authors: LastName1, FirstName1, and FirstName2 LastName2.
- 3+ authors: LastName1, FirstName1, et al.`,

    // ------------------------------------------------------------------
    // FOOTNOTE INSTRUCTIONS
    // ------------------------------------------------------------------
    footnoteMode: `
══════════════════════════════════════════════════════════════
FOOTNOTE MODE (CRITICAL):
══════════════════════════════════════════════════════════════
- Each insertion gets a UNIQUE footnote number
- Same source CAN and SHOULD be cited multiple times with different numbers
- Example: Source 1 cited 3 times = footnotes 1, 5, 12 (all pointing to same source)
- This is STANDARD academic practice

FOOTNOTE DISTRIBUTION TARGET:
- Introduction: 2-3 footnotes
- Each body paragraph: 3-5 footnotes  
- Conclusion: 2-3 footnotes
- Reuse your best sources 2-4 times each`,

    inTextMode: `
══════════════════════════════════════════════════════════════
IN-TEXT CITATION RULES:
══════════════════════════════════════════════════════════════
- Same source CAN be cited multiple times in different locations
- Each major claim should have a citation
- Distribute citations evenly across all paragraphs`,

    // ------------------------------------------------------------------
    // WHERE TO CITE
    // ------------------------------------------------------------------
    citationPlacements: `
═══════════════════════════════════════════════════════════════
WHERE TO INSERT CITATIONS:
═══════════════════════════════════════════════════════════════

🔴 HIGH PRIORITY - ALWAYS CITE:
• Statistical claims and specific numbers
• Causal statements ("driven by...", "contributes to...")
• Scientific consensus statements
• Definitions and key terms
• Policy references (Paris Agreement, IPCC, etc.)
• Impact statements (health, economic, environmental)
• Predictions/projections

🟡 MEDIUM PRIORITY:
• Topic introductions
• Scope claims ("one of the most pressing...")
• Process descriptions
• Concluding assertions`,

    // ------------------------------------------------------------------
    // ANCHOR RULES
    // ------------------------------------------------------------------
    anchorRules: `
═══════════════════════════════════════════════════════════════
ANCHOR RULES (CRITICAL):
═══════════════════════════════════════════════════════════════

1. Choose 3-8 word phrases that appear EXACTLY in the text
2. Place anchor at END of the claim being cited
3. Each anchor must be UNIQUE - never use the same anchor twice
4. SPREAD citations throughout the text - don't cluster them
5. Maximum 1 citation per sentence (unless comparing sources)
6. Never cite the same source twice at the same location

BAD EXAMPLE:
- anchor: "knowledge that is" → source 1
- anchor: "knowledge that is" → source 2  ❌ DUPLICATE ANCHOR

GOOD EXAMPLE:
- anchor: "a posteriori knowledge" → source 1
- anchor: "depends entirely on experience" → source 2  ✓ DIFFERENT ANCHORS`,

    // ------------------------------------------------------------------
    // VERBATIM QUOTE RULES
    // ------------------------------------------------------------------
    verbatimRules: `
QUOTE EXTRACTION RULES:

1. **VERBATIM REQUIREMENT** (CRITICAL):
   - Extract text EXACTLY as it appears in TEXT_CONTENT
   - Do NOT paraphrase, rearrange, or modify ANY words
   - Do NOT combine sentences from different parts of the text
   - Copy the exact punctuation, capitalization, and wording

2. **QUOTE LENGTH**: Extract SUBSTANTIAL passages (50-200 words)
   - Target: 2-5 complete sentences per quote
   - Extract consecutive sentences that appear together in the source

3. **CONTINUOUS vs NON-CONTINUOUS QUOTES**:
   
   **If sentences are CONSECUTIVE** (appear together in source):
   > "First sentence here. Second sentence follows immediately."
   
   **If sentences are SEPARATED** (from different parts of source):
   > • "First passage from beginning of article."
   > • "Second passage from middle of article."

4. **WHAT TO EXTRACT**:
   ✓ Statistical data and research findings
   ✓ Expert statements and authoritative claims
   ✓ Explanations of causes, effects, or solutions
   ✓ Policy recommendations or action plans
   ✓ Urgency statements or calls to action`
};

// ==========================================================================
// HELPER FUNCTIONS
// ==========================================================================

const Helpers = {
    /**
     * Get citation format rules based on style
     */
    getInTextFormat(style) {
        const s = (style || "").toLowerCase();
        if (s.includes("chicago")) return Templates.chicagoInText;
        if (s.includes("mla")) return Templates.mlaInText;
        return Templates.apaInText;
    },

    /**
     * Get bibliography format rules based on style
     */
    getBibFormat(style) {
        const s = (style || "").toLowerCase();
        if (s.includes("chicago")) return Templates.chicagoBib;
        if (s.includes("mla")) return Templates.mlaBib;
        return Templates.apaBib;
    },

    /**
     * Get footnote or in-text mode instructions
     */
    getModeInstructions(outputType) {
        return outputType === 'footnotes' ? Templates.footnoteMode : Templates.inTextMode;
    },

    /**
     * Build source context for prompts
     */
    buildSourceContext(sources, detailed = false) {
        const safeSources = Array.isArray(sources) ? sources : [];
        
        return safeSources.map(s => {
            const content = s.content || "";
            const meta = s.meta || {};
            
            // Extract year
            let year = meta.year || "n.d.";
            if (year === "n.d." && meta.published && meta.published !== "n.d.") {
                const yearMatch = meta.published.match(/\b(20\d{2})\b/);
                if (yearMatch) year = yearMatch[1];
            }
            if (year === "n.d.") {
                const contentYear = content.match(/\b(20\d{2})\b/);
                if (contentYear) year = contentYear[1];
            }
            
            // Extract authors - NEVER use "Unknown"
            let authors = [];
            if (meta.allAuthors && meta.allAuthors.length > 0) {
                authors = meta.allAuthors;
            } else if (meta.author && meta.author !== "Unknown") {
                authors = [meta.author];
            }
            
            // Fallback to site name
            const siteName = meta.siteName || s.title.split(/[:\-–|]/).shift().trim() || "Unknown Source";
            const displayAuthors = authors.length > 0 ? authors.join(' | ') : siteName;
            
            // Extract DOI
            let doi = "none";
            const doiMatch = content.match(/doi\.org\/([^\s]+)|DOI:\s*([^\s]+)/i);
            if (doiMatch) {
                doi = (doiMatch[1] || doiMatch[2]).replace(/[.,;]+$/, '');
            }
            
            if (detailed) {
                return `[ID:${s.id}]
TITLE: ${s.title}
FULL_URL: ${s.link}
DOI: ${doi}
SITE_NAME: ${siteName}
ALL_AUTHORS: ${displayAuthors}
USE_FOR_CITATION: ${displayAuthors.split(' | ')[0]} ← Use this name in citations, NEVER "Unknown"
AUTHOR_COUNT: ${authors.length || 1}
YEAR: ${year}
TEXT_CONTENT: ${content.substring(0, 1000).replace(/\n/g, ' ')}...`;
            }
            
            return `[ID:${s.id}] ${s.title}
  FULL_URL: ${s.link}
  AUTHORS: ${displayAuthors} (${authors.length || 1} author(s))
  YEAR: ${year}
  SITE: ${siteName}
  CONTENT PREVIEW: ${content.substring(0, 400).replace(/\n/g, ' ')}...`;
        }).join('\n\n---\n\n');
    },

    /**
     * Calculate citation targets
     */
    getTargets(sources, context) {
        const count = Array.isArray(sources) ? sources.length : 0;
        const sentences = (context.match(/[.!?]+/g) || []).length;
        
        return {
            minSources: Math.max(8, count - 2),
            targetInsertions: Math.max(Math.floor(count * 1.5), 12),
            targetDensity: Math.max(Math.floor(sentences * 0.5), 12)
        };
    },

    /**
     * Get today's date formatted
     */
    getToday() {
        return new Date().toLocaleDateString('en-US', { 
            year: 'numeric', 
            month: 'long', 
            day: 'numeric' 
        });
    }
};

// ==========================================================================
// MAIN EXPORT: CitationPrompts
// ==========================================================================

export const CitationPrompts = {

    /**
     * STEP 1: Generate formatted bibliography entries
     */
    buildStep1(style, sources) {
        const today = Helpers.getToday();
        const sourceContext = Helpers.buildSourceContext(sources, true);
        const bibFormat = Helpers.getBibFormat(style);
        
        return `
TASK: Generate formatted bibliography entries for ALL ${sources.length} sources.

${bibFormat}

SOURCES:
${sourceContext}

INSTRUCTIONS:
- Create ONE bibliography entry per source
- Use ALL authors from ALL_AUTHORS (use "et al." for 3+)
- If author is unknown, use SITE_NAME as author
- Include DOI if available (not "none")
- End each entry with: (Accessed ${today})

OUTPUT: Return JSON only:
{
  "1": "Complete formatted citation for source 1",
  "2": "Complete formatted citation for source 2"
}
`;
    },

    /**
     * STEP 2: Generate insertion points
     */
    buildStep2(outputType, style, context, sources) {
        const sourceContext = Helpers.buildSourceContext(sources, false);
        const citationFormat = Helpers.getInTextFormat(style);
        const modeInstructions = Helpers.getModeInstructions(outputType);
        const targets = Helpers.getTargets(sources, context);
        
        return `
TASK: Determine WHERE to insert citations in the user's text.

${citationFormat}
${modeInstructions}

AVAILABLE SOURCES (${sources.length} total):
${sourceContext}

TEXT TO CITE:
"${context}"

═══════════════════════════════════════════════════════════════
🎯 CITATION TARGETS (MANDATORY):
═══════════════════════════════════════════════════════════════

1. SOURCE COVERAGE: Use AT LEAST ${targets.minSources} out of ${sources.length} sources
   → "Further Reading" should have AT MOST 2 sources
   
2. INSERTION COUNT: Create AT LEAST ${targets.targetDensity} citation insertions
   → More is better - aim for ${targets.targetDensity + 5} if possible
   
3. DISTRIBUTION REQUIREMENTS:
   • Introduction: 2-4 citations
   • Body paragraph 1: 3-5 citations
   • Body paragraph 2: 3-5 citations  
   • Body paragraph 3: 3-5 citations
   • Conclusion: 2-4 citations
   
4. SOURCE REUSE: Cite strongest sources 2-4 times each

${Templates.citationPlacements}

${Templates.anchorRules}

═══════════════════════════════════════════════════════════════
OUTPUT FORMAT (JSON only):
═══════════════════════════════════════════════════════════════

{
  "insertions": [
    { "anchor": "exact phrase from text", "source_id": 1, "citation_text": "(Author Year)" },
    { "anchor": "another phrase", "source_id": 2, "citation_text": "(Author Year)" }
  ]
}

═══════════════════════════════════════════════════════════════
⚠️ PRE-SUBMISSION CHECKLIST:
═══════════════════════════════════════════════════════════════

□ ${targets.minSources}+ different source_ids used?
□ ${targets.targetDensity}+ total insertions?
□ Citations in intro, body, AND conclusion?
□ All anchors are exact phrases from text?
□ All citation_text includes year or "n.d."?
□ NO "Unknown" authors - use site name instead?
□ Output is valid JSON only?

IF ANY IS NO → Add more citations before outputting!
`;
    },

    /**
     * MAIN BUILD: For quotes and bibliography modes
     */
    build(type, style, context, sources) {
        const today = Helpers.getToday();
        const safeSources = Array.isArray(sources) ? sources : [];

        // ==================== QUOTES MODE ====================
        if (type === 'quotes') {
            // Build source context with clear URL emphasis
            const sourceContext = safeSources.map((s) => {
                return `[ID:${s.id}]
TITLE: ${s.title}
FULL_URL: ${s.link}
SITE: ${s.meta?.siteName || new URL(s.link).hostname}
CONTENT: ${(s.content || '').substring(0, 800).replace(/\n/g, ' ')}...`;
            }).join('\n\n---\n\n');
            
            return `
TASK: Extract substantial, meaningful quotes from each source - VERBATIM ONLY.

USER'S TEXT CONTEXT: "${context.substring(0, 500)}..."

SOURCES:
${sourceContext}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎯 MANDATORY: Extract quotes from ALL ${safeSources.length} sources
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

${Templates.verbatimRules}

OUTPUT FORMAT (strictly in order ID 1 to ${safeSources.length}):

**[ID] Title** - FULL_URL
> "Exact text from source copied verbatim."

EXAMPLE (showing FULL URL):
**[1] David Hume - Stanford Encyclopedia of Philosophy** - https://plato.stanford.edu/entries/hume/
> "Hume recognized two kinds of perception: impressions, which are vivid and forceful, and ideas, which are the less lively copies of impressions."

CRITICAL RULES:
1. Use the COMPLETE URL from FULL_URL field (e.g., https://plato.stanford.edu/entries/hume/)
2. NOT just the domain (e.g., NOT https://plato.stanford.edu)
3. Copy quotes VERBATIM - no paraphrasing
4. Include 2-5 sentences per quote (50-200 words)
5. If no relevant quote, say "No relevant quote found."
`;
        }

        // ==================== BIBLIOGRAPHY MODE ====================
        if (type === 'bibliography') {
            const sourceContext = Helpers.buildSourceContext(safeSources, true);
            const bibFormat = Helpers.getBibFormat(style);
            
            return `
TASK: Generate a bibliography for ALL ${safeSources.length} sources.

${bibFormat}

SOURCES:
${sourceContext}

INSTRUCTIONS:
- Create a properly formatted bibliography entry for EACH source
- Use ALL authors from ALL_AUTHORS field
- If author is "Unknown", use SITE_NAME instead
- Include DOI when available (not "none")
- Sort entries alphabetically by last name
- Output ONLY the bibliography entries, NO explanations

OUTPUT: Return ONLY the formatted bibliography entries, nothing else.
`;
        }

        // ==================== FALLBACK: Combined prompt ====================
        const sourceContext = Helpers.buildSourceContext(safeSources, false);
        const targets = Helpers.getTargets(safeSources, context);
        const citationFormat = Helpers.getInTextFormat(style);

        return `
TASK: Insert ${style || "Chicago"} citations into text.

${citationFormat}

SOURCES (${safeSources.length}):
${sourceContext}

TEXT: "${context}"

TARGETS: Use ${targets.minSources}+ sources, ${targets.targetInsertions}+ insertions

OUTPUT JSON:
{
  "insertions": [
    { "anchor": "phrase from text", "source_id": 1, "citation_text": "(Author Year)" }
  ],
  "formatted_citations": {
    "1": "Full bibliography entry (Accessed ${today})"
  }
}
`;
    }
};

// Export helpers for use in other modules if needed
export { Helpers, Templates };

// ==========================================================================
// HUMANIZER PROMPTS
// ==========================================================================

export const HumanizerPrompts = {
    buildBatchPrompt(sentences) {
        const numbered = sentences.map((s, i) => `${i + 1}. ${s}`).join('\n');
        return `Rewrite each numbered sentence to sound human-written. Preserve exact meaning, all facts, and citations. Academic tone throughout.

RULES (apply to every sentence):
1. Same meaning — no added or removed facts
2. NEVER use "isn't X, it's Y" or "not just X, but Y" constructions
3. No semicolons, em dashes, or ", which" clauses
4. No filler: "essentially", "it should be noted", "as a matter of course"
5. Use contractions naturally: it's, don't, we're, that's
6. Vary sentence openings across the list

SENTENCES:
${numbered}

Output ONLY the numbered rewrites in the same order, no commentary:`;
    }
};

// ==========================================================================
// GRADER PROMPTS
// ==========================================================================

const _formatCriteria = (criteria) => {
    if (!criteria || criteria.length === 0) return null;
    let out = "RUBRIC CRITERIA (Grade EACH criterion):\n";
    criteria.forEach((c, i) => {
        out += c.points ? `${i + 1}. ${c.name} (${c.points} points)\n` : `${i + 1}. ${c.name}\n`;
    });
    return out;
};

export const GraderPrompts = {
    buildGradingPrompt(studentText, instructions, rubric, analysis, parsedCriteria) {
        const parts = [];

        parts.push(`ROLE: You are an experienced, fair, and constructive academic grader.
Your goal is to help students IMPROVE. Be specific, actionable, and encouraging.

GRADING PHILOSOPHY:
- Be strict but fair
- Every critique must include HOW to fix it
- Highlight what works well (students need encouragement)
- Reference SPECIFIC parts of the student's work
- If a rubric is provided, grade EACH criterion explicitly`);

        if (analysis.assignmentType !== 'general') {
            parts.push(`\nASSIGNMENT TYPE: ${analysis.assignmentType.toUpperCase()}
Key areas to evaluate: ${analysis.keyRequirements.join(', ')}`);
        }

        if (instructions && instructions.trim()) {
            parts.push(`\n═══════════════════════════════════════════════════════════════
ASSIGNMENT INSTRUCTIONS (What the student was asked to do):
═══════════════════════════════════════════════════════════════
${instructions.trim()}`);
        }

        if (parsedCriteria) {
            parts.push(`\n═══════════════════════════════════════════════════════════════
GRADING RUBRIC (You MUST grade each criterion):
═══════════════════════════════════════════════════════════════
${_formatCriteria(parsedCriteria)}`);
        } else if (rubric && rubric.trim()) {
            parts.push(`\n═══════════════════════════════════════════════════════════════
GRADING CRITERIA:
═══════════════════════════════════════════════════════════════
${rubric.trim()}`);
        }

        parts.push(`\n═══════════════════════════════════════════════════════════════
STUDENT SUBMISSION:
═══════════════════════════════════════════════════════════════
${studentText}`);

        let outputFormat = `\n═══════════════════════════════════════════════════════════════
OUTPUT FORMAT (Follow this structure exactly):
═══════════════════════════════════════════════════════════════

## 📊 Overall Grade: [Letter Grade]
[1-2 sentence summary of overall performance]

`;
        if (parsedCriteria && parsedCriteria.length > 0) {
            outputFormat += `## 📋 Rubric Breakdown\n`;
            parsedCriteria.forEach((c) => {
                outputFormat += c.points
                    ? `### ${c.name} (___/${c.points} points)\n- Score justification\n- Specific evidence from submission\n\n`
                    : `### ${c.name}\n- Assessment\n- Specific evidence from submission\n\n`;
            });
        }

        outputFormat += `## ✅ Strengths
- [Specific strength with quote/example from text]
- [Another strength]
- [What the student did well]

## ⚠️ Areas for Improvement
- [Specific issue]: "[Quote from text]" → [How to fix it]
- [Another issue]: [Specific example] → [Actionable improvement]
- [Pattern or recurring problem] → [Strategy to address it]

## 🎯 Priority Improvements (Top 3)
1. **[Most important fix]**: [Exactly what to do and why it matters]
2. **[Second priority]**: [Specific steps to improve]
3. **[Third priority]**: [Actionable advice]

## 💡 Next Steps
[2-3 sentences of encouragement and specific next actions the student should take]`;

        parts.push(outputFormat);

        parts.push(`\n═══════════════════════════════════════════════════════════════
CRITICAL GRADING RULES:
═══════════════════════════════════════════════════════════════
1. If a RUBRIC is provided, you MUST score each criterion
2. Every criticism MUST include a specific fix
3. Quote the student's actual text when pointing out issues
4. Be encouraging - help them improve, don't just criticize
5. The "Priority Improvements" section is the MOST IMPORTANT - make it actionable
6. Grade based ONLY on the provided instructions/rubric, not your own expectations`);

        return parts.join('\n');
    },

    buildFollowupPrompt(question, context) {
        return `SYSTEM: You are an expert academic grader having a follow-up conversation with a student about their graded work.

CONTEXT:
- You already graded their submission
- Be helpful, specific, and encouraging
- Reference the original feedback when relevant
- Keep responses concise but thorough

ORIGINAL STUDENT SUBMISSION:
${context.studentText.substring(0, 5000)}

${context.instructions ? `ASSIGNMENT INSTRUCTIONS:\n${context.instructions.substring(0, 1000)}\n` : ''}

YOUR PREVIOUS FEEDBACK:
${context.feedback.substring(0, 3000)}

CONVERSATION HISTORY:
${context.chatHistory.slice(-6).map(m => `${m.role.toUpperCase()}: ${m.content}`).join('\n\n')}

STUDENT'S QUESTION: ${question}

Respond to the student's question naturally and helpfully. Be specific and reference their work when applicable.`;
    }
};

// ==========================================================================
// AGENT PROMPTS
// ==========================================================================

export const AgentPrompts = {
    groqCheckMessages(text) {
        return [
            { role: 'system', content: 'You are a QA checker. Return ONLY valid JSON. No thinking, no explanation.' },
            { role: 'user', content: `Check this academic text and return a JSON object with these boolean fields:
- "hasCommentary": true if ANY sentence comments on a source rather than arguing (e.g. "Indeed, Author highlights...", "As Author points out...", "Author effectively illustrates...", "This highlights the importance of...")
- "hasBecauseStarts": true if ANY sentence or bullet starts with the word "Because"
- "hasMetaDescriptions": true if ANY sentence describes what a study IS rather than what it FOUND (e.g. "This study reviews...", "This article examines...")
- "headersIntact": true if section headers like "ARGUMENTS FOR", "DECISION:", "JUSTIFICATION:" each appear on their own line
- "bulletsCorrectLength": true if every bullet (lines starting with "- ") has 2-3 sentences (not more)

TEXT:
${text}

Return ONLY the JSON object:` }
        ];
    },

    getWriteFormatInstructions(fmt) {
        if (fmt === 'table') {
            return `FORMAT — STRUCTURED TABLE ASSIGNMENT. Output EXACTLY these four sections with their headers on their own lines.

ARGUMENTS FOR (EMBRACE):
- [Argument 1: EXACTLY 2-3 sentences. State the claim, explain why it matters, give a concrete example or consequence. NO padding sentences.]
- [Argument 2: different angle — 2-3 sentences only]
- [Argument 3: different angle — 2-3 sentences only]
- [Argument 4: different angle — 2-3 sentences only]

ARGUMENTS AGAINST (PANIC):
- [Argument 1: EXACTLY 2-3 sentences. Same structure as above.]
- [Argument 2: different angle — 2-3 sentences only]
- [Argument 3: different angle — 2-3 sentences only]
- [Argument 4: different angle — 2-3 sentences only]

DECISION:
One sentence only. Start with "Panic." or "Embrace." then state why.

JUSTIFICATION:
3-4 paragraphs. Requirements:
- First sentence: "I choose to [panic/embrace] because..."
- Each paragraph: topic sentence → reasoning → tie back to decision
- Final paragraph: synthesis — explain WHY the risks/benefits tip the scale
- Do NOT include citations or a reference section

LENGTH RULES — STRICTLY ENFORCED:
- Each bullet in FOR/AGAINST = EXACTLY 2-3 sentences. NOT 4, NOT 5, NOT 6. If you write more than 3 sentences for a bullet, you have failed.
- Do NOT pad arguments with filler like "This represents a profound advancement" or "This perspective highlights..."
- Do NOT repeat the same point in different words within one bullet
- Every sentence must add NEW information — no restating

SENTENCE STARTER RULES — STRICTLY ENFORCED:
- NEVER start any bullet with "Because". Start with the actual claim instead.
- NEVER start two consecutive sentences with the same word anywhere in the output
- BAD: "Because gene editing can..." → GOOD: "Gene editing can..."
- BAD: "Because parents naturally..." → GOOD: "Parents naturally..."
- Vary starters: use the subject, a condition, a contrast, a fact — anything but "Because" as a first word

CRITICAL: All four headers (ARGUMENTS FOR (EMBRACE):, ARGUMENTS AGAINST (PANIC):, DECISION:, JUSTIFICATION:) MUST appear verbatim on their own lines.`;
        }
        if (fmt === 'steps' || fmt === 'structured') {
            return `FORMAT — STRUCTURED ASSIGNMENT:
This task has specific sections or steps. Output each section with its label, in order:
- Read the task carefully and identify each distinct section or deliverable
- Complete each section fully, in the order given
- Use the exact section labels from the task
- Do NOT convert this into a prose essay
- Do NOT skip any sections
- Plain text, no markdown formatting`;
        }
        if (fmt === 'questions') {
            return `FORMAT — ANSWER EACH QUESTION:
- Answer each question directly and completely, keeping original numbering
- Each answer: thorough and specific
- Plain text only — no markdown`;
        }
        if (fmt === 'list') {
            return `FORMAT — LIST:
- Clear, organized structure
- Plain text only — no markdown`;
        }
        if (fmt === 'paragraph') {
            return `FORMAT — PARAGRAPH RESPONSE:
- Write a single well-developed paragraph (or the number of paragraphs the task specifies)
- Do NOT expand into a multi-section essay with introduction/body/conclusion headings
- Do NOT add a title or section labels unless the task asks for them
- Plain text only — no markdown`;
        }
        if (fmt === 'essay') {
            return `FORMAT — ACADEMIC ESSAY (apply all of these):
STRUCTURE:
- Introduction: Open with context, then state your EXPLICIT thesis/decision in the final sentence of the intro (e.g. "This paper argues that...")
- Body paragraphs: Each paragraph covers ONE main point. Start with a topic sentence. Support with evidence. End by connecting back to the thesis — never restate the topic sentence
- Conclusion: Synthesize the argument; do not just summarize. Restate thesis in new words and explain the broader significance

WRITING QUALITY:
- Vary sentence openings and lengths — no two consecutive sentences should start the same way
- Paraphrase all source material; avoid direct quotes unless uniquely necessary
- Every claim should logically advance the argument; cut filler phrases like "it is important to note"
- Formal academic tone throughout`;
        }
        return `FORMAT — MATCH THE TASK EXACTLY:
STEP 1: Identify what output format the task is asking for (e.g. a letter, a list, Q&A, a paragraph, a table, a short answer).
STEP 2: Produce ONLY that format.

STRICT RULES:
- If the task asks for 1 paragraph — write 1 paragraph, NOT an essay
- If the task asks for a letter — write a letter
- If the task asks for Q&A or numbered questions — answer each question directly and separately
- If the task has labeled sections — use those exact labels
- NEVER write a multi-section academic essay (no Introduction/Body/Conclusion structure) unless the task explicitly uses the word "essay"
- Do NOT add titles, headers, or extra sections the task did not ask for
- Plain text — no markdown unless the task specifically requires it`;
    },

    buildWritePrompt(userTask, sourceInfo, pdfContext, fileContext, formatInstructions, hasImages) {
        return `Complete the following task accurately.

TASK:
${userTask}
${pdfContext}${fileContext}
${sourceInfo ? `\nRESEARCH SOURCES (use for ideas and content only — do NOT include citations, author names, or references in your output now):\n${sourceInfo}` : ''}

${formatInstructions}

CRITICAL RULES — ALWAYS APPLY:
- Do NOT include any in-text citations, author names, or source references anywhere in the output
- Do NOT add a reference list, "Sources:", or bibliography section at the end
- Do NOT mention specific researchers, papers, or organisations by name
- Do NOT write a generic essay if the task asks for something else
- Do NOT start with commentary like "Here's your essay:", "Sure!", or any preamble — begin with the actual content immediately
${hasImages ? '- Carefully analyze any uploaded images as part of the response.' : ''}

Complete the task now:`;
    },

    getCitationFormat(type, isApa, isMla) {
        if (type === 'in-text') {
            if (isApa) return `APA 7th in-text: parenthetical = (LastName, Year) | narrative = LastName (Year). Use ONLY the CITE-AS key shown — do not alter it.
Do NOT use footnotes, superscript numbers (¹²³), or endnotes. ONLY parenthetical/narrative in-text citations.`;
            if (isMla) return `MLA 9th in-text: parenthetical = (LastName). No year in the parenthetical. Use ONLY the CITE-AS key shown — do not alter it.
Do NOT use footnotes, superscript numbers (¹²³), or endnotes. ONLY parenthetical in-text citations.`;
            return `Chicago in-text: (LastName Year). Use ONLY the CITE-AS key shown — do not alter it.
Do NOT use footnotes, superscript numbers (¹²³), or endnotes. ONLY parenthetical in-text citations.`;
        }
        return `Superscript footnotes numbered sequentially (¹²³…). New number for each use.
Do NOT use parenthetical citations like (Author, Year) or (Author). ONLY superscript footnote numbers.`;
    },

    buildCitePrompt(input, sourceList, citationFormat, type, hasStructuredHeaders) {
        return `Insert citations into the text below using ONLY the sources listed.

TEXT:
${input}

SOURCES — copy the CITE-AS key verbatim. Do not invent or modify author names:
${sourceList}

FORMAT: ${citationFormat}

RULES:
1. ONLY insert citation keys — do NOT add ANY new sentences or words beyond the citation marker itself
2. FORBIDDEN: Adding commentary like "Indeed, Author (Year) underscores...", "Furthermore, Author highlights...", "Author (Year) directly addresses this concern..." — these are NOT citations, they are new content. NEVER do this.
3. CORRECT citation insertion: place the CITE-AS key at the end of an EXISTING sentence, e.g. "Gene editing carries risks (Author, Year)." — do NOT write a new sentence about the source
4. Copy the CITE-AS key exactly as written — no variations
5. ${type === 'in-text' ? 'NEVER use footnotes or superscript numbers. ONLY parenthetical/narrative in-text citations.' : 'Use superscript footnote numbers ONLY. NEVER use parenthetical (Author, Year) citations.'}
6. Do NOT add a references section, bibliography, or source list at the end
7. Do NOT start with commentary like "Here is..."
8. The output must have the SAME NUMBER OF SENTENCES as the input — you are only adding citation markers, not new text
${hasStructuredHeaders ? '9. CRITICAL: Preserve ALL section headers exactly as written on their own lines. Do not merge headers with other text.' : ''}

Return ONLY the text with citations inserted:`;
    },

    buildFootnoteFixPrompt(text, sourceList) {
        return `Wherever an author name appears without a footnote superscript, add the correct one. Do not change anything else. Do not add a reference list. Do not start with commentary.

TEXT:
${text}

SOURCES:
${sourceList}

Return the corrected text only:`;
    },

    buildQuotesPrompt(input, quotesList) {
        return `Insert 3-5 direct quotes into this text with analytical transitions.

TEXT:
${input}

AVAILABLE QUOTES:
${quotesList}

INSTRUCTIONS:
1. Pick quotes that contain SPECIFIC FINDINGS, DATA, or CONCLUSIONS — not general descriptions of what a paper is about
2. SKIP any quote that just describes what the study does (e.g. "This article reviews..." or "We examine...") — these add nothing
3. Introduce each quote with a transition that explains its relevance to your argument
4. Follow each quote with 1-2 sentences of your own analysis connecting it to the argument
5. Keep ALL existing text and citations intact
6. Do NOT add a bibliography or reference section
7. Do NOT start with commentary like "Here is..." — output ONLY the text with quotes inserted
8. A good quote adds EVIDENCE. A bad quote just describes a paper. Only use good quotes.

Return the text with quotes inserted:`;
    }
};
