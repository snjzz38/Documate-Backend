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
                // Look for date patterns in the content
                const datePatterns = [
                    /(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}/i,
                    /\b(20\d{2})\b/,  // Years 2000-2099
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
            
            // Pre-extract ALL authors from content - IMPROVED LOGIC
            let enhancedAuthors = [];
            let enhancedAuthor = s.meta.author;
            
            // Check if meta author is just the site name (like "Brookings")
            const isSiteName = s.meta.author && (
                s.meta.author === s.meta.siteName || 
                s.meta.author.toLowerCase().includes(s.meta.siteName.toLowerCase().replace(/\.(com|org|edu|net)/, ''))
            );
            
            if (!s.meta.author || s.meta.author === "Unknown" || isSiteName) {
                // Look for actual author names in content
                const authorPatterns = [
                    // Pattern for "Name and Name" format (like "Darrell M. West and John R. Allen")
                    /([A-Z][a-z]+(?:\s+[A-Z]\.?\s*)?[A-Z][a-z]+)\s+and\s+([A-Z][a-z]+(?:\s+[A-Z]\.?\s*)?[A-Z][a-z]+)/g,
                    // Pattern for "By Name" or "Author: Name"
                    /(?:By|Author(?:s)?:)\s+([A-Z][a-z]+(?:\s+[A-Z]\.?\s*)?[A-Z][a-z]+)/gi,
                    // Pattern for standalone proper names near the beginning
                    /^.{0,500}([A-Z][a-z]+\s+[A-Z]\.?\s+[A-Z][a-z]+)/
                ];
                
                for (const pattern of authorPatterns) {
                    const matches = [...s.content.matchAll(pattern)];
                    if (matches.length > 0) {
                        matches.forEach(match => {
                            if (match[1]) enhancedAuthors.push(match[1].trim());
                            if (match[2]) enhancedAuthors.push(match[2].trim());
                        });
                        if (enhancedAuthors.length > 0) break;
                    }
                }
                
                // Remove duplicates and common false positives
                enhancedAuthors = [...new Set(enhancedAuthors)].filter(name => 
                    !name.match(/^(Senior|Fellow|Center|Technology|Innovation|Subscribe|Search|Share|Print)/)
                );
                
                if (enhancedAuthors.length > 0) {
                    enhancedAuthor = enhancedAuthors.join(' and ');
                }
            }
            
            return `[ID:${s.id}]
TITLE: ${s.title}
URL: ${s.link}
SITE_NAME: ${s.meta.siteName || 'Unknown'}
DETECTED_AUTHOR: ${enhancedAuthor} 
DETECTED_DATE: ${enhancedDate || s.meta.published}
AUTHOR_COUNT: ${enhancedAuthors.length || (enhancedAuthor && enhancedAuthor !== "Unknown" && !isSiteName ? 1 : 0)}
TEXT_CONTENT: ${s.content.substring(0, 600).replace(/\n/g, ' ')}...`;
        }).join('\n\n---\n\n');

        // --- 1. QUOTES ---
        if (type === 'quotes') {
            return `
                TASK: Extract quotes. CONTEXT: "${context.substring(0, 300)}..."
                SOURCES:\n${sourceContext}
                RULES: Output strictly in order ID 1 to ${sources.length}. Format: **[ID] Title** - URL \n > "Quote..."
            `;
        }

        // --- 2. CITATIONS ---
        
        // Define strict style templates to prevent MLA/Chicago mix-ups
        let styleRules = "";
        if (style.toLowerCase().includes("chicago")) {
            styleRules = `
                STYLE: Chicago Manual of Style (Notes & Bibliography).
                BIBLIOGRAPHY FORMAT: 
                  - 1 author: Author Last, First. "Title." *Publisher*, Date. URL.
                  - 2 authors: Author1 Last, First, and Author2 First Last. "Title." *Publisher*, Date. URL.
                  - 3+ authors: Author1 Last, First, et al. "Title." *Publisher*, Date. URL.
                IN-TEXT FORMAT: 
                  - 1 author: (Author, Year)
                  - 2 authors: (Author1 and Author2, Year)
                  - 3+ authors: (Author1 et al., Year)
            `;
        } else if (style.toLowerCase().includes("mla")) {
            styleRules = `
                STYLE: MLA 9th Edition.
                BIBLIOGRAPHY FORMAT:
                  - 1 author: Author Last, First. "Title." *Container*, Date, URL.
                  - 2 authors: Author1 Last, First, and Author2 First Last. "Title." *Container*, Date, URL.
                  - 3+ authors: Author1 Last, First, et al. "Title." *Container*, Date, URL.
                IN-TEXT FORMAT:
                  - 1 author: (Author, Year)
                  - 2 authors: (Author1 and Author2, Year)
                  - 3+ authors: (Author1 et al., Year)
            `;
        } else if (style.toLowerCase().includes("apa")) {
            styleRules = `
                STYLE: APA 7th Edition.
                BIBLIOGRAPHY FORMAT:
                  - 1 author: Author, A. A. (Year). Title. *Site Name*. URL
                  - 2 authors: Author1, A. A., & Author2, B. B. (Year). Title. *Site Name*. URL
                  - 3+ authors: Author1, A. A., Author2, B. B., & Author3, C. C. (Year). Title. *Site Name*. URL
                IN-TEXT FORMAT:
                  - 1 author: (Author, Year)
                  - 2 authors: (Author1 & Author2, Year)
                  - 3+ authors: (Author1 et al., Year)
            `;
        }

        return `
            TASK: Insert citations into the text.
            ${styleRules}
            
            SOURCE DATA:
            ${sourceContext}
            
            TEXT TO CITE: "${context}"
            
            CRITICAL INSTRUCTIONS:
            
            1. **MULTIPLE AUTHORS HANDLING**:
               - Check DETECTED_AUTHOR field carefully
               - If it contains " and " (e.g., "Darrell M. West and John R. Allen"), this is TWO authors
               - Extract LAST NAMES ONLY for in-text citations
               - Examples:
                 * "Darrell M. West and John R. Allen" → (West and Allen, Year)
                 * "John Smith, Jane Doe, and Bob Lee" → (Smith et al., Year)
                 * "Mary Johnson" → (Johnson, Year)
               - For APA style with 2 authors, use "&" instead of "and": (West & Allen, Year)
            
            2. **IN-TEXT CITATION FORMATTING**:
               - The "citation_text" field MUST contain the Date whenever possible
               - CORRECT: (West and Allen, 2018)
               - CORRECT: (Smith et al., 2024)
               - CORRECT: (Johnson, 2024)
               - ONLY IF NO DATE FOUND: (Author, n.d.)
               - WRONG: (West, 2018) when Allen is also an author
               - WRONG: Missing date when date is available
            
            3. **METADATA FORENSICS**:
               Step A - Author Extraction:
                 - If DETECTED_AUTHOR contains " and ", this means MULTIPLE authors
                 - Look in TEXT_CONTENT for author names near the beginning
                 - Common patterns: "Name and Name", "By Name", "Author: Name"
                 - Ignore site names (like "Brookings") unless no real author is found
               
               Step B - Date Extraction:
                 - If DETECTED_DATE is "n.d.", search TEXT_CONTENT for dates
                 - Look for: "April 24, 2018", "2018", "January 2024", etc.
                 - Extract the YEAR and use it
                 - If you find a date, DO NOT use "n.d."
               
               Step C - Verification:
                 - Double-check AUTHOR_COUNT to ensure you have all authors
                 - Verify the extracted date makes sense (2000-2026 range)
            
            4. **URL HANDLING - EXTREMELY IMPORTANT**:
               - NEVER use placeholder text like "[URL]", "[link]", or "URL"
               - ALWAYS use the ACTUAL URL from the URL field
               - The formatted citation MUST include the complete, real URL
               - Example: https://www.brookings.edu/articles/how-artificial-intelligence-is-transforming-the-world/
            
            5. **FORMATTED CITATIONS REQUIREMENTS**:
               - Include the COMPLETE bibliographic entry with ALL authors
               - Use the REAL URL, not a placeholder
               - End with: "URL (Accessed ${today})"
               - Example: "West, Darrell M., and John R. Allen. 'How artificial intelligence is transforming the world.' Brookings, April 24, 2018. https://www.brookings.edu/articles/... (Accessed ${today})"
            
            6. **EXAMPLE - Brookings Article**:
               Given:
               - DETECTED_AUTHOR: "Darrell M. West and John R. Allen"
               - DETECTED_DATE: "April 24, 2018"
               - URL: https://www.brookings.edu/articles/how-artificial-intelligence-is-transforming-the-world/
               
               Output:
               - citation_text: "(West and Allen, 2018)"
               - formatted_citations: "West, Darrell M., and John R. Allen. 'How artificial intelligence is transforming the world.' Brookings, April 24, 2018. https://www.brookings.edu/articles/how-artificial-intelligence-is-transforming-the-world/ (Accessed ${today})"
            
            OUTPUT FORMAT: Return strictly valid JSON with NO placeholders.
            {
              "insertions": [
                { "anchor": "exact phrase from text", "source_id": 1, "citation_text": "(Author(s), Year)" }
              ],
              "formatted_citations": { 
                "1": "Complete bibliographic entry with REAL URL (Accessed ${today})"
              }
            }
            
            REMEMBER: Use REAL URLs from the URL field, not placeholders!
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
            // Try to find author in content
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
            // Try to find date in content
            const dateMatch = source.content.match(/(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}/);
            if (dateMatch) {
                date = dateMatch[0];
            } else {
                const yearMatch = source.content.match(/\b(20\d{2})\b/);
                date = yearMatch ? yearMatch[1] : "n.d.";
            }
        }

        // Use actual URL, not placeholder
        const url = source.link;
        
        // Default to a generic clean format with REAL URL
        return `${author}. "${source.title}". ${source.meta.siteName}. ${date}. ${url} (Accessed ${today})`;
    },

    processInsertions(context, insertions, sources, formattedMap, outputType) {
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
            
            // Validation: If AI returned a lazy citation OR contains [URL] placeholder, overwrite it
            if (!citString || citString.length < 10 || citString.includes('[URL]') || citString.includes('[link]')) {
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
                // IN-TEXT LOGIC
                let inText = item.citation_text;
                if (!inText || inText.length < 3) {
                    // Extract author from source
                    let auth = source.meta.author !== "Unknown" ? source.meta.author : "Unknown";
                    
                    // Check if it's actually site name, try to get real author
                    if (auth === source.meta.siteName) {
                        const authorMatch = source.content.match(/([A-Z][a-z]+)\s+[A-Z]\.?\s+[A-Z][a-z]+\s+and/);
                        auth = authorMatch ? authorMatch[1] : source.meta.siteName;
                    } else if (auth.includes(' and ')) {
                        // Multiple authors - get first last name
                        auth = auth.split(' and ')[0].split(' ').pop();
                    } else if (auth !== "Unknown") {
                        // Single author - get last name
                        auth = auth.split(' ').pop();
                    }
                    
                    const yr = source.meta.published !== "n.d." ? source.meta.published.substring(0,4) : "n.d.";
                    inText = `(${auth}, ${yr})`;
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
                    // Double-check for URL placeholders
                    if (cit.includes('[URL]') || cit.includes('[link]')) {
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
                    // Double-check for URL placeholders
                    if (cit.includes('[URL]') || cit.includes('[link]')) {
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
                finalOutput = PipelineService.processInsertions(context, data.insertions, richSources, data.formatted_citations, outputType);
            } catch (e) {
                finalOutput = aiResponse.replace(/```json/g, '').replace(/```/g, '');
            }
        }

        return res.status(200).json({ success: true, sources: richSources, text: finalOutput });

    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
}
