// api/utils/sourceFinder.js
export default async function handler(req, res) {
  try {
    const query = req.query.q;
    if (!query) {
      return res.status(400).json({ error: "Missing query parameter ?q=" });
    }

    const url = `https://api.crossref.org/works?query=${encodeURIComponent(query)}&rows=10`;

    const response = await fetch(url);
    const data = await response.json();

    const papers = (data.message.items || []).map(p => ({
      title: p.title?.[0] || "No title",
      year: p.published?.["date-parts"]?.[0]?.[0] || "n.d.",
      venue: p["container-title"]?.[0] || "Unknown journal",
      url: p.URL,
      authors: (p.author || []).map(a => `${a.given || ""} ${a.family || ""}`.trim())
    }));

    res.status(200).json({ success: true, results: papers });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: "Failed to fetch papers" });
  }
}
