// api/debug/scrape.js
import { ScraperAPI } from '../utils/scraper.js';

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        const { url } = req.body;
        if (!url) throw new Error("URL is required");

        // Scrape the single URL
        const sources = [{ title: "Debug", link: url }];
        const result = await ScraperAPI.scrape(sources);

        return res.status(200).json({ success: true, data: result[0] });
    } catch (e) {
        return res.status(500).json({ success: false, error: e.message });
    }
}
