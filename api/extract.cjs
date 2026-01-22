// api/extract.cjs
const pdfParse = require("pdf-parse");

module.exports = async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    // body pode vir como objeto ou string
    let body = req.body;
    if (typeof body === "string") {
      try { body = JSON.parse(body); } catch (_) { body = {}; }
    }

    const downloadUrl = body && body.downloadUrl;
    if (!downloadUrl) {
      return res.status(400).json({ error: "downloadUrl ausente" });
    }

    const r = await fetch(downloadUrl);
    if (!r.ok) {
      const t = await r.text();
      return res.status(400).json({
        error: `Falha ao baixar PDF: HTTP ${r.status}`,
        detail: t.slice(0, 300)
      });
    }

    const arrayBuffer = await r.arrayBuffer();

    // Limite 10MB
    if (arrayBuffer.byteLength > 10 * 1024 * 1024) {
      return res.status(413).json({ error: "Arquivo muito grande (limite 10MB)" });
    }

    const buffer = Buffer.from(new Uint8Array(arrayBuffer));
    const parsed = await pdfParse(buffer);
    const text = (parsed && parsed.text ? parsed.text : "").trim();

    return res.status(200).json({
      text,
      pages: parsed && parsed.numpages ? parsed.numpages : null
    });
  } catch (e) {
    return res.status(500).json({
      error: "Erro interno",
      detail: String(e && e.message ? e.message : e)
    });
  }
};

