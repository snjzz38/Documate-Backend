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
                // Look for "Name and Name" pattern first (most reliable for multi-author)
                const andPattern = /([A-Z][a-z]+(?:\s+[A-Z]\.?\s*)?[A-Z][a-z]+)\s+and\s+([A-Z][a-z]+(?:\s+[A-Z]\.?\s*)?[A-Z][a-z]+)/;
                const andMatch = s.content.match(andPattern);
                
                if (andMatch) {
                    enhancedAuthors.push(andMatch[1].trim());
                    enhancedAuthors.push(andMatch[2].trim());
                } else {
                    // Try "By Name" pattern
                    const byPattern = /(?:By|Author(?:s)?:)\s+([A-Z][a-z]+(?:\s+[A-Z]\.?\s*)?[A-Z][a-z]+)/i;
                    const byMatch = s.content.match(byPattern);
                    
                    if (byMatch) {
                        enhancedAuthors.push(byMatch[1].trim());
                    }
                }
                
                // Remove duplicates and false positives
                enhancedAuthors = [...new Set(enhancedAuthors)].filter(name => 
                    !name.match(/^(Senior|Fellow|Center|Technology|Innovation|Subscribe|Search|Share|Print)/)
                );
                
                if (enhancedAuthors.length > 0) {
                    enhancedAuthor = enhancedAuthors.join(' and ');
                }
            } else {
                // Meta author exists - check if it contains multiple authors
                if (enhancedAuthor.includes(' and ')) {
                    enhancedAuthors = enhancedAuthor.split(' and ').map(a => a.trim());
                } else if (enhancedAuthor.includes(', and ')) {
                    enhancedAuthors = enhancedAuthor.split(/, and |, /).map(a => a.trim());
                } else {
                    enhancedAuthors = [enhancedAuthor];
                }
            }
            
            return `[ID:${s.id}]
TITLE: ${s.title}
URL: ${s.link}
SITE_NAME: ${s.meta.siteName || 'Unknown'}
DETECTED_AUTHOR: ${enhancedAuthor} 
ALL_AUTHORS: ${enhancedAuthors.join(' | ')}
DETECTED_DATE: ${enhancedDate || s.meta.published}
AUTHOR_COUNT: ${enhancedAuthors.length}
TEXT_CONTENT: ${s.content.substring(0, 800).replace(/\n/g, ' ')}...`;
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
        
        // Define strict style templates
        let styleRules = "";
        let styleExamples = "";
        
        if (style.toLowerCase().includes("chicago")) {
            styleRules = `
                STYLE: Chicago Manual of Style (17th Edition) - Notes and Bibliography System
                
                BIBLIOGRAPHY FORMAT (exactly as shown):
                  - 1 author: LastName, FirstName. "Article Title." *Website/Publisher Name*, Month Day, Year. URL.
                  - 2 authors: LastName1, FirstName1, and FirstName2 LastName2. "Article Title." *Website/Publisher Name*, Month Day, Year. URL.
                  - 3+ authors: LastName1, FirstName1, et al. "Article Title." *Website/Publisher Name*, Month Day, Year. URL.
                
                IN-TEXT FORMAT (exactly as shown):
                  - 1 author: (LastName, Year)
                  - 2 authors: (LastName1 and LastName2, Year)
                  - 3+ authors: (LastName1 et al., Year)
                  - No date: (LastName, n.d.)
            `;
            styleExamples = `
                CHICAGO EXAMPLES:
                
                Example 1 (Two Authors):
                - DETECTED_AUTHOR: "Darrell M. West and John R. Allen"
                - ALL_AUTHORS: Darrell M. West | John R. Allen
                - DETECTED_DATE: April 24, 2018
                - citation_text: "(West and Allen, 2018)"
                - formatted_citations: "West, Darrell M., and John R. Allen. \\"How artificial intelligence is transforming the world.\\" *Brookings*, April 24, 2018. https://www.brookings.edu/..."
                
                Example 2 (Single Author):
                - DETECTED_AUTHOR: "Adam Bohr"
                - ALL_AUTHORS: Adam Bohr
                - DETECTED_DATE: 2020
                - citation_text: "(Bohr, 2020)"
                - formatted_citations: "Bohr, Adam. \\"The rise of artificial intelligence in healthcare.\\" *PMC*, 2020. https://pmc.ncbi.nlm.nih.gov/..."
            `;
        } else if (style.toLowerCase().includes("mla")) {
            styleRules = `
                STYLE: MLA 9th Edition
                
                BIBLIOGRAPHY FORMAT:
                  - 1 author: LastName, FirstName. "Article Title." *Container Title*, Date, URL.
                  - 2 authors: LastName1, FirstName1, and FirstName2 LastName2. "Article Title." *Container*, Date, URL.
                  - 3+ authors: LastName1, FirstName1, et al. "Article Title." *Container*, Date, URL.
                
                IN-TEXT FORMAT:
                  - 1 author: (LastName, Year)
                  - 2 authors: (LastName1 and LastName2, Year)
                  - 3+ authors: (LastName1 et al., Year)
            `;
        } else if (style.toLowerCase().includes("apa")) {
            styleRules = `
                STYLE: APA 7th Edition
                
                BIBLIOGRAPHY FORMAT:
                  - 1 author: Author, A. A. (Year). Title of article. *Site Name*. URL
                  - 2 authors: Author1, A. A., & Author2, B. B. (Year). Title. *Site Name*. URL
                  - 3+ authors: Author1, A. A., Author2, B. B., & Author3, C. C. (Year). Title. *Site Name*. URL
                
                IN-TEXT FORMAT:
                  - 1 author: (Author, Year)
                  - 2 authors: (Author1 & Author2, Year)  [Note: use & not "and"]
                  - 3+ authors: (Author1 et al., Year)
            `;
        }

        return `
            TASK: Insert citations into the text using ${style} format.
            ${styleRules}
            ${styleExamples}
            
            SOURCE DATA:
            ${sourceContext}
            
            TEXT TO CITE: "${context}"
            
            CRITICAL INSTRUCTIONS:
            
            1. **MULTIPLE AUTHORS HANDLING - EXTREMELY IMPORTANT**:
               - Look at ALL_AUTHORS field - this shows all authors separated by " | "
               - If ALL_AUTHORS has 2+ entries separated by |, you MUST include ALL of them
               - Extract LAST NAMES ONLY for in-text citations
               - WRONG: Using only first author when multiple exist
               - CORRECT Examples:
                 * ALL_AUTHORS: "Darrell M. West | John R. Allen" → (West and Allen, 2018)
                 * ALL_AUTHORS: "Adib Bin Rashid | Ashfakul Karim Kausik" → (Rashid et al., 2024)
                 * ALL_AUTHORS: "Adam Bohr" → (Bohr, 2020)
            
            2. **IN-TEXT CITATION FORMATTING**:
               - MUST contain year/date whenever available
               - For Chicago: Use "and" between 2 authors, "et al." for 3+
               - For APA: Use "&" between 2 authors, "et al." for 3+
               - EXAMPLES:
                 * Chicago 2 authors: (West and Allen, 2018)
                 * Chicago 3+ authors: (Smith et al., 2024)
                 * APA 2 authors: (West & Allen, 2018)
            
            3. **BIBLIOGRAPHY FORMATTING**:
               - Follow the EXACT format for the selected style
               - Include ALL author names (full names, not et al. unless 3+)
               - Use italics with *asterisks* for publication/website name
               - Include complete URL
               - End with: URL (Accessed ${today})
            
            4. **METADATA EXTRACTION**:
               - Use ALL_AUTHORS field to get all author names
               - If DETECTED_DATE is "n.d.", search TEXT_CONTENT for dates
               - Extract year from dates like "April 24, 2018" → use 2018
            
            5. **URL HANDLING**:
               - NEVER use "[URL]" or "[link]" placeholders
               - ALWAYS use the real URL from the URL field
            
            OUTPUT FORMAT: Return strictly valid JSON.
            {
              "insertions": [
                { "anchor": "exact phrase from text", "source_id": 1, "citation_text": "(Authors, Year)" }
              ],
              "formatted_citations": { 
                "1": "Complete ${style} bibliographic entry with REAL URL (Accessed ${today})"
              }
            }
            
            CRITICAL REMINDER: Check ALL_AUTHORS field for multiple authors! Include ALL authors in citations!
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
                    // Use site name as last resort
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
        
        // Use the actual title from source, not user text
        const title = source.title || "Untitled";
        
        // Default to a generic clean format with REAL URL
        return `${author}. "${title}". ${source.meta.siteName}. ${date}. ${url} (Accessed ${today})`;
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
                // IN-TEXT LOGIC
                let inText = item.citation_text;
                
                // Check if citation_text is also invalid
                if (!inText || inText.length < 3 || inText === '(Author, n.d.)' || inText.includes('Author')) {
                    // Extract author from source
                    let auth = source.meta.author;
                    
                    // Check if it's actually site name, try to get real author
                    const isSiteName = auth === source.meta.siteName || 
                                     (auth && auth.toLowerCase().includes(source.meta.siteName.toLowerCase().replace(/\.(com|org|edu|net)/, '')));
                    
                    if (!auth || auth === "Unknown" || isSiteName) {
                        const authorMatch = source.content.match(/([A-Z][a-z]+)\s+[A-Z]\.?\s+[A-Z][a-z]+\s+and/);
                        auth = authorMatch ? authorMatch[1] : (source.meta.siteName || "Unknown");
                    } else if (auth.includes(' and ')) {
                        // Multiple authors - get first last name
                        auth = auth.split(' and ')[0].split(' ').pop();
                    } else {
                        // Single author - get last name
                        auth = auth.split(' ').pop();
                    }
                    
                    // Extract year from date
                    let yr = "n.d.";
                    if (source.meta.published && source.meta.published !== "n.d.") {
                        yr = source.meta.published.substring(0, 4);
                    } else {
                        // Try to find year in content
                        const yearMatch = source.content.match(/\b(20\d{2})\b/);
                        if (yearMatch) yr = yearMatch[1];
                    }
                    
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
                    
                    // Check for invalid citations
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
                    
                    // Check for invalid citations
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
