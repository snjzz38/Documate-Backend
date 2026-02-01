// api/features/grader.js
import { GeminiAPI } from '../utils/geminiAPI.js';

export default async function handler(req, res) {
    // 1. Force CORS Headers (Even on error)
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        const { text, instructions, rubric, apiKey } = req.body;
        const GEMINI_KEY = apiKey || process.env.GEMINI_API_KEY;

        if (!text) throw new Error("No student text provided.");

        // Input Truncation (Safety)
        const safeText = text.substring(0, 25000); 
        const safeInstr = (instructions || "").substring(0, 1000);
        const safeRubric = (rubric || "").substring(0, 2000);

        const prompt = `
            TASK: You are a strict academic professor grading student work.
            
            INSTRUCTIONS: ${safeInstr}
            
            RUBRIC / CRITERIA: 
            ${safeRubric || "Grade based on clarity, argumentation, evidence, and flow."}
            
            STUDENT SUBMISSION:
            "${safeText}"
            
            OUTPUT FORMAT:
            1. **Letter Grade**: (e.g., A, B+, C-)
            2. **Summary**: 1-2 sentence overview.
            3. **Strengths**: Bullet points.
            4. **Weaknesses**: Bullet points with specific examples from the text.
            5. **Improvements**: Actionable steps to raise the grade.
        `;

        const feedback = await GeminiAPI.chat(prompt, GEMINI_KEY);

        return res.status(200).json({ success: true, result: feedback });

    } catch (error) {
        console.error("Grader Error:", error);
        return res.status(500).json({ success: false, error: error.message });
    }
}
