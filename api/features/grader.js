// api/features/grader.js
import { GeminiAPI } from '../utils/geminiAPI.js';

// ==========================================================================
// RUBRIC PARSER - Extracts criteria from various rubric formats
// ==========================================================================
const RubricParser = {
    /**
     * Parse rubric text into structured criteria
     */
    parse(rubricText) {
        if (!rubricText || rubricText.trim().length < 10) {
            return null;
        }

        const criteria = [];
        const lines = rubricText.split('\n').filter(l => l.trim());

        // Try to detect rubric format
        for (const line of lines) {
            // Format: "Criterion: X points" or "Criterion (X points)"
            const pointsMatch = line.match(/^(.+?)[\s:]+(\d+)\s*(?:points?|pts?|marks?)?/i);
            if (pointsMatch) {
                criteria.push({
                    name: pointsMatch[1].trim(),
                    points: parseInt(pointsMatch[2]),
                    description: line
                });
                continue;
            }

            // Format: "- Criterion" or "• Criterion"
            const bulletMatch = line.match(/^[\-•\*]\s*(.+)/);
            if (bulletMatch) {
                criteria.push({
                    name: bulletMatch[1].trim(),
                    points: null,
                    description: bulletMatch[1].trim()
                });
                continue;
            }

            // Format: "1. Criterion" or "A. Criterion"
            const numberedMatch = line.match(/^(?:\d+|[A-Za-z])[\.\)]\s*(.+)/);
            if (numberedMatch) {
                criteria.push({
                    name: numberedMatch[1].trim(),
                    points: null,
                    description: numberedMatch[1].trim()
                });
            }
        }

        return criteria.length > 0 ? criteria : null;
    },

    /**
     * Format criteria for prompt
     */
    formatForPrompt(criteria) {
        if (!criteria || criteria.length === 0) return null;

        let formatted = "RUBRIC CRITERIA (Grade EACH criterion):\n";
        criteria.forEach((c, i) => {
            if (c.points) {
                formatted += `${i + 1}. ${c.name} (${c.points} points)\n`;
            } else {
                formatted += `${i + 1}. ${c.name}\n`;
            }
        });
        return formatted;
    }
};

// ==========================================================================
// MATERIAL ANALYZER - Understands context files
// ==========================================================================
const MaterialAnalyzer = {
    /**
     * Analyze what type of materials were provided
     */
    analyze(instructions, rubric) {
        const analysis = {
            hasRubric: !!(rubric && rubric.trim().length > 10),
            hasInstructions: !!(instructions && instructions.trim().length > 10),
            assignmentType: 'general',
            keyRequirements: []
        };

        const text = `${instructions || ''} ${rubric || ''}`.toLowerCase();

        // Detect assignment type
        if (text.includes('essay') || text.includes('argument') || text.includes('thesis')) {
            analysis.assignmentType = 'essay';
            analysis.keyRequirements.push('clear thesis statement', 'supporting arguments', 'evidence', 'conclusion');
        } else if (text.includes('research') || text.includes('sources') || text.includes('citation')) {
            analysis.assignmentType = 'research';
            analysis.keyRequirements.push('research quality', 'source integration', 'citations', 'analysis');
        } else if (text.includes('report') || text.includes('analysis')) {
            analysis.assignmentType = 'report';
            analysis.keyRequirements.push('clarity', 'organization', 'data presentation', 'conclusions');
        } else if (text.includes('creative') || text.includes('story') || text.includes('narrative')) {
            analysis.assignmentType = 'creative';
            analysis.keyRequirements.push('creativity', 'voice', 'narrative structure', 'engagement');
        } else if (text.includes('code') || text.includes('program') || text.includes('function')) {
            analysis.assignmentType = 'code';
            analysis.keyRequirements.push('functionality', 'code quality', 'documentation', 'efficiency');
        }

        return analysis;
    }
};

// ==========================================================================
// PROMPT BUILDER
// ==========================================================================
function buildGradingPrompt(studentText, instructions, rubric, analysis, parsedCriteria) {
    const parts = [];

    // System context
    parts.push(`ROLE: You are an experienced, fair, and constructive academic grader.
Your goal is to help students IMPROVE. Be specific, actionable, and encouraging.

GRADING PHILOSOPHY:
- Be strict but fair
- Every critique must include HOW to fix it
- Highlight what works well (students need encouragement)
- Reference SPECIFIC parts of the student's work
- If a rubric is provided, grade EACH criterion explicitly`);

    // Assignment context
    if (analysis.assignmentType !== 'general') {
        parts.push(`\nASSIGNMENT TYPE: ${analysis.assignmentType.toUpperCase()}
Key areas to evaluate: ${analysis.keyRequirements.join(', ')}`);
    }

    // Instructions
    if (instructions && instructions.trim()) {
        parts.push(`\n═══════════════════════════════════════════════════════════════
ASSIGNMENT INSTRUCTIONS (What the student was asked to do):
═══════════════════════════════════════════════════════════════
${instructions.trim()}`);
    }

    // Rubric
    if (parsedCriteria) {
        parts.push(`\n═══════════════════════════════════════════════════════════════
GRADING RUBRIC (You MUST grade each criterion):
═══════════════════════════════════════════════════════════════
${RubricParser.formatForPrompt(parsedCriteria)}`);
    } else if (rubric && rubric.trim()) {
        parts.push(`\n═══════════════════════════════════════════════════════════════
GRADING CRITERIA:
═══════════════════════════════════════════════════════════════
${rubric.trim()}`);
    }

    // Student work
    parts.push(`\n═══════════════════════════════════════════════════════════════
STUDENT SUBMISSION:
═══════════════════════════════════════════════════════════════
${studentText}`);

    // Output format
    let outputFormat = `\n═══════════════════════════════════════════════════════════════
OUTPUT FORMAT (Follow this structure exactly):
═══════════════════════════════════════════════════════════════

## 📊 Overall Grade: [Letter Grade]
[1-2 sentence summary of overall performance]

`;

    // If rubric criteria exist, grade each one
    if (parsedCriteria && parsedCriteria.length > 0) {
        outputFormat += `## 📋 Rubric Breakdown\n`;
        parsedCriteria.forEach((c, i) => {
            if (c.points) {
                outputFormat += `### ${c.name} (___/${c.points} points)\n- Score justification\n- Specific evidence from submission\n\n`;
            } else {
                outputFormat += `### ${c.name}\n- Assessment\n- Specific evidence from submission\n\n`;
            }
        });
    }

    outputFormat += `## ✅ Strengths
- [Specific strength with quote/example from text]
- [Another strength]
- [What the student did well]

## ⚠️ Areas for Improvement
- [Specific issue]: "[Quote from text]" → [How to fix it]
- [Another issue]: [Specific example] → [Actionable improvement]
- [Pattern or recurring problem] → [Strategy to address it]

## 🎯 Priority Improvements (Top 3)
1. **[Most important fix]**: [Exactly what to do and why it matters]
2. **[Second priority]**: [Specific steps to improve]
3. **[Third priority]**: [Actionable advice]

## 💡 Next Steps
[2-3 sentences of encouragement and specific next actions the student should take]`;

    parts.push(outputFormat);

    // Final instructions
    parts.push(`\n═══════════════════════════════════════════════════════════════
CRITICAL GRADING RULES:
═══════════════════════════════════════════════════════════════
1. If a RUBRIC is provided, you MUST score each criterion
2. Every criticism MUST include a specific fix
3. Quote the student's actual text when pointing out issues
4. Be encouraging - help them improve, don't just criticize
5. The "Priority Improvements" section is the MOST IMPORTANT - make it actionable
6. Grade based ONLY on the provided instructions/rubric, not your own expectations`);

    return parts.join('\n');
}

// ==========================================================================
// MAIN HANDLER
// ==========================================================================
export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        const { text, instructions, rubric, apiKey } = req.body;
        const GEMINI_KEY = apiKey || process.env.GEMINI_API_KEY;

        if (!text) throw new Error("No student text provided.");
        if (text.length < 20) throw new Error("Student submission too short (minimum 20 characters).");

        // Safety limits
        const safeText = text.substring(0, 30000);
        const safeInstructions = (instructions || "").substring(0, 3000);
        const safeRubric = (rubric || "").substring(0, 3000);

        // Analyze materials
        const analysis = MaterialAnalyzer.analyze(safeInstructions, safeRubric);
        
        // Parse rubric into criteria
        const parsedCriteria = RubricParser.parse(safeRubric);

        // Build comprehensive prompt
        const prompt = buildGradingPrompt(
            safeText,
            safeInstructions,
            safeRubric,
            analysis,
            parsedCriteria
        );

        // Call Gemini
        const feedback = await GeminiAPI.chat(prompt, GEMINI_KEY);

        return res.status(200).json({ 
            success: true, 
            result: feedback,
            meta: {
                assignmentType: analysis.assignmentType,
                hasRubric: analysis.hasRubric,
                criteriaCount: parsedCriteria ? parsedCriteria.length : 0
            }
        });

    } catch (error) {
        console.error("Grader Error:", error);
        return res.status(500).json({ success: false, error: error.message });
    }
}
