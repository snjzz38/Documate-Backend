// api/utils/prompts.js

export const CitationPrompts = {
    // --- 1. QUOTES PROMPT ---
    buildQuotes(context, sources) {
        const sourceContext = sources.map(s => 
            `[ID:${s.id}] TITLE: ${s.title} | URL: ${s.link}\nTEXT: ${s.content.substring(0, 400).replace(/\n/g, ' ')}...`
        ).join('\n\n');

        return `
            TASK: Extract quotes. CONTEXT: "${context.substring(0, 300)}..."
            SOURCES:\n${sourceContext}
            RULES: Output strictly in order ID 1 to ${sources.length}. Format: **[ID] Title** - URL \n > "Quote..."
        `;
    },

    // --- 2. BIBLIOGRAPHY PROMPT ---
    buildBibliography(style, sources, today) {
        const sourceContext = this._buildSourceContext(sources);
        
        return `
            TASK: Generate a Bibliography / Works Cited list.
            STYLE: ${style}
            
            SOURCE DATA:
            ${sourceContext}
            
            RULES:
            1. Include ALL ${sources.length} sources.
            2. Sort alphabetically or by ID as per ${style} standard.
            3. **FORMATTING**: Format strictly according to ${style}.
            4. **ACCESS DATE**: You MUST include "Accessed ${today}" at the end of every entry.
            5. **OUTPUT**: Return a clean PLAIN TEXT list. Do NOT return JSON. Do NOT use markdown.
        `;
    },

    // --- 3. CITATION INSERTION PROMPT ---
    buildInsertion(style, context, sources, today) {
        const sourceContext = this._buildSourceContext(sources);
        const styleRules = this._getStyleRules(style);

        return `
            TASK: Map citations to the user's text.
            ${styleRules}
            
            SOURCE DATA:
            ${sourceContext}
            
            TEXT TO ANALYZE: 
            "${context}"
            
            🚨 CRITICAL INSTRUCTIONS 🚨:
            1. **DO NOT REWRITE THE TEXT**. I repeat, DO NOT return the text.
            2. Only return a JSON object containing the "insertions" list and "formatted_citations".
            3. **METADATA FORENSICS**:
               - If META_DATE is "n.d.", scan TEXT_CONTENT for a year (e.g. "April 2018" -> 2018).
               - If META_AUTHOR is "Unknown", scan TEXT_CONTENT for "By [Name]".
            
            OUTPUT RULES:
            1. **insertions**: A list of places to add citations. "anchor" must be a unique 3-6 word phrase from the text.
            2. **formatted_citations**: The full bibliography entry. MUST end with "URL (Accessed ${today})".
            3. **citation_text**: MUST contain the Year (e.g. "(West 2018)").
            4. **JSON ONLY**: Start your response with '{' and end with '}'. No "Here is the JSON".
            
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
        return sources.map(s => 
            `[ID:${s.id}] 
             TITLE: ${s.title}
             URL: ${s.link}
             META_AUTHOR: ${s.meta.author} 
             META_DATE: ${s.meta.published}
             TEXT_CONTENT: ${s.content.substring(0, 800).replace(/\n/g, ' ')}...`
        ).join('\n\n');
    },

    // --- HELPER: Get Style Rules ---
    _getStyleRules(style) {
        const s = style.toLowerCase();
        if (s.includes("chicago")) {
            return `STYLE: Chicago (Notes/Bib). IN-TEXT: (Author Year). BIB: Author. "Title." Site, Date. URL.`;
        } else if (s.includes("mla")) {
            return `STYLE: MLA 9th. IN-TEXT: (Author Year). BIB: Author. "Title." Container, Date, URL.`;
        } else {
            return `STYLE: APA 7th. IN-TEXT: (Author, Year). BIB: Author. (Year). Title. Site. URL.`;
        }
    }
};
