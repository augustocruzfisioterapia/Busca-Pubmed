import test from "node:test";
import assert from "node:assert/strict";
import { isAllowedPdfUrl } from "../src/core/pdfResolver.mjs";
import { normalizeSummary } from "../src/core/pipeline.mjs";
import { runArticleSearch } from "../src/core/pipeline.mjs";
import { resolveSearchConceptsOnline } from "../src/core/onlineTermResolver.mjs";
import { PubMedClient } from "../src/core/pubmedClient.mjs";
import { calculateArticleScore } from "../src/core/articleScoring.mjs";
import { buildEvidenceDiscussionPrompt, prepareEvidenceDiscussionArticles, runEvidenceDiscussion } from "../src/core/evidenceDiscussion.mjs";
import { resolveJournalMetrics } from "../src/core/journalMetrics.mjs";
import { buildNaturalTerm, buildStructuredQuery, normalizeMaxResults, sanitizePubMedQuery } from "../src/core/queryBuilder.mjs";
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

test("sanitizePubMedQuery corrige operadores e parenteses basicos", () => {
  const result = sanitizePubMedQuery('NOT (ARDS AND OR PEEP)) AND');

  assert.equal(result.query, "(ARDS OR PEEP)");
  assert.match(result.warnings.join(" "), /NOT/);
  assert.match(result.warnings.join(" "), /Operadores/);
});

test("buildStructuredQuery sanitiza query manual antes da PubMed", () => {
  const query = buildStructuredQuery({
    structuredQuery: 'NOT (ARDS AND OR PEEP)) AND',
    prioritizeEvidence: false
  });

  assert.equal(query.term, "(ARDS OR PEEP)");
  assert.match(query.warnings.join(" "), /Parênteses|Operadores|NOT/);
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

test("normalizeMaxResults usa 10 como padrao e limita em 25", () => {
  assert.equal(normalizeMaxResults(undefined), 10);
  assert.equal(normalizeMaxResults("10"), 10);
  assert.equal(normalizeMaxResults("15"), 15);
  assert.equal(normalizeMaxResults("20"), 20);
  assert.equal(normalizeMaxResults("50"), 25);
  assert.equal(normalizeMaxResults("200"), 25);
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
    fulljournalname: "Example Journal.",
    source: "Example J",
    issn: "1234-5678",
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
  assert.equal(article.journal.name, "Example Journal");
  assert.equal(article.journal.impactFactorLabel, "não localizado");
});

test("normalizeSummary usa fallback de revista quando titulo completo nao vem no ESummary", () => {
  const article = normalizeSummary({
    uid: "456",
    title: "Fallback journal.",
    pubdate: "2025",
    source: "Crit Care",
    medlinejournalinfo: { medlineta: "Critical Care" },
    articleids: [{ idtype: "pubmed", value: "456" }]
  });

  assert.equal(article.journal.name, "Critical Care");
  assert.equal(article.journal.abbreviation, "Critical Care");
});

test("resolveJournalMetrics sempre devolve nome da revista e status de IF", () => {
  const metrics = resolveJournalMetrics({
    journal: {
      name: "Journal of Critical Care",
      issn: "0883-9441"
    }
  });

  assert.equal(metrics.name, "Journal of Critical Care");
  assert.equal(metrics.impactFactorLabel, "não localizado");
});

test("calculateArticleScore classifica nivel de evidencia e estudo original", () => {
  const score = calculateArticleScore({
    title: "Early mobilization in intensive care.",
    year: "2025",
    studyType: "Randomized Controlled Trial",
    pubTypes: ["Randomized Controlled Trial"],
    pmcid: "PMC123",
    pdf: { url: "https://www.ncbi.nlm.nih.gov/pmc/articles/PMC123/pdf/" },
    hasAbstract: true,
    description: {
      mainResult: "Early mobilization improved mobility.",
      conclusion: "Early mobilization was feasible."
    }
  }, {
    searchText: "early mobilization intensive care"
  });

  assert.equal(score.evidenceLevel, "Randomized Controlled Trial");
  assert.equal(score.isOriginalStudy, true);
  assert.equal(score.hasAbstract, true);
  assert.equal(score.hasPMCFullText, true);
  assert.ok(score.scoreTotal > 40);
  assert.ok(score.reasons.includes("abstract disponivel"));
});

test("isAllowedPdfUrl aceita apenas PDF direto do NCBI/PMC", () => {
  assert.equal(isAllowedPdfUrl("https://www.ncbi.nlm.nih.gov/pmc/articles/PMC123/pdf/"), true);
  assert.equal(isAllowedPdfUrl("https://publisher.example/article.pdf"), false);
  assert.equal(isAllowedPdfUrl("https://clinicaltrials.gov/study/NCT1"), false);
});

test("PubMedClient inclui identificacao publica e API key nas chamadas E-utilities", async () => {
  let capturedUrl = "";
  const client = new PubMedClient({
    apiKey: "test-key",
    tool: "BuscaPubMed",
    email: "dev@example.com",
    fetchImpl: async (url) => {
      capturedUrl = String(url);
      return jsonResponse({ esearchresult: { count: "0", idlist: [] } });
    }
  });

  await client.search("low back pain", { retmax: 50, retstart: 25 });

  const url = new URL(capturedUrl);
  assert.equal(url.searchParams.get("retmax"), "50");
  assert.equal(url.searchParams.get("retstart"), "25");
  assert.equal(url.searchParams.get("api_key"), "test-key");
  assert.equal(url.searchParams.get("tool"), "BuscaPubMed");
  assert.equal(url.searchParams.get("email"), "dev@example.com");
});

test("PubMedClient informa quando NCBI_API_KEY e invalida", async () => {
  const client = new PubMedClient({
    fetchImpl: async () => ({
      ok: false,
      status: 400,
      text: async () => '{"error":"API key invalid"}'
    })
  });

  await assert.rejects(
    () => client.search("low back pain"),
    /NCBI_API_KEY invalida/
  );
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

test("runArticleSearch amplia fallback com OR quando termo original tambem nao retorna", async () => {
  const calls = [];
  const pubmedClient = {
    async search(term) {
      calls.push(term);
      if (term.includes("alpha[Title/Abstract] OR beta[Title/Abstract]")) {
        return { count: 1, ids: ["9"] };
      }
      return { count: 0, ids: [] };
    },
    async summary(ids) {
      return ids.map((id) => ({
        uid: id,
        title: "Alpha beta clinical evidence.",
        pubdate: "2025",
        sortpubdate: "2025/01/01 00:00",
        pubtype: ["Journal Article"],
        articleids: [{ idtype: "pubmed", value: id }]
      }));
    },
    async abstracts() {
      return new Map([
        ["9", {
          pmid: "9",
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
    searchText: "alpha beta",
    structuredQuery: '"termo inexistente"[MeSH Terms]',
    maxResults: 1,
    prioritizeEvidence: false
  }, {
    pubmedClient,
    fetchImpl: async () => ({ ok: false, status: 404 })
  });

  assert.equal(result.count.returned, 1);
  assert.ok(calls.some((term) => term.includes("alpha[Title/Abstract] OR beta[Title/Abstract]")));
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

test("runArticleSearch respeita maxResults ate 25", async () => {
  const ids = Array.from({ length: 70 }, (_, index) => String(index + 1));
  const pubmedClient = {
    async search() {
      return { count: ids.length, ids };
    },
    async summary(requestedIds) {
      return requestedIds.map((id) => ({
        uid: id,
        title: `Clinical trial ${id}.`,
        pubdate: "2026",
        sortpubdate: "2026/01/01 00:00",
        pubtype: ["Clinical Trial"],
        articleids: [{ idtype: "pubmed", value: id }]
      }));
    },
    async abstracts(requestedIds) {
      return new Map(requestedIds.map((id) => [
        id,
        {
          pmid: id,
          abstractSections: [{ label: "conclusion", text: "Conclusao disponivel." }],
          abstractText: "Resultado e conclusao disponiveis."
        }
      ]));
    },
    async pmcFullText() {
      return [];
    }
  };

  const result = await runArticleSearch({
    searchText: "clinical trial",
    maxResults: 25,
    prioritizeEvidence: false,
    useOnlineResolver: false
  }, {
    pubmedClient,
    fetchImpl: async () => ({ ok: false, status: 404 })
  });

  assert.equal(result.count.returned, 25);
  assert.equal(result.articles.length, 25);
  assert.equal(result.pagination.retmax, 25);
});

test("runArticleSearch respeita 10, 15, 20 e 25 como limites selecionaveis", async () => {
  const ids = Array.from({ length: 120 }, (_, index) => String(index + 1));
  const pubmedClient = {
    async search(_term, options = {}) {
      const start = options.retstart || 0;
      return { count: ids.length, ids: ids.slice(start, start + options.retmax) };
    },
    async summary(requestedIds) {
      return requestedIds.map((id) => ({
        uid: id,
        title: `Original study ${id}.`,
        fulljournalname: "Journal of Evidence Testing",
        pubdate: "2026",
        sortpubdate: "2026/01/01 00:00",
        pubtype: ["Clinical Trial"],
        articleids: [{ idtype: "pubmed", value: id }]
      }));
    },
    async abstracts(requestedIds) {
      return new Map(requestedIds.map((id) => [
        id,
        {
          pmid: id,
          abstractSections: [{ label: "conclusion", text: "Conclusao disponivel." }],
          abstractText: "Resultado e conclusao disponiveis."
        }
      ]));
    },
    async pmcFullText() {
      return [];
    }
  };

  for (const maxResults of [10, 15, 20, 25]) {
    const result = await runArticleSearch({
      searchText: "clinical trial",
      maxResults,
      prioritizeEvidence: false,
      useOnlineResolver: false
    }, {
      pubmedClient,
      fetchImpl: async () => ({ ok: false, status: 404 })
    });

    assert.equal(result.articles.length, maxResults);
    assert.equal(result.count.returned, maxResults);
    assert.equal(result.pagination.retmax, maxResults);
  }
});

test("prepareEvidenceDiscussionArticles prioriza hierarquia e tamanho amostral identificado", () => {
  const prepared = prepareEvidenceDiscussionArticles([
    {
      pmid: "3",
      title: "Narrative review about ventilation.",
      year: "2026",
      studyType: "Review",
      hasAbstract: true,
      abstractText: "This review summarizes available evidence."
    },
    {
      pmid: "1",
      title: "Meta-analysis about noninvasive ventilation.",
      year: "2024",
      studyType: "Meta-Analysis",
      hasAbstract: true,
      abstractText: "The meta-analysis included 342 patients and assessed mortality."
    },
    {
      pmid: "2",
      title: "Randomized controlled trial about NIV.",
      year: "2025",
      studyType: "Randomized Controlled Trial",
      hasAbstract: true,
      abstractText: "N = 84 participants were randomized."
    }
  ], { limit: 2 });

  assert.equal(prepared.length, 2);
  assert.equal(prepared[0].pmid, "1");
  assert.equal(prepared[0].sampleSize, "342");
  assert.equal(prepared[1].pmid, "2");
});

test("buildEvidenceDiscussionPrompt inclui regras cientificas obrigatorias", () => {
  const articles = prepareEvidenceDiscussionArticles([
    {
      pmid: "11",
      title: "Systematic review about early mobility.",
      year: "2026",
      studyType: "Systematic Review",
      abstractText: "The review assessed clinical outcomes and surrogate outcomes."
    }
  ]);

  const prompt = buildEvidenceDiscussionPrompt({
    mode: "Clinico",
    query: '"early mobility"[Title/Abstract]',
    articles
  });

  assert.match(prompt, /## 1\./);
  assert.match(prompt, /## 4\./);
  assert.match(prompt, /Base obrigatoria para todos os modos/);
  assert.match(prompt, /Direcao dos achados: beneficio, neutro ou dano/);
  assert.match(prompt, /N\/tamanho amostral quando disponivel/);
  assert.match(prompt, /Relevancia estatistica/);
  assert.match(prompt, /Foco do modo Clinico: decisao pratica/);
  assert.match(prompt, /quando usar, quando evitar, riscos e beneficios/);
  assert.match(prompt, /no maximo 3 frases/);
  assert.match(prompt, /No maximo 5 bullets/);
  assert.match(prompt, /nao termine no meio de uma frase/);
  assert.match(prompt, /preserve sintese, principais achados e limitacoes/);
  assert.match(prompt, /Nao invente informacoes ausentes/);
  assert.match(prompt, /Nao afirme conclusoes absolutas/);
  assert.match(prompt, /Nao adicione, cite ou sugira estudos externos/);
  assert.match(prompt, /Nao realize buscas adicionais nem use ferramentas externas/);
  assert.match(prompt, /nenhuma nova fonte foi incluida/);
  assert.match(prompt, /Todas as conclusoes devem derivar diretamente/);
  assert.match(prompt, /Os dados disponiveis sao limitados para uma conclusao robusta/);
  assert.match(prompt, /concordancia, divergencia e qualidade metodologica/);
  assert.match(prompt, /Sempre inclua limitacoes e vieses/);
  assert.match(prompt, /Diferencie desfechos clinicos de desfechos substitutos/);
  assert.match(prompt, /PMID: 11/);
});

test("buildEvidenceDiscussionPrompt diferencia foco entre modos", () => {
  const articles = prepareEvidenceDiscussionArticles([
    {
      pmid: "12",
      title: "Clinical trial about respiratory support.",
      year: "2026",
      studyType: "Clinical Trial",
      abstractText: "N = 90 patients were included and clinical outcomes were reported."
    }
  ]);

  const pesquisador = buildEvidenceDiscussionPrompt({ mode: "Pesquisador", query: "support", articles });
  const professor = buildEvidenceDiscussionPrompt({ mode: "Professor", query: "support", articles });
  const conteudo = buildEvidenceDiscussionPrompt({ mode: "Conteudo", query: "support", articles });

  assert.match(pesquisador, /Foco do modo Pesquisador: validade cientifica/);
  assert.match(pesquisador, /Evite recomendacoes praticas diretas/);
  assert.match(professor, /Foco do modo Professor: didatica/);
  assert.match(professor, /organize o raciocinio em etapas/);
  assert.match(conteudo, /Foco do modo Conteudo: comunicacao/);
  assert.match(conteudo, /mensagens-chave, insights principais/);
});

test("runEvidenceDiscussion chama Responses API com artigos retornados pela busca", async () => {
  let capturedUrl = "";
  let capturedBody = {};
  const result = await runEvidenceDiscussion({
    mode: "Pesquisador",
    query: "ventilation",
    articles: [
      {
        pmid: "99",
        title: "Randomized controlled trial.",
        year: "2025",
        studyType: "Randomized Controlled Trial",
        abstractText: "N = 120 patients were randomized. Mortality was reported."
      }
    ],
    maxArticles: 20
  }, {
    openaiApiKey: "sk-test",
    model: "test-model",
    fetchImpl: async (url, options) => {
      capturedUrl = String(url);
      capturedBody = JSON.parse(options.body);
      return jsonResponse({ output_text: "## 1. Sintese geral\nAnalise cautelosa." });
    }
  });

  assert.equal(capturedUrl, "https://api.openai.com/v1/responses");
  assert.equal(capturedBody.model, "test-model");
  assert.equal(capturedBody.max_output_tokens, 1500);
  assert.match(capturedBody.instructions, /Use exclusivamente os artigos fornecidos/);
  assert.match(capturedBody.input, /PMID: 99/);
  assert.match(capturedBody.input, /Tamanho amostral identificado: 120/);
  assert.equal(result.selectedCount, 1);
  assert.match(result.analysisMarkdown, /Sintese geral/);
});

test("runEvidenceDiscussion refaz chamada compacta quando resposta vem incompleta", async () => {
  let calls = 0;
  const result = await runEvidenceDiscussion({
    mode: "Clinico",
    query: "ventilation",
    articles: [
      {
        pmid: "101",
        title: "Systematic review.",
        year: "2025",
        studyType: "Systematic Review",
        abstractText: "The review included 12 studies and reported clinical outcomes."
      }
    ]
  }, {
    openaiApiKey: "sk-test",
    model: "test-model",
    fetchImpl: async (_url, options) => {
      calls += 1;
      const body = JSON.parse(options.body);
      if (calls === 1) {
        assert.equal(body.max_output_tokens, 1500);
        return jsonResponse({
          status: "incomplete",
          incomplete_details: { reason: "max_output_tokens" },
          output_text: "## 1. Sintese geral\nTexto cortado no meio"
        });
      }

      assert.match(body.input, /MODO COMPACTO/);
      return jsonResponse({
        output_text: [
          "## 1. Sintese geral",
          "Analise baseada apenas nos artigos fornecidos.",
          "## 2. Principais achados",
          "- Estudo 1 sugere achado clinico cauteloso.",
          "## 3. Consistencia da evidencia",
          "A consistencia e limitada pelos dados disponiveis.",
          "## 4. Limitacoes e vieses",
          "Os dados disponiveis sao limitados para uma conclusao robusta.",
          "## 5. Aplicabilidade",
          "A aplicabilidade deve ser avaliada conforme o contexto clinico."
        ].join("\n")
      });
    }
  });

  assert.equal(calls, 2);
  assert.match(result.analysisMarkdown, /## 5\. Aplicabilidade/);
  assert.match(result.analysisMarkdown, /\.$/);
});

test("runArticleSearch marca indisponibilidade quando todas as buscas falham", async () => {
  const pubmedClient = {
    async search() {
      throw new Error("NCBI_API_KEY invalida.");
    }
  };

  const result = await runArticleSearch({
    searchText: "dor lombar",
    structuredQuery: '"Low Back Pain"[MeSH Terms]',
    maxResults: 1,
    prioritizeEvidence: false
  }, {
    pubmedClient
  });

  assert.equal(result.ok, false);
  assert.equal(result.searchUnavailable, true);
  assert.match(result.validation.warnings.join(" "), /NCBI_API_KEY/);
});

function jsonResponse(payload) {
  return {
    ok: true,
    json: async () => payload
  };
}
