// api/citation.js
import { OpenAI } from 'openai'; // or your preferred library

export const config = {
    maxDuration: 60, // Requires Vercel Pro (or keep it fast)
};

export default async function handler(req, res) {
    console.log("[Backend] Request received");

    // 1. Initialize the Adapter with User Data
    const app = new DocumateBackendApp(req.body);

    try {
        // 2. Run the Logic
        const result = await app.run();
        res.status(200).json({ success: true, ...result });
    } catch (error) {
        console.error("Backend Error:", error);
        res.status(500).json({ success: false, error: error.message });
    }
}

/**
 * THE CLASS FUNCTION
 * Paste your frontend services inside the methods below.
 */
class DocumateBackendApp {
    constructor(payload) {
        this.data = payload; // { context, style, apiKey, ... }
        this.logs = [];
        
        // --- ENVIRONMENT MOCKS (So your frontend code doesn't crash) ---
        this.window = {
            postMessage: (msg) => {
                // Instead of updating UI, we log progress to server console
                if (msg.type.includes('PROGRESS')) console.log(`[Progress] ${msg.percent}%`);
                if (msg.type.includes('CHUNK')) console.log(`[Stream] ${msg.text ? msg.text.substring(0, 20) + '...' : ''}`);
            },
            DocumateAPI: {
                // We must reimplement these for Node.js since we aren't in Chrome anymore
                search: async (query, key) => this._serverSideSearch(query, key),
                scrape: async (urls) => this._serverSideScrape(urls),
                geminiStream: async (msgs, key, cb) => this._serverSideGemini(msgs, key, cb)
            }
        };
    }

    /**
     * 🟢 PASTE ZONE: SEARCH SERVICE
     * Copy your "SearchService" object from frontend here.
     * Change "const SearchService = {" to "this.SearchService = {"
     */
    initServices() {
    // ==========================================================================
    // 1. EVENT ROUTER
    // ==========================================================================
    window.addEventListener('message', async (event) => {
        const { type, ...data } = event.data;
        if (type === 'DOCUMATE_CITATION_REQUEST') await PipelineService.handleCitation(data);
        else if (type === 'DOCUMATE_QUOTES_REQUEST') await PipelineService.handleQuotes(data);
    });

    // ==========================================================================
    // 2. SEARCH SERVICE
    // ==========================================================================
    const SearchService = {
        async performSmartSearch(text, apiKey) {
            window.postMessage({ type: 'DOCUMATE_CITE_PROGRESS', percent: 10 }, '*');
            
            let q = text.split(/\s+/).slice(0, 6).join(' '); 
            const blocklist = " -filetype:pdf -site:instagram.com -site:facebook.com -site:tiktok.com -site:twitter.com -site:pinterest.com -site:reddit.com -site:quora.com -site:wikipedia.org -site:youtube.com";
            const finalQuery = `${q} ${blocklist}`;

            console.log(`[DocuMate] Searching: "${finalQuery}"`);
            window.postMessage({ type: 'DOCUMATE_CITE_PROGRESS', percent: 20 }, '*');
            
            let sources = await window.DocumateAPI.search(finalQuery, apiKey);
            return this.deduplicateSources(sources);
        },

        deduplicateSources(sources) {
            if (!sources || !Array.isArray(sources)) throw new Error("No web results found.");
            const uniqueSources = [];
            const seenDomains = new Set();
            const backupSources = [];
            const bannedDomains = ['instagram', 'facebook', 'tiktok', 'twitter', 'x.com', 'pinterest', 'reddit', 'quora', 'youtube', 'vimeo'];

            sources.forEach(s => {
                try {
                    const domain = new URL(s.link).hostname.replace('www.', '').toLowerCase();
                    if (bannedDomains.some(b => domain.includes(b))) return;
                    if (s.link.endsWith('.pdf')) return;

                    if (!seenDomains.has(domain)) { seenDomains.add(domain); uniqueSources.push(s); }
                    else { backupSources.push(s); }
                } catch (e) {}
            });

            while (uniqueSources.length < 10 && backupSources.length > 0) uniqueSources.push(backupSources.shift());
            if (uniqueSources.length === 0) throw new Error("No valid academic sources found.");
            return uniqueSources;
        }
    };

    // ==========================================================================
    // 3. SCRAPE SERVICE
    // ==========================================================================
    const ScrapeService = {
        async getRichData(sources, apiKey) {
            window.postMessage({ type: 'DOCUMATE_CITE_PROGRESS', percent: 40 }, '*');
            
            const targetSources = sources.slice(0, 10);
            const urls = targetSources.map(s => s.link);
            
            let scrapedData = [];
            try {
                scrapedData = await window.DocumateAPI.scrape(urls); 
            } catch (e) { console.warn("Scraping failed", e); }

            const richSources = targetSources.map((s) => {
                const scrape = scrapedData.find(d => d.url === s.link) || {};
                let cleanLink = s.link.replace(/[.,;:]$/, "");
                if (!cleanLink.startsWith('http')) cleanLink = 'https://' + cleanLink;

                return {
                    id: 0, 
                    title: scrape.title || s.title,
                    link: cleanLink,
                    content: (scrape.status === 'ok' && scrape.content) ? scrape.content : (s.snippet || "No content available."),
                    meta: {} 
                };
            });

            return this.sortAndIndex(richSources);
        },

        sortAndIndex(sources) {
            const sorted = sources.sort((a, b) => {
                const tA = a.title || "";
                const tB = b.title || "";
                return tA.localeCompare(tB);
            });
            return sorted.map((s, index) => ({ ...s, id: index + 1 }));
        }
    };

// ==========================================================================
    // 4. FORMAT SERVICE (Dynamic Access Date)
    // ==========================================================================
    const FormatService = {
        buildPrompt(type, style, context, srcData) {
            // 1. Get Current Date (e.g., "January 24, 2026")
            const today = new Date().toLocaleDateString('en-US', { 
                year: 'numeric', 
                month: 'long', 
                day: 'numeric' 
            });

            if (type === 'in-text' || type === 'footnotes') {
                return `
                    TASK: Insert citations into the text.
                    STYLE: ${style}
                    SOURCE DATA: ${srcData}
                    TEXT: "${context}"
                    
                    MANDATORY INSTRUCTIONS:
                    1. **CITE EVERY SENTENCE:** You MUST assign a source to every single sentence.
                    2. **FORMATTING:**
                       - "insertions": Array of where to put citations.
                       - "formatted_citations": Dictionary mapping Source ID to Full Bibliographic String.
                    3. **ACCESS DATE:** You MUST include "Accessed ${today}" at the end of every full citation in "formatted_citations".
                    
                    RETURN JSON ONLY:
                    {
                      "insertions": [
                        { "anchor": "unique 3-5 word phrase", "source_id": 1, "citation_text": "(Smith, 2023)" }
                      ],
                      "formatted_citations": {
                        "1": "Smith, J. (2023). Title. Publisher. URL (accessed ${today})."
                      }
                    }
                `;
            } else if (type === 'bibliography') {
                return `
                    TASK: Create Bibliography.
                    STYLE: ${style}
                    SOURCE DATA: ${srcData}
                    
                    RULES:
                    1. Format strictly according to ${style}.
                    2. **ACCESS DATE:** You MUST include "Accessed ${today}" at the end of every entry.
                    3. **DO NOT NUMBER THE LIST.**
                    4. Return a plain text list. Double newline separation.
                `;
            } else if (type === 'quotes') {
                return `
                    TASK: Extract Quotes for Sources 1-10.
                    CONTEXT: "${context.substring(0, 300)}..."
                    DATA: ${srcData}
                    RULES: Output strictly in order ID 1 to 10.
                    Format: [ID] Title - URL \n > "Quote..."
                `;
            }
        },

        parseAIJson(text) {
            try {
                const first = text.indexOf('{');
                const last = text.lastIndexOf('}');
                if (first === -1) throw new Error("No JSON");
                return JSON.parse(text.substring(first, last + 1));
            } catch (e) { return { insertions: [], formatted_citations: {} }; }
        }
    };
    
    // ==========================================================================
    // 5. PIPELINE SERVICE
    // ==========================================================================
    const PipelineService = {
        async handleCitation({ context, style, outputType, apiKey }) {
            try {
                const sources = await this.SearchService.performSmartSearch(context, apiKey);
                const richSources = await ScrapeService.getRichData(sources, apiKey);
                const sourceContext = JSON.stringify(richSources, null, 2);

                window.postMessage({ type: 'DOCUMATE_CITE_PROGRESS', percent: 60 }, '*');
                const prompt = FormatService.buildPrompt(outputType, style, context, sourceContext);

                window.postMessage({ type: 'DOCUMATE_CITATION_STREAM_CLEAR' }, '*');
                let jsonBuffer = "";
                
                const messages = [{ role: "user", content: prompt }];
                
                await this.window.DocumateAPI.streamGroqRequest(messages, apiKey, null, (chunk) => {
                    if (outputType === 'bibliography') {
                        window.postMessage({ type: 'DOCUMATE_CITATION_STREAM_CHUNK', text: chunk }, '*');
                    } else {
                        jsonBuffer += chunk;
                    }
                });

                if (outputType !== 'bibliography') {
                    this.processInsertion(jsonBuffer, context, richSources, outputType, style);
                } else {
                    window.postMessage({ type: 'DOCUMATE_CITATION_RESPONSE', success: true, sources: richSources }, '*');
                }
                
                window.postMessage({ type: 'DOCUMATE_CITE_PROGRESS', percent: 100 }, '*');

            } catch (e) {
                window.postMessage({ type: 'DOCUMATE_CITATION_RESPONSE', success: false, error: e.message }, '*');
            }
        },

        async handleQuotes({ text, apiKey, preLoadedSources }) {
            if (!preLoadedSources) {
                window.postMessage({ type: 'DOCUMATE_QUOTES_RESPONSE', success: false, error: "No sources found." }, '*');
                return;
            }
            try {
                const sourceContext = JSON.stringify(preLoadedSources, null, 2);
                const prompt = FormatService.buildPrompt('quotes', null, text, sourceContext);
                const messages = [{ role: "user", content: prompt }];

                window.postMessage({ type: 'DOCUMATE_QUOTES_STREAM_CLEAR' }, '*');
                await window.DocumateAPI.streamGroqRequest(messages, apiKey, null, (chunk) => {
                    window.postMessage({ type: 'DOCUMATE_QUOTES_STREAM_CHUNK', text: chunk }, '*');
                });
                window.postMessage({ type: 'DOCUMATE_QUOTES_RESPONSE', success: true }, '*');
            } catch (e) {
                window.postMessage({ type: 'DOCUMATE_QUOTES_RESPONSE', success: false, error: e.message }, '*');
            }
        },

        processInsertion(jsonBuffer, context, sources, outputType, style) {
            const data = FormatService.parseAIJson(jsonBuffer);
            const insertions = data.insertions || [];
            const formattedMap = data.formatted_citations || {};

            let resultText = context;
            let footnoteCounter = 1;
            let usedSourceIds = new Set();

            // 1. Tokenize Text (Case Insensitive, Alpha-Numeric Only)
            const tokens = [];
            const tokenRegex = /[a-z0-9]+/gi;
            let match;
            while ((match = tokenRegex.exec(context)) !== null) {
                tokens.push({ 
                    word: match[0].toLowerCase(), 
                    start: match.index, 
                    end: match.index + match[0].length 
                });
            }

            // 2. Sort Insertions (Descending)
            const validInsertions = insertions.map(item => {
                if (!item.anchor || !item.source_id) return null;
                const anchorWords = item.anchor.toLowerCase().match(/[a-z0-9]+/g);
                if (!anchorWords || anchorWords.length === 0) return null;

                let bestIndex = -1;
                
                // Strict Match
                for (let i = 0; i <= tokens.length - anchorWords.length; i++) {
                    let matchFound = true;
                    for (let j = 0; j < anchorWords.length; j++) {
                        if (tokens[i + j].word !== anchorWords[j]) { matchFound = false; break; }
                    }
                    if (matchFound) { bestIndex = tokens[i + anchorWords.length - 1].end; break; }
                }
                
                // Fuzzy Match (Last 2 words)
                if (bestIndex === -1 && anchorWords.length > 2) {
                    const shortAnchor = anchorWords.slice(-2);
                    for (let i = 0; i <= tokens.length - shortAnchor.length; i++) {
                        if (tokens[i].word === shortAnchor[0] && tokens[i+1].word === shortAnchor[1]) {
                            bestIndex = tokens[i+1].end; break;
                        }
                    }
                }

                if (bestIndex !== -1) return { ...item, insertIndex: bestIndex };
                return null;
            }).filter(i => i !== null).sort((a, b) => b.insertIndex - a.insertIndex);

            // 3. Apply Insertions
            validInsertions.forEach(item => {
                const source = sources.find(s => s.id === item.source_id);
                if (!source) return;

                usedSourceIds.add(source.id);

                let insertContent = "";
                if (outputType === 'footnotes') {
                    const supers = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹' };
                    insertContent = footnoteCounter.toString().split('').map(d => supers[d] || '').join('');
                    footnoteCounter++;
                } else {
                    insertContent = " " + (item.citation_text || `(Source ${source.id})`);
                }

                const pos = item.insertIndex;
                resultText = resultText.substring(0, pos) + insertContent + resultText.substring(pos);
            });

            // 4. Build Bottom Sections
            let usedSection = outputType === 'footnotes' ? "\n\n### Footnotes\n" : "\n\n### Sources Used\n";
            let unusedSection = "\n\n### Unused Sources\n";
            
            // Reset counter for footnotes list
            let listCounter = 1;

            sources.forEach(s => {
                // Get formatted string from AI, or fallback
                let citation = formattedMap[s.id] || `${s.title}. ${s.link}`;
                
                if (usedSourceIds.has(s.id)) {
                    if (outputType === 'footnotes') {
                        usedSection += `${listCounter}. ${citation}\n`;
                        listCounter++;
                    } else {
                        usedSection += `${citation}\n\n`;
                    }
                } else {
                    unusedSection += `${citation}\n\n`;
                }
            });

            // Append Sections
            resultText += usedSection;
            
            // Only append unused if there are any
            if (usedSourceIds.size < sources.length) {
                resultText += unusedSection;
            }

            window.postMessage({ type: 'DOCUMATE_CITATION_STREAM_CLEAR' }, '*');
            window.postMessage({ type: 'DOCUMATE_CITATION_STREAM_CHUNK', text: resultText }, '*');
            window.postMessage({ type: 'DOCUMATE_CITATION_RESPONSE', success: true, sources: sources }, '*');
        }
    };
    /**
     * 🚀 MAIN EXECUTION
     * This replaces your "PipelineService"
     */
    async run() {
        this.initServices(); // Load the pasted services
        
        const { context, style, outputType, apiKey } = this.data;
        const window = this.window; // Make 'window' available locally like frontend

        // --- PIPELINE LOGIC (Paste your PipelineService.handleCitation content here) ---
        
        // 1. Search
        const sources = await this.SearchService.performSmartSearch(context, apiKey);
        
        // 2. Scrape
        const richSources = await this.ScrapeService.getRichData(sources, apiKey);
        
        // 3. Format
        const prompt = this.FormatService.buildPrompt(outputType, style, context, JSON.stringify(richSources));
        
        // 4. Generate (We collect the stream into a buffer since we aren't streaming to client yet)
        let jsonBuffer = "";
        await this.window.DocumateAPI.geminiStream([{ text: prompt }], apiKey, (chunk) => {
            jsonBuffer += chunk;
        });

        // 5. Return Results
        // We return raw data so the Frontend can do the "Processing Insertion"
        return {
            result: jsonBuffer,
            sources: richSources
        };
    }

    // ==================================================================
    // 🛠 SERVER-SIDE IMPLEMENTATIONS (The actual "Backend" work)
    // ==================================================================

    async _serverSideSearch(query, apiKey) {
        // Implement real Google Search API here
        // Example using Serper.dev or Google Custom Search
        const res = await fetch(`https://google.serper.dev/search`, {
            method: 'POST',
            headers: { 'X-API-KEY': apiKey || process.env.SERPER_KEY, 'Content-Type': 'application/json' },
            body: JSON.stringify({ q: query })
        });
        const data = await res.json();
        return data.organic.map(r => ({ title: r.title, link: r.link, snippet: r.snippet }));
    }

    async _serverSideScrape(urls) {
        // Implement scraping (e.g., using Firecrawl or Cheerio)
        return urls.map(u => ({ url: u, status: 'ok', content: 'Scraped content would go here' }));
    }

    async _serverSideGemini(messages, apiKey, onChunk) {
        // Implement Gemini/Groq API Call
        // Simple non-streaming fallback for now
        const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({
                model: "llama3-70b-8192",
                messages: [{ role: "user", content: messages[0].text }],
                stream: false // Set to true if you implement real streaming
            })
        });
        const json = await response.json();
        const text = json.choices[0].message.content;
        onChunk(text); // Send it all at once for now
    }
}
