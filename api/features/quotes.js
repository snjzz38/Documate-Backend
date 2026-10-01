// ==========================================================================
// FILE PATH: api/features/quotes.js
// ==========================================================================

import { OpenalexAPI } from '../_utils/openalex.js';
import { SearxAPI } from '../_utils/searx.js';
import { ScraperAPI } from '../_utils/scraper.js';
import { GroqAPI } from '../_utils/groqAPI.js';

function buildSourceQuotePrompt(title, text) {
    const slice = (text || '').slice(0, 600).trim();
    return `Extract 1-2 verbatim quotes (1-2 sentences each) directly from the excerpt below.

SOURCE TITLE: ${title}
EXCERPT:
"${slice}"

RULES:
- Must be exact, word-for-word text from EXCERPT.
- Return ONLY the quotes, each starting with '> "'.
- Do NOT add introductory remarks or explanations.`;
}

async function extractQuoteForSource(source, index, groqKey) {
    const title = source.title || 'Source';
    const url = source.doi ? `https://doi.org/${source.doi}` : (source.link || source.url || '');
    const content = source.content || source.snippet || '';

    if (!content || content.length < 50) return null;

    try {
        const prompt = buildSourceQuotePrompt(title, content);
        const quote = await GroqAPI.chat([{ role: 'user', content: prompt }], groqKey, false);
        if (!quote || !quote.trim()) return null;
        return `**[${index + 1}] ${title}** - ${url}\n${quote.trim()}`;
    } catch (err) {
        console.warn(`[Quotes] Failed for source ${index + 1}:`, err.message);
        return null;
    }
}

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        const { context, preLoadedSources, apiKey, googleKey } = req.body;
        const GROQ = apiKey || process.env.GROQ_API_KEY;
        const GKEY = googleKey || process.env.GOOGLE_SEARCH_API_KEY;
        const GCX = process.env.SEARCH_ENGINE_ID;
        const OPENALEX = process.env.OPENALEX_API_KEY;

        let targetSources = [];

        if (preLoadedSources && Array.isArray(preLoadedSources) && preLoadedSources.length > 0) {
            targetSources = preLoadedSources;
        } else if (context) {
            const [academicResults, generalResults] = await Promise.all([
                OpenalexAPI.search(context, GKEY, GCX, GROQ, OPENALEX),
                SearxAPI.search(context, 5)
            ]);
            targetSources = await ScraperAPI.scrape([...academicResults, ...generalResults]);
        } else {
            return res.status(400).json({ success: false, error: 'Context or preLoadedSources required.' });
        }

        const sourcesWithContent = await Promise.all(targetSources.map(async (s) => {
            if (!s.content || s.content.length < 200) {
                try {
                    const scraped = await ScraperAPI.scrape([s]);
                    return scraped[0] || s;
                } catch {
                    return s;
                }
            }
            return s;
        }));

        const quoteResults = await Promise.all(
            sourcesWithContent.map((source, idx) => extractQuoteForSource(source, idx, GROQ))
        );

        const formattedOutput = quoteResults.filter(Boolean).join('\n\n---\n\n');

        return res.status(200).json({
            success: true,
            text: formattedOutput || 'No direct quotes could be extracted.',
            citations: sourcesWithContent,
            count: sourcesWithContent.length
        });

    } catch (error) {
        console.error('[Quotes] Handler Error:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
}
