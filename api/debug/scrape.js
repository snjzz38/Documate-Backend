// api/debug/scrape.js
import { ScraperAPI } from '../utils/scraper.js';
import { GroqAPI } from '../utils/groqAPI.js';

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        const { url, apiKey } = req.body;
        if (!url) throw new Error("URL is required");
        
        // 1. Scrape
        // Mock a source object to pass to scraper
        const sourceObj = [{ title: "Debug Source", link: url, snippet: "" }];
        const scrapedData = await ScraperAPI.scrape(sourceObj);
        const doc = scrapedData[0];

        // 2. AI Metadata Extraction (If API Key provided)
        let aiMeta = null;
        if (apiKey) {
            const prompt = `
                TASK: Extract metadata from this text.
                TEXT: "${doc.content.substring(0, 2000)}"
                
                RETURN JSON ONLY:
                {
                    "author": "Name or Unknown",
                    "date": "YYYY-MM-DD or n.d.",
                    "publisher": "Site Name",
                    "summary": "1 sentence summary"
                }
            `;
            try {
                const jsonStr = await GroqAPI.chat([{ role: "user", content: prompt }], apiKey, true);
                aiMeta = JSON.parse(jsonStr);
            } catch (e) {
                console.error("AI Meta Extraction Failed:", e);
                aiMeta = { error: "AI Extraction Failed" };
            }
        }

        return res.status(200).json({ 
            success: true, 
            scraped: doc,
            ai_metadata: aiMeta || "No API Key provided"
        });

    } catch (e) {
        return res.status(500).json({ success: false, error: e.message });
    }
}
