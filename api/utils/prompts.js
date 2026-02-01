// api/utils/prompts.js

export const CitationPrompts = {

    // ======================================================================
    // STEP 1: Generate formatted citations for all sources
    // Called by citation.js for in-text and footnotes modes
    // ======================================================================
    buildStep1(style, sources) {
        const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
        const safeSources = Array.isArray(sources) ? sources : [];
        
        const sourceContext = this._buildSourceContext(safeSources);
        
        const s = (style || "").toLowerCase();
        let styleRules = "";
        
        if (s.includes("chicago")) {
            styleRules = `
STYLE: Chicago Manual of Style (17th Edition)
FORMAT: LastName, FirstName. "Article Title." *Website Name*. Month Day, Year. URL.
- 2 authors: LastName1, FirstName1, and FirstName2 LastName2.
- 3+ authors: LastName1, FirstName1, et al.
- If DOI exists: use https://doi.org/DOI instead of URL`;
        } else if (s.includes("mla")) {
            styleRules = `
STYLE: MLA 9th Edition
FORMAT: LastName, FirstName. "Article Title." *Container Title*, Date, URL.
- 2 authors: LastName1, FirstName1, and FirstName2 LastName2.
- 3+ authors: LastName1, FirstName1, et al.`;
        } else {
            styleRules = `
STYLE: APA 7th Edition
FORMAT: Author, A. A. (Year). Title of article. *Site Name*. URL
- 2 authors: Author1, A. A., & Author2, B. B. (Year).
- 3+ authors: List all authors with & before last`;
        }
        
        return `
TASK: Generate formatted bibliography entries for ALL ${safeSources.length} sources.

${styleRules}

SOURCES:
${sourceContext}

INSTRUCTIONS:
- Create ONE bibliography entry per source
- Use ALL authors from ALL_AUTHORS (use "et al." for 3+)
- Include DOI if available (not "none")
- End each entry with: (Accessed ${today})

OUTPUT: Return JSON only:
{
  "1": "Complete formatted citation for source 1",
  "2": "Complete formatted citation for source 2",
  ...
}
`;
    },

    // ======================================================================
    // STEP 2: Generate insertion points
    // Called by citation.js for in-text and footnotes modes
    // ======================================================================
    buildStep2(outputType, style, context, sources, formattedCitations) {
        const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
        const safeSources = Array.isArray(sources) ? sources : [];
        
        const minSourcesToUse = Math.max(8, safeSources.length - 2);
        const targetInsertions = Math.max(Math.floor(safeSources.length * 1.5), 12);
        
        // Count sentences for density calculation
        const sentenceCount = (context.match(/[.!?]+/g) || []).length;
        const targetDensity = Math.max(Math.floor(sentenceCount * 0.5), targetInsertions);
        
        const sourceContext = safeSources.map(s => {
            const meta = s.meta || {};
            let year = meta.year || "n.d.";
            if (year === "n.d." && meta.published && meta.published !== "n.d.") {
                const yearMatch = meta.published.match(/\b(20\d{2})\b/);
                if (yearMatch) year = yearMatch[1];
            }
            
            let authors = [];
            if (meta.allAuthors && meta.allAuthors.length > 0) {
                authors = meta.allAuthors;
            } else if (meta.author && meta.author !== "Unknown") {
                authors = [meta.author];
            } else {
                // Fallback to site name instead of "Unknown"
                authors = [meta.siteName || s.title.split(' ')[0] || "Unknown Source"];
            }
            
            return `[ID:${s.id}] ${s.title}
  AUTHORS: ${authors.join(' | ') || "Unknown"} (${authors.length || 1} author(s))
  YEAR: ${year}
  SITE: ${meta.siteName || "Unknown"}
  CONTENT PREVIEW: ${(s.content || "").substring(0, 400).replace(/\n/g, ' ')}...`;
        }).join('\n\n');
        
        const st = (style || "").toLowerCase();
        let citationFormat = "";
        
if (st.includes("chicago")) {
    citationFormat = `
CHICAGO IN-TEXT FORMAT (NO comma between author and year):
- 1 author: (LastName Year) → (Smith 2020)
- 2 authors: (LastName1 and LastName2 Year) → (West and Allen 2018)
- 3+ authors: (LastName1 et al. Year) → (Howden et al. 2007)
- No date: (LastName n.d.)
- Organization/Website: (Organization Year) → (IPCC 2023), (Greenpeace UK n.d.)

CRITICAL - NEVER USE "Unknown":
- If author is unknown, use SITE_NAME or organization name
- Example: IPCC website → (IPCC 2023) NOT (Unknown 2023)
- Example: Greenpeace UK → (Greenpeace UK n.d.) NOT (Unknown n.d.)

EVERY citation MUST have a year or "n.d." - NEVER just (Author)`;
    
        } else if (st.includes("mla")) {
            citationFormat = `
MLA IN-TEXT FORMAT:
- 1 author: (LastName)
- 2 authors: (LastName1 and LastName2)
- 3+ authors: (LastName1 et al.)`;
    
} else {
    citationFormat = `
APA IN-TEXT FORMAT (WITH comma between author and year):
- 1 author: (Author, Year) → (Smith, 2020)
- 2 authors: (Author1 & Author2, Year) → (West & Allen, 2018)
- 3+ authors: (Author1 et al., Year) → (Howden et al., 2007)
- Organization: (Organization, Year) → (IPCC, 2023)

CRITICAL - NEVER USE "Unknown":
- If author is unknown, use SITE_NAME → (IPCC, 2023) NOT (Unknown, 2023)
- EVERY citation MUST include year or n.d.`;
} 
        
        const footnoteInstructions = outputType === 'footnotes' ? `
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
- Reuse your best sources 2-4 times each
` : `
══════════════════════════════════════════════════════════════
IN-TEXT CITATION RULES:
══════════════════════════════════════════════════════════════
- Same source CAN be cited multiple times in different locations
- Each major claim should have a citation
- Distribute citations evenly across all paragraphs
`;

        return `
TASK: Determine WHERE to insert citations in the user's text.

${citationFormat}
${footnoteInstructions}

AVAILABLE SOURCES (${safeSources.length} total):
${sourceContext}

TEXT TO CITE:
"${context}"

═══════════════════════════════════════════════════════════════
🎯 CITATION TARGETS (MANDATORY):
═══════════════════════════════════════════════════════════════

1. SOURCE COVERAGE: Use AT LEAST ${minSourcesToUse} out of ${safeSources.length} sources
   → "Further Reading" should have AT MOST 2 sources
   
2. INSERTION COUNT: Create AT LEAST ${targetDensity} citation insertions
   → More is better - aim for ${targetDensity + 5} if possible
   
3. DISTRIBUTION REQUIREMENTS:
   • Introduction: 2-4 citations
   • Body paragraph 1: 3-5 citations
   • Body paragraph 2: 3-5 citations  
   • Body paragraph 3: 3-5 citations
   • Conclusion: 2-4 citations
   
4. SOURCE REUSE: Cite strongest sources 2-4 times each

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
• Concluding assertions

═══════════════════════════════════════════════════════════════
ANCHOR RULES:
═══════════════════════════════════════════════════════════════

1. Choose 3-8 word phrases that appear EXACTLY in the text
2. Place anchor at END of the claim being cited
3. Each anchor must be unique and findable

═══════════════════════════════════════════════════════════════
OUTPUT FORMAT (JSON only):
═══════════════════════════════════════════════════════════════

{
  "insertions": [
    { "anchor": "most pressing challenges facing", "source_id": 1, "citation_text": "(Author Year)" },
    { "anchor": "driven by anthropogenic activities", "source_id": 2, "citation_text": "(Author Year)" },
    { "anchor": "scientific consensus is unequivocal", "source_id": 2, "citation_text": "(Author Year)" },
    ... continue until ${targetDensity}+ insertions using ${minSourcesToUse}+ sources
  ]
}

═══════════════════════════════════════════════════════════════
⚠️ PRE-SUBMISSION CHECKLIST:
═══════════════════════════════════════════════════════════════

□ ${minSourcesToUse}+ different source_ids used?
□ ${targetDensity}+ total insertions?
□ Citations in intro, body, AND conclusion?
□ All anchors are exact phrases from text?
□ All citation_text includes year or "n.d."?
□ Output is valid JSON only?

IF ANY IS NO → Add more citations before outputting!
`;
    },

    // ======================================================================
    // MAIN BUILD METHOD
    // Called by citation.js for quotes and bibliography modes
    // ======================================================================
    build(type, style, context, sources) {
        const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
        
        // SAFETY CHECK: Ensure sources is an array
        const safeSources = Array.isArray(sources) ? sources : [];

        // Enhanced context builder with comprehensive metadata extraction
        const sourceContext = this._buildEnhancedSourceContext(safeSources);

        // ======================================================================
        // MODE 1: QUOTES EXTRACTION
        // ======================================================================
        if (type === 'quotes') {
            return `
TASK: Extract substantial, meaningful quotes from each source - VERBATIM ONLY.

USER'S TEXT CONTEXT: "${context.substring(0, 500)}..."

SOURCES:
${sourceContext}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎯 MANDATORY: Extract quotes from ALL ${safeSources.length} sources
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

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
   > "First sentence here. Second sentence follows immediately. Third sentence continues the thought."
   
   **If sentences are SEPARATED** (from different parts of source):
   > • "First passage from beginning of article."
   > • "Second passage from middle of article."
   > • "Third passage from end of article."

4. **WHAT TO EXTRACT**:
   ✓ Statistical data and research findings
   ✓ Expert statements and authoritative claims
   ✓ Explanations of causes, effects, or solutions
   ✓ Policy recommendations or action plans
   ✓ Urgency statements or calls to action

5. **OUTPUT FORMAT** (strictly in order ID 1 to ${safeSources.length}):

**[ID] Title** - URL
> "Exact text from source copied verbatim."

OR for non-continuous:
**[ID] Title** - URL
> • "First passage."
> • "Second passage."

OR if truly no content:
**[ID] Title** - URL
> No relevant quote found.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CRITICAL: VERBATIM means VERBATIM - no paraphrasing, no rewording!
`;
        }

        // ======================================================================
        // MODE 2: BIBLIOGRAPHY ONLY
        // ======================================================================
        if (type === 'bibliography') {
            let bibStyleRules = "";
            const s = (style || "").toLowerCase();
            
            if (s.includes("chicago")) {
                bibStyleRules = `
STYLE: Chicago Manual of Style (17th Edition)

FORMAT:
- 1 author: LastName, FirstName. "Article Title." *Website Name*. Month Day, Year. URL.
- 2 authors: LastName1, FirstName1, and FirstName2 LastName2. "Article Title." *Website Name*. Month Day, Year. URL.
- 3+ authors: LastName1, FirstName1, et al. "Article Title." *Website Name*. Month Day, Year. URL.

RULES:
- Use ALL authors from ALL_AUTHORS field
- Include DOI if available (format: https://doi.org/DOI)
- Sort alphabetically by last name
`;
            } else if (s.includes("mla")) {
                bibStyleRules = `
STYLE: MLA 9th Edition

FORMAT:
- 1 author: LastName, FirstName. "Article Title." *Container Title*, Date, URL.
- 2 authors: LastName1, FirstName1, and FirstName2 LastName2. "Article Title." *Container*, Date, URL.
- 3+ authors: LastName1, FirstName1, et al. "Article Title." *Container*, Date, URL.
`;
            } else {
                bibStyleRules = `
STYLE: APA 7th Edition

FORMAT:
- 1 author: Author, A. A. (Year). Title of article. *Site Name*. URL
- 2 authors: Author1, A. A., & Author2, B. B. (Year). Title. *Site Name*. URL
- 3+ authors: List all authors with & before last
`;
            }
            
            return `
TASK: Generate a bibliography for ALL ${safeSources.length} sources.

${bibStyleRules}

SOURCES:
${sourceContext}

INSTRUCTIONS:
- Create a properly formatted bibliography entry for EACH source (ID 1 through ${safeSources.length})
- Use ALL authors from ALL_AUTHORS field
- Include DOI when available (not "none")
- Sort entries alphabetically by last name
- Output ONLY the bibliography entries, NO explanations
- Each entry on a new line, separated by blank line

OUTPUT: Return ONLY the formatted bibliography entries, nothing else.
`;
        }

        // ======================================================================
        // MODE 3: IN-TEXT CITATIONS & FOOTNOTES (fallback - normally uses Step1/Step2)
        // ======================================================================
        return this._buildCombinedPrompt(style, context, safeSources, today, type);
    },

    // ======================================================================
    // HELPER: Build Enhanced Source Context (for build method)
    // ======================================================================
    _buildEnhancedSourceContext(sources) {
        return sources.map(s => {
            const content = s.content || "";
            const meta = s.meta || {};

            // PRE-EXTRACT DATE
            let enhancedDate = meta.published;
            if (!enhancedDate || enhancedDate === "n.d.") {
                const datePatterns = [
                    /(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}/i,
                    /\b(20\d{2})\b/,
                ];
                
                for (const pattern of datePatterns) {
                    const match = content.match(pattern);
                    if (match) {
                        enhancedDate = match[0];
                        break;
                    }
                }
            }
            
            // EXTRACT YEAR
            let year = "n.d.";
            if (enhancedDate && enhancedDate !== "n.d.") {
                const yearMatch = enhancedDate.match(/\b(20\d{2})\b/);
                if (yearMatch) year = yearMatch[1];
            }
            
            // PRE-EXTRACT AUTHORS
            let enhancedAuthors = meta.allAuthors || [];
            if (enhancedAuthors.length === 0 && meta.author && meta.author !== "Unknown") {
                enhancedAuthors = [meta.author];
            }
            
            // EXTRACT DOI
            let doi = "";
            const doiMatch = content.match(/doi\.org\/([^\s]+)|DOI:\s*([^\s]+)/i);
            if (doiMatch) {
                doi = doiMatch[1] || doiMatch[2];
                doi = doi.replace(/[.,;]+$/, '');
            }
            
// Determine display author (never "Unknown")
const siteName = meta.siteName || s.title.split(/[:\-–|]/).shift().trim() || "Unknown Source";
const displayAuthors =
    enhancedAuthors.length > 0
        ? enhancedAuthors.join(' | ')
        : siteName;

return `[ID:${s.id}]
TITLE: ${s.title}
URL: ${s.link}
DOI: ${doi || "none"}
SITE_NAME: ${siteName}
ALL_AUTHORS: ${displayAuthors}
USE_FOR_CITATION: ${displayAuthors.split(' | ')[0]} ← Use this name in citations, NEVER "Unknown"
AUTHOR_COUNT: ${enhancedAuthors.length}
DETECTED_DATE: ${enhancedDate || meta.published}
YEAR: ${year}
TEXT_CONTENT: ${content.substring(0, 1000).replace(/\n/g, ' ')}...`;
        }).join('\n\n---\n\n');
    },

    // ======================================================================
    // HELPER: Build Source Context (for Step1/Step2)
    // ======================================================================
    _buildSourceContext(sources) {
        return sources.map(s => {
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
            
            // Extract authors
            let authors = [];
            if (meta.allAuthors && meta.allAuthors.length > 0) {
                authors = meta.allAuthors;
            } else if (meta.author && meta.author !== "Unknown") {
                authors = [meta.author];
            }
            
            // Extract DOI
            let doi = "";
            const doiMatch = content.match(/doi\.org\/([^\s]+)|DOI:\s*([^\s]+)/i);
            if (doiMatch) {
                doi = doiMatch[1] || doiMatch[2];
                doi = doi.replace(/[.,;]+$/, '');
            }
            
            return `[ID:${s.id}]
TITLE: ${s.title}
URL: ${s.link}
DOI: ${doi || "none"}
SITE_NAME: ${meta.siteName || "Unknown"}
ALL_AUTHORS: ${authors.join(' | ') || "Unknown"}
AUTHOR_COUNT: ${authors.length || 1}
YEAR: ${year}
CONTENT PREVIEW: ${content.substring(0, 800).replace(/\n/g, ' ')}...`;
        }).join('\n\n---\n\n');
    },

    // ======================================================================
    // HELPER: Combined prompt for direct in-text/footnotes (fallback)
    // ======================================================================
    _buildCombinedPrompt(style, context, sources, today, outputType) {
        const s = (style || "").toLowerCase();
        const minSourcesToUse = Math.max(8, sources.length - 2);
        const targetInsertions = Math.floor(sources.length * 1.5);
        const sourceContext = this._buildSourceContext(sources);
        
        let styleRules = "";
        if (s.includes("chicago")) {
            styleRules = `
STYLE: Chicago (NO comma between author and year)
IN-TEXT: (LastName Year), (LastName1 and LastName2 Year), (LastName1 et al. Year)`;
        } else if (s.includes("mla")) {
            styleRules = `
STYLE: MLA 9th Edition
IN-TEXT: (LastName), (LastName1 and LastName2), (LastName1 et al.)`;
        } else {
            styleRules = `
STYLE: APA 7th (WITH comma, use &)
IN-TEXT: (Author, Year), (Author1 & Author2, Year), (Author1 et al., Year)`;
        }

        return `
TASK: Insert ${style || "Chicago"} citations into text.

${styleRules}

SOURCES (${sources.length}):
${sourceContext}

TEXT: "${context}"

TARGETS: Use ${minSourcesToUse}+ sources, ${targetInsertions}+ insertions

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
