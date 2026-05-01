const CURRENT_YEAR = new Date().getFullYear();

const STOPWORDS = new Set([
  "a",
  "as",
  "o",
  "os",
  "e",
  "em",
  "na",
  "no",
  "nas",
  "nos",
  "de",
  "da",
  "do",
  "das",
  "dos",
  "para",
  "por",
  "com",
  "sem",
  "and",
  "or",
  "not",
  "the",
  "of",
  "in",
  "on",
  "with",
  "mesh",
  "terms",
  "title",
  "abstract",
  "all",
  "fields"
]);

// Centraliza o ranking para que uma futura etapa de IA ou avaliacao metodologica
// possa expandir os pesos sem alterar a renderizacao dos artigos.
export function calculateArticleScore(article = {}, searchContext = {}) {
  const typeProfile = classifyPublicationType(article);
  const hasAbstract = Boolean(article.hasAbstract || hasDescriptionFromAbstract(article));
  const hasPMCFullText = Boolean(article.pmcid && article.pdf?.url);
  const textRelevance = calculateTextRelevance(article, searchContext);
  const recencyScore = calculateRecencyScore(article.year);

  let scoreTotal = typeProfile.typeScore + textRelevance.score + recencyScore;
  if (hasAbstract) scoreTotal += 8;
  if (hasPMCFullText) scoreTotal += 4;

  const reasons = [typeProfile.reason];
  if (textRelevance.score > 0) reasons.push("relevancia textual");
  if (article.year) reasons.push(`ano ${article.year}`);
  if (hasAbstract) reasons.push("abstract disponivel");
  if (hasPMCFullText) reasons.push("PDF PMC disponivel");

  return {
    scoreTotal,
    reasons,
    evidenceLevel: typeProfile.evidenceLevel,
    evidenceRank: typeProfile.evidenceRank,
    isOriginalStudy: typeProfile.isOriginalStudy,
    hasAbstract,
    hasPMCFullText
  };
}

export function classifyPublicationType(article = {}) {
  const haystack = `${article.studyType || ""} ${(article.pubTypes || []).join(" ")} ${article.title || ""}`.toLowerCase();

  if (haystack.includes("meta-analysis") || haystack.includes("meta analysis")) {
    return profile("Meta-Analysis", 1, 42, false, "Meta-Analysis");
  }

  if (haystack.includes("systematic review")) {
    return profile("Systematic Review", 2, 38, false, "Systematic Review");
  }

  if (haystack.includes("randomized controlled trial") || haystack.includes("randomised controlled trial")) {
    return profile("Randomized Controlled Trial", 3, 36, true, "ensaio randomizado");
  }

  if (haystack.includes("controlled clinical trial")) {
    return profile("Controlled Clinical Trial", 4, 30, true, "ensaio clinico controlado");
  }

  if (haystack.includes("clinical trial")) {
    return profile("Clinical Trial", 4, 28, true, "ensaio clinico");
  }

  if (
    haystack.includes("cohort") ||
    haystack.includes("observational") ||
    haystack.includes("case-control") ||
    haystack.includes("case control") ||
    haystack.includes("comparative study") ||
    haystack.includes("prospective") ||
    haystack.includes("retrospective")
  ) {
    return profile("Cohort / Observational / Case-Control", 5, 24, true, "estudo observacional");
  }

  if (
    haystack.includes("editorial") ||
    haystack.includes("letter") ||
    haystack.includes("comment")
  ) {
    return profile("Editorial / Letter / Comment", 7, 2, false, "tipo de publicacao secundario");
  }

  if (haystack.includes("review")) {
    return profile("Review", 6, 12, false, "revisao narrativa");
  }

  return profile("Outros tipos", 6, 8, false, "tipo de estudo informado");
}

function profile(evidenceLevel, evidenceRank, typeScore, isOriginalStudy, reason) {
  return {
    evidenceLevel,
    evidenceRank,
    typeScore,
    isOriginalStudy,
    reason
  };
}

function calculateTextRelevance(article, searchContext) {
  // Ponto preparado para evoluir: termos da query no titulo podem ganhar
  // peso adicional sem substituir criterios metodologicos do ranking.
  const queryTokens = tokenize(`${searchContext.searchText || ""} ${searchContext.queryTerm || ""}`);
  if (!queryTokens.length) return { score: 0, overlap: 0 };

  const articleTokens = new Set(tokenize([
    article.title,
    article.studyType,
    article.evidenceLabel,
    article.description?.mainResult,
    article.description?.conclusion
  ].filter(Boolean).join(" ")));

  const overlap = queryTokens.filter((token) => articleTokens.has(token)).length;
  const ratio = overlap / queryTokens.length;
  return {
    score: Math.round(Math.min(18, ratio * 18)),
    overlap
  };
}

function calculateRecencyScore(year) {
  const parsed = Number.parseInt(year, 10);
  if (!Number.isFinite(parsed)) return 0;
  const age = Math.max(0, CURRENT_YEAR - parsed);
  if (age <= 2) return 10;
  if (age <= 5) return 7;
  if (age <= 10) return 4;
  return 1;
}

function hasDescriptionFromAbstract(article) {
  const source = String(article.description?.sourceUsed || "").toLowerCase();
  return source.includes("abstract") || source.includes("texto completo");
}

function tokenize(value) {
  return normalize(value)
    .replace(/\[[^\]]+\]/g, " ")
    .replace(/["()]/g, " ")
    .split(/[^a-z0-9]+/i)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !STOPWORDS.has(token));
}

function normalize(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}
