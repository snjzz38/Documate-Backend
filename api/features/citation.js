// api/features/citation.js
import { GoogleSearchAPI } from '../utils/googleSearch.js';
import { ScraperAPI } from '../utils/scraper.js';
import { GroqAPI } from '../utils/groqAPI.js';
import { CitationPrompts } from '../utils/prompts.js';

// ==========================================================================
// PIPELINE SERVICE
// ==========================================================================
const PipelineService = {
    ensureAccessDate(text) {
        if (!text) return "";
        const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
        if (text.includes("Accessed")) return text;
        return `${text} (Accessed ${today})`;
    },

    extractYear(source) {
        let year = "n.d.";
        if (source.meta?.published && source.meta.published !== "n.d.") {
            const yearMatch = source.meta.published.match(/\b(20\d{2})\b/);
            if (yearMatch) return yearMatch[1];
        }
        if (source.content) {
            const contentYearMatch = source.content.match(/\b(20\d{2})\b/);
            if (contentYearMatch) return contentYearMatch[1];
        }
        return year;
    },

    getSiteName(source) {
        return source.meta?.siteName || source.title.split(/[:\-–|]/).shift().trim() || "Unknown Source";
    },

    validateCitationText(citationText, source, style) {
        if (!citationText) return null;
        
        // Fix "Unknown" author issue - replace with site name
        if (citationText.includes("Unknown")) {
            const siteName = this.getSiteName(source);
            citationText = citationText.replace(/Unknown/g, siteName);
        }
        
        const year = this.extractYear(source);
        const hasYear = /\d{4}|n\.d\./i.test(citationText);
        
        // Ensure year is always present
        if (!hasYear) {
            const match = citationText.match(/^\((.*?)\)$/);
            if (match) {
                const authorPart = match[1];
                const s = (style || "").toLowerCase();
                if (s.includes('chicago')) return `(${authorPart} ${year})`;
                if (s.includes('apa')) return `(${authorPart}, ${year})`;
                return `(${authorPart} ${year})`;
            }
        }
        
        return citationText;
    },

    generateFallback(source) {
        const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
        
        let author = source.meta?.author;
        const site = this.getSiteName(source);
        
        // Check if author is just the site name
        const isSiteName = author && (
            author === site || 
            author.toLowerCase().includes(site.toLowerCase().replace(/\.(com|org|edu|net)/, ''))
        );
        
        if (!author || author === "Unknown" || isSiteName) {
            // Try to extract author from content
            const authorMatch = source.content?.match(/([A-Z][a-z]+\s+[A-Z]\.?\s+[A-Z][a-z]+)\s+and\s+([A-Z][a-z]+\s+[A-Z]\.?\s+[A-Z][a-z]+)/);
            if (authorMatch) {
                author = `${authorMatch[1]} and ${authorMatch[2]}`;
            } else {
                const singleAuthor = source.content?.match(/(?:By|Author:)\s+([A-Z][a-z]+\s+[A-Z]\.?\s+[A-Z][a-z]+)/);
                author = singleAuthor ? singleAuthor[1] : site;
            }
        }
        
        const date = this.extractYear(source);
        return `${author}. "${source.title}". ${site}. ${date}. ${source.link} (Accessed ${today})`;
    },

    processInsertions(context, insertions, sources, formattedMap, outputType, style) {
        let resultText = context;
        let footnoteCounter = 1;
        let usedSourceIds = new Set();
        let footnotesList = [];

        // Tokenize text for anchor matching
        const tokens = [];
        const tokenRegex = /[a-z0-9]+/gi;
        let match;
        while ((match = tokenRegex.exec(context)) !== null) {
            tokens.push({ word: match[0].toLowerCase(), start: match.index, end: match.index + match[0].length });
        }

        // Process and validate insertions
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
            .filter(Boolean);

        // =======================================================
        // DEDUPLICATION: Remove duplicate citations at same position
        // =======================================================
        const seenPositions = new Map(); // position -> Set of source_ids
        const deduplicatedInsertions = [];

        for (const item of validInsertions) {
            const pos = item.insertIndex;
            const srcId = item.source_id;

            if (!seenPositions.has(pos)) {
                seenPositions.set(pos, new Set());
            }

            // Skip if this source was already cited at this position
            if (seenPositions.get(pos).has(srcId)) {
                continue;
            }

            // Skip if there are already 2+ citations at this position
            if (seenPositions.get(pos).size >= 2) {
                continue;
            }

            seenPositions.get(pos).add(srcId);
            deduplicatedInsertions.push(item);
        }

        // =======================================================
        // SPREAD: Ensure citations are distributed, not clustered
        // =======================================================
        const MIN_DISTANCE = 50; // Minimum characters between citation positions
        const spreadInsertions = [];
        let lastPosition = -MIN_DISTANCE;

        // Sort by position first
        deduplicatedInsertions.sort((a, b) => a.insertIndex - b.insertIndex);

        for (const item of deduplicatedInsertions) {
            // If too close to last citation, check if it's a different source
            if (item.insertIndex - lastPosition < MIN_DISTANCE) {
                // Allow if it's at the exact same position (will be combined)
                // But skip if it's just slightly offset (clustering)
                if (item.insertIndex !== lastPosition) {
                    continue;
                }
            }
            spreadInsertions.push(item);
            lastPosition = item.insertIndex;
        }

        // Sort descending for insertion (preserve indices)
        spreadInsertions.sort((a, b) => b.insertIndex - a.insertIndex);

        // =======================================================
        // GROUP: Combine citations at same position
        // =======================================================
        const groupedByPosition = new Map();
        for (const item of spreadInsertions) {
            const pos = item.insertIndex;
            if (!groupedByPosition.has(pos)) {
                groupedByPosition.set(pos, []);
            }
            groupedByPosition.get(pos).push(item);
        }

        // Process grouped insertions (sorted by position descending)
        const sortedPositions = [...groupedByPosition.keys()].sort((a, b) => b - a);

        for (const pos of sortedPositions) {
            const items = groupedByPosition.get(pos);
            
            let insertContent = "";

            if (outputType === 'footnotes') {
                // For footnotes: each source gets ONE footnote number at this position
                const footnoteNumbers = [];
                
                for (const item of items) {
                    const source = sources.find(s => s.id === item.source_id);
                    if (!source) continue;

                    usedSourceIds.add(source.id);

                    let citString = formattedMap[source.id];
                    const isInvalid = !citString || citString.length < 10 || citString.includes('[URL]');
                    if (isInvalid) {
                        citString = this.generateFallback(source);
                    }
                    citString = this.ensureAccessDate(citString);

                    footnoteNumbers.push(footnoteCounter);
                    footnotesList.push(`${footnoteCounter}. ${citString}`);
                    footnoteCounter++;
                }

                // Convert to superscript
                const superscripts = {'0':'⁰','1':'¹','2':'²','3':'³','4':'⁴','5':'⁵','6':'⁶','7':'⁷','8':'⁸','9':'⁹'};
                insertContent = footnoteNumbers.map(n => 
                    n.toString().split('').map(d => superscripts[d] || '').join('')
                ).join(''); // No comma, just concatenate like ¹²

            } else {
                // For in-text: combine citations
                const citations = [];
                
                for (const item of items) {
                    const source = sources.find(s => s.id === item.source_id);
                    if (!source) continue;

                    usedSourceIds.add(source.id);

                    let inText = item.citation_text;
                    inText = this.validateCitationText(inText, source, style);
                    
                    if (!inText || inText.length < 3) {
                        const auth = source.meta?.author !== "Unknown" ? source.meta?.author?.split(' ')[0] : this.getSiteName(source);
                        const yr = this.extractYear(source);
                        inText = `(${auth} ${yr})`;
                    }
                    
                    // Remove parentheses for combining
                    const inner = inText.replace(/^\(|\)$/g, '');
                    citations.push(inner);
                }

                // Combine: (Author1 2020; Author2 2021)
                if (citations.length > 0) {
                    insertContent = ` (${citations.join('; ')})`;
                }
            }

            if (insertContent) {
                resultText = resultText.substring(0, pos) + insertContent + resultText.substring(pos);
            }
        }

        // Build footer
        let footer = "";
        
        if (outputType === 'footnotes') {
            footer += "\n\n### Footnotes (Used)\n" + footnotesList.join('\n\n');
        } else {
            footer += "\n\n### References Cited (Used)\n";
            sources.forEach(s => {
                if (usedSourceIds.has(s.id)) {
                    let cit = formattedMap[s.id] || this.generateFallback(s);
                    footer += this.ensureAccessDate(cit) + "\n\n";
                }
            });
        }

        // Unused sources
        if (usedSourceIds.size < sources.length) {
            footer += "\n\n### Further Reading (Unused)\n";
            sources.forEach(s => {
                if (!usedSourceIds.has(s.id)) {
                    let cit = formattedMap[s.id] || this.generateFallback(s);
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

        // --- 1. QUOTES MODE ---
        if (preLoadedSources?.length > 0) {
            const prompt = CitationPrompts.build('quotes', null, context, preLoadedSources);
            const result = await GroqAPI.chat([{ role: "user", content: prompt }], GROQ_KEY, false);
            return res.status(200).json({ success: true, text: result });
        }

        // --- 2. SEARCH & SCRAPE (with AI keyword extraction) ---
        const rawSources = await GoogleSearchAPI.search(context, SEARCH_KEY, SEARCH_CX, GROQ_KEY);
        const richSources = await ScraperAPI.scrape(rawSources);
        
        // --- 3. BIBLIOGRAPHY MODE ---
        if (outputType === 'bibliography') {
            const prompt = CitationPrompts.build('bibliography', style, context, richSources);
            const result = await GroqAPI.chat([{ role: "user", content: prompt }], GROQ_KEY, false);
            const cleaned = result.replace(/```json/g, '').replace(/```/g, '').trim();
            return res.status(200).json({ success: true, sources: richSources, text: cleaned });
        }

        // --- 4. TWO-STEP CITATION PROCESS ---
        
        // STEP 1: Generate formatted citations for all sources
        const step1Prompt = CitationPrompts.buildStep1(style, richSources);
        const step1Response = await GroqAPI.chat([{ role: "user", content: step1Prompt }], GROQ_KEY, true);
        
        let formattedCitations = {};
        try {
            const jsonMatch = step1Response.match(/\{[\s\S]*\}/);
            const jsonStr = jsonMatch ? jsonMatch[0] : step1Response;
            formattedCitations = JSON.parse(jsonStr);
        } catch (e) {
            // Fallback: generate citations manually
            richSources.forEach(s => {
                formattedCitations[s.id] = PipelineService.generateFallback(s);
            });
        }

        // STEP 2: Generate insertion points
        const step2Prompt = CitationPrompts.buildStep2(outputType, style, context, richSources, formattedCitations);
        const step2Response = await GroqAPI.chat([{ role: "user", content: step2Prompt }], GROQ_KEY, true);

        let finalOutput = "";
        try {
            const jsonMatch = step2Response.match(/\{[\s\S]*\}/);
            const jsonStr = jsonMatch ? jsonMatch[0] : step2Response;
            const data = JSON.parse(jsonStr);
            finalOutput = PipelineService.processInsertions(context, data.insertions, richSources, formattedCitations, outputType, style);
        } catch (e) {
            finalOutput = step2Response.replace(/```json/g, '').replace(/```/g, '');
        }

        return res.status(200).json({ success: true, sources: richSources, text: finalOutput });

    } catch (error) {
        console.error("Citation Error:", error);
        return res.status(500).json({ success: false, error: error.message });
    }
}
