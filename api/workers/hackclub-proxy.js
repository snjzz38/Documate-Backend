// workers/hackclub-proxy.js
// Cloudflare Worker to proxy HackClub AI API requests
// Deploy to Cloudflare Workers

export default {
    async fetch(request, env) {
        // CORS headers
        const corsHeaders = {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, Authorization",
            "Content-Type": "application/json",
        };

        // Handle preflight
        if (request.method === "OPTIONS") {
            return new Response(null, { headers: corsHeaders });
        }

        // Only allow POST
        if (request.method !== "POST") {
            return new Response(
                JSON.stringify({ error: "Method not allowed" }),
                { status: 405, headers: corsHeaders }
            );
        }

        try {
            // Parse request body
            const body = await request.json();
            const { messages, model = "qwen/qwen3-32b", stream = false } = body;

            if (!messages || !Array.isArray(messages)) {
                return new Response(
                    JSON.stringify({ error: "Invalid messages array" }),
                    { status: 400, headers: corsHeaders }
                );
            }

            // HackClub AI API - OpenRouter compatible endpoint
            const HACKCLUB_ENDPOINT = "https://ai.hackclub.com/proxy/v1/chat/completions";

            // Build headers - try with API key if available, otherwise without
            const headers = {
                "Content-Type": "application/json",
                "HTTP-Referer": "https://documate.app",
                "X-Title": "DocuMate Agent",
            };

            // Add API key if provided in env
            if (env.HACKCLUB_API_KEY) {
                headers["Authorization"] = `Bearer ${env.HACKCLUB_API_KEY}`;
            }

            // Call HackClub AI API
            const hackclubRes = await fetch(HACKCLUB_ENDPOINT, {
                method: "POST",
                headers,
                body: JSON.stringify({
                    model,
                    messages,
                    stream,
                }),
            });

            // Get raw response for debugging
            const responseText = await hackclubRes.text();

            // Handle streaming response
            if (stream && hackclubRes.ok) {
                return new Response(responseText, {
                    status: hackclubRes.status,
                    headers: {
                        ...corsHeaders,
                        "Content-Type": "text/event-stream",
                    },
                });
            }

            // Try to parse as JSON
            let data;
            try {
                data = JSON.parse(responseText);
            } catch (e) {
                return new Response(
                    JSON.stringify({
                        error: "Failed to parse HackClub response",
                        status: hackclubRes.status,
                        raw: responseText.substring(0, 500),
                    }),
                    { status: 502, headers: corsHeaders }
                );
            }

            if (!hackclubRes.ok) {
                return new Response(
                    JSON.stringify({
                        error: "HackClub API error",
                        status: hackclubRes.status,
                        details: data,
                    }),
                    { status: hackclubRes.status, headers: corsHeaders }
                );
            }

            // Extract content from response
            const content = data.choices?.[0]?.message?.content || "";

            return new Response(
                JSON.stringify({
                    success: true,
                    content,
                    model: data.model,
                    usage: data.usage,
                }),
                { status: 200, headers: corsHeaders }
            );

        } catch (e) {
            return new Response(
                JSON.stringify({ error: "Server error", details: String(e) }),
                { status: 500, headers: corsHeaders }
            );
        }
    },
};
