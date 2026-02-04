/* ************************************************************************* */
/* Nome do codigo: api/extract.js (Vercel)Trata arquivo PDF, DOCX e DOC      */
/* Data da Criação: 23/01/2026                                               */
/* Ultima Modificaçãoo: 04/02/2026                                           */
/* - blindagem: requestId + CORS + OPTIONS + timeout download                */
/* ************************************************************************* */

const pdfParse = require("pdf-parse");
const mammoth = require("mammoth");
const WordExtractor = require("word-extractor");

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Request-Id");
  res.setHeader("Access-Control-Max-Age", "86400");
}

function safeJson(res, status, obj) {
  res.status(status);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(obj));
}

function makeRequestId() {
  return `${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 10)}`;
}

function guessType(downloadUrl, fileName) {
  const s = (fileName || downloadUrl || "").toLowerCase();
  if (s.endsWith(".pdf")) return "pdf";
  if (s.endsWith(".docx")) return "docx";
  if (s.endsWith(".doc")) return "doc";
  return "unknown";
}

async function readBodyJson(req) {
  let body = req.body;
  if (!body) return {};
  if (typeof body === "string") {
    try { return JSON.parse(body); } catch (_) { return {}; }
  }
  return body;
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const r = await fetch(url, { ...options, signal: controller.signal });
    return r;
  } finally {
    clearTimeout(t);
  }
}

module.exports = async function handler(req, res) {
  setCors(res);

  const requestId = (req.headers["x-request-id"] || "").toString().trim() || makeRequestId();

  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }

  if (req.method !== "POST") {
    return safeJson(res, 405, { ok: false, requestId, error: "Method not allowed" });
  }

  try {
    const body = await readBodyJson(req);
    const downloadUrl = body && body.downloadUrl;
    const fileName = body && body.fileName;

    if (!downloadUrl) {
      return safeJson(res, 400, { ok: false, requestId, error: "downloadUrl ausente" });
    }

    const type = guessType(downloadUrl, fileName);

    // Download do arquivo (timeout para evitar travar e virar 500)
    let r;
    try {
      r = await fetchWithTimeout(downloadUrl, {}, 25000);
    } catch (e) {
      const isAbort = String(e?.name || "").toLowerCase().includes("abort");
      return safeJson(res, isAbort ? 504 : 502, {
        ok: false,
        requestId,
        error: isAbort ? "Timeout ao baixar o arquivo" : "Falha ao baixar o arquivo",
        detail: String(e?.message || e)
      });
    }

    if (!r.ok) {
      const t = await r.text();
      return safeJson(res, 400, {
        ok: false,
        requestId,
        error: `Falha ao baixar arquivo: HTTP ${r.status}`,
        detail: t.slice(0, 300)
      });
    }

    const arrayBuffer = await r.arrayBuffer();
    const buffer = Buffer.from(new Uint8Array(arrayBuffer));

    // Limite de segurança (15MB)
    if (buffer.length > 15 * 1024 * 1024) {
      return safeJson(res, 413, { ok: false, requestId, error: "Arquivo muito grande (limite 15MB)" });
    }

    // 1) PDF
    if (type === "pdf") {
      const parsed = await pdfParse(buffer);
      return safeJson(res, 200, {
        ok: true,
        requestId,
        kind: "pdf",
        text: (parsed?.text || "").trim(),
        pages: parsed?.numpages || null
      });
    }

    // 2) DOCX
    if (type === "docx") {
      const result = await mammoth.extractRawText({ buffer });
      return safeJson(res, 200, {
        ok: true,
        requestId,
        kind: "docx",
        text: (result?.value || "").trim()
      });
    }

    // 3) DOC
    if (type === "doc") {
      try {
        const extractor = new WordExtractor();
        const extracted = await extractor.extract(buffer);
        return safeJson(res, 200, {
          ok: true,
          requestId,
          kind: "doc",
          text: (extracted.getBody() || "").trim()
        });
      } catch (_) {
        return safeJson(res, 422, {
          ok: false,
          requestId,
          error: "Erro ao processar arquivo .doc binário.",
          detail: "O arquivo pode estar corrompido ou protegido por senha."
        });
      }
    }

    return safeJson(res, 400, {
      ok: false,
      requestId,
      error: "Tipo de arquivo não suportado.",
      hint: "O ValidaLex aceita apenas PDF, DOCX e DOC."
    });

  } catch (e) {
    return safeJson(res, 500, {
      ok: false,
      requestId,
      error: "Erro interno no servidor de extração",
      detail: String(e?.message || e)
    });
  }
};
