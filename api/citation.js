import cheerio from 'cheerio';

/* ==========================================================================
   1. PROVIDERS
   ========================================================================== */

const GROQ_MODELS = [
  "qwen/qwen3-32b",
  "llama-3.1-8b-instant",
  "moonshotai/kimi-k2-instruct-0905"
];

async function callGroq(messages, apiKey, jsonMode = false) {
  let last;
  for (const model of GROQ_MODELS) {
    try {
      const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: 0.3,
          response_format: jsonMode ? { type: "json_object" } : undefined
        })
      });
      if (!res.ok) throw new Error(res.status);
      const data = await res.json();
      return data.choices[0].message.content;
    } catch (e) {
      last = e;
    }
  }
  throw last;
}

async function searchWeb(query, googleKey, cx) {
  const url = `https://www.googleapis.com/customsearch/v1?key=${googleKey}&cx=${cx}&q=${encodeURIComponent(query)}&num=10`;
  const res = await fetch(url);
  const data = await res.json();
  return (data.items || []).map(i => ({
    title: i.title,
    link: i.link,
    snippet: i.snippet
  }));
}

async function scrapeUrls(urls) {
  const results = [];
  for (const url of urls.slice(0, 10)) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'DocuMate/1.0' }
      });
      const html = await res.text();
      const $ = cheerio.load(html);
      $('script,style,nav,footer,header,iframe').remove();
      const title = $('title').text().trim();
      const content = $('body').text().replace(/\s+/g, ' ').trim().slice(0, 2500);
      results.push({ id: 0, title, link: url, content });
    } catch {}
  }
  results.sort((a, b) => a.title.localeCompare(b.title));
  return results.map((r, i) => ({ ...r, id: i + 1 }));
}

/* ==========================================================================
   2. FORMAT SERVICE
   ========================================================================== */

const FormatService = {
  buildPrompt(type, style, context, srcData) {
    const today = new Date().toLocaleDateString('en-US', {
      year: 'numeric', month: 'long', day: 'numeric'
    });

    if (type === 'bibliography') {
      return `
TASK: Create bibliography.
STYLE: ${style}
SOURCE DATA: ${srcData}
RULES:
- Include "Accessed ${today}".
- Do NOT number.
- Double newline separation.
`;
    }

    return `
TASK: Insert citations.
STYLE: ${style}
SOURCE DATA: ${srcData}
TEXT: "${context}"

RULES:
- Cite EVERY sentence.
- Return JSON ONLY.
- Include "Accessed ${today}".

FORMAT:
{
 "insertions":[{"anchor":"3-5 words","source_id":1,"citation_text":"(Smith, 2023)"}],
 "formatted_citations":{"1":"Full citation"}
}
`;
  },

  parseAIJson(text) {
    try {
      const start = text.indexOf('{');
      const end = text.lastIndexOf('}');
      return JSON.parse(text.slice(start, end + 1));
    } catch {
      return { insertions: [], formatted_citations: {} };
    }
  }
};

/* ==========================================================================
   3. INSERTION ENGINE (VERBATIM FRONTEND LOGIC)
   ========================================================================== */

function processInsertion(data, context, sources, outputType) {
  const insertions = data.insertions || [];
  const formatted = data.formatted_citations || {};
  let text = context;
  let used = new Set();
  let footnote = 1;

  const tokens = [];
  const re = /[a-z0-9]+/gi;
  let m;
  while ((m = re.exec(context)) !== null) {
    tokens.push({ word: m[0].toLowerCase(), end: m.index + m[0].length });
  }

  const resolved = insertions.map(i => {
    const a = i.anchor?.toLowerCase().match(/[a-z0-9]+/g);
    if (!a) return null;
    for (let x = 0; x <= tokens.length - a.length; x++) {
      if (a.every((w, j) => tokens[x + j].word === w)) {
        return { ...i, pos: tokens[x + a.length - 1].end };
      }
    }
    return null;
  }).filter(Boolean).sort((a, b) => b.pos - a.pos);

  resolved.forEach(i => {
    const src = sources.find(s => s.id === i.source_id);
    if (!src) return;
    used.add(src.id);
    const insert = outputType === 'footnotes'
      ? toSup(footnote++)
      : ` ${i.citation_text || `(Source ${src.id})`}`;
    text = text.slice(0, i.pos) + insert + text.slice(i.pos);
  });

  text += "\n\n### Sources Used\n";
  sources.forEach(s => {
    if (used.has(s.id)) {
      text += (formatted[s.id] || `${s.title}. ${s.link}`) + "\n\n";
    }
  });

  return text;
}

function toSup(n) {
  const m = {0:'⁰',1:'¹',2:'²',3:'³',4:'⁴',5:'⁵',6:'⁶',7:'⁷',8:'⁸',9:'⁹'};
  return n.toString().split('').map(d => m[d]).join('');
}

/* ==========================================================================
   4. PIPELINE
   ========================================================================== */

async function runPipeline({ context, style, outputType, keys }) {
  const q = context.split(/\s+/).slice(0, 6).join(' ');
  const block = " -filetype:pdf -site:reddit.com -site:youtube.com -site:wikipedia.org";
  const searchResults = await searchWeb(q + block, keys.google, keys.cx);
  const sources = await scrapeUrls(searchResults.map(r => r.link));
  const prompt = FormatService.buildPrompt(
    outputType, style, context, JSON.stringify(sources, null, 2)
  );

  const raw = await callGroq([{ role: "user", content: prompt }], keys.groq, outputType !== 'bibliography');

  if (outputType === 'bibliography') {
    return { text: raw, sources };
  }

  const parsed = FormatService.parseAIJson(raw);
  const text = processInsertion(parsed, context, sources, outputType);
  return { text, sources };
}

/* ==========================================================================
   5. API HANDLER
   ========================================================================== */

export default async function handler(req, res) {
  try {
    const result = await runPipeline({
      context: req.body.context,
      style: req.body.style,
      outputType: req.body.outputType,
      keys: {
        groq: process.env.GROQ_API_KEY,
        google: process.env.GOOGLE_SEARCH_API_KEY,
        cx: process.env.SEARCH_ENGINE_ID
      }
    });
    res.status(200).json({ success: true, ...result });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
}
