/* ************************************************************************* */
/* Nome do codigo: api/analyze.js (Vercel)                                   */
/* Data da Criação: 23/01/2026                                               */
/* Ultima Modificaçãoo: 26/01/2026                                           */
/* - atualizado com Prompt Master v1 em 3 partes + schema novo               */
/* - Implementação da função ajuste de hora para mostrar a geração correta   */
/* ************************************************************************* */

/* ************************************************************************* */
/* Nome do codigo: api/analyze.js (Vercel)                                   */
/* Data da Criação: 23/01/2026                                               */
/* Ultima Modificaçãoo: 26/01/2026                                           */
/* - atualizado com Prompt Master v1 em 3 partes + schema novo               */
/* ************************************************************************* */

const { LEGAL_PROMPT_V1 } = require("../lib/prompts/legalPrompt.v1.js");

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');
}

function tryJsonRepair(s) {
  if (!s) return s;

  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  let t = fenced ? fenced[1] : s;

  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) t = t.slice(start, end + 1);

  t = t.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
  t = t.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
  t = t.replace(/,\s*([}\]])/g, '$1');

  return t;
}

function pickStructuredOutputRobust(aiData) {
  const output = aiData?.output || [];

  for (const item of output) {
    if (item?.type !== "message") continue;
    const arr = item?.content || [];
    const found = arr.find(c => c?.type === "output_json" && c?.json);
    if (found?.json) return { ok: true, json: found.json, source: "output_json" };
  }

  let outText = aiData?.output_text || "";
  if (!outText) {
    for (const item of output) {
      if (item?.type !== "message") continue;
      const arr = item?.content || [];
      const chunk = arr.find(c => c?.type === "output_text" && typeof c?.text === "string");
      if (chunk?.text) { outText = chunk.text; break; }
    }
  }

  if (!outText) {
    return { ok: false, code: "missing_output", detail: "Sem output_json e sem output_text." };
  }

  try {
    return { ok: true, json: JSON.parse(outText), source: "output_text" };
  } catch (_) {}

  const repaired = tryJsonRepair(outText);
  try {
    return { ok: true, json: JSON.parse(repaired), source: "output_text_repaired" };
  } catch (e2) {
    return {
      ok: false,
      code: "json_parse_failed",
      detail: String(e2?.message || e2),
      snippet: outText.slice(0, 1200),
      repairedSnippet: repaired.slice(0, 1200)
    };
  }
}

function sanitizeArray(arr, maxItems, maxLen) {
  if (!Array.isArray(arr)) return [];
  const out = arr.map(x => String(x || '').trim()).filter(Boolean);
  const cut = typeof maxItems === 'number' ? out.slice(0, maxItems) : out;
  return typeof maxLen === 'number' ? cut.map(x => x.slice(0, maxLen)) : cut;
}

function sanitizeEnum(v, allowed, fallback) {
  const s = String(v || '').trim().toLowerCase();
  return allowed.includes(s) ? s : fallback;
}

function normalizeFileName(name) {
  const base = String(name || "arquivo").trim();
  return base.replace(/[\\/:*?"<>|]+/g, '-').slice(0, 80);
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* NOVO: formato determinístico em horário do Brasil (America/Sao_Paulo) */
function formatSaoPauloDateTime(date = new Date()) {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    dateStyle: 'short',
    timeStyle: 'medium'
  }).format(date);
}

function buildReportHtml({ fileName, meta, report }) {
  const title = `Relatório - ${normalizeFileName(fileName)}`;
  const now = formatSaoPauloDateTime(new Date());

  const metaHtml = (meta || []).map(x => `<li>${escapeHtml(x)}</li>`).join('');
  const obsFinais = sanitizeArray(report?.observacoes_finais, 20, 300);

  const qualidade = report?.qualidade_do_texto || {};
  const qualObs = sanitizeArray(qualidade?.observacoes, 10, 240);

  const elementos = Array.isArray(report?.elementos_essenciais) ? report.elementos_essenciais : [];
  const riscos = Array.isArray(report?.riscos) ? report.riscos : [];
  const lacunas = Array.isArray(report?.lacunas_e_perguntas) ? report.lacunas_e_perguntas : [];

  const elemRows = elementos.map(e => `
    <tr>
      <td>${escapeHtml(e?.elemento || '')}</td>
      <td>${escapeHtml(e?.status || '')}</td>
      <td>${escapeHtml(e?.evidencia_trecho || '')}</td>
    </tr>
  `.trim()).join('');

  const riscosRows = riscos.map(r => `
    <tr>
      <td>${escapeHtml(r?.risco || '')}</td>
      <td>${escapeHtml(r?.nivel || '')}</td>
      <td>${escapeHtml(r?.fato_textual_evidencia || '')}</td>
      <td>${escapeHtml((Array.isArray(r?.inferencias) ? r.inferencias.join(' | ') : ''))}</td>
      <td>${escapeHtml(r?.impacto_pratico || '')}</td>
      <td>${escapeHtml(r?.mitigacao_recomendada || '')}</td>
    </tr>
  `.trim()).join('');

  const lacRows = lacunas.map(l => `
    <tr>
      <td>${escapeHtml(l?.ponto || '')}</td>
      <td>${escapeHtml(l?.status || '')}</td>
      <td>${escapeHtml(l?.por_que_importa || '')}</td>
      <td>${escapeHtml(l?.pergunta_objetiva || '')}</td>
    </tr>
  `.trim()).join('');

  const cls = report?.doc_classification || {};

  const obsFinaisHtml = obsFinais.map(x => `<li>${escapeHtml(x)}</li>`).join('');
  const qualObsHtml = qualObs.map(x => `<li>${escapeHtml(x)}</li>`).join('');

  return `
<!doctype html>
<html lang="pt-br">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>
    html, body { background: #fff; }
    body { font-family: Arial, sans-serif; line-height: 1.35; margin: 24px; }
    h1 { margin: 0 0 6px 0; }
    .sub { color: #555; margin: 0 0 18px 0; }
    .card { border: 1px solid #ddd; border-radius: 10px; padding: 14px 16px; margin: 12px 0; }
    ul { margin: 8px 0 0 20px; }
    table { width: 100%; border-collapse: collapse; margin-top: 10px; }
    th, td { border: 1px solid #ddd; padding: 8px; vertical-align: top; }
    th { background: #f6f6f6; text-align: left; }
    .small { color:#666; font-size: 12px; }
    .warn { color: #7a4b00; }
  </style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  <p class="sub">Gerado em: ${escapeHtml(now)}</p>

  <div class="card">
    <b>Metadados</b>
    <ul>${metaHtml}</ul>
    <p class="small warn">Este relatório auxilia na revisão, não substitui análise jurídica profissional.</p>
  </div>

  <div class="card">
    <b>Classificação</b>
    <p><b>Tipo:</b> ${escapeHtml(cls?.tipo || '')} &nbsp; <b>Área:</b> ${escapeHtml(cls?.area || '')} &nbsp; <b>Confiança:</b> ${escapeHtml(String(cls?.confianca ?? ''))}</p>
  </div>

  <div class="card">
    <b>Qualidade do texto</b>
    <p><b>Status:</b> ${escapeHtml(qualidade?.status || '')}</p>
    <ul>${qualObsHtml || '<li>Sem observações.</li>'}</ul>
  </div>

  <div class="card">
    <b>Elementos essenciais</b>
    ${elemRows
      ? `<table>
          <thead><tr><th>Elemento</th><th>Status</th><th>Evidência</th></tr></thead>
          <tbody>${elemRows}</tbody>
        </table>`
      : `<p>Nenhum elemento retornado.</p>`
    }
  </div>

  <div class="card">
    <b>Riscos</b>
    ${riscosRows
      ? `<table>
          <thead><tr>
            <th>Risco</th><th>Nível</th><th>Evidência</th><th>Inferências</th><th>Impacto</th><th>Mitigação</th>
          </tr></thead>
          <tbody>${riscosRows}</tbody>
        </table>`
      : `<p>Nenhum risco estruturado retornado.</p>`
    }
  </div>

  <div class="card">
    <b>Lacunas e perguntas</b>
    ${lacRows
      ? `<table>
          <thead><tr><th>Ponto</th><th>Status</th><th>Por que importa</th><th>Pergunta</th></tr></thead>
          <tbody>${lacRows}</tbody>
        </table>`
      : `<p>Nenhuma lacuna retornada.</p>`
    }
  </div>

  <div class="card">
    <b>Observações finais</b>
    <ul>${obsFinaisHtml || '<li>Sem observações finais.</li>'}</ul>
  </div>

</body>
</html>
`.trim();
}

module.exports = async function handler(req, res) {
  setCors(res);

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    // IMPORTANTE: não aceitar prompt vindo do cliente
    const { downloadUrl, fileName } = req.body || {};
    if (!downloadUrl) return res.status(400).json({ error: 'downloadUrl ausente' });

    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    if (!OPENAI_API_KEY) return res.status(500).json({ error: 'OPENAI_API_KEY ausente no env da Vercel' });

    // 1) Extrai texto chamando /api/extract no mesmo projeto Vercel
    const base = `https://${req.headers.host}`;
    const extractResp = await fetch(`${base}/api/extract`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ downloadUrl, fileName })
    });

    const extractRaw = await extractResp.text();
    if (!extractResp.ok) {
      return res.status(extractResp.status).json({ error: 'Falha no extract', detail: extractRaw.slice(0, 1200) });
    }

    let extract;
    try { extract = JSON.parse(extractRaw); }
    catch (_) { return res.status(500).json({ error: 'extract retornou não-JSON', detail: extractRaw.slice(0, 1200) }); }

    const extractedText = String(extract?.text || '').trim();
    const kind = extract?.kind || 'unknown';
    const pages = extract?.pages ?? null;

    const meta = [
      `Arquivo: ${fileName || 'arquivo'}`,
      `Extraído via ValidaLex Extrator: ${kind}${pages ? ` (${pages} pág.)` : ''}`
    ];

    if (extractedText.length < 80) {
      const minimal = {
        doc_classification: { tipo: "Indeterminado", area: "Indeterminada", confianca: 0 },
        qualidade_do_texto: { status: "ruim", observacoes: ["Texto extraído insuficiente."] },
        elementos_essenciais: [],
        riscos: [
          {
            risco: "Risco operacional: texto insuficiente para análise",
            nivel: "alto",
            fato_textual_evidencia: "Sem evidência direta no texto",
            inferencias: [],
            impacto_pratico: "Conclusões jurídicas ficam comprometidas; pode haver omissões relevantes.",
            mitigacao_recomendada: "Reenviar arquivo com texto selecionável ou habilitar OCR no extrator."
          }
        ],
        lacunas_e_perguntas: [
          {
            ponto: "Conteúdo do documento não está disponível no texto extraído",
            status: "ausente",
            por_que_importa: "Sem o conteúdo, não é possível validar estrutura, obrigações e riscos.",
            pergunta_objetiva: "O documento original possui texto selecionável? Há versão .docx?"
          }
        ],
        observacoes_finais: [...meta]
      };

      const reportHtml = buildReportHtml({ fileName, meta, report: minimal });

      return res.status(200).json({
        report: minimal,
        reportHtml,
        reportFileName: `relatorio-${normalizeFileName(fileName)}.html`
      });
    }

    // 2) Schema novo (rigoroso) alinhado ao prompt
    const schema = {
      type: "object",
      additionalProperties: false,
      properties: {
        doc_classification: {
          type: "object",
          additionalProperties: false,
          properties: {
            tipo: { type: "string", maxLength: 80 },
            area: { type: "string", maxLength: 80 },
            confianca: { type: "number", minimum: 0, maximum: 1 }
          },
          required: ["tipo", "area", "confianca"]
        },
        qualidade_do_texto: {
          type: "object",
          additionalProperties: false,
          properties: {
            status: { type: "string", enum: ["boa", "suspeita", "ruim"] },
            observacoes: {
              type: "array",
              maxItems: 10,
              items: { type: "string", maxLength: 240 }
            }
          },
          required: ["status", "observacoes"]
        },
        elementos_essenciais: {
          type: "array",
          maxItems: 20,
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              elemento: { type: "string", maxLength: 80 },
              status: { type: "string", enum: ["presente", "ausente", "ambiguo"] },
              evidencia_trecho: { type: "string", maxLength: 260 }
            },
            required: ["elemento", "status", "evidencia_trecho"]
          }
        },
        riscos: {
          type: "array",
          maxItems: 12,
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              risco: { type: "string", maxLength: 200 },
              nivel: { type: "string", enum: ["baixo", "medio", "alto"] },
              fato_textual_evidencia: { type: "string", maxLength: 260 },
              inferencias: {
                type: "array",
                maxItems: 6,
                items: { type: "string", maxLength: 160 }
              },
              impacto_pratico: { type: "string", maxLength: 260 },
              mitigacao_recomendada: { type: "string", maxLength: 260 }
            },
            required: ["risco", "nivel", "fato_textual_evidencia", "inferencias", "impacto_pratico", "mitigacao_recomendada"]
          }
        },
        lacunas_e_perguntas: {
          type: "array",
          maxItems: 12,
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              ponto: { type: "string", maxLength: 180 },
              status: { type: "string", enum: ["ausente", "ambiguo"] },
              por_que_importa: { type: "string", maxLength: 220 },
              pergunta_objetiva: { type: "string", maxLength: 220 }
            },
            required: ["ponto", "status", "por_que_importa", "pergunta_objetiva"]
          }
        },
        observacoes_finais: {
          type: "array",
          maxItems: 20,
          items: { type: "string", maxLength: 260 }
        }
      },
      required: ["doc_classification", "qualidade_do_texto", "elementos_essenciais", "riscos", "lacunas_e_perguntas", "observacoes_finais"]
    };

    // 3) Mensagens (3 partes) + task
    const MAX_INPUT_CHARS = 9000;

    const messages = [
      { role: "system", content: LEGAL_PROMPT_V1.system },
      { role: "system", content: LEGAL_PROMPT_V1.rules },
      { role: "user", content: LEGAL_PROMPT_V1.task({ fileName, extractedText, maxChars: MAX_INPUT_CHARS }) }
    ];

    // 4) OpenAI Responses API com json_schema estrito
    const aiResp = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.2,
        max_output_tokens: 1200,
        input: messages,
        text: {
          format: {
            type: "json_schema",
            strict: true,
            name: "relatorio_validacao_juridica_v1",
            schema
          }
        }
      })
    });

    const aiRaw = await aiResp.text();
    if (!aiResp.ok) {
      return res.status(aiResp.status).json({ error: "OpenAI erro", detail: aiRaw.slice(0, 1200) });
    }

    let aiData;
    try { aiData = JSON.parse(aiRaw); }
    catch (_) { return res.status(500).json({ error: "OpenAI retornou não-JSON", detail: aiRaw.slice(0, 1200) }); }

    const picked = pickStructuredOutputRobust(aiData);
    if (!picked.ok) {
      return res.status(502).json({
        error: "OpenAI retornou saída não-parseável",
        code: picked.code,
        detail: picked.detail,
        snippet: picked.snippet || "",
        repairedSnippet: picked.repairedSnippet || ""
      });
    }

    /** @type {any} */
    const report = picked.json || {};

    // 5) Sanitização leve (garantia extra)
    report.observacoes_finais = sanitizeArray(report.observacoes_finais, 20, 260);

    // Força metadados no final (auditabilidade)
    const fullFinalObs = [...meta, ...(Array.isArray(report.observacoes_finais) ? report.observacoes_finais : [])];
    report.observacoes_finais = fullFinalObs.slice(0, 20);

    // 6) HTML
    const reportHtml = buildReportHtml({ fileName, meta, report });
    const reportFileName = `relatorio-${normalizeFileName(fileName)}.html`;

    return res.status(200).json({
      report,
      reportHtml,
      reportFileName
    });

  } catch (err) {
    return res.status(500).json({ error: 'Unhandled', message: String(err?.message || err) });
  }
}
