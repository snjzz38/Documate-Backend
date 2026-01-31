// api/utils/prompts.js

export const CitationPrompts = {
    build(type, style, context, sources) {
        const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
        
        // Enhanced context builder with better metadata extraction (VERBATIM from your provided code)
        const sourceContext = sources.map(s => {
            // Pre-extract date from content if DETECTED_DATE is n.d.
            let enhancedDate = s.meta.published;
            if (!enhancedDate || enhancedDate === "n.d.") {
                const datePatterns = [
                    /(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}/i,
                    /\b(20\d{2})\b/,
                    /\d{1,2}\/\d{1,2}\/\d{4}/,
                    /\d{4}-\d{2}-\d{2}/
                ];
                
                for (const pattern of datePatterns) {
                    const match = s.content.match(pattern);
                    if (match) {
                        enhancedDate = match[0];
                        break;
                    }
                }
            }
            
            // Extract YEAR specifically for citations
            let year = "n.d.";
            if (enhancedDate && enhancedDate !== "n.d.") {
                const yearMatch = enhancedDate.match(/\b(20\d{2})\b/);
                if (yearMatch) {
                    year = yearMatch[1];
                }
            }
            
            // Pre-extract ALL authors from content
            let enhancedAuthors = [];
            let enhancedAuthor = s.meta.author;
            
            const isSiteName = s.meta.author && (
                s.meta.author === s.meta.siteName || 
                s.meta.author.toLowerCase().includes(s.meta.siteName.toLowerCase().replace(/\.(com|org|edu|net)/, ''))
            );
            
            if (!s.meta.author || s.meta.author === "Unknown" || isSiteName) {
                // Search for authors in content
                const andPattern = /^.{0,300}([A-Z][a-z]+(?:\s+[A-Z]\.?\s*)?[A-Z][a-z]+)\s+and\s+([A-Z][a-z]+(?:\s+[A-Z]\.?\s*)?[A-Z][a-z]+)/;
                const andMatch = s.content.match(andPattern);
                
                if (andMatch) {
                    enhancedAuthors.push(andMatch[1].trim());
                    enhancedAuthors.push(andMatch[2].trim());
                }
                
                if (enhancedAuthors.length === 0) {
                    const byPattern = /By\s+([A-Z][a-z]+\s+[A-Z]\.?\s+[A-Z][a-z]+)(?:,?\s+and\s+([A-Z][a-z]+\s+[A-Z]\.?\s+[A-Z][a-z]+))?/i;
                    const byMatch = s.content.match(byPattern);
                    if (byMatch) {
                        enhancedAuthors.push(byMatch[1].trim());
                        if (byMatch[2]) enhancedAuthors.push(byMatch[2].trim());
                    }
                }
                
                enhancedAuthors = [...new Set(enhancedAuthors)].filter(name => 
                    !name.match(/^(Senior|Fellow|Center|Technology|Innovation|Subscribe|Search|Share|Print|Editor)/)
                );
                
                if (enhancedAuthors.length > 0) {
                    enhancedAuthor = enhancedAuthors.join(' and ');
                }
            } else {
                // Meta author exists - parse it for multiple authors
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
            
            // Look for DOI in content
            let doi = "";
            const doiMatch = s.content.match(/doi\.org\/([^\s]+)|DOI:\s*([^\s]+)/i);
            if (doiMatch) {
                doi = doiMatch[1] || doiMatch[2];
                doi = doi.replace(/[.,;]+$/, '');
            }
            
            return `[ID:${s.id}]
TITLE: ${s.title}
URL: ${s.link}
DOI: ${doi || "none"}
SITE_NAME: ${s.meta.siteName || 'Unknown'}
DETECTED_AUTHOR: ${enhancedAuthor} 
ALL_AUTHORS: ${enhancedAuthors.join(' | ')}
AUTHOR_COUNT: ${enhancedAuthors.length}
DETECTED_DATE: ${enhancedDate || s.meta.published}
YEAR: ${year}
TEXT_CONTENT: ${s.content.substring(0, 1000).replace(/\n/g, ' ')}...`;
        }).join('\n\n---\n\n');

        // --- 1. QUOTES ---
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
                   - If a source has multiple good quotes, you can extract 2-3 separate quotes from the same source
                   - Ensure quotes are self-contained and make sense on their own
                
                5. **FORMAT** (Output strictly in order ID 1 to ${sources.length}):
                   **[ID] Title** - URL
                   > "Complete quote with full context and multiple sentences if needed. This should be substantial and directly support the user's argument."
                   
                   OR if no relevant quote found:
                   **[ID] Title** - URL
                   > No relevant quote found that supports the argument.
                
                IMPORTANT: 
                - Extract LONGER quotes (50-150 words) that provide substantial evidence
                - Ensure each quote SUPPORTS the user's argument
                - Quality over quantity - it's better to have fewer strong quotes than many weak ones
                - Read the full TEXT_CONTENT to find the best passages
            `;
        }

        // --- 2. BIBLIOGRAPHY ONLY MODE ---
        if (type === 'bibliography') {
            let bibStyleRules = "";
            
            if (style.toLowerCase().includes("chicago")) {
                bibStyleRules = `
                    STYLE: Chicago Manual of Style (17th Edition)
                    FORMAT: LastName, FirstName. "Article Title." *Website Name*. Month Day, Year. URL or https://doi.org/DOI.
                    - For 2 authors: LastName1, FirstName1, and FirstName2 LastName2.
                    - For 3+ authors: LastName1, FirstName1, et al.
                `;
            } else if (style.toLowerCase().includes("mla")) {
                bibStyleRules = `
                    STYLE: MLA 9th Edition
                    FORMAT: LastName, FirstName. "Article Title." *Container Title*, Date, URL.
                    - For 2 authors: LastName1, FirstName1, and FirstName2 LastName2.
                    - For 3+ authors: LastName1, FirstName1, et al.
                `;
            } else if (style.toLowerCase().includes("apa")) {
                bibStyleRules = `
                    STYLE: APA 7th Edition
                    FORMAT: Author, A. A. (Year). Title of article. *Site Name*. URL
                    - For 2 authors: Author1, A. A., & Author2, B. B.
                    - For 3+ authors: List all authors
                `;
            }
            
            return `
                TASK: Generate a bibliography for ALL ${sources.length} sources.
                ${bibStyleRules}
                
                SOURCES:
                ${sourceContext}
                
                INSTRUCTIONS:
                - Create a properly formatted bibliography entry for EACH source (ID 1 through ${sources.length})
                - Use ALL authors from ALL_AUTHORS field
                - Include DOI if available (not "none")
                - Format in alphabetical order by last name
                - Output ONLY the bibliography entries, NO explanations or thinking
                - Each entry on a new line, separated by blank line
                
                OUTPUT: Return ONLY the formatted bibliography entries, nothing else.
            `;
        }

        // --- 3. IN-TEXT CITATIONS & FOOTNOTES ---
        
        let styleRules = "";
        let styleExamples = "";
        let citationStrategy = "";
        
        // Calculate minimum sources to use (aim for 8-10 out of 10)
        const minSourcesToUse = Math.max(8, sources.length - 2);
        const targetInsertions = Math.floor(sources.length * 1.5); // ~15 insertions for 10 sources
        
        // Different strategy for footnotes vs in-text
        if (type === 'footnotes') {
            citationStrategy = `
                FOOTNOTE CITATION STRATEGY:
                - You MUST use AT LEAST ${minSourcesToUse} out of ${sources.length} sources
                - Aim for ${targetInsertions} total citations by citing key sources 2-3 times
                - Each citation gets a NEW superscript number and footnote entry
                - Spread citations evenly throughout the text
                - Don't leave 90% of sources unused - that defeats the purpose!
                
                DISTRIBUTION EXAMPLE (for 10 sources):
                - Use 8-10 different sources
                - Cite the most important ones 2-3 times each
                - Result: ~12-15 total footnote citations
                - "Further Reading (Unused)" should have 0-2 sources MAX
            `;
        } else {
            citationStrategy = `
                IN-TEXT CITATION STRATEGY:
                - You MUST use AT LEAST ${minSourcesToUse} out of ${sources.length} sources
                - Aim for ${targetInsertions} total citations by citing key sources 2-3 times
                - The same citation text can appear multiple times (e.g., "(Smith 2020)")
                - Spread citations evenly throughout the text (intro, body paragraphs, conclusion)
                - Don't cluster all citations in one section
                
                DISTRIBUTION EXAMPLE (for 10 sources):
                - Use 8-10 different sources
                - Cite authoritative sources 2-3 times in different paragraphs
                - Result: ~12-15 total in-text citations
                - "Further Reading (Unused)" should have 0-2 sources MAX
                
                PARAGRAPH DISTRIBUTION GUIDE:
                - Introduction: 2-3 citations
                - Each body paragraph: 2-3 citations
                - Conclusion: 1-2 citations
            `;
        }
        
        if (style.toLowerCase().includes("chicago")) {
            styleRules = `
                STYLE: Chicago Manual of Style (17th Edition) - Notes and Bibliography System
                
                BIBLIOGRAPHY FORMAT (Follow EXACTLY):
                  - 1 author: LastName, FirstName. "Article Title." *Website Name*. Month Day, Year. URL or https://doi.org/DOI.
                  - 2 authors: LastName1, FirstName1, and FirstName2 LastName2. "Article Title." *Website Name*. Month Day, Year. URL or https://doi.org/DOI.
                  - 3+ authors: LastName1, FirstName1, et al. "Article Title." *Website Name*. Month Day, Year. URL or https://doi.org/DOI.
                
                IN-TEXT FORMAT (Follow EXACTLY):
                  - 1 author: (LastName Year) - e.g., (Smith 2020)
                  - 2 authors: (LastName1 and LastName2 Year) - e.g., (West and Allen 2018)
                  - 3+ authors: (LastName1 et al. Year) - e.g., (Johnson et al. 2024)
                  - No date: (LastName n.d.) - ONLY use if YEAR field is "n.d."
                  
                CRITICAL: NO COMMA between author and year in Chicago!
            `;
            styleExamples = `
                CHICAGO CITATION PLACEMENT EXAMPLES:
                
                Introduction paragraph:
                "Climate change represents one of the most pressing challenges (United Nations 2030). The scientific consensus is clear (IPCC 2023)."
                
                Body paragraph about causes:
                "The principal driver is greenhouse gases (UNDP 2023). Deforestation exacerbates the issue (Greenpeace 2015)."
                
                Body paragraph about consequences:
                "Rising temperatures have resulted in extreme weather (Harvard 2024). Human health is at risk (Harvard 2024)."
                
                Body paragraph about solutions:
                "Mitigation strategies are essential (IPCC 2023). Adaptation measures include resilient infrastructure (Howden et al. 2007)."
                
                Conclusion:
                "The time to act is now (University of Chicago Press n.d.)."
            `;
        } else if (style.toLowerCase().includes("mla")) {
            styleRules = `
                STYLE: MLA 9th Edition
                
                BIBLIOGRAPHY FORMAT:
                  - 1 author: LastName, FirstName. "Article Title." *Container Title*, Date, URL.
                  - 2 authors: LastName1, FirstName1, and FirstName2 LastName2.
                  - 3+ authors: LastName1, FirstName1, et al.
                
                IN-TEXT FORMAT:
                  - 1 author: (LastName)
                  - 2 authors: (LastName1 and LastName2)
                  - 3+ authors: (LastName1 et al.)
            `;
        } else if (style.toLowerCase().includes("apa")) {
            styleRules = `
                STYLE: APA 7th Edition
                
                BIBLIOGRAPHY FORMAT:
                  - Use ALL authors from ALL_AUTHORS field
                  - Include DOI when available
                
                IN-TEXT FORMAT:
                  - 1 author: (Author, Year)
                  - 2 authors: (Author1 & Author2, Year)
                  - 3+ authors: (Author1 et al., Year)
            `;
        }

        return `
            TASK: Insert citations into the text using ${style} format.
            ${styleRules}
            ${citationStrategy}
            ${styleExamples}
            
            SOURCE DATA (${sources.length} sources available):
            ${sourceContext}
            
            TEXT TO CITE: "${context}"
            
            🎯 PRIMARY GOAL: USE ${minSourcesToUse}-${sources.length} SOURCES (NOT just 1-2!)
            
            CITATION DISTRIBUTION REQUIREMENTS:
            
            1. **MANDATORY SOURCE USAGE**:
               - You have ${sources.length} sources available
               - You MUST use AT LEAST ${minSourcesToUse} different sources
               - Target: ${targetInsertions} total citation insertions
               - Leaving 7-8 sources unused is UNACCEPTABLE
               - The "Further Reading (Unused)" section should be nearly EMPTY (0-2 sources max)
            
            2. **HOW TO ACHIEVE THIS**:
               - Read through the ENTIRE user text
               - Identify which sources are relevant to each section/paragraph
               - Cite multiple sources per paragraph when appropriate
               - For highly relevant sources, cite them 2-3 times in different locations
               - Example: If discussing health impacts, cite Harvard 2-3 times in that section
            
            3. **YEAR/DATE REQUIREMENT - MANDATORY**:
               - Every citation_text MUST include the YEAR field value
               - Format: (Author Year) for Chicago, (Author, Year) for APA
               - NO citations without dates unless YEAR is "n.d."
            
            4. **MULTIPLE AUTHORS**:
               - Check ALL_AUTHORS field for multiple authors separated by " | "
               - Include ALL authors or use "et al." for 3+
            
            5. **BIBLIOGRAPHY FORMAT**:
               - Follow exact format for ${style}
               - Include DOI if available (not "none")
               - Each source appears ONCE in formatted_citations even if cited multiple times
            
            OUTPUT FORMAT: Return strictly valid JSON.
            {
              "insertions": [
                { "anchor": "phrase 1", "source_id": 1, "citation_text": "(Author Year)" },
                { "anchor": "phrase 2", "source_id": 2, "citation_text": "(Author Year)" },
                { "anchor": "phrase 3", "source_id": 3, "citation_text": "(Author Year)" },
                { "anchor": "phrase 4", "source_id": 1, "citation_text": "(Author Year)" },  // Same source, different location
                { "anchor": "phrase 5", "source_id": 4, "citation_text": "(Author Year)" },
                ... continue until you have ~${targetInsertions} insertions using ${minSourcesToUse}+ different sources
              ],
              "formatted_citations": {
                "1": "Complete bibliography entry",
                "2": "Complete bibliography entry",
                ... one entry per unique source cited
              }
            }
            
            ✅ FINAL VERIFICATION CHECKLIST:
            □ Am I using at least ${minSourcesTo
