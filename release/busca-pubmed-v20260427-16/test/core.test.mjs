import test from "node:test";
import assert from "node:assert/strict";
import { isAllowedPdfUrl } from "../src/core/pdfResolver.mjs";
import { normalizeSummary } from "../src/core/pipeline.mjs";
import { runArticleSearch } from "../src/core/pipeline.mjs";
import { resolveSearchConceptsOnline } from "../src/core/onlineTermResolver.mjs";
import { buildNaturalTerm, buildStructuredQuery } from "../src/core/queryBuilder.mjs";
import { validateSearchOutput } from "../src/core/validation.mjs";

test("buildStructuredQuery cria query simples e query priorizada", () => {
  const query = buildStructuredQuery({
    searchText: "early mobilization, ICU, safety"
  });

  assert.equal(query.mode, "simple");
  assert.match(query.evidenceTerm, /Meta-Analysis/);
  assert.match(query.term, /early mobilization/);
  assert.match(query.term, /ICU/);
});

test("buildNaturalTerm separa conceitos por virgula como AND", () => {
  const term = buildNaturalTerm("early mobilization, ICU, safety");

  assert.match(term, /early mobilization/);
  assert.match(term, / AND /);
  assert.match(term, /ICU/);
  assert.match(term, /safety/);
});

test("buildStructuredQuery traduz termos comuns em portugues para ingles e MeSH", () => {
  const query = buildStructuredQuery({
    searchText: "mobilização precoce, unidade de terapia intensiva, segurança"
  });

  assert.match(query.term, /Early Ambulation/);
  assert.match(query.term, /early mobilization/);
  assert.match(query.term, /Intensive Care Units/);
  assert.match(query.term, /Patient Safety/);
  assert.equal(query.translation.concepts.length, 3);
});

test("buildStructuredQuery expande siglas clinicas comuns", () => {
  const query = buildStructuredQuery({
    searchText: "DPOC VNI EAP"
  });

  assert.match(query.term, /Pulmonary Disease, Chronic Obstructive/);
  assert.match(query.term, /copd/i);
  assert.match(query.term, /Noninvasive Ventilation/);
  assert.match(query.term, /Pulmonary Edema/);
  assert.equal(query.translation.concepts.length, 3);
});

test("resolveSearchConceptsOnline traduz termo livre e valida no MeSH", async () => {
  const fetchImpl = async (url) => {
    const value = String(url);
    if (value.includes("api.mymemory.translated.net")) {
      return jsonResponse({ responseData: { translatedText: "low back pain" } });
    }
    if (value.includes("id.nlm.nih.gov/mesh/lookup/descriptor")) {
      return jsonResponse([{ resource: "http://id.nlm.nih.gov/mesh/D017116", label: "Low Back Pain" }]);
    }
    throw new Error(`URL inesperada: ${value}`);
  };

  const resolved = await resolveSearchConceptsOnline("dor lombar", { fetchImpl });

  assert.match(resolved.query, /Low Back Pain/);
  assert.match(resolved.query, /low back pain/);
  assert.equal(resolved.concepts[0].source, "Tradução online + MeSH/NLM");
});

test("normalizeSummary extrai identificadores principais", () => {
  const article = normalizeSummary({
    uid: "123",
    title: "Example.",
    pubdate: "2025 Oct",
    sortpubdate: "2025/10/01 00:00",
    pubtype: ["Systematic Review"],
    articleids: [
      { idtype: "doi", value: "10.1000/example" },
      { idtype: "pmc", value: "PMC12345" }
    ]
  });

  assert.equal(article.title, "Example");
  assert.equal(article.pmid, "123");
  assert.equal(article.doi, "10.1000/example");
  assert.equal(article.pmcid, "PMC12345");
  assert.equal(article.sortDate, "2025-10-01");
  assert.equal(article.evidenceLabel, "Revisão sistemática");
});

test("isAllowedPdfUrl aceita apenas PDF direto do NCBI/PMC", () => {
  assert.equal(isAllowedPdfUrl("https://www.ncbi.nlm.nih.gov/pmc/articles/PMC123/pdf/"), true);
  assert.equal(isAllowedPdfUrl("https://publisher.example/article.pdf"), false);
  assert.equal(isAllowedPdfUrl("https://clinicaltrials.gov/study/NCT1"), false);
});

test("validateSearchOutput exige links PubMed, ordenacao e descricao", () => {
  const validation = validateSearchOutput([
    {
      pmid: "2",
      pubmedUrl: "https://pubmed.ncbi.nlm.nih.gov/2/",
      sortDate: "2025-01-01",
      pdf: { url: "", attempts: [{ step: "x", ok: false }, { step: "y", ok: false }] },
      description: { mainResult: "Resultado", conclusion: "Conclusao" }
    },
    {
      pmid: "1",
      pubmedUrl: "https://pubmed.ncbi.nlm.nih.gov/1/",
      sortDate: "2024-01-01",
      pdf: { url: "https://www.ncbi.nlm.nih.gov/pmc/articles/PMC1/pdf/", attempts: [] },
      description: { mainResult: "Resultado", conclusion: "Conclusao" }
    }
  ]);

  assert.equal(validation.ok, true);
});

test("runArticleSearch tenta fallback com termo original quando query interpretada nao retorna", async () => {
  const calls = [];
  const pubmedClient = {
    async search(term) {
      calls.push(term);
      if (term === "dor lombar") return { count: 1, ids: ["1"] };
      return { count: 0, ids: [] };
    },
    async summary(ids) {
      return ids.map((id) => ({
        uid: id,
        title: "Dor lombar em adultos.",
        pubdate: "2025",
        sortpubdate: "2025/01/01 00:00",
        pubtype: ["Journal Article"],
        articleids: [{ idtype: "pubmed", value: id }]
      }));
    },
    async abstracts() {
      return new Map([
        ["1", {
          pmid: "1",
          abstractSections: [{ label: "conclusion", text: "Conclusao disponivel." }],
          abstractText: "Resultado e conclusao disponiveis."
        }]
      ]);
    },
    async pmcFullText() {
      return [];
    }
  };

  const result = await runArticleSearch({
    searchText: "dor lombar",
    structuredQuery: '"Low Back Pain"[MeSH Terms]',
    maxResults: 1,
    prioritizeEvidence: false
  }, {
    pubmedClient,
    fetchImpl: async () => ({ ok: false, status: 404 })
  });

  assert.equal(result.count.returned, 1);
  assert.ok(calls.includes("dor lombar"));
});

test("runArticleSearch continua quando uma etapa PubMed falha temporariamente", async () => {
  let searchCalls = 0;
  const pubmedClient = {
    async search() {
      searchCalls += 1;
      if (searchCalls === 1) throw new Error("timeout temporario");
      return { count: 1, ids: ["10"] };
    },
    async summary(ids) {
      return ids.map((id) => ({
        uid: id,
        title: "Ventilacao nao invasiva.",
        pubdate: "2026",
        sortpubdate: "2026/01/01 00:00",
        pubtype: ["Journal Article"],
        articleids: [{ idtype: "pubmed", value: id }]
      }));
    },
    async abstracts() {
      throw new Error("efetch indisponivel");
    },
    async pmcFullText() {
      return [];
    }
  };

  const result = await runArticleSearch({
    searchText: "VNI",
    structuredQuery: '"Noninvasive Ventilation"[MeSH Terms]',
    maxResults: 1,
    prioritizeEvidence: true
  }, {
    pubmedClient,
    fetchImpl: async () => ({ ok: false, status: 404 })
  });

  assert.equal(result.count.returned, 1);
  assert.equal(result.searchRuns[0].returnedIds, 0);
  assert.match(result.searchRuns[0].error, /timeout/);
  assert.match(result.validation.warnings.join(" "), /abstracts/);
});

function jsonResponse(payload) {
  return {
    ok: true,
    json: async () => payload
  };
}
