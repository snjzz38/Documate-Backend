// api/features/citation.js
import { GoogleSearchAPI } from '../utils/googleSearch.js';
import { ScraperAPI } from '../utils/scraper.js';
import { GroqAPI } from '../utils/groqAPI.js';

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
