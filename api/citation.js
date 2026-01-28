import * as cheerio from 'cheerio';

// =============================================================================
// 1. CONFIGURATION
// =============================================================================
const CONFIG = {
    BLOCKLIST_QUERY: " -filetype:pdf -site:instagram.com -site:facebook.com -site:tiktok.com -site:twitter.com -site:pinterest.com -site:reddit.com -site:quora.com -site:wikipedia.org -site:youtube.com",
    BANNED_DOMAINS: ['instagram', 'facebook', 'tiktok', 'twitter', 'x.com', 'pinterest', 'reddit', 'quora', 'youtube', 'vimeo'],
    GROQ_MODEL: "llama-3.3-70b-versatile",
    MAX_CHARS_PER_SOURCE: 2000 
};

const getTodayDate = () => new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

// =============================================================================
// 2. SERVICES
// =============================================================================
const SearchService = {
    async perform(text, googleKey, cx) {
        if (!googleKey || !cx) throw new Error("Missing Google Search Configuration");
        
        let q = text.split(/\s+/).slice(0, 6).join(' '); 
        const finalQuery = `${q} ${CONFIG.BLOCKLIST_QUERY}`;
        const url = `https://www.googleapis.com/customsearch/v1?key=${googleKey}&cx=${cx}&q=${encodeURIComponent(finalQuery)}&num=10`;
        
        const res = await fetch(url);
        const data = await res.json();
        
        if (data.error) throw new Error(`Google Search Error: ${data.error.message}`);
        if (!data.items) return [];
        return this.deduplicate(data.items);
    },

    deduplicate(sources) {
        const unique = [];
        const seenDomains = new Set();
        sources.forEach(s => {
            try {
                const domain = new URL(s.link).hostname.replace('www.', '').toLowerCase();
                if (CONFIG.BANNED_DOMAINS.some(b => domain.includes(b))) return;
                if (!seenDomains.has(domain)) {
                    seenDomains.add(domain);
                    unique.push({ title: s.title, link: s.link, snippet: s.snippet });
                }
            } catch (e) {}
        });
        return unique.slice(0, 8); 
    }
};

const ScrapeService = {
    async getRichData(sources) {
        const promises = sources.map(async (s) => {
            try {
                const controller = new AbortController();
                setTimeout(() => controller.abort(), 2000); 

                const res = await fetch(s.link, { 
                    signal: controller.signal,
                    headers: { 'User-Agent': 'Mozilla/5.0 (DocuMate_Bot)' } 
                });
                
                if (!res.ok) throw new Error("Failed");
                const html = await res.text();
                const $ = cheerio.load(html);

                $('script, style, nav, footer, iframe, svg, header, .ad').remove();
                
                const content = $('body').text().replace(/\s+/g, ' ').substring(0, CONFIG.MAX_CHARS_PER_SOURCE);
                const title = $('meta[property="og:title"]').attr('content') || $('title').text() || s.title;
                const author = $('meta[name="author"]').attr('content') || "Unknown Author";
                const siteName = $('meta[property="og:site_name"]').attr('content') || "";
                
                return { ...s, title: title.trim(), content: content.length > 50 ? content : s.snippet, meta: { author, siteName } };
            } catch (e) {
                return { ...s, content: s.snippet || "No content available." };
            }
        });
        const results = await Promise.all(promises);
        return results.map((s, index) => ({ ...s, id: index + 1 }));
    }
};

const FormatService = {
    buildPrompt(type, style, context, srcData) {
        const today = getTodayDate();
        
        // --- QUOTES MODE ---
        if (type === 'quotes') {
            return `TASK: Extract Quotes. CONTEXT: "${context.substring(0, 300)}..." DATA: ${srcData} RULES: Output strictly in order ID 1 to 10. Format: **[ID] Title** - URL \n > "Quote..."`;
        }

        // --- BIBLIOGRAPHY ONLY ---
        if (type === 'bibliography') {
            return `TASK: Create Bibliography. STYLE: ${style} SOURCE DATA: ${srcData} RULES: Format strictly. Include "Accessed ${today}". Return plain text list.`;
        }

        // --- CITATION INSERTION ---
        let styleInstruction = "";
        if (style.toLowerCase().includes('apa')) styleInstruction = "Use APA 7 style. In-text: (Author, Year). Bibliography: Author. (Year). Title. Site. URL";
        else if (style.toLowerCase().includes('mla')) styleInstruction = "Use MLA 9 style. In-text: (Author). Bibliography: Author. Title. Site, Date, URL.";
        else if (style.toLowerCase().includes('chicago')) styleInstruction = "Use Chicago style. In-text: Use superscripts (e.g. word¹). Bibliography: Author. Title. Site. URL.";
        else styleInstruction = `Use ${style} style for citations.`;

        return `
            TASK: Insert citations into text.
            ${styleInstruction}
            SOURCE DATA: ${srcData}
            TEXT: "${context}"
            
            MANDATORY:
            1. Cite every sentence that contains factual claims.
            2. RETURN JSON object with keys: "insertions" (array), "formatted_citations" (object).
            3. "formatted_citations": The Key is the Source ID. The Value is the FULL bibliography entry.
            4. **CRITICAL**: Include "Accessed ${today}" at the end of every "formatted_citations" value.
            5. Ensure URL is included in "formatted_citations".
            
            Example JSON Structure:
            {
              "insertions": [{ "anchor": "text segment", "source_id": 1, "citation_text": "(Smith, 2024)" }],
              "formatted_citations": { "1": "Smith, J. (2024). Article Title. *Website Name*. https://example.com (Accessed ${today})." }
            }
        `;
    }
};

const GroqService = {
    async call(messages, apiKey, jsonMode = false) {
        const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({
                model: CONFIG.GROQ_MODEL,
                messages: messages,
                temperature: 0.1,
                response_format: jsonMode ? { type: "json_object" } : undefined
            })
        });

        const data = await response.json();
        if (!response.ok) throw new Error(`Groq API ${response.status}: ${data.error?.message}`);
        return data.choices[0].message.content;
    }
};

const TextProcessor = {
    applyInsertions(context, insertions, sources, formattedMap, outputType) {
        let resultText = context;
        let footnoteCounter = 1;
        let usedSourceIds = new Set();

        // 1. Fuzzy Match Logic (Tokenization)
        const tokens = [];
        const tokenRegex = /[a-z0-9]+/gi;
        let match;
        while ((match = tokenRegex.exec(context)) !== null) {
            tokens.push({ word: match[0].toLowerCase(), start: match.index, end: match.index + match[0].length });
        }

        const validInsertions = (insertions || []).map(item => {
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
            if (bestIndex !== -1) return { ...item, insertIndex: bestIndex };
            return null;
        }).filter(Boolean).sort((a, b) => b.insertIndex - a.insertIndex);

        // 2. Apply Insertions to Text
        validInsertions.forEach(item => {
            const source = sources.find(s => s.id === item.source_id);
            if (!source) return;
            usedSourceIds.add(source.id);
            
            let insertContent = "";
            if (outputType === 'footnotes') {
                // Unicode Superscripts
                const s = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹' };
                insertContent = footnoteCounter.toString().split('').map(d => s[d] || '').join('');
                footnoteCounter++; // Increment counter for each insertion
            } else {
                insertContent = " " + (item.citation_text || `(${source.id})`);
            }

            resultText = resultText.substring(0, item.insertIndex) + insertContent + resultText.substring(item.insertIndex);
        });

        // 3. Build Footer (Used vs Unused)
        let usedSection = outputType === 'footnotes' ? "\n\n### References Cited\n" : "\n\n### Works Cited\n";
        let unusedSection = "\n\n### Further Reading (Unused Sources)\n";

        // We iterate through ALL sources to sort them into Used vs Unused
        sources.forEach((s) => {
            const fullCitation = formattedMap[s.id] || `${s.title}. ${s.link}`;
            
            if (usedSourceIds.has(s.id)) {
                // Deduplication: Only add to list once, even if used 5 times in text
                usedSection += `${fullCitation}\n\n`;
            } else {
                unusedSection += `${fullCitation}\n\n`;
            }
        });

        // Combine sections
        let finalOutput = resultText + usedSection;
        if (usedSourceIds.size < sources.length) {
            finalOutput += unusedSection;
        }

        return finalOutput;
    }
};

// =============================================================================
// 3. MAIN HANDLER
// =============================================================================
export default async function handler(req, res) {
    if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'POST');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        return res.status(200).end();
    }
    res.setHeader('Access-Control-Allow-Origin', '*');

    try {
        const { context, style, outputType, apiKey, googleKey, preLoadedSources } = req.body;
        const GROQ_KEY = apiKey || process.env.GROQ_API_KEY;
        const GOOGLE_KEY = googleKey || process.env.GOOGLE_SEARCH_API_KEY;
        const SEARCH_CX = process.env.SEARCH_ENGINE_ID;

        // --- BRANCH A: QUOTES ---
        if (preLoadedSources && preLoadedSources.length > 0) {
            const prompt = FormatService.buildPrompt('quotes', null, context, JSON.stringify(preLoadedSources));
            const result = await GroqService.call([{ role: "user", content: prompt }], GROQ_KEY, false);
            return res.status(200).json({ success: true, text: result });
        }

        // --- BRANCH B: CITATIONS ---
        const rawSources = await SearchService.perform(context, GOOGLE_KEY, SEARCH_CX);
        if (!rawSources.length) throw new Error("No academic sources found.");

        const richSources = await ScrapeService.getRichData(rawSources);
        const prompt = FormatService.buildPrompt(outputType, style, context, JSON.stringify(richSources));
        
        const isJson = outputType !== 'bibliography';
        const aiResponse = await GroqService.call([{ role: "user", content: prompt }], GROQ_KEY, isJson);

        let finalOutput;
        if (outputType === 'bibliography') {
            finalOutput = aiResponse;
        } else {
            let data;
            try { data = JSON.parse(aiResponse); } 
            catch (e) { return res.status(200).json({ success: true, sources: richSources, text: aiResponse }); }
            
            finalOutput = TextProcessor.applyInsertions(context, data.insertions, richSources, data.formatted_citations, outputType);
        }

        return res.status(200).json({ success: true, sources: richSources, text: finalOutput });

    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
}
