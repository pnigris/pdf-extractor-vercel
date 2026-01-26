/* ************************************************************************* */
/* Nome do codigo: api/extract.js (Vercel)Trata arquivo PDF, DOCX e DOC      */
/* Data da Criação: 23/01/2026                                               */
/* Ultima Modificaçãoo: 23/01/2026                                           */
/* ************************************************************************* */
const pdfParse = require("pdf-parse");
const mammoth = require("mammoth");
const WordExtractor = require("word-extractor");

/**
 * Detecta o tipo de arquivo com base na extensão
 */
function guessType(downloadUrl, fileName) {
  const s = (fileName || downloadUrl || "").toLowerCase();
  if (s.endsWith(".pdf")) return "pdf";
  if (s.endsWith(".docx")) return "docx";
  if (s.endsWith(".doc")) return "doc";
  return "unknown";
}

module.exports = async function handler(req, res) {
  // Garantir que é um método POST
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    let body = req.body;
    if (typeof body === "string") {
      try { body = JSON.parse(body); } catch (_) { body = {}; }
    }

    const downloadUrl = body && body.downloadUrl;
    const fileName = body && body.fileName;

    if (!downloadUrl) {
      return res.status(400).json({ error: "downloadUrl ausente" });
    }

    const type = guessType(downloadUrl, fileName);

    // Download do arquivo
    const r = await fetch(downloadUrl);
    if (!r.ok) {
      const t = await r.text();
      return res.status(400).json({
        error: `Falha ao baixar arquivo: HTTP ${r.status}`,
        detail: t.slice(0, 300)
      });
    }

    const arrayBuffer = await r.arrayBuffer();
    const buffer = Buffer.from(new Uint8Array(arrayBuffer));

    // Limite de segurança (15MB)
    if (buffer.length > 15 * 1024 * 1024) {
      return res.status(413).json({ error: "Arquivo muito grande (limite 15MB)" });
    }

    // --- Lógica de Extração por Tipo ---

    // 1. PDF
    if (type === "pdf") {
      const parsed = await pdfParse(buffer);
      return res.status(200).json({
        kind: "pdf",
        text: (parsed?.text || "").trim(),
        pages: parsed?.numpages || null
      });
    }

    // 2. DOCX (Word Moderno)
    if (type === "docx") {
      const result = await mammoth.extractRawText({ buffer });
      return res.status(200).json({
        kind: "docx",
        text: (result?.value || "").trim()
      });
    }

    // 3. DOC (Word Antigo 97-2003)
    if (type === "doc") {
      try {
        const extractor = new WordExtractor();
        const extracted = await extractor.extract(buffer);
        return res.status(200).json({
          kind: "doc",
          text: (extracted.getBody() || "").trim()
        });
      } catch (errDoc) {
        return res.status(422).json({
          error: "Erro ao processar arquivo .doc binário.",
          detail: "O arquivo pode estar corrompido ou protegido por senha."
        });
      }
    }

    // Caso o tipo seja desconhecido
    return res.status(400).json({
      error: "Tipo de arquivo não suportado.",
      hint: "O ValidaLex aceita apenas PDF, DOCX e DOC."
    });

  } catch (e) {
    return res.status(500).json({
      error: "Erro interno no servidor de extração",
      detail: String(e?.message || e)
    });
  }
};