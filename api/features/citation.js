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
            
            // Pre-extract ALL authors from content
            let enhancedAuthors = [];
            let enhancedAuthor = s.meta.author;
            
            const isSiteName = s.meta.author && (
                s.meta.author === s.meta.siteName || 
                s.meta.author.toLowerCase().includes(s.meta.siteName.toLowerCase().replace(/\.(com|org|edu|net)/, ''))
            );
            
            if (!s.meta.author || s.meta.author === "Unknown" || isSiteName) {
                // Search for authors in content - look for multiple patterns
                
                // Pattern 1: "Name and Name" at start
                const andPattern = /^.{0,300}([A-Z][a-z]+(?:\s+[A-Z]\.?\s*)?[A-Z][a-z]+)\s+and\s+([A-Z][a-z]+(?:\s+[A-Z]\.?\s*)?[A-Z][a-z]+)/;
                const andMatch = s.content.match(andPattern);
                
                if (andMatch) {
                    enhancedAuthors.push(andMatch[1].trim());
                    enhancedAuthors.push(andMatch[2].trim());
                }
                
                // Pattern 2: Look for "By Name, Name" format
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
                    // Try comma-separated
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
                doi = doi.replace(/[.,;]+$/, ''); // Remove trailing punctuation
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
TEXT_CONTENT: ${s.content.substring(0, 1000).replace(/\n/g, ' ')}...`;
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
        
        let styleRules = "";
        let styleExamples = "";
        
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
                  - No date: (LastName n.d.)
                  
                CRITICAL: NO COMMA between author and year in Chicago in-text citations!
            `;
            styleExamples = `
                CHICAGO EXAMPLES:
                
                Example 1 (Two Authors with DOI):
                - ALL_AUTHORS: "Adam Bohr | Kaveh Memarzadeh"
                - DETECTED_DATE: "2020"
                - DOI: "10.1016/B978-0-12-818438-7.00002-2"
                - citation_text: "(Bohr and Memarzadeh 2020)"
                - formatted_citations: "Bohr, Adam, and Kaveh Memarzadeh. \\"The Rise of Artificial Intelligence in Healthcare Applications.\\" *Artificial Intelligence in Healthcare* 1, no. 1 (2020): 25–60. https://doi.org/10.1016/B978-0-12-818438-7.00002-2."
                
                Example 2 (Two Authors, Web Article):
                - ALL_AUTHORS: "Darrell M. West | John R. Allen"
                - DETECTED_DATE: "April 24, 2018"
                - DOI: "none"
                - citation_text: "(West and Allen 2018)"
                - formatted_citations: "West, Darrell M., and John R. Allen. \\"How Artificial Intelligence Is Transforming the World.\\" *Brookings*. April 24, 2018. https://www.brookings.edu/articles/how-artificial-intelligence-is-transforming-the-world/."
                
                Example 3 (Multiple Authors):
                - ALL_AUTHORS: "Adib Bin Rashid | Ashfakul Karim Kausik | Another Author"
                - DETECTED_DATE: "2024"
                - citation_text: "(Rashid et al. 2024)"
                - formatted_citations: "Rashid, Adib Bin, et al. \\"AI Revolutionizing Industries Worldwide.\\" *ScienceDirect*. 2024. https://www.sciencedirect.com/..."
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
            `;
        } else if (style.toLowerCase().includes("apa")) {
            styleRules = `
                STYLE: APA 7th Edition
                
                BIBLIOGRAPHY FORMAT:
                  - 1 author: Author, A. A. (Year). Title of article. *Site Name*. URL or https://doi.org/DOI
                  - 2 authors: Author1, A. A., & Author2, B. B. (Year). Title. *Site Name*. URL
                  - 3+ authors: Author1, A. A., Author2, B. B., & Author3, C. C. (Year). Title. *Site Name*. URL
                
                IN-TEXT FORMAT:
                  - 1 author: (Author, Year)
                  - 2 authors: (Author1 & Author2, Year)
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
            
            1. **MULTIPLE AUTHORS - READ ALL_AUTHORS FIELD**:
               - The ALL_AUTHORS field shows ALL authors separated by " | "
               - Count the separators: "Author1 | Author2" = 2 authors (NOT 1!)
               - You MUST include ALL authors listed in ALL_AUTHORS field
               - WRONG: Using only first author when multiple exist
               - EXAMPLES:
                 * ALL_AUTHORS: "Adam Bohr | Kaveh Memarzadeh" → 2 AUTHORS → (Bohr and Memarzadeh 2020)
                 * ALL_AUTHORS: "Darrell M. West | John R. Allen" → 2 AUTHORS → (West and Allen 2018)
                 * ALL_AUTHORS: "Adib Bin Rashid | Ashfakul Karim Kausik | Third Author" → 3+ AUTHORS → (Rashid et al. 2024)
                 * ALL_AUTHORS: "Adam Bohr" → 1 AUTHOR → (Bohr 2020)
            
            2. **IN-TEXT CITATION FORMAT**:
               - Chicago: NO COMMA between author and year: (West and Allen 2018) NOT (West and Allen, 2018)
               - Always include year when available
               - Use "and" for 2 authors (Chicago/MLA), "&" for APA
               - Use "et al." for 3+ authors
            
            3. **BIBLIOGRAPHY FORMAT**:
               - Follow the EXACT format shown in examples
               - Include ALL author full names (unless 3+, then use et al.)
               - Check DOI field - if DOI exists, use https://doi.org/DOI instead of URL
               - Use proper punctuation and italics
               - DO NOT add "(Accessed Date)" for Chicago format - it's not standard
            
            4. **METADATA EXTRACTION**:
               - Count authors in ALL_AUTHORS by counting "|" separators
               - Extract year from DETECTED_DATE
               - Check DOI field for DOI availability
            
            5. **URL/DOI HANDLING**:
               - If DOI exists and is not "none", use: https://doi.org/[DOI]
               - If DOI is "none", use the regular URL
               - NEVER use placeholders like "[URL]"
            
            OUTPUT FORMAT: Return strictly valid JSON.
            {
              "insertions": [
                { "anchor": "exact phrase", "source_id": 1, "citation_text": "(Authors Year)" }
              ],
              "formatted_citations": { 
                "1": "Complete Chicago bibliography entry."
              }
            }
            
            VERIFY: Before outputting, check that ALL authors from ALL_AUTHORS are included!
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
