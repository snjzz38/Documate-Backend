// api/utils/prompts.js

export const CitationPrompts = {
    build(type, style, context, sources) {
        const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
        
        // SAFETY CHECK: Ensure sources is an array
        const safeSources = Array.isArray(sources) ? sources : [];

        // Enhanced context builder with comprehensive metadata extraction
        const sourceContext = safeSources.map(s => {
            const content = s.content || "";
            const meta = s.meta || {};

            // PRE-EXTRACT DATE
            let enhancedDate = meta.published;
            if (!enhancedDate || enhancedDate === "n.d.") {
                const datePatterns = [
                    /(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}/i,
                    /\b(20\d{2})\b/,
                    /\d{1,2}\/\d{1,2}\/\d{4}/,
                    /\d{4}-\d{2}-\d{2}/
                ];
                
                for (const pattern of datePatterns) {
                    const match = content.match(pattern);
                    if (match) {
                        enhancedDate = match[0];
                        break;
                    }
                }
            }
            
            // EXTRACT YEAR for citations
            let year = "n.d.";
            if (enhancedDate && enhancedDate !== "n.d.") {
                const yearMatch = enhancedDate.match(/\b(20\d{2})\b/);
                if (yearMatch) year = yearMatch[1];
            }
            
            // PRE-EXTRACT ALL AUTHORS
            let enhancedAuthors = [];
            let enhancedAuthor = meta.author;
            const siteName = meta.siteName || "Unknown";
            
            const isSiteName = enhancedAuthor && (
                enhancedAuthor === siteName || 
                enhancedAuthor.toLowerCase().includes(siteName.toLowerCase().replace(/\.(com|org|edu|net)/, ''))
            );
            
            if (!enhancedAuthor || enhancedAuthor === "Unknown" || isSiteName) {
                // Pattern 1: "Name and Name"
                const andPattern = /^.{0,300}([A-Z][a-z]+(?:\s+[A-Z]\.?\s*)?[A-Z][a-z]+)\s+and\s+([A-Z][a-z]+(?:\s+[A-Z]\.?\s*)?[A-Z][a-z]+)/;
                const andMatch = content.match(andPattern);
                
                if (andMatch) {
                    enhancedAuthors.push(andMatch[1].trim());
                    enhancedAuthors.push(andMatch[2].trim());
                }
                
                // Pattern 2: "By Name"
                if (enhancedAuthors.length === 0) {
                    const byPattern = /By\s+([A-Z][a-z]+\s+[A-Z]\.?\s+[A-Z][a-z]+)(?:,?\s+and\s+([A-Z][a-z]+\s+[A-Z]\.?\s+[A-Z][a-z]+))?/i;
                    const byMatch = content.match(byPattern);
                    if (byMatch) {
                        enhancedAuthors.push(byMatch[1].trim());
                        if (byMatch[2]) enhancedAuthors.push(byMatch[2].trim());
                    }
                }
                
                // Filter out false positives
                enhancedAuthors = [...new Set(enhancedAuthors)].filter(name => 
                    !name.match(/^(Senior|Fellow|Center|Technology|Innovation|Subscribe|Search|Share|Print|Editor)/)
                );
                
                if (enhancedAuthors.length > 0) {
                    enhancedAuthor = enhancedAuthors.join(' and ');
                }
            } else {
                // Parse existing meta.author for multiple authors
                if (enhancedAuthor.includes(' and ')) {
                    enhancedAuthors = enhancedAuthor.split(' and ').map(a => a.trim());
                } else if (enhancedAuthor.includes(', and ')) {
                    enhancedAuthors = enhancedAuthor.split(/, and |, /).map(a => a.trim());
                } else if (enhancedAuthor.includes(',')) {
                    const parts = enhancedAuthor.split(',').map(a => a.trim());
                    if (parts.length === 2 && parts[0].split(' ').length >= 2 && parts[1].split(' ').length >= 2) {
                        enhancedAuthors = parts;
                    } else {
                        enhancedAuthors = [enhancedAuthor];
                    }
                } else {
                    enhancedAuthors = [enhancedAuthor];
                }
            }
            
            // EXTRACT DOI
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
SITE_NAME: ${siteName}
DETECTED_AUTHOR: ${enhancedAuthor || "Unknown"} 
ALL_AUTHORS: ${enhancedAuthors.join(' | ')}
AUTHOR_COUNT: ${enhancedAuthors.length}
DETECTED_DATE: ${enhancedDate || meta.published}
YEAR: ${year}
TEXT_CONTENT: ${content.substring(0, 1000).replace(/\n/g, ' ')}...`;
        }).join('\n\n---\n\n');

        // ======================================================================
        // MODE 1: QUOTES EXTRACTION
        // ======================================================================
        if (type === 'quotes') {
            return `
TASK: Extract high-quality quotes that SUPPORT the user's argument/perspective.

USER'S TEXT CONTEXT: "${context.substring(0, 500)}..."

SOURCES:
${sourceContext}

CRITICAL QUOTE EXTRACTION RULES:

1. **QUOTE LENGTH**: Extract SUBSTANTIAL quotes (2-4 sentences, 50-150 words)
   - NOT single sentences unless exceptionally powerful
   - Look for complete thoughts, arguments, or explanations
   - Include context that makes the quote meaningful

2. **RELEVANCE**: Quotes must DIRECTLY SUPPORT the user's argument
   - Analyze the user's perspective from their text
   - Find quotes that provide evidence, data, or expert opinion aligned with their view
   - Avoid generic or tangential quotes

3. **QUALITY CRITERIA**:
   - Prefer quotes with specific data, statistics, or concrete examples
   - Choose authoritative statements from experts or organizations
   - Select quotes that add credibility to the user's argument
   - Avoid vague or generic statements

4. **EXTRACTION GUIDELINES**:
   - Extract the FULL relevant passage, not fragments
   - Include complete sentences with proper context
   - If a source has multiple good quotes, extract 2-3 separate quotes
   - Ensure quotes are self-contained and make sense on their own

5. **FORMAT** (Output strictly in order ID 1 to ${safeSources.length}):
   **[ID] Title** - URL
   > "Complete quote with full context and multiple sentences. This should be substantial and directly support the user's argument."
   
   OR if no relevant quote:
   **[ID] Title** - URL
   > No relevant quote found that supports the argument.

EXAMPLE OUTPUT:

**[1] Climate Change Impacts** - https://example.com
> "Recent studies demonstrate that global temperatures have risen by 1.1°C since pre-industrial times, with the past decade being the warmest on record. This warming has led to increased frequency of extreme weather events, including hurricanes, droughts, and wildfires. The scientific consensus is clear: human activities, particularly the burning of fossil fuels, are the primary driver of these changes, and immediate action is required to prevent catastrophic consequences."

**[2] Economic Costs** - https://example2.com
> "The economic impact of climate inaction is staggering. Without significant mitigation efforts, global GDP could decline by up to 23% by 2100, with developing nations facing even steeper losses. These projections underscore the urgent need for policy intervention and sustainable development strategies."

IMPORTANT: 
- Extract LONGER quotes (50-150 words) that provide substantial evidence
- Ensure each quote SUPPORTS the user's argument
- Quality over quantity - better to have fewer strong quotes than many weak ones
- Read the full TEXT_CONTENT to find the best passages
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
- Use ALL authors from ALL_AUTHORS field (count by counting "|" separators)
- Include DOI when available (not "none")
- Sort entries alphabetically by last name
- Output ONLY the bibliography entries, NO explanations or thinking
- Each entry on a new line, separated by blank line

OUTPUT: Return ONLY the formatted bibliography entries, nothing else.
            `;
        }

        // ======================================================================
        // MODE 3: IN-TEXT CITATIONS & FOOTNOTES
        // ======================================================================
        
        const s = (style || "").toLowerCase();
        const minSourcesToUse = Math.max(8, safeSources.length - 2);
        const targetInsertions = Math.floor(safeSources.length * 1.5);
        
        let styleRules = "";
        let citationStrategy = "";
        let examples = "";
        
        // CITATION STRATEGY (different for footnotes vs in-text)
        if (type === 'footnotes') {
            citationStrategy = `
FOOTNOTE CITATION STRATEGY:
- You MUST use AT LEAST ${minSourcesToUse} out of ${safeSources.length} sources
- Aim for ${targetInsertions} total citations by citing key sources 2-3 times
- Each citation gets a NEW superscript number and footnote entry
- Spread citations evenly throughout the text (intro, body paragraphs, conclusion)
- Don't leave 90% of sources unused!

DISTRIBUTION GUIDE:
- Use 8-10 different sources
- Cite the most important/authoritative ones 2-3 times each
- Result: ~12-15 total footnote citations
- "Further Reading (Unused)" should have 0-2 sources MAX

EXAMPLE: If discussing climate impacts across 3 paragraphs:
- Para 1: Cite sources 1, 2, 3
- Para 2: Cite sources 1, 4, 5 (source 1 cited again)
- Para 3: Cite sources 6, 7, 2 (source 2 cited again)
            `;
        } else {
            citationStrategy = `
IN-TEXT CITATION STRATEGY:
- You MUST use AT LEAST ${minSourcesToUse} out of ${safeSources.length} sources
- Aim for ${targetInsertions} total citations by citing key sources 2-3 times
- The same citation text appears multiple times (e.g., "(Smith 2020)")
- Spread citations throughout ALL sections (intro, body, conclusion)
- Don't cluster all citations in one paragraph

DISTRIBUTION GUIDE:
- Introduction: 2-3 citations
- Each body paragraph: 2-3 citations  
- Conclusion: 1-2 citations
- Cite authoritative sources 2-3 times in different locations
- "Further Reading (Unused)" should have 0-2 sources MAX

EXAMPLE: 5-paragraph essay structure:
- Intro: Sources 1, 2
- Body 1: Sources 3, 4, 1 (reuse source 1)
- Body 2: Sources 5, 6, 2 (reuse source 2)
- Body 3: Sources 7, 8, 3 (reuse source 3)
- Conclusion: Source 9
Result: 9 different sources, 12 total citations
            `;
        }
        
        // STYLE-SPECIFIC RULES
        if (s.includes("chicago")) {
            styleRules = `
STYLE: Chicago Manual of Style (17th Edition) - Notes and Bibliography System

BIBLIOGRAPHY FORMAT:
- 1 author: LastName, FirstName. "Article Title." *Website Name*. Month Day, Year. URL.
- 2 authors: LastName1, FirstName1, and FirstName2 LastName2. "Article Title." *Website Name*. Month Day, Year. URL.
- 3+ authors: LastName1, FirstName1, et al. "Article Title." *Website Name*. Month Day, Year. URL.
- If DOI exists (not "none"), use: https://doi.org/DOI instead of URL
- End with period after URL/DOI

IN-TEXT CITATION FORMAT:
- 1 author: (LastName Year) - e.g., (Smith 2020)
- 2 authors: (LastName1 and LastName2 Year) - e.g., (West and Allen 2018)
- 3+ authors: (LastName1 et al. Year) - e.g., (Howden et al. 2007)
- No date: (LastName n.d.)

CRITICAL CHICAGO RULES:
- NO COMMA between author and year: (Smith 2020) NOT (Smith, 2020)
- ALWAYS include year from YEAR field
- Use "and" for 2 authors (NOT "&")
- Use "et al." for 3+ authors
            `;
            
            examples = `
CHICAGO CITATION EXAMPLES:

Example 1 - Two Authors:
- ALL_AUTHORS: "Darrell M. West | John R. Allen"
- YEAR: "2018"
✓ CORRECT: "(West and Allen 2018)"
✗ WRONG: "(West and Allen, 2018)" - no comma!
✗ WRONG: "(West 2018)" - missing Allen!
✗ WRONG: "(West and Allen)" - missing year!

Example 2 - Multiple Authors (3+):
- ALL_AUTHORS: "S.M. Howden | J.-F. Soussana | F.N. Tubiello | N. Chhetri | M. Dunlop | H. Meinke"
- AUTHOR_COUNT: 6
- YEAR: "2007"
✓ CORRECT: "(Howden et al. 2007)"
✗ WRONG: "(Howden 2007)" - use et al. for 3+!

Example 3 - Organization Author:
- ALL_AUTHORS: "United Nations Sustainable Development"
- YEAR: "2030"
✓ CORRECT: "(United Nations Sustainable Development 2030)"
✗ WRONG: "(United Nations 2030)" - use full org name!

Example 4 - No Date:
- ALL_AUTHORS: "Greenpeace UK"
- YEAR: "n.d."
✓ CORRECT: "(Greenpeace UK n.d.)"
            `;
        } else if (s.includes("mla")) {
            styleRules = `
STYLE: MLA 9th Edition

BIBLIOGRAPHY FORMAT:
- LastName, FirstName. "Article Title." *Container Title*, Date, URL.
- For 2 authors: LastName1, FirstName1, and FirstName2 LastName2.
- For 3+ authors: LastName1, FirstName1, et al.

IN-TEXT FORMAT:
- 1 author: (LastName)
- 2 authors: (LastName1 and LastName2)
- 3+ authors: (LastName1 et al.)

Note: MLA typically omits year in parenthetical citations
            `;
        } else {
            styleRules = `
STYLE: APA 7th Edition

BIBLIOGRAPHY FORMAT:
- Author, A. A. (Year). Title of article. *Site Name*. URL
- 2 authors: Author1, A. A., & Author2, B. B. (Year). Title. *Site*. URL
- 3+ authors: List all with & before last

IN-TEXT FORMAT:
- 1 author: (Author, Year)
- 2 authors: (Author1 & Author2, Year) - use & not "and"!
- 3+ authors: (Author1 et al., Year)

CRITICAL: APA requires comma between author and year
            `;
        }

        return `
TASK: Insert citations into the text using ${style || "Chicago"} format.

${styleRules}

${citationStrategy}

${examples}

SOURCE DATA (${safeSources.length} sources available):
${sourceContext}

TEXT TO CITE: "${context}"

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎯 PRIMARY GOAL: USE ${minSourcesToUse}-${safeSources.length} SOURCES (NOT just 1-2!)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

MANDATORY REQUIREMENTS:

1. **SOURCE USAGE** (CRITICAL):
   - You have ${safeSources.length} sources available
   - You MUST use AT LEAST ${minSourcesToUse} different sources
   - Target: ${targetInsertions} total citation insertions
   - Leaving 7-8 sources unused is UNACCEPTABLE
   - "Further Reading (Unused)" should be nearly EMPTY (0-2 sources max)

2. **HOW TO ACHIEVE THIS**:
   - Read through the ENTIRE user text carefully
   - Match each claim/section to relevant sources
   - Cite multiple sources per paragraph when appropriate
   - Reuse important sources 2-3 times in different sections
   - Example: Climate health impacts → cite Harvard 2-3 times

3. **YEAR REQUIREMENT** (MANDATORY):
   - Every source has a YEAR field (e.g., "2018", "2023", "n.d.")
   - EVERY citation_text MUST include this year
   - NO citations without dates unless YEAR is "n.d."
   - Format: (Author Year) for Chicago, (Author, Year) for APA

4. **MULTIPLE AUTHORS** (CHECK ALL_AUTHORS):
   - ALL_AUTHORS shows authors separated by " | "
   - Count "|" separators to get author count
   - 2 authors: Include both (e.g., "West and Allen")
   - 3+ authors: Use "et al." (e.g., "Howden et al.")
   - NEVER use only first author when multiple exist!

5. **BIBLIOGRAPHY FORMAT**:
   - Follow EXACT format for ${style || "Chicago"}
   - Use ALL author names from ALL_AUTHORS (unless 3+, then et al.)
   - Include DOI if available (not "none"): https://doi.org/DOI
   - Each source appears ONCE in formatted_citations
   - End every entry with: URL (Accessed ${today})

6. **URL/DOI HANDLING**:
   - If DOI exists and not "none": use https://doi.org/DOI
   - Otherwise: use regular URL from URL field
   - NEVER use placeholders like "[URL]" or "[link]"

OUTPUT FORMAT: Return strictly valid JSON.
{
  "insertions": [
    { "anchor": "phrase from text", "source_id": 1, "citation_text": "(Author Year)" },
    { "anchor": "another phrase", "source_id": 2, "citation_text": "(Author Year)" },
    { "anchor": "different phrase", "source_id": 1, "citation_text": "(Author Year)" },
    { "anchor": "yet another", "source_id": 3, "citation_text": "(Author Year)" },
    ... continue until you have ~${targetInsertions} insertions using ${minSourcesToUse}+ sources
  ],
  "formatted_citations": {
    "1": "Complete bibliography entry with REAL URL (Accessed ${today})",
    "2": "Complete bibliography entry with REAL URL (Accessed ${today})",
    ... one entry per unique source cited
  }
}

✅ FINAL VERIFICATION CHECKLIST (Check before submitting):
□ Am I using at least ${minSourcesToUse} different sources?
□ Do I have around ${targetInsertions} total insertions?
□ Are citations spread throughout ALL sections (not clustered)?
□ Does EVERY citation_text include a year or "n.d."?
□ Did I check ALL_AUTHORS for multiple authors?
□ Are my bibliography entries in proper ${style || "Chicago"} format?
□ Did I use REAL URLs (not placeholders)?
□ Will "Further Reading (Unused)" be nearly empty (0-2 sources)?

If you answer NO to ANY of these, REVISE your citations before submitting!
        `;
    }
};
