/**
 * uses/citation.js - Hybrid Client
 * Logic: Fetches AI/Search data from Vercel -> Processes Text Locally
 */
(function() {
    // --- SINGLETON CHECK ---
    if (window.DocumateCitationActive) return;
    window.DocumateCitationActive = true;

    // ⚡ UPDATE THIS: Your actual Vercel Endpoint
    const API_ENDPOINT = "https://documate-backend.vercel.app/api/citation"; 

    console.log("%c [DocuMate] HYBRID ENGINE ACTIVE ", "background: #000; color: #0f0; font-weight: bold;");

    // ==========================================================================
    // 1. EVENT ROUTER
    // ==========================================================================
    window.addEventListener('message', async (event) => {
        const { type, ...data } = event.data;

        if (type === 'DOCUMATE_CITATION_REQUEST') {
            await handleCitationRequest(data);
        }
        else if (type === 'DOCUMATE_QUOTES_REQUEST') {
            await handleQuotesRequest(data);
        }
    });

    // ==========================================================================
    // 2. NETWORK HANDLER (Talks to Vercel)
    // ==========================================================================
    async function handleCitationRequest(data) {
        try {
            window.postMessage({ type: 'DOCUMATE_CITE_PROGRESS', percent: 20 }, '*');

            // 1. Send Request to Backend
            // We only send the context + style. We wait for raw data back.
            const response = await fetch(API_ENDPOINT, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    type: 'citation', // Tell backend what mode we are in
                    context: data.context,
                    style: data.style,
                    outputType: data.outputType,
                    apiKey: data.apiKey, // Pass keys if not stored in ENV
                    googleKey: data.googleKey
                })
            });

            if (!response.ok) {
                const errText = await response.text();
                throw new Error(`Server Error (${response.status}): ${errText}`);
            }

            // 2. Parse Response
            const json = await response.json();
            if (!json.success) throw new Error(json.error || "Unknown backend error");

            window.postMessage({ type: 'DOCUMATE_CITE_PROGRESS', percent: 80 }, '*');

            // 3. Process Logic Locally (The "Frontend Logic")
            // We use the backend's data, but the browser's CPU to stitch text.
            // This is safer and allows for instant UI updates.
            if (data.outputType === 'bibliography') {
                // Bibliography is simple, just pass it through
                window.postMessage({ type: 'DOCUMATE_CITATION_STREAM_CHUNK', text: json.result }, '*');
                window.postMessage({ type: 'DOCUMATE_CITATION_RESPONSE', success: true, sources: json.sources }, '*');
            } else {
                // In-Text/Footnotes requires complex stitching
                processInsertion(json.result, data.context, json.sources, data.outputType);
            }

        } catch (e) {
            console.error("Citation Failed:", e);
            window.postMessage({ type: 'DOCUMATE_CITATION_RESPONSE', success: false, error: e.message }, '*');
        }
    }

    async function handleQuotesRequest(data) {
        try {
            window.postMessage({ type: 'DOCUMATE_QUOTES_STREAM_CLEAR' }, '*');
            
            // 1. Send to Backend
            const response = await fetch(API_ENDPOINT, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    type: 'quotes',
                    text: data.text,
                    sources: data.preLoadedSources,
                    apiKey: data.apiKey
                })
            });

            if (!response.ok) throw new Error("Backend connection failed.");

            // 2. Handle Streaming Response from Vercel (Advanced)
            // If your backend streams, we read it here. If not, we await JSON.
            // Assuming standard JSON for now to fix the ERR_FAILED first.
            const json = await response.json();
            
            if(json.quotes) {
                window.postMessage({ type: 'DOCUMATE_QUOTES_STREAM_CHUNK', text: json.quotes }, '*');
            }
            
            window.postMessage({ type: 'DOCUMATE_QUOTES_RESPONSE', success: true }, '*');

        } catch (e) {
            window.postMessage({ type: 'DOCUMATE_QUOTES_RESPONSE', success: false, error: e.message }, '*');
        }
    }

    // ==========================================================================
    // 3. TEXT PROCESSING (The Robust "Frontend" Logic)
    // ==========================================================================
    function processInsertion(aiData, context, sources, outputType) {
        // Safe parsing in case backend sent a string instead of object
        const data = (typeof aiData === 'string') ? parseAIJson(aiData) : aiData;
        
        const insertions = data.insertions || [];
        const formattedMap = data.formatted_citations || {};

        let resultText = context;
        let footnoteCounter = 1;
        let usedSourceIds = new Set();

        // A. Tokenize (Find word positions)
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

        // B. Map Insertions to Positions
        const validInsertions = insertions.map(item => {
            if (!item.anchor || !item.source_id) return null;
            const anchorWords = item.anchor.toLowerCase().match(/[a-z0-9]+/g);
            if (!anchorWords || anchorWords.length === 0) return null;

            let bestIndex = -1;
            
            // 1. Strict Match
            for (let i = 0; i <= tokens.length - anchorWords.length; i++) {
                let matchFound = true;
                for (let j = 0; j < anchorWords.length; j++) {
                    if (tokens[i + j].word !== anchorWords[j]) { matchFound = false; break; }
                }
                if (matchFound) { bestIndex = tokens[i + anchorWords.length - 1].end; break; }
            }
            
            // 2. Fuzzy Match (Last 2 words fallback)
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

        // C. Apply Insertions (Reverse Order)
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

        // D. Build Bibliography (Batch Style - Robust)
        let usedSection = outputType === 'footnotes' ? "\n\n### Footnotes\n" : "\n\n### Sources Used\n";
        let unusedSection = "\n\n### Unused Sources\n";
        let listCounter = 1;

        sources.forEach(s => {
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

        resultText += usedSection;
        if (usedSourceIds.size < sources.length) {
            resultText += unusedSection;
        }

        // Send Result back to Controller
        window.postMessage({ type: 'DOCUMATE_CITATION_STREAM_CLEAR' }, '*');
        window.postMessage({ type: 'DOCUMATE_CITATION_STREAM_CHUNK', text: resultText }, '*');
        window.postMessage({ type: 'DOCUMATE_CITATION_RESPONSE', success: true, sources: sources }, '*');
    }

    function parseAIJson(text) {
        try {
            const first = text.indexOf('{');
            const last = text.lastIndexOf('}');
            if (first === -1) return { insertions: [], formatted_citations: {} };
            return JSON.parse(text.substring(first, last + 1));
        } catch (e) { return { insertions: [], formatted_citations: {} }; }
    }

})();
