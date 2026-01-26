/**
 * uses/citation.js - Streaming Citations & Quotes
 * Architecture: Modular Services (Search, Scrape, Format, Pipeline)
 * Features: Max Density, Full Bibliography, CRAAP Filter, Dynamic Dates
 */
(function() {
    // --- SINGLETON CHECK ---
    if (window.DocumateCitationActive) return;
    window.DocumateCitationActive = true;

    console.log("%c [DocuMate] CITATION ENGINE LOADED (FULL LOGIC) ", "background: #000; color: #0f0; font-weight: bold;");

    // ==========================================================================
    // 1. EVENT ROUTER
    // ==========================================================================
    window.addEventListener('message', async (event) => {
        const { type, ...data } = event.data;

        if (type === 'DOCUMATE_CITATION_REQUEST') {
            await PipelineService.handleCitation(data);
        }
        else if (type === 'DOCUMATE_QUOTES_REQUEST') {
            await PipelineService.handleQuotes(data);
        }
    });

    // ==========================================================================
    // 2. SEARCH SERVICE (Query Gen, Filtering, Deduplication)
    // ==========================================================================
    const SearchService = {
        async performSmartSearch(text, apiKey) {
            window.postMessage({ type: 'DOCUMATE_CITE_PROGRESS', percent: 10 }, '*');
            
            let q = "";
            try {
                let qBuf = "";
                const prompt = `
                    TASK: Create a Google search query for this text.
                    TEXT: "${text.substring(0, 400)}"
                    RULES:
                    1. PRIORITIZE Proper Nouns and Key Concepts.
                    2. Combine them into a SINGLE line string.
                    3. Max 8 words.
                `;
                
                await window.DocumateAPI.geminiStream([{ text: prompt }], apiKey, (c) => qBuf += c);
                
                q = qBuf.replace(/[\r\n]+/g, ' ')
                        .replace(/^\d+\.\s*/, '')
                        .replace(/["`]/g, '')
                        .trim();
                        
            } catch (e) { console.warn("Query gen failed"); }

            if (!q || q.length < 3) {
                const properNouns = text.match(/[A-Z][a-z]+/g) || [];
                const uniqueNouns = [...new Set(properNouns)].filter(w => w.length > 3).slice(0, 6);
                q = uniqueNouns.join(' ');
                if (!q) q = text.split(/\s+/).slice(0, 6).join(' ');
            }

            // --- CRAAP FILTER (Blocklist) ---
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
            
            // Javascript Domain Filter (Double Safety)
            const bannedDomains = ['instagram', 'facebook', 'tiktok', 'twitter', 'x.com', 'pinterest', 'reddit', 'quora', 'youtube', 'vimeo'];

            sources.forEach(s => {
                try {
                    const domain = new URL(s.link).hostname.replace('www.', '').toLowerCase();
                    
                    if (bannedDomains.some(b => domain.includes(b))) return;
                    if (s.link.endsWith('.pdf')) return;

                    if (!seenDomains.has(domain)) {
                        seenDomains.add(domain);
                        uniqueSources.push(s);
                    } else {
                        backupSources.push(s);
                    }
                } catch (e) {
                    // Invalid URL
                }
            });

            // Backfill to ensure we get 10 sources if possible
            while (uniqueSources.length < 10 && backupSources.length > 0) {
                uniqueSources.push(backupSources.shift());
            }

            if (uniqueSources.length === 0) throw new Error("No valid academic sources found.");
            return uniqueSources;
        }
    };

    // ==========================================================================
    // 3. SCRAPE SERVICE (Metadata Extraction & Enrichment)
    // ==========================================================================
    const ScrapeService = {
        async getRichData(sources, apiKey) {
            window.postMessage({ type: 'DOCUMATE_CITE_PROGRESS', percent: 40 }, '*');
            
            // Limit to 10 sources
            const targetSources = sources.slice(0, 10);
            const urls = targetSources.map(s => s.link);
            
            let scrapedData = [];
            try {
                scrapedData = await window.DocumateAPI.scrape(urls);
            } catch (e) { console.warn("Scraping failed, using snippets"); }

            // Merge Data
            const richSources = targetSources.map((s, i) => {
                const scrape = scrapedData.find(d => d.url === s.link) || {};
                const hasContent = scrape.status === 'ok' && scrape.content && scrape.content.length > 50;

                let cleanLink = s.link.replace(/[.,;:]$/, "");
                if (!cleanLink.startsWith('http')) cleanLink = 'https://' + cleanLink;

                const bestTitle = (scrape.meta && scrape.meta.title) ? scrape.meta.title : s.title;

                return {
                    id: 0, // Temp ID
                    title: bestTitle,
                    link: cleanLink,
                    content: hasContent ? scrape.content.substring(0, 1500) : (s.snippet || "").substring(0, 500),
                    meta: scrape.meta || {}
                };
            });

            // Sort Alphabetically
            return this.sortAlphabetically(richSources);
        },

        sortAlphabetically(sources) {
            const sorted = sources.sort((a, b) => {
                const nameA = (a.meta.author || a.title || "").trim().toLowerCase();
                const nameB = (b.meta.author || b.title || "").trim().toLowerCase();
                return nameA.localeCompare(nameB);
            });
            return sorted.map((s, index) => ({ ...s, id: index + 1 }));
        }
    };

    // ==========================================================================
    // 4. FORMAT SERVICE (Prompts & Text Utils)
    // ==========================================================================
    const FormatService = {
        buildPrompt(type, style, context, srcData) {
            // Dynamic Date
            const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

            if (type === 'in-text' || type === 'footnotes') {
                return `
                    TASK: Insert citations into the text.
                    STYLE: ${style}
                    SOURCE DATA (JSON): ${srcData}
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
                        "1": "Smith, J. (2023). Title. Publisher. URL (Accessed ${today})."
                      }
                    }
                `;
            } else if (type === 'bibliography') {
                return `
                    TASK: Create Bibliography.
                    STYLE: ${style}
                    SOURCE DATA (JSON): ${srcData}
                    
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
                    SOURCE DATA (JSON): ${srcData}
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
        },

        getSuperscript(num) {
            const supers = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹' };
            return num.toString().split('').map(d => supers[d] || '').join('');
        }
    };

    // ==========================================================================
    // 5. PIPELINE SERVICE (Orchestrator)
    // ==========================================================================
    const PipelineService = {
        
        // --- BIBLIOGRAPHY & INSERTION ---
        async handleCitation({ context, style, outputType, apiKey }) {
            try {
                // 1. Search
                const sources = await SearchService.performSmartSearch(context, apiKey);
                
                // 2. Scrape & Sort
                const richSources = await ScrapeService.getRichData(sources, apiKey);
                const sourceContext = JSON.stringify(richSources, null, 2);

                // 3. Build Prompt
                window.postMessage({ type: 'DOCUMATE_CITE_PROGRESS', percent: 60 }, '*');
                const prompt = FormatService.buildPrompt(outputType, style, context, sourceContext);

                // 4. Stream AI Response
                window.postMessage({ type: 'DOCUMATE_CITATION_STREAM_CLEAR' }, '*');
                let jsonBuffer = "";
                
                await window.DocumateAPI.geminiStream([{ text: prompt }], apiKey, (chunk) => {
                    if (outputType === 'bibliography') {
                        window.postMessage({ type: 'DOCUMATE_CITATION_STREAM_CHUNK', text: chunk }, '*');
                    } else {
                        jsonBuffer += chunk;
                    }
                });

                // 5. Process Insertion
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

        // --- QUOTES ---
        async handleQuotes({ text, apiKey, preLoadedSources }) {
            if (!preLoadedSources) {
                window.postMessage({ type: 'DOCUMATE_QUOTES_RESPONSE', success: false, error: "No sources found." }, '*');
                return;
            }

            try {
                const sourceContext = JSON.stringify(preLoadedSources, null, 2);
                const prompt = FormatService.buildPrompt('quotes', null, text, sourceContext);

                window.postMessage({ type: 'DOCUMATE_QUOTES_STREAM_CLEAR' }, '*');
                await window.DocumateAPI.geminiStream([{ text: prompt }], apiKey, (chunk) => {
                    window.postMessage({ type: 'DOCUMATE_QUOTES_STREAM_CHUNK', text: chunk }, '*');
                });
                window.postMessage({ type: 'DOCUMATE_QUOTES_RESPONSE', success: true }, '*');

            } catch (e) {
                window.postMessage({ type: 'DOCUMATE_QUOTES_RESPONSE', success: false, error: e.message }, '*');
            }
        },

        // --- INSERTION LOGIC ---
        processInsertion(jsonBuffer, context, sources, outputType, style) {
            const data = FormatService.parseAIJson(jsonBuffer);
            const insertions = data.insertions || [];
            const formattedMap = data.formatted_citations || {};

            let resultText = context;
            let bottomSection = outputType === 'footnotes' ? "\n\n### Footnotes\n" : "\n\n### Sources Used\n";
            let footnoteCounter = 1;
            let usedSourceIds = new Set();

            // 1. Tokenize Text
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

            // 2. Sort Insertions
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
                // Fuzzy Match
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

                const isNewSource = !usedSourceIds.has(source.id);
                usedSourceIds.add(source.id);

                // Get formatted string from AI
                const fullCitation = formattedMap[source.id] || `${source.title}. ${source.link}`;

                let insertContent = "";
                if (outputType === 'footnotes') {
                    insertContent = FormatService.getSuperscript(footnoteCounter);
                    bottomSection += `${footnoteCounter}. ${fullCitation}\n`;
                    footnoteCounter++;
                } else {
                    insertContent = " " + (item.citation_text || `(Source ${source.id})`);
                    if (isNewSource) bottomSection += `${fullCitation}\n\n`;
                }

                const pos = item.insertIndex;
                resultText = resultText.substring(0, pos) + insertContent + resultText.substring(pos);
            });

            resultText += bottomSection;

            // 4. Unused Sources
            const unusedSources = sources.filter(s => !usedSourceIds.has(s.id));
            if (unusedSources.length > 0) {
                resultText += "\n\n### Unused Sources\n";
                unusedSources.forEach(s => {
                    const fullCitation = formattedMap[s.id] || `${s.title}. ${s.link}`;
                    resultText += `${fullCitation}\n\n`;
                });
            }

            window.postMessage({ type: 'DOCUMATE_CITATION_STREAM_CLEAR' }, '*');
            window.postMessage({ type: 'DOCUMATE_CITATION_STREAM_CHUNK', text: resultText }, '*');
            window.postMessage({ type: 'DOCUMATE_CITATION_RESPONSE', success: true, sources: sources }, '*');
        }
    };
})();
