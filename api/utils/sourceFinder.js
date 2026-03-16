// api/utils/sourceFinder.js
// Academic source discovery using OpenAlex
// Filters: open access + has abstract

export default async function handler(req, res) {

  try {

    const query = req.query.q;

    if (!query) {
      return res.status(400).json({
        success: false,
        error: "Missing query parameter ?q="
      });
    }

    const url =
      `https://api.openalex.org/works?` +
      `search=${encodeURIComponent(query)}` +
      `&filter=is_oa:true,has_abstract:true` +
      `&per-page=10`;

    const response = await fetch(url, {
      headers: {
        "User-Agent": "Documate Academic Research Tool"
      }
    });

    if (!response.ok) {
      throw new Error(`OpenAlex error ${response.status}`);
    }

    const data = await response.json();

    const papers = (data.results || []).map(work => {

      const abstract = reconstructAbstract(work.abstract_inverted_index);

      return {
        title: work.title || "Untitled",
        year: work.publication_year || "n.d.",
        venue: work.host_venue?.display_name || "Unknown Journal",
        citationCount: work.cited_by_count || 0,

        // Prefer free PDF / OA link
        url: work.best_oa_location?.url || work.doi || work.id,

        doi: work.doi
          ? work.doi.replace("https://doi.org/", "")
          : null,

        abstract: abstract,

        authors: (work.authorships || [])
          .map(a => a.author.display_name)
      };

    });

    res.status(200).json({
      success: true,
      results: papers
    });

  } catch (err) {

    console.error("[sourceFinder] Error:", err.message);

    res.status(500).json({
      success: false,
      error: "Failed to fetch papers"
    });

  }

}


// Convert OpenAlex inverted abstract index → readable text
function reconstructAbstract(index) {

  if (!index) return null;

  const words = [];

  Object.entries(index).forEach(([word, positions]) => {
    positions.forEach(pos => {
      words[pos] = word;
    });
  });

  return words.join(" ");

}
