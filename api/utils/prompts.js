// api/utils/prompts.js

export const CitationPrompts = {
    // --- 1. QUOTES PROMPT ---
    buildQuotes(context, sources) {
        // FIX: Increased limit from 400 to 2500 chars so AI sees the middle/end chunks
        const sourceContext = sources.map(s => 
            `[ID:${s.id}] TITLE: ${s.title} | URL: ${s.link}\nTEXT: ${s.content.substring(0, 2500).replace(/\n/g, ' ')}`
        ).join('\n\n');

        return `
            TASK: Extract a short, relevant quote for EACH of the ${sources.length} sources provided.
            
            USER CONTEXT: "${context.substring(0, 500)}..."
            
            SOURCE DATA:
            ${sourceContext}
            
            RULES:
            1. **STRICT ALIGNMENT**: You MUST output exactly one entry for every ID from 1 to ${sources.length}.
            2. **ORDER**: Output strictly in numerical order: [1], [2], [3]...
            3. **FORMAT**:
               [ID] Title - URL
               > "Direct quote from text..."
            
            4. **FALLBACK**: If a source text is truly empty or irrelevant, write:
               [ID] Title - URL
               > No relevant quote found.
            
            5. **SELECTION**: Prefer quotes that contain data, definitions, or strong assertions related to the User Context.
        `;
    },

    // --- 2. BIBLIOGRAPHY PROMPT ---
    buildBibliography(style, sources, today) {
        const sourceContext = this._buildSourceContext(sources);
        
        // Define style-specific rules (VERBATIM from previous logic)
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
            5. **OUTPUT**: Return a clean PLAIN TEXT list. Do NOT return JSON. Do NOT use markdown.
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

    // --- HELPER: Build Context String ---
    _buildSourceContext(sources) {
        return sources.map(s => {
            // Enhanced metadata extraction logic (VERBATIM from previous request)
            let enhancedDate = s.meta.published;
            let enhancedAuthor = s.meta.author;
            
            return `[ID:${s.id}] 
TITLE: ${s.title}
URL: ${s.link}
META_AUTHOR: ${enhancedAuthor} 
META_DATE: ${enhancedDate}
TEXT_CONTENT: ${s.content.substring(0, 1500).replace(/\n/g, ' ')}...`; // Increased to 1500 for Citations too
        }).join('\n\n');
    }
};
