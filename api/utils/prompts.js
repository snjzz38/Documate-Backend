// api/utils/prompts.js

export const CitationPrompts = {

  // --- 1. QUOTES PROMPT ---
  buildQuotes(context, sources) {
    const sourceContext = this._buildSourceContext(sources);

    return `
TASK: Extract high-quality quotes that SUPPORT the user's argument.

USER CONTEXT:
"${context.substring(0, 500)}..."

SOURCES:
${sourceContext}

CRITICAL QUOTE RULES:
1. Extract SUBSTANTIAL quotes (50–150 words, 2–4 sentences).
2. Quotes MUST directly support the user's argument or perspective.
3. Prefer authoritative, data-driven, or expert statements.
4. Extract FULL passages with sufficient context.
5. If a source has multiple strong quotes, you may extract up to 3.
6. If no relevant quote exists, explicitly say so.

FORMAT (STRICT, ID ORDER 1 → ${sources.length}):

**[ID] Title** – URL  
> "Full quote text…"

OR

**[ID] Title** – URL  
> No relevant quote found that supports the argument.

IMPORTANT:
- Quality over quantity
- No summaries, no paraphrasing
- Do NOT explain your choices
`;
  },

  // --- 2. BIBLIOGRAPHY PROMPT ---
  buildBibliography(style, sources, today) {
    const sourceContext = this._buildSourceContext(sources);

    let bibStyleRules = "";

    if (style.toLowerCase().includes("chicago")) {
      bibStyleRules = `
STYLE: Chicago Manual of Style (17th Edition)

FORMAT:
LastName, FirstName. "Article Title." *Website Name*. Month Day, Year. URL or https://doi.org/DOI.

RULES:
- 2 authors: LastName1, FirstName1, and FirstName2 LastName2
- 3+ authors: LastName1, FirstName1, et al.
`;
    } else if (style.toLowerCase().includes("mla")) {
      bibStyleRules = `
STYLE: MLA 9th Edition

FORMAT:
LastName, FirstName. "Article Title." *Container Title*, Date, URL.
`;
    } else {
      bibStyleRules = `
STYLE: APA 7th Edition

FORMAT:
Author, A. A. (Year). Title of article. *Site Name*. URL
- Use ALL authors
`;
    }

    return `
TASK: Generate a bibliography for ALL ${sources.length} sources.

${bibStyleRules}

SOURCES:
${sourceContext}

INSTRUCTIONS:
- Use ALL authors from ALL_AUTHORS
- Include DOI if available
- Alphabetize by author last name
- Each entry on its own line
- Do NOT return JSON
- Do NOT include explanations
- Output bibliography ONLY
`;
  },

  // --- 3. CITATION INSERTION PROMPT (ENHANCED) ---
  buildInsertion(style, context, sources, today, outputType = 'in-text') {
    const sourceContext = this._buildSourceContext(sources);
    const styleRules = this._getStyleRules(style);

    // Calculate aggressive targets
    const totalSources = sources.length;
    const minSourcesToUse = Math.max(totalSources - 1, Math.ceil(totalSources * 0.9)); // Use 90%+ of sources
    const targetInsertions = Math.max(totalSources * 2, 15); // At least 2x sources or 15 insertions
    
    // Count approximate sentences/claims in context for insertion density
    const sentenceCount = (context.match(/[.!?]+/g) || []).length;
    const targetDensity = Math.max(Math.floor(sentenceCount * 0.6), targetInsertions); // Cite ~60% of sentences

    const footnoteRules = outputType === 'footnotes' ? `
FOOTNOTE-SPECIFIC RULES:
- The SAME source CAN and SHOULD be cited multiple times with DIFFERENT footnote numbers
- Each insertion gets its own unique footnote number (1, 2, 3, 4, etc.)
- If Source ID 3 is cited in three places, it will have three different footnote numbers
- This is standard academic practice - duplicate source citations are EXPECTED
- Example: "Climate change is accelerating¹ ... Sea levels are rising² ... Action is needed³" where ¹²³ might all cite the same UN report
` : '';

    return `
TASK: Insert ${style} citations into the user's text. Your goal is MAXIMUM COVERAGE using ALL available sources.

${styleRules}

${footnoteRules}

═══════════════════════════════════════════════════════════════
SOURCE DATA (${totalSources} sources available - USE THEM ALL):
═══════════════════════════════════════════════════════════════
${sourceContext}

═══════════════════════════════════════════════════════════════
TEXT TO CITE:
═══════════════════════════════════════════════════════════════
"${context}"

═══════════════════════════════════════════════════════════════
🎯 AGGRESSIVE CITATION TARGETS (MANDATORY):
═══════════════════════════════════════════════════════════════

1. SOURCE COVERAGE: Use AT LEAST ${minSourcesToUse} out of ${totalSources} sources (${Math.round(minSourcesToUse/totalSources*100)}%+)
2. INSERTION COUNT: Create AT LEAST ${targetDensity} citation insertions
3. CITATION DENSITY: Cite approximately every 1-2 sentences
4. DISTRIBUTION: Spread citations across ALL sections (intro, body, conclusion)
5. REUSE SOURCES: Cite strong sources 2-4 times each in different contexts

═══════════════════════════════════════════════════════════════
WHERE TO INSERT CITATIONS (Find ALL opportunities):
═══════════════════════════════════════════════════════════════

CITE THESE (high priority):
• Statistical claims ("CO₂ levels have reached...")
• Causal statements ("driven by anthropogenic activities...")
• Expert consensus ("scientific consensus is...")
• Definitions ("characterized by long-term alterations...")
• Predictions/projections ("potentially catastrophic...")
• Comparisons ("highest concentration in over 800,000 years")
• Policy references ("Paris Agreement aims to...")
• Impact statements ("threatens coastal communities...")
• Process descriptions ("mitigation strategies include...")
• Scope claims ("one of the most pressing challenges...")

ALSO CITE THESE (medium priority):
• Topic introductions ("Climate change represents...")
• Transition statements that make claims
• Concluding assertions ("demands immediate action")
• Any sentence containing "significant," "substantial," "major," "critical"
• Sentences with specific numbers, percentages, or timeframes

═══════════════════════════════════════════════════════════════
SOURCE-TO-CONTENT MATCHING GUIDE:
═══════════════════════════════════════════════════════════════

For each source, identify ALL sentences it could support:
- UN sources → climate impacts, policy, global cooperation, SDGs
- IPCC sources → scientific data, projections, consensus statements  
- Academic sources → research findings, methodology claims
- Government sources → policy, regulations, official positions
- News/research orgs → current events, surveys, public opinion
- Health sources → health impacts, disease, food security
- Environmental orgs → solutions, advocacy, action items

═══════════════════════════════════════════════════════════════
MANDATORY RULES:
═══════════════════════════════════════════════════════════════

1. DO NOT rewrite or modify the original text
2. Return ONLY valid JSON (no markdown, no explanations)
3. Every citation_text MUST include a YEAR or "n.d."
4. Use ALL_AUTHORS field to determine author formatting
5. Use "et al." ONLY for 3+ authors
6. Anchor phrases must be 3-8 words, unique, and findable in text
7. Each anchor should appear exactly once in the text
8. Bibliography entries appear ONCE even if cited multiple times

═══════════════════════════════════════════════════════════════
OUTPUT JSON FORMAT (STRICT):
═══════════════════════════════════════════════════════════════

{
  "insertions": [
    { "anchor": "exact 3-8 word phrase from text", "source_id": 1, "citation_text": "(Author Year)" },
    { "anchor": "another exact phrase", "source_id": 2, "citation_text": "(Author Year)" },
    { "anchor": "third phrase showing reuse", "source_id": 1, "citation_text": "(Author Year)" }
  ],
  "formatted_citations": {
    "1": "Complete bibliography entry for source 1",
    "2": "Complete bibliography entry for source 2"
  }
}

═══════════════════════════════════════════════════════════════
PRE-SUBMISSION CHECKLIST (ALL must be YES):
═══════════════════════════════════════════════════════════════

□ Used ${minSourcesToUse}+ different sources? 
□ Created ${targetDensity}+ total insertions?
□ Citations in introduction section?
□ Citations throughout body paragraphs?
□ Citations in conclusion?
□ Strong sources cited multiple times?
□ All anchor phrases are exact quotes from text?
□ All citations include year or "n.d."?
□ Output is valid JSON only (no extra text)?
□ "Further Reading" section should have 0-2 sources MAX?

FAILURE TO MEET THESE TARGETS IS UNACCEPTABLE. Maximize citation density.
`;
  },

  // --- HELPER: Build Enhanced Source Context ---
  _buildSourceContext(sources) {
    return sources.map(s => {
      // Extract key themes/topics from content for better matching
      const contentPreview = s.content.substring(0, 1500).replace(/\n/g, " ");
      
      return `
[ID:${s.id}] ════════════════════════════════════════
TITLE: ${s.title}
URL: ${s.link}
DOI: ${s.meta?.doi || "none"}
SITE_NAME: ${s.meta?.siteName || "Unknown"}
DETECTED_AUTHOR: ${s.meta?.author || "Unknown"}
ALL_AUTHORS: ${(s.meta?.allAuthors || []).join(" | ") || "Unknown"}
AUTHOR_COUNT: ${(s.meta?.allAuthors || []).length || 1}
DETECTED_DATE: ${s.meta?.published || "n.d."}
YEAR: ${s.meta?.year || "n.d."}

CONTENT PREVIEW (use to match with user's text):
${contentPreview}...
════════════════════════════════════════════════════════════`;
    }).join("\n\n");
  },

  // --- HELPER: Style Rules ---
  _getStyleRules(style) {
    const s = style.toLowerCase();

    if (s.includes("chicago")) {
      return `
═══════════════════════════════════════════════════════════════
STYLE: Chicago Manual of Style (17th Edition)
═══════════════════════════════════════════════════════════════

IN-TEXT FORMAT:
- 1 author: (LastName Year)
- 2 authors: (LastName1 and LastName2 Year)
- 3+ authors: (LastName1 et al. Year)
- No date: (LastName n.d.)
- Organization: (Organization Name Year)

CRITICAL: NO comma between author and year in Chicago style

BIBLIOGRAPHY FORMAT:
LastName, FirstName. "Article Title." Website Name. Month Day, Year. URL.
`;
    }

    if (s.includes("mla")) {
      return `
═══════════════════════════════════════════════════════════════
STYLE: MLA 9th Edition
═══════════════════════════════════════════════════════════════

IN-TEXT FORMAT:
- 1 author: (LastName)
- 2 authors: (LastName1 and LastName2)
- 3+ authors: (LastName1 et al.)
- Organization: (Organization Name)
- NO year in parenthetical citations

BIBLIOGRAPHY FORMAT:
LastName, FirstName. "Article Title." Container Title, Date, URL.
`;
    }

    return `
═══════════════════════════════════════════════════════════════
STYLE: APA 7th Edition
═══════════════════════════════════════════════════════════════

IN-TEXT FORMAT:
- 1 author: (Author, Year)
- 2 authors: (Author1 & Author2, Year)
- 3+ authors: (Author1 et al., Year)
- No date: (Author, n.d.)
- Organization: (Organization Name, Year)

CRITICAL: Use comma between author and year, use & not "and"

BIBLIOGRAPHY FORMAT:
Author, A. A. (Year). Title of article. Site Name. URL
`;
  }
};
