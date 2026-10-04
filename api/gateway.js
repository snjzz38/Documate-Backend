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

/**
 * Heuristic detector for legacy Chrome Extension builds.
 * Fingerprints incoming payloads when `feature` is not explicitly declared.
 */
function detectFeature(body = {}, query = {}) {
    // 1. Explicit feature in body, query param, or Vercel rewrite param
    const explicit = body.feature || query.feature || query.match;
    if (explicit && typeof explicit === 'string') {
        return explicit.toLowerCase().trim();
    }

    // 2. Swarm Agent: has 'action' ('plan' | 'run_swarm') or 'task' + 'options'
    if (body.action === 'plan' || body.action === 'run_swarm' || (body.task && body.options)) {
        return 'agent';
    }

    // 3. Grader: has 'followup' action, rubric, instructions, files, or studentText
    if (
        body.action === 'followup' ||
        body.rubric !== undefined ||
        body.instructions !== undefined ||
        body.files !== undefined ||
        (body.context && typeof body.context === 'object' && body.context.studentText)
    ) {
        return 'grader';
    }

    // 4. Quotes: has preLoadedSources
    if (body.preLoadedSources !== undefined) {
        return 'quotes';
    }

    // 5. Citation: has academic style / outputType configuration
    if (body.style !== undefined || body.outputType !== undefined || body.citationStyle !== undefined) {
        return 'citation';
    }

    // 6. Humanizer: only sends { text, apiKey } without instructions, rubric, or actions
    if (body.text && !body.instructions && !body.rubric && !body.action) {
        return 'humanizer';
    }

    // 7. Citation context fallback: legacy citations using context: string
    if (body.context && typeof body.context === 'string') {
        return 'citation';
    }

    return null;
}

export default async function handler(req, res) {
    // Universal CORS configuration
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        const body = req.body || {};
        const query = req.query || {};

        // Resolve feature (works for both old and new extension builds)
        const feature = detectFeature(body, query);

        if (!feature || !HANDLERS[feature]) {
            console.warn('[Gateway] Unresolved request payload:', JSON.stringify(body).slice(0, 150));
            return res.status(400).json({
                success: false,
                error: `[Gateway] Could not resolve target feature. Available features: ${Object.keys(HANDLERS).filter((v, i, a) => a.indexOf(v) === i).join(', ')}`
            });
        }

        // Forward to the target feature handler
        const targetHandler = HANDLERS[feature];
        return await targetHandler(req, res);

    } catch (error) {
        console.error('[Gateway] Central Routing Error:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
}
