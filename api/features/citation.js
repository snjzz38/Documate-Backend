// api/features/citation.js
import { GoogleSearchAPI } from '../utils/googleSearch.js';
import { ScraperAPI } from '../utils/scraper.js';
import { GroqAPI } from '../utils/groqAPI.js';

// ==========================================================================
// MODULE: FORMAT SERVICE (The Prompt Logic)
// ==========================================================================
const FormatService = {
    buildPrompt(type, style, context, sources) {
        const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
        
        // Enhanced context builder with better metadata extraction
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
                
                EXAMPLE OUTPUT:
                
                **[1] Climate Change Impacts** - https://example.com
                > "Recent studies demonstrate that global temperatures have risen by 1.1°C since pre-industrial times, with the past decade being the warmest on record. This warming has led to increased frequency of extreme weather events, including hurricanes, droughts, and wildfires. The scientific consensus is clear: human activities, particularly the burning of fossil fuels, are the primary driver of these changes, and immediate action is required to prevent catastrophic consequences."
                
                **[2] Economic Costs** - https://example2.com
                > "The economic impact of climate inaction is staggering. Without significant mitigation efforts, global GDP could decline by up to 23% by 2100, with developing nations facing even steeper losses."
                
                IMPORTANT: 
                - Extract LONGER quotes (50-150 words) that provide substantial evidence
                - Ensure each quote SUPPORTS the user's argument about "${context.substring(0, 100)}..."
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
        
        // Different strategy for footnotes vs in-text
        if (type === 'footnotes') {
            citationStrategy = `
                FOOTNOTE CITATION STRATEGY:
                - You can cite the SAME source MULTIPLE times throughout the text
                - Each time you cite a source, it gets a NEW superscript number
                - Each citation appears as a separate numbered footnote at the bottom
                - Example: If you cite Source ID:1 three times, you'll have:
                  * First citation: ¹ (footnote 1 lists the source)
                  * Second citation: ³ (footnote 3 lists the SAME source again)
                  * Third citation: ⁶ (footnote 6 lists the SAME source again)
                - This means your insertions array can have MULTIPLE entries with the same source_id
                - This is ENCOURAGED for important sources - cite them 1-3 times in different locations
            `;
        } else {
            citationStrategy = `
                IN-TEXT CITATION STRATEGY:
                - You can cite the SAME source MULTIPLE times throughout the text
                - The citation text stays the same each time (e.g., "(West and Allen 2018)")
                - Example: If Source ID:1 is highly relevant, you might cite it 2-3 times:
                  * "Climate change is urgent (West and Allen 2018). ... other text ... This requires action (West and Allen 2018)."
                - This means your insertions array can have MULTIPLE entries with the same source_id
                - Each insertion just needs a different anchor point in the text
                - The same source only appears ONCE in the formatted_citations/bibliography
                - This is ENCOURAGED for authoritative sources - cite them 1-3 times in different sections
            `;
        }
        
        if (style.toLowerCase().includes("chicago")) {
            styleRules = `
                STYLE: Chicago Manual of Style (17th Edition) - Notes and Bibliography System
                
                BIBLIOGRAPHY FORMAT (Follow EXACTLY):
                  - 1 author: LastName, FirstName. "Article Title." *Website Name*. Month Day, Year. URL or https://doi.org/DOI.
                  - 2 authors: LastName1, FirstName1, and FirstName2 LastName2. "Article Title." *Website Name*. Month Day, Year. URL or https://doi.org/DOI.
                  - 3+ authors: LastName1, FirstName1, et al. "Article Title." *Website Name*. Month Day, Year. URL or https://doi.org/DOI.
                
                KEY RULES:
                  - Use period after author names
                  - Article title in quotes with period inside
                  - Website/Publisher in italics (*Name*)
                  - Period after website name
                  - Full date: Month Day, Year (e.g., April 24, 2018)
                  - If DOI exists, use https://doi.org/DOI instead of regular URL
                  - End with period after URL/DOI
                
                IN-TEXT FORMAT (Follow EXACTLY):
                  - 1 author: (LastName Year) - e.g., (Smith 2020)
                  - 2 authors: (LastName1 and LastName2 Year) - e.g., (West and Allen 2018)
                  - 3+ authors: (LastName1 et al. Year) - e.g., (Johnson et al. 2024)
                  - No date: (LastName n.d.) - ONLY use this if YEAR field is "n.d."
                  
                CRITICAL: 
                - NO COMMA between author and year in Chicago in-text citations!
                - ALWAYS include the YEAR field value in citation_text
                - The YEAR field is pre-extracted for you - USE IT!
            `;
            styleExamples = `
                CHICAGO EXAMPLES:
                
                Example 1 (Source with Year):
                - ALL_AUTHORS: "United Nations Sustainable Development"
                - YEAR: "2030"
                - citation_text: "(United Nations Sustainable Development 2030)" ✓ CORRECT
                - citation_text: "(United Nations Sustainable Development)" ✗ WRONG - missing year!
                
                Example 2 (Two Authors with Year):
                - ALL_AUTHORS: "Darrell M. West | John R. Allen"
                - YEAR: "2018"
                - citation_text: "(West and Allen 2018)" ✓ CORRECT
                - citation_text: "(West and Allen)" ✗ WRONG - missing year!
                
                Example 3 (Multiple Authors):
                - ALL_AUTHORS: "S.M. Howden | J.-F. Soussana | F.N. Tubiello | N. Chhetri | M. Dunlop | H. Meinke"
                - YEAR: "2007"
                - citation_text: "(Howden et al. 2007)" ✓ CORRECT
                - citation_text: "(Howden et al.)" ✗ WRONG - missing year!
                
                Example 4 (No Date Available):
                - ALL_AUTHORS: "Greenpeace UK"
                - YEAR: "n.d."
                - citation_text: "(Greenpeace UK n.d.)" ✓ CORRECT
            `;
        } else if (style.toLowerCase().includes("mla")) {
            styleRules = `
                STYLE: MLA 9th Edition
                
                BIBLIOGRAPHY FORMAT:
                  - 1 author: LastName, FirstName. "Article Title." *Container Title*, Date, URL.
                  - 2 authors: LastName1, FirstName1, and FirstName2 LastName2. "Article Title." *Container*, Date, URL.
                  - 3+ authors: LastName1, FirstName1, et al. "Article Title." *Container*, Date, URL.
                
                IN-TEXT FORMAT:
                  - 1 author: (LastName)
                  - 2 authors: (LastName1 and LastName2)
                  - 3+ authors: (LastName1 et al.)
                  
                NOTE: MLA typically doesn't include year in parenthetical citations unless needed for clarity
            `;
        } else if (style.toLowerCase().includes("apa")) {
            styleRules = `
                STYLE: APA 7th Edition
                
                BIBLIOGRAPHY FORMAT:
                  - 1 author: Author, A. A. (Year). Title of article. *Site Name*. URL or https://doi.org/DOI
                  - 2 authors: Author1, A. A., & Author2, B. B. (Year). Title. *Site Name*. URL
                  - 3+ authors: Author1, A. A., Author2, B. B., & Author3, C. C. (Year). Title. *Site Name*. URL
                
                IN-TEXT FORMAT:
                  - 1 author: (Author, Year) - MUST include year!
                  - 2 authors: (Author1 & Author2, Year) - MUST include year!
                  - 3+ authors: (Author1 et al., Year) - MUST include year!
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
            
            🚨 MANDATORY REQUIREMENT - READ THIS CAREFULLY 🚨
            Every source has a "YEAR" field. This is the year you MUST use in citation_text.
            - If YEAR is "2018", your citation MUST include "2018"
            - If YEAR is "2023", your citation MUST include "2023"
            - If YEAR is "n.d.", your citation MUST include "n.d."
            There is NO situation where you omit the year/date from citation_text!
            
            CRITICAL INSTRUCTIONS:
            
            0. **CITATION DISTRIBUTION & REUSE**:
               - You have ${sources.length} sources available
               - Try to use AT LEAST ${Math.max(4, Math.floor(sources.length * 0.6))} DIFFERENT sources
               - For particularly authoritative or relevant sources, cite them MULTIPLE times (1-3 insertions per source)
               - Spread citations throughout the text - don't cluster them all in one section
            
            1. **YEAR/DATE REQUIREMENT - NON-NEGOTIABLE**:
               - Look at the YEAR field for each source
               - Include this YEAR in every citation_text
               - Format for Chicago: (Author Year) with NO comma
               - Format for APA: (Author, Year) with comma
               - Format for MLA: (Author) typically, but include year if helpful
               - VALIDATION: Every citation_text MUST contain a year OR "n.d."
            
            2. **MULTIPLE AUTHORS - READ ALL_AUTHORS FIELD**:
               - The ALL_AUTHORS field shows ALL authors separated by " | "
               - Count the separators to determine author count
               - Include ALL authors or use "et al." for 3+
            
            3. **BIBLIOGRAPHY FORMAT**:
               - Follow the EXACT format shown in examples
               - Include ALL author full names (unless 3+, then use et al.)
               - Check DOI field - if DOI exists, use https://doi.org/DOI
               - Each source appears ONLY ONCE in formatted_citations
            
            4. **URL/DOI HANDLING**:
               - If DOI exists and is not "none", use: https://doi.org/[DOI]
               - Otherwise use the regular URL
               - NEVER use placeholders like "[URL]"
            
            OUTPUT FORMAT: Return strictly valid JSON.
            {
              "insertions": [
                { "anchor": "phrase", "source_id": 1, "citation_text": "(Author YEAR)" },  // YEAR is mandatory!
                { "anchor": "phrase", "source_id": 2, "citation_text": "(Author YEAR)" },  // YEAR is mandatory!
                ...
              ],
              "formatted_citations": { 
                "1": "Complete bibliography entry.",
                "2": "Complete bibliography entry.",
                ...
              }
            }
            
            FINAL CHECK before submitting:
            ✓ Does EVERY citation_text contain a year or "n.d."?
            ✓ Are you using 60%+ of available sources?
            ✓ Are important sources cited 2-3 times?
        `;
    }
};
// ==========================================================================
// MODULE: TEXT PROCESSOR (The Pipeline)
// ==========================================================================
const PipelineService = {
    ensureAccessDate(text) {
        if (!text) return "";
        const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
        if (text.includes("Accessed")) return text;
        return `${text} (Accessed ${today})`;
    },

    // Extract year from source
    extractYear(source) {
        let year = "n.d.";
        
        // Try meta.published first
        if (source.meta.published && source.meta.published !== "n.d.") {
            const yearMatch = source.meta.published.match(/\b(20\d{2})\b/);
            if (yearMatch) return yearMatch[1];
        }
        
        // Try content
        const contentYearMatch = source.content.match(/\b(20\d{2})\b/);
        if (contentYearMatch) return contentYearMatch[1];
        
        return year;
    },

    // Validates and fixes citation_text to ensure it has a year
    validateCitationText(citationText, source, style) {
        if (!citationText) return null;
        
        // Extract the year
        const year = this.extractYear(source);
        
        // Check if citation already has a year
        const hasYear = /\d{4}|n\.d\./i.test(citationText);
        
        if (hasYear) {
            return citationText; // Already good
        }
        
        // Missing year - need to add it
        // Parse the citation to add year in the right place
        
        // Pattern: (Author) or (Author and Author) or (Author et al.)
        const match = citationText.match(/^\((.*?)\)$/);
        if (!match) return citationText; // Can't parse, return as-is
        
        const authorPart = match[1];
        
        // Determine style-specific formatting
        if (style && style.toLowerCase().includes('chicago')) {
            // Chicago: (Author Year) - no comma
            return `(${authorPart} ${year})`;
        } else if (style && style.toLowerCase().includes('apa')) {
            // APA: (Author, Year) - with comma
            return `(${authorPart}, ${year})`;
        } else {
            // Default/MLA: (Author Year) - no comma
            return `(${authorPart} ${year})`;
        }
    },

    // Generates a backup citation if AI returns "Unknown" or fails
    generateFallback(source) {
        const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
        
        // Try to extract authors from content
        let author = source.meta.author;
        const isSiteName = author && (
            author === source.meta.siteName || 
            author.toLowerCase().includes(source.meta.siteName.toLowerCase().replace(/\.(com|org|edu|net)/, ''))
        );
        
        if (!author || author === "Unknown" || isSiteName) {
            const authorMatch = source.content.match(/([A-Z][a-z]+\s+[A-Z]\.?\s+[A-Z][a-z]+)\s+and\s+([A-Z][a-z]+\s+[A-Z]\.?\s+[A-Z][a-z]+)/);
            if (authorMatch) {
                author = `${authorMatch[1]} and ${authorMatch[2]}`;
            } else {
                const singleAuthor = source.content.match(/(?:By|Author:)\s+([A-Z][a-z]+\s+[A-Z]\.?\s+[A-Z][a-z]+)/);
                if (singleAuthor) {
                    author = singleAuthor[1];
                } else {
                    author = source.meta.siteName || "Unknown Source";
                }
            }
        }
        
        let date = source.meta.published;
        if (!date || date === "n.d.") {
            const dateMatch = source.content.match(/(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}/);
            if (dateMatch) {
                date = dateMatch[0];
            } else {
                const yearMatch = source.content.match(/\b(20\d{2})\b/);
                date = yearMatch ? yearMatch[1] : "n.d.";
            }
        }

        const url = source.link;
        const title = source.title || "Untitled";
        
        return `${author}. "${title}". ${source.meta.siteName}. ${date}. ${url} (Accessed ${today})`;
    },

    processInsertions(context, insertions, sources, formattedMap, outputType, style) {
        let resultText = context;
        let footnoteCounter = 1;
        let usedSourceIds = new Set();
        let footnotesList = [];

        // 1. Tokenize Text
        const tokens = [];
        const tokenRegex = /[a-z0-9]+/gi;
        let match;
        while ((match = tokenRegex.exec(context)) !== null) {
            tokens.push({ word: match[0].toLowerCase(), start: match.index, end: match.index + match[0].length });
        }

        // 2. Sort Insertions
        const validInsertions = (insertions || [])
            .map(item => {
                if (!item.anchor || !item.source_id) return null;
                const anchorWords = item.anchor.toLowerCase().match(/[a-z0-9]+/g);
                if (!anchorWords) return null;
                let bestIndex = -1;
                for (let i = 0; i <= tokens.length - anchorWords.length; i++) {
                    let matchFound = true;
                    for (let j = 0; j < anchorWords.length; j++) {
                        if (tokens[i + j].word !== anchorWords[j]) { matchFound = false; break; }
                    }
                    if (matchFound) { bestIndex = tokens[i + anchorWords.length - 1].end; break; }
                }
                return bestIndex !== -1 ? { ...item, insertIndex: bestIndex } : null;
            })
            .filter(Boolean)
            .sort((a, b) => b.insertIndex - a.insertIndex);

        // 3. Apply Insertions
        validInsertions.forEach(item => {
            const source = sources.find(s => s.id === item.source_id);
            if (!source) return;
            
            usedSourceIds.add(source.id);
            
            // Get Citation String
            let citString = formattedMap[source.id];
            
            // Validation: If AI returned invalid citation, overwrite it
            const isInvalid = !citString || 
                            citString.length < 10 || 
                            citString.includes('[URL]') || 
                            citString.includes('[link]') ||
                            citString.startsWith('Author.') ||
                            citString.includes('"The rise of artificial') ||
                            citString.includes('"Powered by advances');
            
            if (isInvalid) {
                citString = this.generateFallback(source);
            }
            citString = this.ensureAccessDate(citString);

            let insertContent = "";
            if (outputType === 'footnotes') {
                const s = {'0':'⁰','1':'¹','2':'²','3':'³','4':'⁴','5':'⁵','6':'⁶','7':'⁷','8':'⁸','9':'⁹'};
                const numStr = footnoteCounter.toString();
                insertContent = numStr.split('').map(d => s[d]||'').join('');
                
                footnotesList.push(`${footnoteCounter}. ${citString}`);
                footnoteCounter++;
            } else {
                // IN-TEXT LOGIC with YEAR VALIDATION
                let inText = item.citation_text;
                
                // CRITICAL: Validate that citation has a year
                inText = this.validateCitationText(inText, source, style);
                
                // If still invalid after validation, generate from scratch
                if (!inText || inText.length < 3) {
                    let auth = source.meta.author;
                    
                    const isSiteName = auth === source.meta.siteName || 
                                     (auth && auth.toLowerCase().includes(source.meta.siteName.toLowerCase().replace(/\.(com|org|edu|net)/, '')));
                    
                    if (!auth || auth === "Unknown" || isSiteName) {
                        const authorMatch = source.content.match(/([A-Z][a-z]+)\s+[A-Z]\.?\s+[A-Z][a-z]+\s+and/);
                        auth = authorMatch ? authorMatch[1] : (source.meta.siteName || "Unknown");
                    } else if (auth.includes(' and ')) {
                        auth = auth.split(' and ')[0].split(' ').pop();
                    } else {
                        auth = auth.split(' ').pop();
                    }
                    
                    const yr = this.extractYear(source);
                    
                    // Format based on style
                    if (style && style.toLowerCase().includes('chicago')) {
                        inText = `(${auth} ${yr})`;
                    } else if (style && style.toLowerCase().includes('apa')) {
                        inText = `(${auth}, ${yr})`;
                    } else {
                        inText = `(${auth} ${yr})`;
                    }
                }
                
                insertContent = " " + inText;
            }
            resultText = resultText.substring(0, item.insertIndex) + insertContent + resultText.substring(item.insertIndex);
        });

        // 4. Build Footer
        let footer = "";
        
        if (outputType === 'footnotes') {
            footer += "\n\n### Footnotes (Used)\n" + footnotesList.join('\n\n');
        } else {
            footer += "\n\n### References Cited (Used)\n";
            sources.forEach(s => {
                if (usedSourceIds.has(s.id)) {
                    let cit = formattedMap[s.id] || this.generateFallback(s);
                    
                    const isInvalid = cit.includes('[URL]') || 
                                    cit.includes('[link]') ||
                                    cit.startsWith('Author.') ||
                                    cit.includes('"The rise of artificial') ||
                                    cit.includes('"Powered by advances');
                    
                    if (isInvalid) {
                        cit = this.generateFallback(s);
                    }
                    footer += this.ensureAccessDate(cit) + "\n\n";
                }
            });
        }

        if (usedSourceIds.size < sources.length) {
            footer += "\n\n### Further Reading (Unused)\n";
            sources.forEach(s => {
                if (!usedSourceIds.has(s.id)) {
                    let cit = formattedMap[s.id] || this.generateFallback(s);
                    
                    const isInvalid = cit.includes('[URL]') || 
                                    cit.includes('[link]') ||
                                    cit.startsWith('Author.') ||
                                    cit.includes('"The rise of artificial') ||
                                    cit.includes('"Powered by advances');
                    
                    if (isInvalid) {
                        cit = this.generateFallback(s);
                    }
                    footer += this.ensureAccessDate(cit) + "\n\n";
                }
            });
        }

        return resultText + footer;
    }
};

// ==========================================================================
// MAIN HANDLER
// ==========================================================================
export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        const { context, style, outputType, apiKey, googleKey, preLoadedSources } = req.body;
        const GROQ_KEY = apiKey || process.env.GROQ_API_KEY;
        const SEARCH_KEY = googleKey || process.env.GOOGLE_SEARCH_API_KEY;
        const SEARCH_CX = process.env.SEARCH_ENGINE_ID;

        // 1. QUOTES
        if (preLoadedSources?.length > 0) {
            const prompt = FormatService.buildPrompt('quotes', null, context, preLoadedSources);
            const result = await GroqAPI.chat([{ role: "user", content: prompt }], GROQ_KEY, false);
            return res.status(200).json({ success: true, text: result });
        }

        // 2. SEARCH & SCRAPE
        const rawSources = await GoogleSearchAPI.search(context, SEARCH_KEY, SEARCH_CX);
        const richSources = await ScraperAPI.scrape(rawSources);
        
        // 3. GENERATE
        const prompt = FormatService.buildPrompt(outputType, style, context, richSources);
        const isJson = outputType !== 'bibliography';
        
        const aiResponse = await GroqAPI.chat([{ role: "user", content: prompt }], GROQ_KEY, isJson);

        let finalOutput = aiResponse;

        if (outputType === 'bibliography') {
            finalOutput = aiResponse.replace(/```json/g, '').replace(/```/g, '').trim();
        } 
        else {
            try {
                const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
                const jsonStr = jsonMatch ? jsonMatch[0] : aiResponse;
                const data = JSON.parse(jsonStr);
                finalOutput = PipelineService.processInsertions(context, data.insertions, richSources, data.formatted_citations, outputType, style);
            } catch (e) {
                finalOutput = aiResponse.replace(/```json/g, '').replace(/```/g, '');
            }
        }

        return res.status(200).json({ success: true, sources: richSources, text: finalOutput });

    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
}
