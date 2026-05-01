import { deriveScientificDescription } from "./extractors.mjs";
import { resolvePdf } from "./pdfResolver.mjs";
import { PubMedClient } from "./pubmedClient.mjs";
import { resolveSearchConceptsOnline } from "./onlineTermResolver.mjs";
import { calculateArticleScore } from "./articleScoring.mjs";
import { normalizeJournalFromPubMed, resolveJournalMetrics } from "./journalMetrics.mjs";
import { buildStructuredQuery, normalizeMaxResults } from "./queryBuilder.mjs";
import { validateSearchOutput } from "./validation.mjs";

const runtimeEnv = typeof process !== "undefined" ? process.env : {};

export async function runArticleSearch(input = {}, deps = {}) {
  const maxResults = normalizeMaxResults(input.maxResults);
  const retstart = normalizeRetstart(input.retstart);
  const fetchImpl = deps.fetchImpl || fetch;
  const normalizedInput = { ...input };

  if (!normalizedInput.structuredQuery && normalizedInput.useOnlineResolver !== false) {
    const online = await resolveSearchConceptsOnline(normalizedInput.searchText || normalizedInput.topic || "", { fetchImpl });
    if (online.query) {
      normalizedInput.structuredQuery = online.query;
      normalizedInput.resolvedTranslation = online;
    }
  }

  const query = buildStructuredQuery(normalizedInput);
  if (normalizedInput.resolvedTranslation) {
    query.translation = normalizedInput.resolvedTranslation;
    query.mode = "online";
    query.strategy = "Termos livres tentam tradução online para inglês e validação no MeSH/NLM antes da busca PubMed.";
  }

  const client = deps.pubmedClient || new PubMedClient({ fetchImpl });
  const candidateLimit = Math.min(Math.max(maxResults * 4, 30), 200);

  const searchPlan = buildSearchPlan(query, normalizedInput);
  const searchRuns = [];
  const pipelineWarnings = [];
  const mergedIds = [];
  const seen = new Set();

  for (const item of searchPlan) {
    let run;
    try {
      run = await client.search(item.term, { retmax: candidateLimit, retstart });
    } catch (error) {
      searchRuns.push({ label: item.label, term: item.term, count: 0, returnedIds: 0, error: error.message });
      pipelineWarnings.push(`Busca ${item.label} falhou temporariamente: ${error.message}`);
      continue;
    }

    searchRuns.push({ label: item.label, term: item.term, count: run.count, returnedIds: run.ids.length });
    for (const id of run.ids) {
      if (!seen.has(id)) {
        seen.add(id);
        mergedIds.push(id);
      }
    }
    if (mergedIds.length >= candidateLimit) break;
  }

  if (!mergedIds.length) {
    return emptyResult({ query, searchRuns, pipelineWarnings, retstart, retmax: maxResults });
  }

  let summaries = [];
  try {
    summaries = await client.summary(mergedIds.slice(0, candidateLimit));
  } catch (error) {
    pipelineWarnings.push(`Falha ao recuperar metadados dos artigos: ${error.message}`);
    return emptyResult({ query, searchRuns, pipelineWarnings, retstart, retmax: maxResults });
  }

  const normalized = summaries.map(normalizeSummary).sort(sortNewestFirst);
  const exclusions = normalized.filter(isProtocolRegistryOrDataset);
  const candidates = normalized.filter((article) => !isProtocolRegistryOrDataset(article)).slice(0, maxResults);
  let abstractMap = new Map();
  try {
    abstractMap = await client.abstracts(candidates.map((article) => article.pmid));
  } catch (error) {
    pipelineWarnings.push(`Falha ao recuperar abstracts; usando metadados disponiveis: ${error.message}`);
  }

  const articles = [];
  const searchContext = {
    searchText: normalizedInput.searchText || normalizedInput.topic || "",
    queryTerm: query.term
  };

  for (const article of candidates) {
    const abstractRecord = abstractMap.get(article.pmid);
    let pdf;
    try {
      pdf = await resolvePdf(article, {
        fetchImpl,
        unpaywallEmail: input.unpaywallEmail || runtimeEnv.UNPAYWALL_EMAIL || runtimeEnv.NCBI_EMAIL || ""
      });
    } catch (error) {
      pdf = pdfFailure(article, error);
    }

    let pmcSections = [];
    if (article.pmcid) {
      try {
        pmcSections = await client.pmcFullText(article.pmcid);
      } catch (error) {
        article.audit.push({
          step: "Texto completo PMC",
          ok: false,
          detail: `Falha ao recuperar texto completo: ${error.message}`
        });
      }
    }

    const description = deriveScientificDescription({
      article,
      abstractRecord,
      pmcSections
    });
    const hasAbstract = hasAbstractRecord(abstractRecord);
    const articleWithDetails = {
      ...article,
      journal: resolveJournalMetrics(article),
      pdf,
      description,
      hasAbstract,
      abstractText: abstractRecord?.abstractText || "",
      abstractSections: abstractRecord?.abstractSections || []
    };

    articles.push({
      ...articleWithDetails,
      scoring: calculateArticleScore(articleWithDetails, searchContext)
    });
  }

  const validation = validateSearchOutput(articles);
  validation.warnings.push(...pipelineWarnings);
  const pubMedTotal = searchRuns.reduce((total, run) => Math.max(total, run.count), 0);

  return {
    ok: validation.ok,
    generatedAt: new Date().toISOString(),
    query,
    searchRuns,
    count: {
      pubMedTotal,
      candidatesFetched: summaries.length,
      excluded: exclusions.length,
      returned: articles.length
    },
    pagination: {
      retstart,
      retmax: maxResults,
      hasMore: pubMedTotal > retstart + articles.length
    },
    exclusions: exclusions.map((article) => ({
      pmid: article.pmid,
      title: article.title,
      reason: "Protocolo, registro, dataset ou base de dados identificado por título/tipo de publicação."
    })),
    articles,
    validation
  };
}

function emptyResult({ query, searchRuns, pipelineWarnings = [], retstart = 0, retmax = 0 }) {
  const validation = validateSearchOutput([]);
  validation.warnings.push(...pipelineWarnings);
  const searchUnavailable = hasOnlyFailedSearchRuns(searchRuns);

  return {
    ok: !searchUnavailable,
    searchUnavailable,
    error: searchUnavailable
      ? validation.warnings[0] || "Falha ao consultar a PubMed."
      : undefined,
    generatedAt: new Date().toISOString(),
    query,
    searchRuns,
    count: {
      pubMedTotal: searchRuns.reduce((total, run) => Math.max(total, run.count || 0), 0),
      candidatesFetched: 0,
      excluded: 0,
      returned: 0
    },
    pagination: {
      retstart,
      retmax,
      hasMore: false
    },
    exclusions: [],
    articles: [],
    validation
  };
}

function normalizeRetstart(value) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) return 0;
  return Math.min(Math.max(parsed, 0), 10000);
}

function hasAbstractRecord(record) {
  return Boolean(record?.abstractText || record?.abstractSections?.length);
}

function hasOnlyFailedSearchRuns(searchRuns = []) {
  return searchRuns.length > 0 && searchRuns.every((run) => Boolean(run.error));
}

function pdfFailure(article, error) {
  const attempts = [
    { step: "Busca de PDF", ok: false, detail: `Falha tecnica: ${error.message}` },
    {
      step: "Verificacao PubMed/PMC",
      ok: false,
      detail: article.pmcid
        ? "PMCID presente, mas a verificacao tecnica do PDF falhou."
        : "Sem PMCID para gerar link direto de PDF aberto."
    }
  ];

  return {
    status: "PDF nao disponivel (possivel paywall)",
    url: "",
    attempts
  };
}

export function normalizeSummary(summary = {}) {
  const articleIds = Array.isArray(summary.articleids) ? summary.articleids : [];
  const doi = findArticleId(articleIds, "doi");
  const pmcid = findArticleId(articleIds, "pmc");
  const pmid = String(summary.uid || findArticleId(articleIds, "pubmed") || "");
  const pubTypes = Array.isArray(summary.pubtype) ? summary.pubtype : [];
  const pubdate = summary.pubdate || "";
  const sortDate = parseSortDate(summary.sortpubdate || pubdate);
  const evidenceLabel = classifyEvidence(pubTypes);

  return {
    pmid,
    title: cleanupTitle(summary.title || "Título não disponível."),
    year: extractYear(pubdate || summary.sortpubdate),
    pubdate,
    sortDate,
    studyType: pubTypes.join("; ") || "Tipo de estudo não informado",
    evidenceLabel,
    pubTypes,
    journal: normalizeJournalFromPubMed(summary),
    doi,
    pmcid,
    pubmedUrl: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
    audit: []
  };
}

export function isProtocolRegistryOrDataset(article) {
  const haystack = `${article.title} ${article.studyType}`.toLowerCase();
  return [
    "study protocol",
    "trial protocol",
    "protocol",
    "registry",
    "registered",
    "database",
    "dataset",
    "data set"
  ].some((needle) => haystack.includes(needle));
}

function buildSearchPlan(query, input = {}) {
  const plan = [];
  if (query.prioritizeEvidence && query.evidenceTerm) {
    plan.push({ label: "priorizada", term: query.evidenceTerm });
  }
  plan.push({ label: "ampla", term: query.term });

  const original = normalizeSpaces(input.searchText || input.topic || "");
  if (original) {
    plan.push({ label: "fallback termo original livre", term: original });
    plan.push({ label: "fallback termo original em titulo/resumo", term: titleAbstractFallback(original) });

    const orFallback = originalTermsOrFallback(original);
    if (orFallback.titleAbstract) {
      plan.push({ label: "fallback termos originais OR em titulo/resumo", term: orFallback.titleAbstract });
    }
    if (orFallback.allFields) {
      plan.push({ label: "fallback termos originais OR amplo", term: orFallback.allFields });
    }
  }

  return dedupePlan(plan);
}

function titleAbstractFallback(value) {
  const escaped = String(value).replace(/"/g, '\\"');
  return value.includes(" ") ? `"${escaped}"[Title/Abstract] OR "${escaped}"[All Fields]` : `${escaped}[Title/Abstract] OR ${escaped}[All Fields]`;
}

function originalTermsOrFallback(value) {
  const terms = extractFallbackTerms(value);
  const titleAbstract = terms.map((term) => fieldedFallbackTerm(term, "Title/Abstract")).join(" OR ");
  const allFields = terms.map((term) => fieldedFallbackTerm(term, "All Fields")).join(" OR ");
  return { titleAbstract, allFields };
}

// Ultima camada de sensibilidade: preserva os termos digitados e usa OR
// para evitar que uma query restritiva bloqueie completamente a busca.
function extractFallbackTerms(value) {
  const cleaned = normalizeSpaces(String(value)
    .replace(/\[[^\]]+\]/g, " ")
    .replace(/[()"']/g, " ")
    .replace(/\b(AND|OR|NOT)\b/gi, " "));
  const chunks = cleaned
    .split(/\s*(?:[\n;,/]+)\s*/)
    .map((term) => normalizeSpaces(term))
    .filter(Boolean);
  const source = chunks.length > 1 ? chunks : [cleaned];
  const terms = [...source];

  if (source.length === 1) {
    terms.push(...cleaned
      .split(/\s+/)
      .map((term) => term.trim())
      .filter((term) => term.length >= 3));
  }

  return [...new Set(terms)].slice(0, 12);
}

function fieldedFallbackTerm(term, field) {
  const escaped = String(term).replace(/"/g, '\\"');
  return term.includes(" ") ? `"${escaped}"[${field}]` : `${escaped}[${field}]`;
}

function dedupePlan(plan) {
  const seen = new Set();
  return plan.filter((item) => {
    const key = normalizeSpaces(item.term).toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function looksLikePubMedSyntax(value) {
  return /\[[^[\]]+\]|\b(AND|OR|NOT)\b|["()]/i.test(value);
}

function normalizeSpaces(value) {
  return String(value).replace(/\s+/g, " ").trim();
}

function classifyEvidence(pubTypes = []) {
  const haystack = pubTypes.join(" ").toLowerCase();
  if (haystack.includes("meta-analysis")) return "Meta-análise";
  if (haystack.includes("systematic review")) return "Revisão sistemática";
  if (haystack.includes("randomized controlled trial")) return "Ensaio randomizado";
  if (haystack.includes("clinical trial")) return "Ensaio clínico";
  if (haystack.includes("review")) return "Revisão";
  return "Artigo";
}

function findArticleId(articleIds, type) {
  return articleIds.find((id) => id.idtype === type)?.value || "";
}

function cleanupTitle(title) {
  return String(title).replace(/\.$/, "").trim();
}

function extractYear(value = "") {
  const match = String(value).match(/\b(19|20)\d{2}\b/);
  return match ? match[0] : "";
}

function parseSortDate(value = "") {
  const normalized = String(value).replace(/\//g, "-");
  const year = extractYear(normalized);
  if (!year) return "0000-00-00";

  const monthNames = {
    jan: "01",
    feb: "02",
    mar: "03",
    apr: "04",
    may: "05",
    jun: "06",
    jul: "07",
    aug: "08",
    sep: "09",
    oct: "10",
    nov: "11",
    dec: "12"
  };

  const lower = normalized.toLowerCase();
  const monthName = Object.keys(monthNames).find((name) => lower.includes(name));
  if (monthName) return `${year}-${monthNames[monthName]}-01`;

  const numeric = normalized.match(/\b(19|20)\d{2}[-\s](\d{1,2})(?:[-\s](\d{1,2}))?/);
  if (numeric) {
    const month = numeric[2].padStart(2, "0");
    const day = (numeric[3] || "01").padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  return `${year}-01-01`;
}

function sortNewestFirst(a, b) {
  return b.sortDate.localeCompare(a.sortDate);
}
