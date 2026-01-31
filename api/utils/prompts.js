// api/utils/prompts.js

export const CitationPrompts = {
    build(type, style, context, sources) {
        const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
        
        // SAFETY CHECK: Ensure sources is an array
        const safeSources = Array.isArray(sources) ? sources : [];

        // Enhanced context builder
        const sourceContext = safeSources.map(s => {
            // Safety: Ensure content exists
            const content = s.content || "";
            const meta = s.meta || {};

            // Pre-extract date from content if DETECTED_DATE is n.d.
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
            let enhancedAuthor = meta.author;
            const siteName = meta.siteName || "Unknown";
            
            const isSiteName = enhancedAuthor && (
                enhancedAuthor === siteName || 
                enhancedAuthor.toLowerCase().includes(siteName.toLowerCase().replace(/\.(com|org|edu|net)/, ''))
            );
            
            if (!enhancedAuthor || enhancedAuthor === "Unknown" || isSiteName) {
                // Search for authors in content
                const andPattern = /^.{0,300}([A-Z][a-z]+(?:\s+[A-Z]\.?\s*)?[A-Z][a-z]+)\s+and\s+([A-Z][a-z]+(?:\s+[A-Z]\.?\s*)?[A-Z][a-z]+)/;
                const andMatch = content.match(andPattern);
                
                if (andMatch) {
                    enhancedAuthors.push(andMatch[1].trim());
                    enhancedAuthors.push(andMatch[2].trim());
                }
                
                if (enhancedAuthors.length === 0) {
                    const byPattern = /By\s+([A-Z][a-z]+\s+[A-Z]\.?\s+[A-Z][a-z]+)(?:,?\s+and\s+([A-Z][a-z]+\s+[A-Z]\.?\s+[A-Z][a-z]+))?/i;
                    const byMatch = content.match(byPattern);
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
                // Meta author exists - parse it
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
            
            // Look for DOI
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
DETECTED_DATE: ${enhancedDate || meta.published}
YEAR: ${year}
TEXT_CONTENT: ${content.substring(0, 1000).replace(/\n/g, ' ')}...`;
        }).join('\n\n---\n\n');

        // --- 1. QUOTES ---
        if (type === 'quotes') {
            return `
                TASK: Extract high-quality quotes that SUPPORT the user's argument.
                CONTEXT: "${context.substring(0, 500)}..."
                SOURCES:
                ${sourceContext}
                
                RULES:
                1. Output strictly in order ID 1 to ${safeSources.length}.
                2. Format: **[ID] Title** - URL \n > "Quote..."
                3. If no relevant quote found, output "No relevant quote found."
            `;
        }

        // --- 2. BIBLIOGRAPHY ONLY ---
        if (type === 'bibliography') {
            let bibStyleRules = "";
            const s = (style || "").toLowerCase();
            
            if (s.includes("chicago")) {
                bibStyleRules = `STYLE: Chicago (17th). FORMAT: LastName, FirstName. "Title." *Site*. Date. URL.`;
            } else if (s.includes("mla")) {
                bibStyleRules = `STYLE: MLA 9th. FORMAT: LastName, FirstName. "Title." *Container*, Date, URL.`;
            } else {
                bibStyleRules = `STYLE: APA 7th. FORMAT: Author. (Year). Title. *Site*. URL`;
            }
            
            return `
                TASK: Generate a bibliography.
                ${bibStyleRules}
                SOURCES: ${sourceContext}
                RULES: Include all sources. Sort alphabetically. Return PLAIN TEXT.
            `;
        }

        // --- 3. CITATIONS & FOOTNOTES ---
        let styleRules = "";
        const s = (style || "").toLowerCase();
        
        if (s.includes("chicago")) {
            styleRules = `STYLE: Chicago (Notes/Bib). IN-TEXT: (Author Year). BIB: Author. "Title." Site, Date. URL.`;
        } else if (s.includes("mla")) {
            styleRules = `STYLE: MLA 9th. IN-TEXT: (Author Year). BIB: Author. "Title." Container, Date, URL.`;
        } else {
            styleRules = `STYLE: APA 7th. IN-TEXT: (Author, Year). BIB: Author. (Year). Title. Site. URL.`;
        }

        return `
            TASK: Insert citations into the text.
            ${styleRules}
            
            SOURCE DATA:
            ${sourceContext}
            
            TEXT: "${context}"
            
            RULES:
            1. **MANDATORY**: Cite every factual claim using source IDs.
            2. **YEAR**: Every in-text citation MUST have a year (e.g. 2024 or n.d.).
            3. **BIBLIOGRAPHY**: Values in "formatted_citations" must be full entries ending with "URL (Accessed ${today})".
            4. **JSON ONLY**: Return valid JSON.
            
            JSON STRUCTURE:
            {
              "insertions": [
                { "anchor": "phrase", "source_id": 1, "citation_text": "(Author Year)" }
              ],
              "formatted_citations": { "1": "Full Bibliography Entry..." }
            }
        `;
    }
};
