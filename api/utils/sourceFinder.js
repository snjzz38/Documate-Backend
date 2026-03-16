export default async function handler(req, res) {

try {

const query = req.query.q;

if (!query) {
return res.status(400).json({
error: "Missing query parameter ?q="
});
}

const url =
`https://api.semanticscholar.org/graph/v1/paper/search?` +
`query=${encodeURIComponent(query)}` +
`&limit=10` +
`&fields=title,year,authors,venue,url,citationCount`;

const response = await fetch(url, {
headers: {
"User-Agent": "documate-research-tool"
}
});

const data = await response.json();

const papers = (data.data || []).map(p => ({
title: p.title,
year: p.year,
venue: p.venue,
citationCount: p.citationCount,
url: p.url,
authors: p.authors.map(a => a.name)
}));

res.status(200).json({
success: true,
results: papers
});

} catch (err) {

res.status(500).json({
success: false,
error: "Failed to fetch papers"
});

}

}
