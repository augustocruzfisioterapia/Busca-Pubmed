import { resolveSearchConcepts } from "./termResolver.mjs";

const DEFAULT_EVIDENCE_FILTER = [
  '"Meta-Analysis"[Publication Type]',
  '"Systematic Review"[Publication Type]',
  '"Randomized Controlled Trial"[Publication Type]',
  '"Clinical Trial"[Publication Type]'
].join(" OR ");

const CLINICAL_FILTER = [
  'humans[Filter]',
  'english[Language]',
  'portuguese[Language]'
].join(" OR ");

export function buildStructuredQuery(input = {}) {
  const direct = normalizeSpaces(input.structuredQuery || input.query || "");
  const prioritizeEvidence = input.prioritizeEvidence !== false;
  const applyClinicalFilter = Boolean(input.applyClinicalFilter);

  if (direct) {
    const term = applyClinicalFilter ? `(${direct}) AND (${CLINICAL_FILTER})` : direct;
    return buildQueryObject({
      term,
      mode: "manual",
      prioritizeEvidence,
      applyClinicalFilter,
      components: [{ label: "Query manual", value: term }]
    });
  }

  const searchText = normalizeSpaces(input.searchText || input.topic || "");
  if (!searchText) {
    const error = new Error("Informe os termos da busca.");
    error.statusCode = 400;
    error.publicMessage = "Informe os termos da busca.";
    throw error;
  }

  const translation = resolveSearchConcepts(searchText);
  const naturalTerm = buildNaturalTermFromConcepts(translation.concepts);
  const term = applyClinicalFilter ? `(${naturalTerm}) AND (${CLINICAL_FILTER})` : naturalTerm;

  return buildQueryObject({
    term,
    mode: "simple",
    prioritizeEvidence,
    applyClinicalFilter,
    components: [
      { label: "Termos", value: naturalTerm },
      ...(applyClinicalFilter ? [{ label: "Filtro clínico", value: `(${CLINICAL_FILTER})` }] : [])
    ],
    translation
  });
}

export function normalizeMaxResults(value) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) return 10;
  return Math.min(Math.max(parsed, 1), 25);
}

export function buildNaturalTerm(value = "") {
  const clean = normalizeSpaces(value);
  if (looksLikePubMedSyntax(clean)) return `(${clean})`;

  const concepts = clean
    .split(/\s*(?:[\n;,]+)\s*/)
    .map((term) => term.trim())
    .filter(Boolean);
  if (concepts.length === 0) return "";

  return concepts.map((concept) => `(${fieldedConcept(concept)})`).join(" AND ");
}

function buildNaturalTermFromConcepts(concepts = []) {
  return concepts.map((concept) => `(${fieldedResolvedConcept(concept)})`).join(" AND ");
}

function buildQueryObject({ term, mode, prioritizeEvidence, applyClinicalFilter, components, translation }) {
  const evidenceTerm = prioritizeEvidence ? `(${term}) AND (${DEFAULT_EVIDENCE_FILTER})` : "";
  return {
    term,
    evidenceTerm,
    mode,
    prioritizeEvidence,
    applyClinicalFilter,
    components,
    translation,
    strategy: prioritizeEvidence
      ? "Busca primeiro por revisões/meta-análises/ensaios clínicos e complementa com busca ampla se necessário."
      : "Busca ampla sem filtro por tipo de publicação."
  };
}

function fieldedConcept(concept) {
  if (looksLikePubMedSyntax(concept)) return concept;

  const exact = concept.match(/^"(.+)"$/);
  const term = exact ? exact[1] : concept;
  const escaped = term.replace(/"/g, '\\"');
  const words = term
    .split(/\s+/)
    .map((word) => word.trim())
    .filter(Boolean);

  if (words.length <= 1) {
    return `(${escaped}[Title/Abstract] OR ${escaped}[MeSH Terms])`;
  }

  const allWords = words.map((word) => `${word}[Title/Abstract]`).join(" AND ");
  return `("${escaped}"[Title/Abstract] OR (${allWords}) OR "${escaped}"[MeSH Terms])`;
}

function fieldedResolvedConcept(concept) {
  const terms = [];

  for (const mesh of concept.mesh || []) {
    terms.push(`"${escapeQuotes(mesh)}"[MeSH Terms]`);
  }

  for (const term of concept.titleAbstract || []) {
    terms.push(titleAbstractTerm(term));
  }

  return unique(terms).join(" OR ");
}

function titleAbstractTerm(term) {
  const escaped = escapeQuotes(term);
  if (looksLikePubMedSyntax(term)) return term;
  if (term.includes(" ")) return `"${escaped}"[Title/Abstract]`;
  return `${escaped}[Title/Abstract]`;
}

function escapeQuotes(value) {
  return String(value).replace(/"/g, '\\"');
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function looksLikePubMedSyntax(value) {
  return /\[[^[\]]+\]|\b(AND|OR|NOT)\b|["()]/i.test(value);
}

function normalizeSpaces(value) {
  return String(value).replace(/\s+/g, " ").trim();
}
