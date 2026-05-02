import { classifyPublicationType } from "./articleScoring.mjs";

const runtimeEnv = typeof process !== "undefined" ? process.env : {};
const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const VALID_MODES = new Set(["Clinico", "Pesquisador", "Professor", "Conteudo"]);
const DEFAULT_MAX_OUTPUT_TOKENS = 1500;
const REQUIRED_RESPONSE_SECTIONS = [
  "## 1. Sintese geral",
  "## 2. Principais achados",
  "## 3. Consistencia da evidencia",
  "## 4. Limitacoes e vieses",
  "## 5. Aplicabilidade"
];

const MODE_GUIDANCE = {
  Clinico: "Foque aplicabilidade clinica, magnitude pratica, seguranca e diferenca entre desfechos clinicos e substitutos.",
  Pesquisador: "Foque desenho dos estudos, consistencia, heterogeneidade, vieses, lacunas e proximos estudos necessarios.",
  Professor: "Foque explicacao didatica, hierarquia da evidencia e pontos de ensino sem simplificar demais.",
  Conteudo: "Foque uma sintese clara para comunicacao profissional, sem sensacionalismo e sem prometer resultados."
};

const SCIENTIFIC_GUARDRAILS = [
  "Use exclusivamente os artigos fornecidos na entrada.",
  "Nao adicione, cite ou sugira estudos externos.",
  "Nao realize buscas adicionais nem use ferramentas externas.",
  "Nao utilize conhecimento fora dos abstracts e metadados fornecidos.",
  "Nao invente informacoes ausentes.",
  "Nao afirme conclusoes absolutas.",
  "Nao use expressoes vagas como 'a literatura mostra' ou 'estudos demonstram' sem referencia direta aos artigos fornecidos.",
  "Todas as conclusoes devem derivar diretamente dos abstracts e metadados fornecidos.",
  "Use linguagem cautelosa: sugere, foi associado, os dados indicam, entre os estudos fornecidos.",
  "Declare claramente que a analise e baseada apenas nos artigos fornecidos e que nenhuma nova fonte foi incluida.",
  "Se os dados forem insuficientes, inclua a frase: Os dados disponiveis sao limitados para uma conclusao robusta.",
  "Realize comparacao entre os estudos quando possivel: concordancia, divergencia e qualidade metodologica.",
  "Sempre inclua limitacoes e vieses.",
  "Priorize Meta-Analysis > Systematic Review > Randomized Controlled Trial > outros.",
  "Considere tamanho amostral quando informado no abstract.",
  "Diferencie desfechos clinicos de desfechos substitutos.",
  "Se um dado importante nao estiver no abstract, declare a limitacao em vez de inferir."
];

export async function runEvidenceDiscussion(input = {}, deps = {}) {
  const mode = normalizeMode(input.mode);
  const articles = prepareEvidenceDiscussionArticles(input.articles || [], {
    limit: input.maxArticles || 20
  });

  if (!articles.length) {
    const error = new Error("Nenhum artigo com dados suficientes para discutir.");
    error.statusCode = 400;
    error.publicMessage = "Nenhum artigo com dados suficientes para discutir.";
    throw error;
  }

  const apiKey = deps.openaiApiKey || runtimeEnv.OPENAI_API_KEY || "";
  if (!apiKey) {
    const error = new Error("OPENAI_API_KEY ausente.");
    error.statusCode = 503;
    error.publicMessage = "Motor de IA não configurado. Configure OPENAI_API_KEY no servidor.";
    throw error;
  }

  const model = deps.model || runtimeEnv.OPENAI_MODEL || "gpt-4.1-mini";
  const maxOutputTokens = normalizeMaxOutputTokens(deps.maxOutputTokens || runtimeEnv.OPENAI_MAX_OUTPUT_TOKENS);
  const prompt = buildEvidenceDiscussionPrompt({
    mode,
    query: input.query || "",
    articles
  });

  const analysisMarkdown = await createOpenAIAnalysis({
    apiKey,
    model,
    prompt,
    compactPrompt: buildEvidenceDiscussionPrompt({
      mode,
      query: input.query || "",
      articles,
      compact: true
    }),
    fetchImpl: deps.fetchImpl || fetch,
    timeoutMs: Number(runtimeEnv.OPENAI_TIMEOUT_MS || 45_000),
    maxOutputTokens
  });

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    mode,
    model,
    selectedCount: articles.length,
    selectedArticles: articles.map(({ pmid, title, year, studyType, evidenceLevel, sampleSize }) => ({
      pmid,
      title,
      year,
      studyType,
      evidenceLevel,
      sampleSize
    })),
    analysisMarkdown
  };
}

export function prepareEvidenceDiscussionArticles(articles = [], options = {}) {
  const limit = clampNumber(options.limit, 1, 20, 20);

  // A IA recebe uma amostra pequena e rastreavel, priorizada pela hierarquia metodologica.
  return articles
    .map(normalizeDiscussionArticle)
    .filter((article) => article.title && article.pmid)
    .sort(sortForDiscussion)
    .slice(0, limit);
}

export function buildEvidenceDiscussionPrompt({ mode, query, articles, compact = false }) {
  const articleBlocks = articles.map(formatArticleForPrompt).join("\n\n");
  const modeGuidance = MODE_GUIDANCE[mode] || MODE_GUIDANCE.Clinico;
  const sizeInstruction = compact
    ? "MODO COMPACTO: responda em no maximo 450 palavras, mantendo todas as cinco secoes."
    : "Responda de forma objetiva e completa, sem redundancias.";

  return [
    "Tarefa: analisar criticamente os artigos retornados pela Busca PubMed.",
    `Modo selecionado: ${mode}. ${modeGuidance}`,
    query ? `Query/contexto da busca: ${query}` : "",
    sizeInstruction,
    "",
    "Regras obrigatorias:",
    ...SCIENTIFIC_GUARDRAILS.map((rule) => `- ${rule}`),
    "",
    "Formato obrigatorio da resposta em portugues do Brasil:",
    "## 1. Sintese geral",
    "Texto curto, no maximo 3 frases.",
    "## 2. Principais achados",
    "Use bullet points. No maximo 5 bullets, cada bullet com 1 frase.",
    "## 3. Consistencia da evidencia",
    "Texto curto, no maximo 3 frases.",
    "## 4. Limitacoes e vieses",
    "Texto curto, no maximo 5 frases. Esta secao e obrigatoria.",
    "## 5. Aplicabilidade",
    "Texto curto, no maximo 3 frases.",
    "",
    "Cada secao deve ter no maximo 3 a 5 frases.",
    "Evite repeticoes e priorize clareza sobre detalhamento excessivo.",
    "Sempre entregue as cinco secoes completas e nao termine no meio de uma frase.",
    "Se houver risco de exceder o limite, reduza o detalhamento das secoes 3 e 5, mas preserve sintese, principais achados e limitacoes.",
    "Referencia dos estudos: use preferencialmente Estudo 1, Estudo 2 etc. e inclua PMIDs quando fizer afirmacoes especificas.",
    "Declare no inicio que a analise usa apenas os artigos fornecidos e nao inclui novas fontes.",
    "Em cada secao, cite PMIDs quando fizer afirmacoes especificas.",
    "Na secao de limitacoes, inclua obrigatoriamente limitacoes dos abstracts, tamanho amostral ausente/pequeno quando aplicavel, desenho dos estudos e risco de extrapolacao.",
    "",
    "Artigos fornecidos:",
    articleBlocks
  ].filter(Boolean).join("\n");
}

function normalizeDiscussionArticle(article = {}) {
  const typeProfile = classifyPublicationType(article);
  const abstractText = firstText(
    article.abstractText,
    article.abstract,
    article.abstractRecord?.abstractText
  );
  const fallbackText = firstText(
    article.description?.mainResult,
    article.description?.conclusion
  );
  const evidenceText = abstractText || fallbackText;

  return {
    pmid: String(article.pmid || "").trim(),
    doi: String(article.doi || "").trim(),
    title: String(article.title || "").trim(),
    year: String(article.year || "").trim(),
    studyType: String(article.studyType || "Tipo de estudo não informado").trim(),
    evidenceLevel: article.scoring?.evidenceLevel || typeProfile.evidenceLevel,
    evidenceRank: article.scoring?.evidenceRank || typeProfile.evidenceRank,
    scoreTotal: Number(article.scoring?.scoreTotal || 0),
    hasAbstract: Boolean(abstractText || article.hasAbstract),
    abstractText: truncateText(abstractText, 2200),
    evidenceText: truncateText(evidenceText, 2200),
    evidenceSource: abstractText ? "Abstract" : "Resumo derivado/metadados",
    sampleSize: extractSampleSize(evidenceText)
  };
}

function sortForDiscussion(a, b) {
  return (a.evidenceRank || 99) - (b.evidenceRank || 99)
    || Number(b.scoreTotal || 0) - Number(a.scoreTotal || 0)
    || Number(b.hasAbstract) - Number(a.hasAbstract)
    || Number(b.year || 0) - Number(a.year || 0);
}

function formatArticleForPrompt(article, index) {
  // O prompt envia apenas metadados e texto recuperados da busca, sem contexto externo.
  return [
    `ARTIGO ${index + 1}`,
    `PMID: ${article.pmid}`,
    article.doi ? `DOI: ${article.doi}` : "",
    `Titulo: ${article.title}`,
    `Ano: ${article.year || "nao informado"}`,
    `Tipo de estudo: ${article.studyType}`,
    `Nivel/ranking de evidencia: ${article.evidenceLevel}`,
    `Tamanho amostral identificado: ${article.sampleSize || "nao informado no texto fornecido"}`,
    `Fonte textual: ${article.evidenceSource}`,
    `Texto disponível: ${article.evidenceText || "Sem abstract recuperado; usar apenas como limitacao."}`
  ].filter(Boolean).join("\n");
}

async function createOpenAIAnalysis({ apiKey, model, prompt, compactPrompt, fetchImpl, timeoutMs, maxOutputTokens }) {
  const first = await requestOpenAIAnalysis({
    apiKey,
    model,
    prompt,
    fetchImpl,
    timeoutMs,
    maxOutputTokens
  });

  let text = extractResponseText(first);
  if (isIncompleteResponse(first) || looksAbrupt(text)) {
    const retry = await requestOpenAIAnalysis({
      apiKey,
      model,
      prompt: compactPrompt || prompt,
      fetchImpl,
      timeoutMs,
      maxOutputTokens
    });
    text = extractResponseText(retry);
  }

  if (!text) {
    const error = new Error("A IA não retornou texto analisável.");
    error.statusCode = 502;
    error.publicMessage = "A IA não retornou uma análise válida. Tente novamente.";
    throw error;
  }

  return completeStructuredAnalysis(text);
}

async function requestOpenAIAnalysis({ apiKey, model, prompt, fetchImpl, timeoutMs, maxOutputTokens }) {
  const response = await fetchImpl(OPENAI_RESPONSES_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      instructions: [
        "Voce e um assistente de sintese critica de evidencia cientifica.",
        "Responda sempre em portugues do Brasil.",
        ...SCIENTIFIC_GUARDRAILS
      ].join("\n"),
      input: prompt,
      max_output_tokens: maxOutputTokens,
      text: { format: { type: "text" } }
    }),
    signal: timeoutSignal(timeoutMs)
  });

  if (!response.ok) throw await openAIHttpError(response);

  return response.json();
}

function extractResponseText(data = {}) {
  if (typeof data.output_text === "string" && data.output_text.trim()) return data.output_text;

  const chunks = [];
  for (const item of data.output || []) {
    for (const content of item.content || []) {
      if (typeof content.text === "string") chunks.push(content.text);
      if (typeof content.output_text === "string") chunks.push(content.output_text);
    }
  }
  return chunks.join("\n").trim();
}

function isIncompleteResponse(data = {}) {
  return data.status === "incomplete" || data.incomplete_details?.reason === "max_output_tokens";
}

function looksAbrupt(value = "") {
  const text = String(value || "").trim();
  if (!text) return true;
  if (text.length < 80) return true;
  return !/[.!?)]$/.test(text);
}

function completeStructuredAnalysis(value = "") {
  let text = trimAbruptEnding(String(value || "").trim());
  for (const heading of REQUIRED_RESPONSE_SECTIONS) {
    if (!hasSectionHeading(text, heading)) {
      text += `\n\n${heading}\nOs dados disponiveis sao limitados para uma conclusao robusta sem extrapolar os artigos fornecidos.`;
    }
  }
  return text.trim();
}

function trimAbruptEnding(value = "") {
  const text = String(value || "").trim();
  if (!text || !looksAbrupt(text)) return text;
  const lastSentenceEnd = Math.max(text.lastIndexOf("."), text.lastIndexOf("!"), text.lastIndexOf("?"));
  if (lastSentenceEnd > Math.floor(text.length * 0.55)) return text.slice(0, lastSentenceEnd + 1).trim();
  return `${text.replace(/[,\s;:]+$/, "")}.`;
}

function hasSectionHeading(text, heading) {
  const normalizedText = normalizePlain(text);
  const normalizedHeading = normalizePlain(heading).replace(/^##\s*/, "");
  return normalizedText.includes(normalizedHeading);
}

function extractSampleSize(value = "") {
  const text = String(value || "");
  const patterns = [
    /\b(?:n|N)\s*=\s*([0-9][0-9.,]*)\b/,
    /\b([0-9][0-9.,]*)\s+(?:patients|participants|subjects|adults|children|individuals|cases)\b/i,
    /\b(?:included|enrolled|randomized|analysed|analyzed)\s+([0-9][0-9.,]*)\b/i,
    /\bsample\s+of\s+([0-9][0-9.,]*)\b/i
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1].replace(/\.$/, "");
  }
  return "";
}

async function openAIHttpError(response) {
  let detail = "";
  try {
    const body = await response.json();
    detail = body?.error?.message || JSON.stringify(body).slice(0, 240);
  } catch {
    try {
      detail = (await response.text()).slice(0, 240);
    } catch {
      detail = "";
    }
  }

  const error = new Error(`OpenAI respondeu HTTP ${response.status}${detail ? `: ${detail}` : ""}`);
  error.statusCode = response.status === 401 ? 503 : 502;
  error.publicMessage = response.status === 401
    ? "Motor de IA não autorizado. Verifique OPENAI_API_KEY no servidor."
    : "Falha ao gerar a análise por IA. Tente novamente.";
  return error;
}

function normalizeMode(value) {
  const normalized = String(value || "Clinico").trim();
  return VALID_MODES.has(normalized) ? normalized : "Clinico";
}

function firstText(...values) {
  return values
    .map((value) => String(value || "").replace(/\s+/g, " ").trim())
    .find(Boolean) || "";
}

function truncateText(value, maxLength) {
  const clean = firstText(value);
  if (clean.length <= maxLength) return clean;
  return `${clean.slice(0, maxLength).replace(/\s+\S*$/, "").trim()}...`;
}

function clampNumber(value, min, max, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

function normalizeMaxOutputTokens(value) {
  return clampNumber(value, 1200, 1500, DEFAULT_MAX_OUTPUT_TOKENS);
}

function normalizePlain(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function timeoutSignal(timeoutMs) {
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
    return AbortSignal.timeout(timeoutMs);
  }
  return undefined;
}
