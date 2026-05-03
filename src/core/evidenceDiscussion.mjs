import { classifyPublicationType } from "./articleScoring.mjs";

const runtimeEnv = typeof process !== "undefined" ? process.env : {};
const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const VALID_MODES = new Set(["Clinico", "Pesquisador", "Professor", "Conteudo"]);
const DEFAULT_MAX_OUTPUT_TOKENS = 1500;

const MODE_GUIDANCE = {
  Clinico: [
    "Foco do modo Clinico: decisao pratica.",
    "Interprete os resultados para aplicacao clinica, destacando quando usar, quando evitar, riscos e beneficios.",
    "Priorize impacto na pratica e evite aprofundamento metodologico excessivo."
  ],
  Pesquisador: [
    "Foco do modo Pesquisador: validade cientifica.",
    "Avalie desenho dos estudos, N e poder amostral, risco de vies, consistencia dos resultados e confiabilidade da evidencia.",
    "Evite recomendacoes praticas diretas; discuta incerteza, robustez e lacunas."
  ],
  Professor: [
    "Foco do modo Professor: didatica.",
    "Explique os achados de forma progressiva, organize o raciocinio em etapas e traduza conceitos complexos.",
    "Use linguagem clara e estruturada, mantendo rigor sem excesso tecnico."
  ],
  Conteudo: [
    "Foco do modo Conteudo: comunicacao.",
    "Extraia mensagens-chave, insights principais e frases claras utilizaveis.",
    "Mantenha precisao cientifica e evite excesso de detalhamento tecnico."
  ]
};

const MODE_RESPONSE_STRUCTURES = {
  Clinico: {
    label: "MODO CLINICO (DECISAO)",
    prohibition: "Proibido: evite analise metodologica extensa.",
    sections: [
      ["## 1. O que isso muda na pratica", "Interprete impacto clinico, direcao dos achados, N quando disponivel e relevancia para decisao."],
      ["## 2. Quando aplicar", "Liste condicoes clinicas ou perfis de paciente em que os dados favorecem uso cauteloso."],
      ["## 3. Quando evitar", "Liste cenarios em que os dados nao sustentam uso, sugerem neutralidade, dano ou incerteza."],
      ["## 4. Riscos importantes", "Descreva riscos, limites de seguranca e principais incertezas dos estudos."]
    ]
  },
  Pesquisador: {
    label: "MODO PESQUISADOR (CRITICO)",
    prohibition: "Proibido: nao dar recomendacoes clinicas diretas.",
    sections: [
      ["## 1. Qualidade da evidencia", "Avalie hierarquia, desenho, direcao dos achados, N e relevancia estatistica quando informada."],
      ["## 2. Principais vieses", "Aponte vieses plausiveis a partir dos abstracts e metadados, sem extrapolar."],
      ["## 3. Limitacoes metodologicas", "Discuta N, poder amostral, heterogeneidade, desfechos clinicos/substitutos e lacunas."],
      ["## 4. Grau de confiabilidade", "Classifique de forma cautelosa a confiabilidade geral e consistencia dos resultados."]
    ]
  },
  Professor: {
    label: "MODO PROFESSOR (DIDATICO)",
    prohibition: "Proibido: evitar linguagem excessivamente tecnica.",
    sections: [
      ["## 1. Explicacao do fenomeno", "Explique a pergunta clinica/cientifica em linguagem progressiva e clara."],
      ["## 2. Como interpretar os resultados", "Ensine como ler direcao dos achados, N, tipo de estudo e relevancia estatistica quando informada."],
      ["## 3. O que isso significa na pratica", "Traduza os achados para significado pratico sem transformar em recomendacao absoluta."],
      ["## 4. Onde os alunos costumam errar", "Liste erros comuns de interpretacao, incluindo confundir associacao, significancia e causalidade."]
    ]
  },
  Conteudo: {
    label: "MODO CONTEUDO (COMUNICACAO)",
    prohibition: "Proibido: evitar detalhamento tecnico profundo.",
    sections: [
      ["## 1. Mensagem principal", "Entregue uma mensagem curta, fiel aos dados e sem promessa absoluta."],
      ["## 2. 3 insights principais", "Liste exatamente 3 insights em bullets, incluindo direcao dos achados, N quando disponivel e limites."],
      ["## 3. Frases utilizaveis", "Crie frases curtas para comunicacao profissional, sem sensacionalismo."],
      ["## 4. Como comunicar isso para leigos/profissionais", "Diferencie como falar com publico leigo e com profissionais, mantendo precisao cientifica."]
    ]
  }
};

const SHARED_MODE_REQUIREMENTS = [
  "Principais resultados dos estudos.",
  "Direcao dos achados: beneficio, neutro ou dano, quando os dados permitirem.",
  "N/tamanho amostral quando disponivel; se nao estiver no abstract, declarar como nao informado.",
  "Referencia aos estudos como Estudo 1, Estudo 2 etc. e PMIDs quando fizer afirmacoes especificas.",
  "Relevancia estatistica quando estiver informada ou claramente inferivel; se nao estiver, declarar que nao foi informada.",
  "Limitacoes gerais dos dados, sem redundancia."
];

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
    mode,
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
  const responseStructure = getModeResponseStructure(mode);
  const sizeInstruction = compact
    ? "MODO COMPACTO: responda em no maximo 450 palavras, mantendo todas as secoes obrigatorias do modo."
    : "Responda de forma objetiva e completa, sem redundancias.";

  return [
    "Tarefa: analisar criticamente os artigos retornados pela Busca PubMed.",
    `Modo selecionado: ${mode}.`,
    "Diferenciacao obrigatoria do modo selecionado:",
    ...modeGuidance.map((rule) => `- ${rule}`),
    query ? `Query/contexto da busca: ${query}` : "",
    sizeInstruction,
    "",
    "Base obrigatoria para todos os modos:",
    ...SHARED_MODE_REQUIREMENTS.map((rule) => `- ${rule}`),
    "",
    "Regras obrigatorias:",
    ...SCIENTIFIC_GUARDRAILS.map((rule) => `- ${rule}`),
    "",
    `Formato obrigatorio e exclusivo da resposta: ${responseStructure.label}`,
    responseStructure.prohibition,
    "Use exatamente as secoes abaixo, nesta ordem. Nao use a estrutura de outros modos.",
    ...responseStructure.sections.flatMap(([heading, instruction]) => [
      heading,
      instruction
    ]),
    "",
    "Regra absoluta de diferenciacao: se comparada a outro modo, esta resposta deve ter estrutura, foco e utilidade claramente diferentes; similaridade acima de 40% e considerada erro.",
    "Incorpore a base obrigatoria dentro das secoes especificas do modo, sem criar secoes genericas extras.",
    "Cada secao deve ter no maximo 3 a 5 frases, exceto quando a secao pedir bullets.",
    "Evite repeticoes e priorize clareza sobre detalhamento excessivo.",
    "Sempre entregue todas as secoes obrigatorias e nao termine no meio de uma frase.",
    "Se houver risco de exceder o limite, reduza detalhamento das secoes finais, mas preserve resultados centrais, direcao dos achados, N e limitacoes.",
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

async function createOpenAIAnalysis({ apiKey, model, mode, prompt, compactPrompt, fetchImpl, timeoutMs, maxOutputTokens }) {
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

  return completeStructuredAnalysis(text, mode);
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

function completeStructuredAnalysis(value = "", mode = "Clinico") {
  let text = trimAbruptEnding(String(value || "").trim());
  for (const heading of getRequiredResponseSections(mode)) {
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

function getModeResponseStructure(mode) {
  return MODE_RESPONSE_STRUCTURES[mode] || MODE_RESPONSE_STRUCTURES.Clinico;
}

function getRequiredResponseSections(mode) {
  return getModeResponseStructure(mode).sections.map(([heading]) => heading);
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
