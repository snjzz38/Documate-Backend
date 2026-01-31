export const CitationPrompts = {

  // --- MAIN DISPATCHER (Fixes "build is not a function") ---
  build(type, style, context, sources) {
    const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

    if (type === 'quotes') {
        return this.buildQuotes(context, sources);
    }
    if (type === 'bibliography') {
        return this.buildBibliography(style, sources, today);
    }
    // Default: in-text or footnotes
    return this.buildInsertion(style, context, sources, today);
  },

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

  // --- 3. CITATION INSERTION PROMPT ---
  buildInsertion(style, context, sources, today) {
    const sourceContext = this._buildSourceContext(sources);
    const styleRules = this._getStyleRules(style);

    const minSourcesToUse = Math.max(8, sources.length - 2);
    const targetInsertions = Math.floor(sources.length * 1.5);

    return `
TASK: Insert citations into the user's text using ${style} format.

${styleRules}

SOURCE DATA (${sources.length} sources):
${sourceContext}

TEXT TO CITE:
"${context}"

🎯 PRIMARY GOAL:
- Use AT LEAST ${minSourcesToUse} different sources
- Aim for ~${targetInsertions} total citation insertions
- Cite key sources multiple times when appropriate
- Spread citations across intro, body, and conclusion

MANDATORY RULES:
1. DO NOT rewrite the text.
2. Return ONLY valid JSON.
3. Every citation_text MUST include a YEAR or "n.d."
4. Use ALL_AUTHORS field to determine author formatting.
5. Use "et al." ONLY for 3+ authors.
6. Bibliography entries appear ONCE even if cited multiple times.
7. "Further Reading (Unused)" should be nearly empty (0–2 max).

OUTPUT JSON FORMAT (STRICT):
{
  "insertions": [
    { "anchor": "3–6 word phrase from text", "source_id": 1, "citation_text": "(Author Year)" },
    { "anchor": "another phrase", "source_id": 2, "citation_text": "(Author Year)" }
  ],
  "formatted_citations": {
    "1": "Complete bibliography entry",
    "2": "Complete bibliography entry"
  }
}

FINAL CHECKLIST (must all be YES):
- Used ${minSourcesToUse}+ sources?
- ~${targetInsertions} total insertions?
- Citations evenly distributed?
- All citations include year?
- Output is valid JSON ONLY?
`;
  },

  // --- HELPER: Build Enhanced Source Context ---
  _buildSourceContext(sources) {
    // Ensure sources is an array
    const safeSources = Array.isArray(sources) ? sources : [];
    
    return safeSources.map(s => `
[ID:${s.id}]
TITLE: ${s.title}
URL: ${s.link}
DOI: ${s.meta?.doi || "none"}
SITE_NAME: ${s.meta?.siteName || "Unknown"}
DETECTED_AUTHOR: ${s.meta?.author || "Unknown"}
ALL_AUTHORS: ${(s.meta?.allAuthors || []).join(" | ")}
AUTHOR_COUNT: ${(s.meta?.allAuthors || []).length}
DETECTED_DATE: ${s.meta?.published || "n.d."}
YEAR: ${s.meta?.year || "n.d."}
TEXT_CONTENT: ${(s.content || "").substring(0, 1000).replace(/\n/g, " ")}...
`).join("\n\n---\n\n");
  },

  // --- HELPER: Style Rules ---
  _getStyleRules(style) {
    const s = (style || "").toLowerCase();

    if (s.includes("chicago")) {
      return `
STYLE: Chicago Manual of Style (17th Edition)

IN-TEXT:
- 1 author: (LastName Year)
- 2 authors: (LastName1 and LastName2 Year)
- 3+ authors: (LastName1 et al. Year)
- No date: (LastName n.d.)

IMPORTANT:
- NO comma between author and year
`;
    }

    if (s.includes("mla")) {
      return `
STYLE: MLA 9th Edition

IN-TEXT:
- 1 author: (LastName)
- 2 authors: (LastName1 and LastName2)
- 3+ authors: (LastName1 et al.)
`;
    }

    return `
STYLE: APA 7th Edition

IN-TEXT:
- 1 author: (Author, Year)
- 2 authors: (Author1 & Author2, Year)
- 3+ authors: (Author1 et al., Year)
`;
  }
};
