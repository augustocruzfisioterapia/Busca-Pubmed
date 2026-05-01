import { resolveSearchConcepts } from "./termResolver.mjs";

const MESH_LOOKUP = "https://id.nlm.nih.gov/mesh/lookup/descriptor";
const MYMEMORY = "https://api.mymemory.translated.net/get";

export async function resolveSearchConceptsOnline(searchText = "", { fetchImpl = fetch } = {}) {
  const local = resolveSearchConcepts(searchText);
  const concepts = [];

  for (const concept of local.concepts) {
    if (concept.source !== "Termo livre") {
      concepts.push(concept);
      continue;
    }

    const enriched = await enrichFreeTerm(concept.original, { fetchImpl });
    concepts.push(enriched);
  }

  return {
    concepts,
    notes: [
      "Termos conhecidos são resolvidos pela base local DeCS/MeSH.",
      "Termos livres tentam tradução online para inglês e validação no MeSH/NLM.",
      "Se a resolução online falhar, o termo entra como busca livre em título/resumo."
    ],
    query: buildQueryFromConcepts(concepts)
  };
}

export function buildQueryFromConcepts(concepts = []) {
  return concepts
    .filter((concept) => concept.titleAbstract?.length || concept.mesh?.length)
    .map((concept) => `(${fieldedConcept(concept)})`)
    .join(" AND ");
}

async function enrichFreeTerm(term, { fetchImpl }) {
  const translated = await translatePtToEn(term, { fetchImpl });
  const candidates = unique([term, translated].filter(Boolean));
  const meshMatch = await findBestMesh(candidates, { fetchImpl });

  if (meshMatch) {
    return {
      original: term,
      label: meshMatch.label,
      mesh: [meshMatch.label],
      english: unique([translated, meshMatch.label].filter(Boolean)),
      titleAbstract: unique([term, translated, meshMatch.label].filter(Boolean)),
      source: translated
        ? "Tradução online + MeSH/NLM"
        : "MeSH/NLM"
    };
  }

  if (translated && translated.toLowerCase() !== term.toLowerCase()) {
    return {
      original: term,
      label: translated,
      mesh: [],
      english: [translated],
      titleAbstract: unique([term, translated]),
      source: "Tradução online"
    };
  }

  return {
    original: term,
    label: term,
    mesh: [],
    english: [],
    titleAbstract: [term],
    source: "Termo livre"
  };
}

async function translatePtToEn(term, { fetchImpl }) {
  if (!shouldTryTranslation(term)) return "";

  try {
    const url = new URL(MYMEMORY);
    url.searchParams.set("q", term);
    url.searchParams.set("langpair", "pt|en");
    const response = await fetchImpl(url, {
      headers: { "Accept": "application/json" },
      signal: AbortSignal.timeout(6000)
    });
    if (!response.ok) return "";
    const json = await response.json();
    return cleanupTranslation(json.responseData?.translatedText || "");
  } catch {
    return "";
  }
}

async function findBestMesh(terms, { fetchImpl }) {
  for (const term of terms) {
    const exact = await meshLookup(term, "exact", { fetchImpl });
    if (exact) return exact;
  }

  for (const term of terms) {
    const contains = await meshLookup(term, "contains", { fetchImpl });
    if (contains) return contains;
  }

  return null;
}

async function meshLookup(label, match, { fetchImpl }) {
  try {
    const url = new URL(MESH_LOOKUP);
    url.searchParams.set("label", label);
    url.searchParams.set("match", match);
    url.searchParams.set("limit", "5");
    const response = await fetchImpl(url, {
      headers: { "Accept": "application/json" },
      signal: AbortSignal.timeout(6000)
    });
    if (!response.ok) return null;
    const items = await response.json();
    return Array.isArray(items) && items.length ? items[0] : null;
  } catch {
    return null;
  }
}

function fieldedConcept(concept) {
  const terms = [];

  for (const mesh of concept.mesh || []) {
    terms.push(`"${escapeQuotes(mesh)}"[MeSH Terms]`);
  }

  for (const term of concept.titleAbstract || []) {
    if (!term) continue;
    const escaped = escapeQuotes(term);
    terms.push(term.includes(" ") ? `"${escaped}"[Title/Abstract]` : `${escaped}[Title/Abstract]`);
  }

  return unique(terms).join(" OR ");
}

function cleanupTranslation(value) {
  return String(value)
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function shouldTryTranslation(value = "") {
  return /[a-záàâãéêíóôõúç]/i.test(value) && normalizeText(value).length > 2;
}

function normalizeText(value) {
  return String(value)
    .replace(/\s+/g, " ")
    .trim();
}

function escapeQuotes(value) {
  return String(value).replace(/"/g, '\\"');
}

function unique(values) {
  const seen = new Set();
  return values
    .map((value) => String(value).trim())
    .filter(Boolean)
    .filter((value) => {
      const key = value.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}
