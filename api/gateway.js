// ==========================================================================
// FILE PATH: api/gateway.js
// ==========================================================================

import citationHandler from './features/citation.js';
import quotesHandler from './features/quotes.js';
import agentHandler from './features/agent.js';
import graderHandler from './features/grader.js';
import humanizerHandler from './features/humanizer.js';

const HANDLERS = {
    citation: citationHandler,
    cite: citationHandler,
    quotes: quotesHandler,
    quote: quotesHandler,
    agent: agentHandler,
    grader: graderHandler,
    grade: graderHandler,
    humanizer: humanizerHandler,
    humanize: humanizerHandler
};

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        const body = req.body || {};
        
        // 1. Determine Feature (Explicitly or via Auto-Detection)
        let feature = (body.feature || '').toLowerCase().trim();

        if (!feature) {
            // Smart auto-detection for backwards compatibility
            if (body.preLoadedSources) feature = 'quotes';
            else if (body.action === 'plan' || body.action === 'run_swarm') feature = 'agent';
            else if (body.rubric || body.action === 'followup') feature = 'grader';
            else if (body.style || body.outputType) feature = 'citation';
            else if (body.text && !body.context) feature = 'humanizer';
            else feature = 'citation';
        }

        const targetHandler = HANDLERS[feature];

        if (!targetHandler) {
            return res.status(400).json({ 
                success: false, 
                error: `[Gateway] Unknown feature: "${feature}". Available: ${Object.keys(HANDLERS).join(', ')}` 
            });
        }

        // 2. Delegate directly to the feature module
        return await targetHandler(req, res);

    } catch (error) {
        console.error('[Gateway] Central Routing Error:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
}
