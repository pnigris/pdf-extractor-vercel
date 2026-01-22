import pdfParse from "pdf-parse";

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const { downloadUrl } = req.body || {};
    if (!downloadUrl) {
      return res.status(400).json({ error: "downloadUrl ausente" });
    }

    // Baixa o PDF do Wix (URL temporária assinada)
    const r = await fetch(downloadUrl);
    if (!r.ok) {
      const t = await r.text();
      return res.status(400).json({
        error: `Falha ao baixar PDF: HTTP ${r.status}`,
        detail: t.slice(0, 300)
      });
    }

    const arrayBuffer = await r.arrayBuffer();
    const buffer = Buffer.from(new Uint8Array(arrayBuffer));

    const parsed = await pdfParse(buffer);
    const text = (parsed?.text || "").trim();

    return res.status(200).json({
      text,
      pages: parsed?.numpages || null
    });
  } catch (e) {
    return res.status(500).json({ error: "Erro interno", detail: String(e?.message || e) });
  }
}
