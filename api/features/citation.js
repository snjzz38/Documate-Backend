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

    /**
     * Fix truncated URLs in quotes output
     * Replaces short URLs (just domain) with full URLs from source data
     */
    fixQuoteUrls(text, sources) {
        let fixed = text;
        
        for (const source of sources) {
            if (!source.link) continue;
            
            try {
                const url = new URL(source.link);
                const domain = url.hostname.replace('www.', '');
                
                // Pattern 1: Just the domain (e.g., "https://plato.stanford.edu" or "plato.stanford.edu")
                const domainOnlyPattern = new RegExp(
                    `(https?://)?(www\\.)?${domain.replace(/\./g, '\\.')}(?![\\w/\\-])`,
                    'gi'
                );
                
                // Pattern 2: Domain with just a slash (e.g., "https://plato.stanford.edu/")
                const domainSlashPattern = new RegExp(
                    `(https?://)?(www\\.)?${domain.replace(/\./g, '\\.')}/?(?![\\w\\-])`,
                    'gi'
                );
                
                // Only replace if the full URL is different from just the domain
                if (source.link !== `https://${domain}` && source.link !== `https://${domain}/`) {
                    // Replace domain-only URLs with full URL
                    fixed = fixed.replace(domainOnlyPattern, source.link);
                    fixed = fixed.replace(domainSlashPattern, source.link);
                }
                
                // Pattern 3: Title pattern - match "[ID:X] Title - short_url" format
                // Look for the source title and fix URL after it
                const titleEscaped = source.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').substring(0, 50);
                const titlePattern = new RegExp(
                    `(\\*\\*\\[${source.id}\\][^*]+\\*\\*\\s*-\\s*)(https?://[^\\s\\n]+|${domain.replace(/\./g, '\\.')}[^\\s\\n]*)`,
                    'gi'
                );
                
                fixed = fixed.replace(titlePattern, `$1${source.link}`);
                
            } catch (e) {
                // Invalid URL, skip
            }
        }
        
        return fixed;
    },

    /**
     * Fix quote URLs - replace short domain URLs with full URLs from sources
     * This handles when AI outputs "https://plato.stanford.edu" instead of full path
     */
    fixQuoteUrls(text, sources) {
        let result = text;
        
        for (const source of sources) {
            if (!source.link) continue;
            
            try {
                const url = new URL(source.link);
                const domain = url.hostname.replace('www.', '');
                
                // Pattern 1: Just domain (https://domain.com or domain.com)
                const domainOnlyPatterns = [
                    new RegExp(`https?://(www\\.)?${domain.replace('.', '\\.')}(?![\\w/])`, 'gi'),
                    new RegExp(`- ${domain.replace('.', '\\.')}(?:\\s|$)`, 'gi')
                ];
                
                for (const pattern of domainOnlyPatterns) {
                    result = result.replace(pattern, (match) => {
                        // If it's "- domain.com", replace with "- fullurl"
                        if (match.startsWith('-')) {
                            return `- ${source.link}`;
                        }
                        return source.link;
                    });
                }
                
                // Pattern 2: Match by [ID:X] and ensure URL follows
                const idPattern = new RegExp(`\\[ID:${source.id}\\][^\\n]*?(?:https?://[^\\s]+|${domain.replace('.', '\\.')})`, 'gi');
                result = result.replace(idPattern, (match) => {
                    // If the full URL is already there, keep it
                    if (match.includes(source.link)) return match;
                    // Otherwise replace domain-only with full URL
                    return match.replace(new RegExp(`https?://(www\\.)?${domain.replace('.', '\\.')}[^\\s]*`, 'i'), source.link)
                                .replace(new RegExp(`${domain.replace('.', '\\.')}`, 'i'), source.link);
                });
                
            } catch (e) {
                // Invalid URL, skip
            }
        }
        
        return result;
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
        let usedSourceIds = new Set();

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
        const seenPositions = new Map();
        const deduplicatedInsertions = [];

        for (const item of validInsertions) {
            const pos = item.insertIndex;
            const srcId = item.source_id;

            if (!seenPositions.has(pos)) {
                seenPositions.set(pos, new Set());
            }

            if (seenPositions.get(pos).has(srcId)) continue;
            if (seenPositions.get(pos).size >= 2) continue;

            seenPositions.get(pos).add(srcId);
            deduplicatedInsertions.push(item);
        }

        // =======================================================
        // SPREAD: Ensure citations are distributed, not clustered
        // =======================================================
        const MIN_DISTANCE = 50;
        const spreadInsertions = [];
        let lastPosition = -MIN_DISTANCE;

        deduplicatedInsertions.sort((a, b) => a.insertIndex - b.insertIndex);

        for (const item of deduplicatedInsertions) {
            if (item.insertIndex - lastPosition < MIN_DISTANCE) {
                if (item.insertIndex !== lastPosition) continue;
            }
            spreadInsertions.push(item);
            lastPosition = item.insertIndex;
        }

        // =======================================================
        // FOOTNOTES: Sequential numbering based on text order
        // =======================================================
        if (outputType === 'footnotes') {
            // CRITICAL: Sort by position ASCENDING so first citation = footnote 1
            spreadInsertions.sort((a, b) => a.insertIndex - b.insertIndex);
            
            // Assign sequential footnote numbers (1, 2, 3...) in TEXT ORDER
            let footnoteNumber = 1;
            const footnoteAssignments = [];
            
            for (const item of spreadInsertions) {
                const source = sources.find(s => s.id === item.source_id);
                if (!source) continue;
                
                usedSourceIds.add(source.id);
                
                let citString = formattedMap[source.id];
                const isInvalid = !citString || citString.length < 10 || citString.includes('[URL]');
                if (isInvalid) {
                    citString = this.generateFallback(source);
                }
                citString = this.ensureAccessDate(citString);
                
                footnoteAssignments.push({
                    position: item.insertIndex,
                    sourceId: source.id,
                    footnoteNum: footnoteNumber,
                    citString: citString
                });
                
                footnoteNumber++;
            }
            
            // Convert numbers to superscripts
            const superscripts = {'0':'⁰','1':'¹','2':'²','3':'³','4':'⁴','5':'⁵','6':'⁶','7':'⁷','8':'⁸','9':'⁹'};
            
            // Insert superscripts in REVERSE position order (to preserve string indices)
            // But the footnote NUMBERS stay as assigned (1, 2, 3...)
            const sortedByPositionDesc = [...footnoteAssignments].sort((a, b) => b.position - a.position);
            
            for (const fa of sortedByPositionDesc) {
                const superscript = fa.footnoteNum.toString().split('').map(d => superscripts[d] || '').join('');
                resultText = resultText.substring(0, fa.position) + superscript + resultText.substring(fa.position);
            }
            
            // Build footnotes list in SEQUENTIAL order (1, 2, 3...)
            // This matches the order they appear in the text
            footnoteAssignments.sort((a, b) => a.footnoteNum - b.footnoteNum);
            
            let footer = "\n\n### Footnotes (Used)\n\n";
            for (const fa of footnoteAssignments) {
                footer += `${fa.footnoteNum}. ${fa.citString}\n\n`;
            }
            
            // Unused sources
            if (usedSourceIds.size < sources.length) {
                footer += "\n### Further Reading (Unused)\n\n";
                sources.forEach(s => {
                    if (!usedSourceIds.has(s.id)) {
                        let cit = formattedMap[s.id] || this.generateFallback(s);
                        footer += this.ensureAccessDate(cit) + "\n\n";
                    }
                });
            }
            
            return resultText + footer;
        }
        
        // =======================================================
        // IN-TEXT CITATIONS (non-footnotes)
        // =======================================================
        spreadInsertions.sort((a, b) => b.insertIndex - a.insertIndex);
        
        const byPosition = new Map();
        for (const item of spreadInsertions) {
            if (!byPosition.has(item.insertIndex)) {
                byPosition.set(item.insertIndex, []);
            }
            byPosition.get(item.insertIndex).push(item);
        }
        
        const positions = [...byPosition.keys()].sort((a, b) => b - a);
        
        for (const pos of positions) {
            const items = byPosition.get(pos);
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
                
                const inner = inText.replace(/^\(|\)$/g, '');
                citations.push(inner);
            }
            
            if (citations.length > 0) {
                const insertContent = ` (${citations.join('; ')})`;
                resultText = resultText.substring(0, pos) + insertContent + resultText.substring(pos);
            }
        }
        
        // Build footer for in-text
        let footer = "\n\n### References Cited (Used)\n\n";
        sources.forEach(s => {
            if (usedSourceIds.has(s.id)) {
                let cit = formattedMap[s.id] || this.generateFallback(s);
                footer += this.ensureAccessDate(cit) + "\n\n";
            }
        });
        
        if (usedSourceIds.size < sources.length) {
            footer += "\n### Further Reading (Unused)\n\n";
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
            let result = await GroqAPI.chat([{ role: "user", content: prompt }], GROQ_KEY, false);
            
            // POST-PROCESS: Replace short URLs with full URLs from sources
            result = PipelineService.fixQuoteUrls(result, preLoadedSources);
            
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
