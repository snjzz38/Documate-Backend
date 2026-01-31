// api/utils/prompts.js

export const CitationPrompts = {
    // --- 1. QUOTES PROMPT ---
    buildQuotes(context, sources) {
        // Note: Keeping this at 2500 chars so AI sees the middle/end text for quotes
        const sourceContext = sources.map(s => 
            `[ID:${s.id}] TITLE: ${s.title} | URL: ${s.link}\nTEXT: ${s.content.substring(0, 2500).replace(/\n/g, ' ')}`
        ).join('\n\n');

        return `
            TASK: Extract a short, relevant quote for EACH of the ${sources.length} sources provided.
            
            USER CONTEXT: "${context.substring(0, 500)}..."
            
            SOURCE DATA:
            ${sourceContext}
            
            🚨 CRITICAL ORDERING RULES 🚨:
            1. **DO NOT REORDER**: You MUST output the results in strict numerical sequence: ID 1, then ID 2, then ID 3, etc.
            2. **NO GROUPING**: Do NOT put "No quote found" entries at the bottom. If ID 3 has no quote, it must appear immediately after ID 2.
            
            FORMAT:
            [ID] Title - URL
            > "Direct quote from text..."
            
            FALLBACK:
            [ID] Title - URL
            > No relevant quote found.
            
            SELECTION: Prefer quotes that contain data, definitions, or strong assertions related to the User Context.
        `;
    },

    // --- 2. BIBLIOGRAPHY PROMPT ---
    buildBibliography(style, sources, today) {
        const sourceContext = this._buildSourceContext(sources);
        
        let bibStyleRules = "";
        if (style.toLowerCase().includes("chicago")) {
            bibStyleRules = `
                STYLE: Chicago Manual of Style (17th Edition)
                FORMAT: LastName, FirstName. "Article Title." *Website Name*. Month Day, Year. URL or https://doi.org/DOI.
            `;
        } else if (style.toLowerCase().includes("mla")) {
            bibStyleRules = `
                STYLE: MLA 9th Edition
                FORMAT: LastName, FirstName. "Article Title." *Container Title*, Date, URL.
            `;
        } else {
            bibStyleRules = `
                STYLE: APA 7th Edition
                FORMAT: Author, A. A. (Year). Title of article. *Site Name*. URL
            `;
        }
        
        return `
            TASK: Generate a Bibliography / Works Cited list.
            ${bibStyleRules}
            
            SOURCE DATA:
            ${sourceContext}
            
            RULES:
            1. Include ALL ${sources.length} sources.
            2. **SORTING**: Sort strictly by Source ID (1, 2, 3...) to match the scraping order.
            3. **FORMATTING**: Format strictly according to ${style}.
            4. **ACCESS DATE**: You MUST include "Accessed ${today}" at the end of every entry.
            5. **OUTPUT**: Return a clean PLAIN TEXT list. Do NOT return JSON.
        `;
    },

    // --- 3. CITATION INSERTION PROMPT ---
    buildInsertion(style, context, sources, today) {
        const sourceContext = this._buildSourceContext(sources);
        
        let styleRules = "";
        if (style.toLowerCase().includes("chicago")) {
            styleRules = `STYLE: Chicago (Notes/Bib). IN-TEXT: (Author Year). BIB: Author. "Title." Site, Date. URL.`;
        } else if (style.toLowerCase().includes("mla")) {
            styleRules = `STYLE: MLA 9th. IN-TEXT: (Author Year). BIB: Author. "Title." Container, Date, URL.`;
        } else {
            styleRules = `STYLE: APA 7th. IN-TEXT: (Author, Year). BIB: Author. (Year). Title. Site. URL.`;
        }

        return `
            TASK: Map citations to the user's text.
            ${styleRules}
            
            SOURCE DATA:
            ${sourceContext}
            
            TEXT TO ANALYZE: 
            "${context}"
            
            🚨 CRITICAL INSTRUCTIONS 🚨:
            1. **DO NOT REWRITE THE TEXT**. Only return the JSON object.
            2. **METADATA FORENSICS**:
               - If META_DATE is "n.d.", scan TEXT_CONTENT for a year (e.g. "April 2018" -> 2018).
               - If META_AUTHOR is "Unknown", scan TEXT_CONTENT for "By [Name]".
            
            OUTPUT RULES:
            1. **insertions**: List of places to add citations.
            2. **formatted_citations**: Full bibliography entry. MUST end with "URL (Accessed ${today})".
            3. **citation_text**: MUST contain the Year (e.g. "(West 2018)").
            4. **JSON ONLY**: Start your response with '{' and end with '}'.
            
            REQUIRED JSON STRUCTURE:
            {
              "insertions": [
                { "anchor": "transformative periods in modern history", "source_id": 1, "citation_text": "(West 2018)" }
              ],
              "formatted_citations": {
                "1": "West, Darrell. \"Title.\" Brookings, 2018. https://link... (Accessed ${today})"
              }
            }
        `;
    },

    // --- HELPER: Build Context String (VERBATIM LOGIC) ---
    _buildSourceContext(sources) {
        return sources.map(s => {
            // Enhanced metadata extraction logic
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
            
            let year = "n.d.";
            if (enhancedDate && enhancedDate !== "n.d.") {
                const yearMatch = enhancedDate.match(/\b(20\d{2})\b/);
                if (yearMatch) {
                    year = yearMatch[1];
                }
            }
            
            let enhancedAuthors = [];
            let enhancedAuthor = s.meta.author;
            
            const isSiteName = s.meta.author && (
                s.meta.author === s.meta.siteName || 
                s.meta.author.toLowerCase().includes(s.meta.siteName.toLowerCase().replace(/\.(com|org|edu|net)/, ''))
            );
            
            if (!s.meta.author || s.meta.author === "Unknown" || isSiteName) {
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
                if (enhancedAuthor.includes(' and ')) {
                    enhancedAuthors = enhancedAuthor.split(' and ').map(a => a.trim());
                } else if (enhancedAuthor.includes(', and ')) {
                    enhancedAuthors = enhancedAuthor.split(/, and |, /).map(a => a.trim());
                } else if (enhancedAuthor.includes(',')) {
                    enhancedAuthors = [enhancedAuthor]; 
                } else {
                    enhancedAuthors = [enhancedAuthor];
                }
            }
            
            let doi = "";
            const doiMatch = s.content.match(/doi\.org\/([^\s]+)|DOI:\s*([^\s]+)/i);
            if (doiMatch) {
                doi = doiMatch[1] || doiMatch[2];
                doi = doi.replace(/[.,;]+$/, '');
            }
            
            // VERBATIM FORMATTING REQUESTED
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
    }
};
