const form = document.querySelector("#search-form");
const statusPanel = document.querySelector("#status-panel");
const queryPanel = document.querySelector("#query-panel");
const queryOutput = document.querySelector("#query-output");
const validationGrid = document.querySelector("#validation-grid");
const results = document.querySelector("#results");
const template = document.querySelector("#article-template");
const exportMdButton = document.querySelector("#export-md");
const exportJsonButton = document.querySelector("#export-json");
const copyQueryButton = document.querySelector("#copy-query");
const copyDoiListButton = document.querySelector("#copy-doi-list");
const loadExampleButton = document.querySelector("#load-example");
const homeButton = document.querySelector("#home-button");
const analyzeButton = form.querySelector('button[type="submit"]');
const auditPanel = document.querySelector("#audit-panel");
const resultsToolbar = document.querySelector("#results-toolbar");
const resultTabButtons = [...document.querySelectorAll(".result-tabs button")];
const rankingNote = document.querySelector("#ranking-note");
const loadMorePanel = document.querySelector("#load-more-panel");
const loadMoreButton = document.querySelector("#load-more-results");
const discussEvidenceButton = document.querySelector("#discuss-evidence");
const discussionPanel = document.querySelector("#discussion-panel");
const closeDiscussionButton = document.querySelector("#close-discussion");
const discussionModeButtons = [...document.querySelectorAll(".discussion-modes button")];
const discussionPlaceholder = document.querySelector("#discussion-placeholder");
const discussionResult = document.querySelector("#discussion-result");
const copyDiscussionButton = document.querySelector("#copy-discussion");
const queryBuilderRows = document.querySelector("#query-builder-rows");
const addQueryRowButton = document.querySelector("#add-query-row");
const advancedQueryWarning = document.querySelector("#advanced-query-warning");
const copyAdvancedQueryButton = document.querySelector("#copy-advanced-query");
const advancedTermInput = document.querySelector("#advanced-term-input");
const advancedTermOperator = document.querySelector("#advanced-term-operator");
const advancedTermField = document.querySelector("#advanced-term-field");

let currentResult = null;
let activePayload = null;
let currentView = "recommended";
let targetResultCount = 10;
let advancedTerms = [];
let advancedTermId = 0;
const RETURN_RESTORE_KEY = "article-search-returning";
const SETTINGS_VERSION = 4;
const configuredApiBase = normalizeApiBase(window.BUSCA_PUBMED_API_BASE || "");

const CLIENT_DESCRIPTORS = [
  {
    label: "Mobilização precoce",
    terms: ["mobilização precoce", "mobilizacao precoce", "deambulação precoce", "deambulacao precoce", "early mobilization", "early mobility", "early ambulation"],
    mesh: ["Early Ambulation"],
    english: ["early mobilization", "early mobility", "early ambulation"]
  },
  {
    label: "Unidade de terapia intensiva",
    terms: ["unidade de terapia intensiva", "unidade de cuidados intensivos", "terapia intensiva", "uti", "icu", "intensive care unit", "intensive care units"],
    mesh: ["Intensive Care Units"],
    english: ["intensive care unit", "intensive care units", "ICU"]
  },
  {
    label: "DPOC - Doença pulmonar obstrutiva crônica",
    terms: ["dpoc", "doença pulmonar obstrutiva crônica", "doenca pulmonar obstrutiva cronica", "copd", "chronic obstructive pulmonary disease"],
    mesh: ["Pulmonary Disease, Chronic Obstructive"],
    english: ["COPD", "chronic obstructive pulmonary disease", "chronic obstructive lung disease"]
  },
  {
    label: "VNI - Ventilação não invasiva",
    terms: ["vni", "ventilação não invasiva", "ventilacao nao invasiva", "niv", "noninvasive ventilation", "non-invasive ventilation"],
    mesh: ["Noninvasive Ventilation"],
    english: ["noninvasive ventilation", "non-invasive ventilation", "NIV"]
  },
  {
    label: "EAP - Edema agudo de pulmão",
    terms: ["eap", "edema agudo de pulmão", "edema agudo de pulmao", "edema pulmonar agudo", "acute pulmonary edema", "pulmonary edema"],
    mesh: ["Pulmonary Edema"],
    english: ["acute pulmonary edema", "pulmonary edema"]
  },
  {
    label: "Segurança",
    terms: ["segurança", "seguranca", "eventos adversos", "evento adverso", "efeitos adversos", "safety", "adverse events", "adverse effects"],
    mesh: ["Patient Safety"],
    english: ["safety", "adverse events", "adverse effects", "feasibility"]
  },
  {
    label: "Doença crítica",
    terms: ["paciente crítico", "paciente critico", "pacientes críticos", "pacientes criticos", "doença crítica", "doenca critica", "critical illness", "critically ill"],
    mesh: ["Critical Illness"],
    english: ["critical illness", "critically ill"]
  },
  {
    label: "Ventilação mecânica",
    terms: ["ventilação mecânica", "ventilacao mecanica", "respiração artificial", "respiracao artificial", "mechanical ventilation", "artificial respiration"],
    mesh: ["Respiration, Artificial"],
    english: ["mechanical ventilation", "artificial respiration"]
  },
  {
    label: "Desmame ventilatório",
    terms: ["desmame ventilatório", "desmame ventilatorio", "weaning", "ventilator weaning"],
    mesh: ["Ventilator Weaning"],
    english: ["ventilator weaning", "weaning"]
  },
  {
    label: "Fisioterapia",
    terms: ["fisioterapia", "fisioterapia intensiva", "physical therapy", "physiotherapy"],
    mesh: ["Physical Therapy Modalities"],
    english: ["physical therapy", "physiotherapy"]
  },
  {
    label: "Reabilitação",
    terms: ["reabilitação", "reabilitacao", "rehabilitation"],
    mesh: ["Rehabilitation"],
    english: ["rehabilitation"]
  },
  {
    label: "Síndrome do desconforto respiratório agudo",
    terms: ["síndrome do desconforto respiratório agudo", "sindrome do desconforto respiratorio agudo", "sdra", "ards", "acute respiratory distress syndrome"],
    mesh: ["Acute Respiratory Distress Syndrome"],
    english: ["acute respiratory distress syndrome", "ARDS"]
  },
  {
    label: "Recrutamento pulmonar",
    terms: ["recrutamento pulmonar", "recrutabilidade pulmonar", "lung recruitment", "lung recruitability", "recruitability"],
    mesh: [],
    english: ["lung recruitment", "lung recruitability", "recruitability"]
  }
];

const CLIENT_STOPWORDS = new Set([
  "a", "as", "o", "os", "e", "em", "na", "no", "nas", "nos", "de", "da", "do", "das", "dos",
  "para", "por", "com", "sem", "sobre", "entre", "ao", "aos", "um", "uma", "uns", "umas",
  "paciente", "pacientes", "adulto", "adultos"
]);

const ADVANCED_FIELDS = [
  "All Fields",
  "Title/Abstract",
  "MeSH Terms"
];

restoreSettings();
initializeAdvancedBuilder();
restoreLastSearch();

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (form.dataset.busy === "true") return;

  setBusy(true);
  currentView = "recommended";
  targetResultCount = normalizeRequestedTotal(form.maxResults.value);
  renderStatus("Buscando artigos...", "Iniciando a busca com os termos informados.");
  results.innerHTML = "";
  queryOutput.textContent = "";
  validationGrid.hidden = true;
  validationGrid.innerHTML = "";
  queryPanel.hidden = true;
  auditPanel.hidden = true;
  setResultsChrome(false);
  await nextPaint();

  try {
    renderStatus("Otimizando termos...", "Traduzindo quando necessário, verificando MeSH e preparando fallbacks.");
    const payload = await formPayload();
    activePayload = payload;
    saveSettings(payload);
    renderStatus("Consultando PubMed...", "Buscando artigos, metadados, PDFs e fontes de texto.");

    const result = await requestSearchUntilTarget(payload, targetResultCount);
    renderStatus("Organizando resultados...", "Preparando artigos, links PubMed e PDFs PMC disponíveis.");
    await nextPaint();
    renderStatus("Classificando evidências...", "Aplicando ranking auxiliar sem uso de IA.");
    await nextPaint();
    currentResult = result;
    preparePaginationState(currentResult);
    persistLastSearch(payload, result);
    renderResult(result);
  } catch (error) {
    currentResult = null;
    activePayload = null;
    setResultsChrome(false);
    renderStatus(
      "Não foi possível realizar a busca no momento. Tente novamente.",
      error.message || "A PubMed ou o servidor de busca não respondeu corretamente."
    );
    setExportButtonsEnabled(false);
  } finally {
    setBusy(false);
  }
});

loadExampleButton.addEventListener("click", () => {
  form.searchText.value = "mobilização precoce, unidade de terapia intensiva, segurança";
  form.structuredQuery.value = "";
  form.maxResults.value = "10";
  resetAdvancedRows();
});

homeButton.addEventListener("click", () => {
  clearSearchScreen();
});

copyQueryButton.addEventListener("click", async () => {
  if (!currentResult?.query) return;
  await copyText(queryToCopy(currentResult.query));
  copyQueryButton.textContent = "Query copiada.";
  setTimeout(() => {
    copyQueryButton.textContent = "Copiar query";
  }, 1200);
});

copyDoiListButton?.addEventListener("click", async () => {
  const dois = currentDisplayedArticles()
    .map((article) => article.doi)
    .filter(Boolean);

  if (!dois.length) {
    copyDoiListButton.textContent = "Nenhum DOI encontrado nesta busca.";
    setTimeout(() => {
      copyDoiListButton.textContent = "Copiar lista de DOI";
    }, 1600);
    return;
  }

  await copyText([...new Set(dois)].join("\n"));
  copyDoiListButton.textContent = "Lista de DOI copiada.";
  setTimeout(() => {
    copyDoiListButton.textContent = "Copiar lista de DOI";
  }, 1600);
});

form.freePdfOnly?.addEventListener("change", () => {
  if (!currentResult) return;
  if (activePayload) activePayload.freePdfOnly = Boolean(form.freePdfOnly.checked);
  renderArticles(currentResult);
  renderLoadMoreState();
  saveSettings(activePayload || formSnapshotPayload());
});

exportMdButton?.addEventListener("click", () => {
  if (!currentResult) return;
  downloadText("busca-pubmed.md", toMarkdown(currentResult), "text/markdown");
});

exportJsonButton?.addEventListener("click", () => {
  if (!currentResult) return;
  downloadText("busca-pubmed.json", JSON.stringify(currentResult, null, 2), "application/json");
});

addQueryRowButton?.addEventListener("click", async () => {
  await handleAddAdvancedTerm();
});

advancedTermInput?.addEventListener("keydown", async (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  await handleAddAdvancedTerm();
});

copyAdvancedQueryButton?.addEventListener("click", async () => {
  const query = form.structuredQuery.value.trim();
  if (!query) {
    renderAdvancedWarning("Adicione pelo menos um termo ou cole uma query PubMed.");
    return;
  }
  const copied = await copyText(query);
  copyAdvancedQueryButton.textContent = copied ? "Copiado" : "Não foi possível copiar.";
  setTimeout(() => {
    copyAdvancedQueryButton.textContent = "Copiar query avançada";
  }, 1200);
});

resultTabButtons.forEach((button) => {
  button.addEventListener("click", () => {
    currentView = button.dataset.view || "recommended";
    renderResultTabs();
    renderArticles(currentResult);
  });
});

loadMoreButton?.addEventListener("click", async () => {
  if (!currentResult || !activePayload || form.dataset.busy === "true") return;
  const remaining = targetResultCount - uniqueArticles(currentResult.articles || []).length;
  if (remaining <= 0) return;

  setBusy(true);
  try {
    renderStatus("Buscando artigos...", "Carregando a próxima página da PubMed.");
    const nextResult = await requestSearchPage(activePayload, {
      retstart: currentResult.pagination?.nextRetstart || uniqueArticles(currentResult.articles || []).length,
      pageSize: remaining
    });
    renderStatus("Organizando resultados...", "Unindo os novos artigos à lista atual.");
    await nextPaint();
    currentResult = mergeSearchResults(currentResult, nextResult);
    renderStatus("Classificando evidências...", "Atualizando abas e ranking auxiliar.");
    await nextPaint();
    persistLastSearch(activePayload, currentResult);
    renderResult(currentResult);
  } catch (error) {
    renderStatus("Falha ao carregar mais resultados", error.message);
  } finally {
    setBusy(false);
  }
});

discussEvidenceButton?.addEventListener("click", () => {
  if (!currentResult?.articles?.length) return;
  discussionPanel.hidden = false;
  resetDiscussionPanel();
});

closeDiscussionButton?.addEventListener("click", () => {
  discussionPanel.hidden = true;
});

discussionPanel?.addEventListener("click", (event) => {
  if (event.target === discussionPanel) discussionPanel.hidden = true;
});

discussionModeButtons.forEach((button) => {
  button.addEventListener("click", async () => {
    discussionModeButtons.forEach((item) => item.classList.toggle("active", item === button));
    await requestEvidenceDiscussion(button.dataset.mode || "Clinico");
  });
});

copyDiscussionButton?.addEventListener("click", async () => {
  const text = currentResult?.discussion?.analysisMarkdown || "";
  if (!text) return;
  const copied = await copyText(text);
  copyDiscussionButton.textContent = copied ? "Resultado copiado." : "Não foi possível copiar.";
  setTimeout(() => {
    copyDiscussionButton.textContent = "Copiar resultado";
  }, 1400);
});

async function formPayload() {
  const data = new FormData(form);
  const searchText = String(data.get("searchText") || "").trim();
  const advancedQuery = buildAdvancedQueryFromTerms().query;
  const manualStructuredQuery = advancedQuery || String(data.get("structuredQuery") || "").trim();
  const advancedSearchText = advancedTerms.length ? advancedTerms.map((item) => item.term).join(", ") : "";
  const effectiveSearchText = advancedSearchText || searchText;
  const conceptOperator = "AND";
  const clientTranslation = manualStructuredQuery ? null : await resolveClientConcepts(effectiveSearchText, conceptOperator);

  return {
    searchText: effectiveSearchText,
    structuredQuery: manualStructuredQuery || clientTranslation?.query || "",
    manualStructuredQuery,
    clientTranslation,
    conceptOperator,
    useOnlineResolver: true,
    maxResults: data.get("maxResults"),
    freePdfOnly: data.get("freePdfOnly") === "on",
    unpaywallEmail: data.get("unpaywallEmail"),
    prioritizeEvidence: data.get("prioritizeEvidence") === "on",
    applyClinicalFilter: data.get("applyClinicalFilter") === "on"
  };
}

async function requestSearchPage(basePayload, { retstart = 0, pageSize = 10 } = {}) {
  const payload = {
    ...basePayload,
    maxResults: pageSize,
    retstart
  };

  const response = await fetch(apiUrl("/api/search"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  let result;
  try {
    result = await response.json();
  } catch (error) {
    throw new Error("Resposta inválida da API da busca.");
  }
  if (!response.ok || (!result.ok && !result.articles)) {
    throw new Error(result.error || "Falha na busca.");
  }
  if (!result.query?.translation && basePayload.clientTranslation?.concepts?.length) {
    result.query = {
      ...(result.query || {}),
      term: result.query?.term || basePayload.structuredQuery,
      translation: basePayload.clientTranslation,
      strategy: result.query?.strategy || "A busca foi interpretada localmente antes do envio ao PubMed."
    };
  }
  await enrichMissingJournals(result.articles);
  preparePaginationState(result);
  return result;
}

async function requestSearchUntilTarget(payload, targetTotal) {
  let fallbackPayload = null;
  let result;

  try {
    result = await requestSearchPage(payload, {
      retstart: 0,
      pageSize: targetTotal
    });
  } catch (error) {
    renderStatus("Erro na busca. Tentando estratégia alternativa...", error.message);
    await nextPaint();
    fallbackPayload = createLooseFallbackPayload(payload);
    result = await requestSearchPage(fallbackPayload, {
      retstart: 0,
      pageSize: targetTotal
    });
  }

  if (shouldRetryWithLooseFallback(result) && !fallbackPayload) {
    renderStatus(
      "Erro na busca. Tentando estratégia alternativa...",
      "A primeira estratégia retornou vazia; ampliando a busca com os termos originais."
    );
    await nextPaint();
    fallbackPayload = createLooseFallbackPayload(payload);
    result = await requestSearchPage(fallbackPayload, {
      retstart: 0,
      pageSize: targetTotal
    });
  }

  let loaded = uniqueArticles(result.articles || []).length;

  // Completa a lista automaticamente quando a API entrega uma pagina menor
  // que a quantidade selecionada, mantendo retstart/retmax como contrato.
  while (loaded < targetTotal && result.pagination?.hasMore !== false) {
    const nextRetstart = result.pagination?.nextRetstart;
    if (!Number.isFinite(nextRetstart) || nextRetstart <= 0) break;

    const nextResult = await requestSearchPage(payload, {
      retstart: nextRetstart,
      pageSize: targetTotal - loaded
    });
    const merged = mergeSearchResults(result, nextResult);
    const nextLoaded = uniqueArticles(merged.articles || []).length;
    result = merged;

    if (nextLoaded <= loaded) break;
    loaded = nextLoaded;
  }

  return result;
}

async function requestEvidenceDiscussion(mode) {
  if (!currentResult?.articles?.length) return;

  setDiscussionBusy(true, "Analisando evidências...", "A IA está revisando até 20 artigos, priorizando meta-análises, revisões sistemáticas e RCTs.");
  try {
    // Envia somente dados recuperados na busca atual; o backend aplica a selecao e as regras anti-extrapolacao.
    const payload = {
      mode,
      query: queryToCopy(currentResult.query),
      articles: uniqueArticles(currentResult.articles || []).map(serializeArticleForDiscussion),
      maxArticles: 20
    };
    const response = await fetch(apiUrl("/api/discuss-evidence"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const result = await response.json().catch(() => null);
    if (!response.ok || !result?.ok) {
      throw new Error(result?.error || "Não foi possível gerar a discussão das evidências.");
    }

    currentResult.discussion = result;
    renderDiscussionResult(result);
    persistLastSearch(activePayload || formSnapshotPayload(), currentResult);
  } catch (error) {
    renderDiscussionMessage("Não foi possível discutir as evidências.", error.message);
  } finally {
    setDiscussionBusy(false);
  }
}

function serializeArticleForDiscussion(article = {}) {
  return {
    pmid: article.pmid,
    doi: article.doi,
    title: article.title,
    year: article.year,
    pubdate: article.pubdate,
    studyType: article.studyType,
    pubTypes: article.pubTypes,
    evidenceLabel: article.evidenceLabel,
    abstractText: article.abstractText,
    abstractSections: article.abstractSections,
    hasAbstract: article.hasAbstract,
    description: article.description,
    scoring: article.scoring
  };
}

function resetDiscussionPanel() {
  discussionModeButtons.forEach((button) => button.classList.remove("active"));
  if (discussionResult) {
    discussionResult.hidden = true;
    discussionResult.innerHTML = "";
  }
  if (copyDiscussionButton) {
    copyDiscussionButton.hidden = true;
    copyDiscussionButton.textContent = "Copiar resultado";
  }
  renderDiscussionMessage(
    "Escolha um modo de análise.",
    "A resposta será baseada somente nos abstracts e metadados dos artigos retornados."
  );
}

function setDiscussionBusy(isBusy, title = "", body = "") {
  discussionModeButtons.forEach((button) => {
    button.disabled = isBusy;
  });
  if (copyDiscussionButton) copyDiscussionButton.disabled = isBusy;
  if (isBusy) renderDiscussionMessage(title, body);
}

function renderDiscussionMessage(title, body) {
  if (!discussionPlaceholder) return;
  discussionPlaceholder.hidden = false;
  discussionPlaceholder.innerHTML = `<strong>${escapeHtml(title)}</strong><p>${escapeHtml(body || "")}</p>`;
  if (discussionResult) discussionResult.hidden = true;
  if (copyDiscussionButton) copyDiscussionButton.hidden = true;
}

function renderDiscussionResult(result) {
  if (!discussionResult) return;
  discussionPlaceholder.hidden = true;
  discussionResult.hidden = false;
  discussionResult.innerHTML = "";

  const meta = document.createElement("p");
  meta.className = "discussion-meta";
  meta.textContent = `${result.selectedCount || 0} artigos analisados no modo ${discussionModeLabel(result.mode)}.`;
  discussionResult.append(meta);
  renderMarkdownBlock(result.analysisMarkdown || "", discussionResult);

  if (copyDiscussionButton) {
    copyDiscussionButton.hidden = false;
    copyDiscussionButton.disabled = false;
  }
}

function renderMarkdownBlock(markdown, container) {
  let currentList = null;
  for (const rawLine of String(markdown || "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      currentList = null;
      continue;
    }

    const heading = line.match(/^#{1,3}\s+(.+)$/);
    if (heading) {
      currentList = null;
      const h3 = document.createElement("h3");
      h3.textContent = heading[1];
      container.append(h3);
      continue;
    }

    const item = line.match(/^[-*]\s+(.+)$/);
    if (item) {
      if (!currentList) {
        currentList = document.createElement("ul");
        container.append(currentList);
      }
      const li = document.createElement("li");
      li.textContent = item[1];
      currentList.append(li);
      continue;
    }

    currentList = null;
    const p = document.createElement("p");
    p.textContent = line;
    container.append(p);
  }
}

function discussionModeLabel(mode) {
  return {
    Clinico: "Clínico",
    Pesquisador: "Pesquisador",
    Professor: "Professor",
    Conteudo: "Conteúdo"
  }[mode] || mode || "Clínico";
}

function shouldRetryWithLooseFallback(result) {
  if (!result) return true;
  if (result.searchUnavailable) return true;
  return !uniqueArticles(result.articles || []).length;
}

function createLooseFallbackPayload(payload) {
  const searchText = normalizeSpaces(payload.searchText || form.searchText.value || "");
  return {
    ...payload,
    searchText,
    structuredQuery: buildLooseFallbackQuery(searchText),
    manualStructuredQuery: "",
    clientTranslation: null,
    useOnlineResolver: false,
    prioritizeEvidence: false,
    applyClinicalFilter: false
  };
}

// Fallback amplo usado apenas quando a busca principal quebra ou volta vazia.
// Preserva os termos digitados e usa OR para aumentar sensibilidade.
function buildLooseFallbackQuery(searchText) {
  const terms = extractLooseTerms(searchText);
  if (!terms.length) return searchText;
  return terms
    .map((term) => {
      const escaped = term.replace(/"/g, '\\"');
      if (term.includes(" ")) return `("${escaped}"[Title/Abstract] OR "${escaped}"[All Fields])`;
      return `(${escaped}[Title/Abstract] OR ${escaped}[All Fields])`;
    })
    .join(" OR ");
}

function extractLooseTerms(value) {
  const cleaned = normalizeSpaces(String(value)
    .replace(/\[[^\]]+\]/g, " ")
    .replace(/[()"']/g, " ")
    .replace(/\b(AND|OR|NOT)\b/gi, " "));
  if (!cleaned) return [];
  const chunks = cleaned
    .split(/\s*(?:[\n;,/]+)\s*/)
    .map((term) => normalizeSpaces(term))
    .filter(Boolean);
  const terms = chunks.length > 1 ? chunks : [cleaned];
  if (chunks.length <= 1) {
    terms.push(...cleaned.split(/\s+/).filter((term) => term.length >= 3));
  }
  return [...new Set(terms)].slice(0, 12);
}

function renderResult(result) {
  const returned = result.count.returned;
  renderStatus(
    returned ? `${returned} artigo${returned === 1 ? "" : "s"} retornado${returned === 1 ? "" : "s"}` : "Nenhum artigo retornado",
    `${result.count.candidatesFetched} candidatos analisados, ${result.count.excluded} excluídos por protocolo/registro/dataset.`
  );

  queryOutput.textContent = queryText(result.query);
  auditPanel.hidden = false;
  queryPanel.hidden = false;
  if (result.articles.length) {
    renderValidation(result.validation);
  } else {
    validationGrid.innerHTML = "";
    validationGrid.hidden = true;
  }
  setResultsChrome(Boolean(result.articles.length));
  renderResultTabs();
  renderArticles(result);
  renderLoadMoreState();
  setExportButtonsEnabled(true);
}

function queryText(query) {
  const lines = [`Query principal:\n${query.term}`];
  if (query.translation?.concepts?.length) {
    lines.unshift(`Termos interpretados:\n${query.translation.concepts.map(formatConcept).join("\n")}`);
  }
  if (query.translation?.notes?.length) {
    lines.push(`Notas:\n${query.translation.notes.map((note) => `- ${note}`).join("\n")}`);
  }
  if (query.warnings?.length) {
    lines.push(`Ajustes automáticos:\n${query.warnings.map((warning) => `- ${warning}`).join("\n")}`);
  }
  if (query.evidenceTerm && query.evidenceTerm !== query.term) {
    lines.push(`Query priorizada:\n${query.evidenceTerm}`);
  }
  if (query.strategy) {
    lines.push(`Estratégia:\n${query.strategy}`);
  }
  return lines.join("\n\n");
}

function queryToCopy(query) {
  return query?.term || "";
}

function formatConcept(concept) {
  const mesh = concept.mesh?.length ? ` | MeSH: ${concept.mesh.join(", ")}` : "";
  const english = concept.english?.length ? ` | Inglês: ${concept.english.join(", ")}` : "";
  return `- ${concept.original} → ${concept.label}${english}${mesh} | Fonte: ${concept.source}`;
}

function renderValidation(validation) {
  validationGrid.innerHTML = "";
  for (const check of validation.checks) {
    const item = document.createElement("div");
    item.className = `check${check.ok ? "" : " failed"}`;
    item.innerHTML = `<strong>${check.ok ? "OK" : "Revisar"}</strong><p>${escapeHtml(check.label)}</p>`;
    validationGrid.append(item);
  }

  for (const warning of validation.warnings || []) {
    const item = document.createElement("div");
    item.className = "check failed";
    item.innerHTML = `<strong>Limitação</strong><p>${escapeHtml(warning)}</p>`;
    validationGrid.append(item);
  }

  validationGrid.hidden = false;
}

function renderArticles(result) {
  const sourceArticles = uniqueArticles(result?.articles || []).map(ensureArticleScoring);
  const filteredSourceArticles = filterArticlesByPdfPreference(sourceArticles);
  const articles = articlesForCurrentView(filteredSourceArticles);
  results.innerHTML = "";

  if (!sourceArticles.length) {
    const problems = [
      ...(result?.validation?.warnings || []),
      ...(result?.searchRuns || []).filter((run) => run.error).map((run) => `${run.label}: ${run.error}`)
    ];
    const empty = document.createElement("section");
    empty.className = "empty-state";
    empty.innerHTML = `
      <h2>${result?.searchUnavailable ? "Falha ao consultar a PubMed" : "Nenhum artigo encontrado"}</h2>
      <p>${result?.searchUnavailable
        ? "A busca não conseguiu consultar a base PubMed. Revise a configuração do servidor ou tente novamente em alguns minutos."
        : "A busca ampla também não retornou artigos. Tente menos termos, revise sinônimos ou pesquise a query diretamente na PubMed oficial."}</p>
      ${problems.length ? `<ul class="empty-problems">${problems.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>` : ""}
      <button class="pubmed-fallback" type="button">Pesquisar na PubMed</button>
    `;
    empty.querySelector(".pubmed-fallback").addEventListener("click", async () => {
      if (!currentResult?.query) return;
      await persistCurrentBeforeNavigation();
      window.location.assign(pubMedSearchUrl(queryToCopy(currentResult.query)));
    });
    results.append(empty);
    return;
  }

  if (form.freePdfOnly?.checked && !filteredSourceArticles.length) {
    const empty = document.createElement("section");
    empty.className = "empty-state";
    empty.innerHTML = `
      <h2>Nenhum PDF livre identificado</h2>
      <p>Nenhum estudo com PDF livre identificado entre os resultados carregados.</p>
    `;
    results.append(empty);
    return;
  }

  if (!articles.length) {
    const empty = document.createElement("section");
    empty.className = "empty-state";
    empty.innerHTML = `
      <h2>${currentView === "original" ? "Nenhum estudo original identificado" : "Nenhum estudo nesta aba"}</h2>
      <p>${currentView === "original"
        ? "Nenhum estudo original identificado entre os resultados carregados."
        : "Os resultados encontrados não possuem metadados suficientes para esta classificação. Use outra aba para revisar a lista completa."}</p>
    `;
    results.append(empty);
    return;
  }

  for (const article of articles) {
    const node = template.content.firstElementChild.cloneNode(true);
    node.querySelector(".journal-line").textContent = formatJournalLine(article);
    node.querySelector("h2").textContent = article.title;
    node.querySelector(".article-meta").innerHTML = [
      tag(article.year || "Ano indisponível"),
      tag(article.scoring?.evidenceLevel || article.evidenceLabel || "Artigo"),
      tag(article.studyType || "Tipo não informado"),
      article.pmcid ? tag(article.pmcid) : "",
      article.doi ? tag("DOI") : ""
    ].join("");

    const scoreReasons = node.querySelector(".score-reasons");
    if (currentView === "recommended" && article.scoring?.reasons?.length) {
      scoreReasons.hidden = false;
      scoreReasons.textContent = `Estudo recomendado para esta busca. Priorizado por: ${article.scoring.reasons.slice(0, 5).join(", ")}.`;
    }

    node.querySelector(".study-data").innerHTML = definitionList({
      PMID: article.pmid,
      DOI: article.doi || "Não informado",
      PMCID: article.pmcid || "Não informado",
      Data: article.pubdate || "Não informada"
    });

    node.querySelector(".main-result").textContent = article.description.mainResult;
    node.querySelector(".conclusion").textContent = article.description.conclusion;
    node.querySelector(".source").textContent = `Fonte: ${article.description.sourceUsed}${article.description.limitation ? ` | Limitação: ${article.description.limitation}` : ""}`;

    const pubmedLink = node.querySelector(".pubmed-link");
    pubmedLink.href = article.pubmedUrl;
    pubmedLink.addEventListener("click", async (event) => {
      event.preventDefault();
      await persistCurrentBeforeNavigation();
      window.location.assign(article.pubmedUrl);
    });

    const pdfLink = node.querySelector(".pdf-link");
    if (article.pdf?.url) {
      pdfLink.hidden = false;
      pdfLink.href = article.pdf.url;
      pdfLink.addEventListener("click", async (event) => {
        event.preventDefault();
        await persistCurrentBeforeNavigation();
        window.location.assign(article.pdf.url);
      });
    }

    node.querySelector(".pdf-status").textContent = article.pdf?.status || "PDF não avaliado";
    node.querySelector(".attempts").innerHTML = (article.pdf?.attempts || [])
      .map((attempt) => `<li><strong>${escapeHtml(attempt.step)}:</strong> ${attempt.ok ? "OK" : "Falhou"} - ${escapeHtml(attempt.detail)}</li>`)
      .join("");

    results.append(node);
  }
}

function currentDisplayedArticles() {
  if (!currentResult?.articles?.length) return [];
  const sourceArticles = uniqueArticles(currentResult.articles || []).map(ensureArticleScoring);
  return articlesForCurrentView(filterArticlesByPdfPreference(sourceArticles));
}

function filterArticlesByPdfPreference(articles) {
  if (!form.freePdfOnly?.checked) return articles;
  return articles.filter(hasFreePdf);
}

function hasFreePdf(article = {}) {
  return Boolean(article.pdf?.url);
}

function articlesForCurrentView(articles) {
  const copy = articles.map(ensureArticleScoring);
  if (currentView === "recent") return copy.sort(sortArticleByDate);
  if (currentView === "original") return copy.filter(isOriginalArticle).sort(sortArticleByEvidence);
  return copy.sort(sortArticleByRecommendation);
}

function sortArticleByRecommendation(a, b) {
  return articleScore(b).scoreTotal - articleScore(a).scoreTotal || sortArticleByDate(a, b);
}

function sortArticleByEvidence(a, b) {
  return (articleScore(a).evidenceRank || 99) - (articleScore(b).evidenceRank || 99) || sortArticleByDate(a, b);
}

function sortArticleByDate(a, b) {
  return String(b.sortDate || "0000-00-00").localeCompare(String(a.sortDate || "0000-00-00"));
}

function ensureArticleScoring(article) {
  if (article?.scoring?.scoreTotal !== undefined) {
    return {
      ...article,
      scoring: {
        ...article.scoring,
        isOriginalStudy: Boolean(article.scoring.isOriginalStudy || isOriginalArticle(article))
      }
    };
  }

  const scoring = calculateClientArticleScore(article);
  return {
    ...article,
    scoring
  };
}

function articleScore(article) {
  return ensureArticleScoring(article).scoring;
}

function calculateClientArticleScore(article = {}) {
  const evidence = classifyClientEvidence(article);
  const hasAbstract = Boolean(article.hasAbstract || String(article.description?.sourceUsed || "").toLowerCase().includes("abstract"));
  const hasPMCFullText = Boolean(article.pmcid && article.pdf?.url);
  const relevance = calculateClientRelevance(article);
  const yearScore = clientYearScore(article.year);
  const scoreTotal = evidence.typeScore + relevance + yearScore + (hasAbstract ? 8 : 0) + (hasPMCFullText ? 4 : 0);
  const reasons = [evidence.reason];
  if (relevance > 0) reasons.push("relevância textual");
  if (article.year) reasons.push(`ano ${article.year}`);
  if (hasAbstract) reasons.push("abstract disponível");
  if (hasPMCFullText) reasons.push("PDF PMC disponível");

  return {
    scoreTotal,
    reasons,
    evidenceLevel: evidence.evidenceLevel,
    evidenceRank: evidence.evidenceRank,
    isOriginalStudy: evidence.isOriginalStudy,
    hasAbstract,
    hasPMCFullText
  };
}

function classifyClientEvidence(article = {}) {
  const haystack = normalizeClientKey([
    article.studyType,
    article.evidenceLabel,
    article.title,
    article.description?.mainResult,
    article.description?.conclusion
  ].filter(Boolean).join(" "));

  if (haystack.includes("meta analysis") || haystack.includes("metaanalysis")) {
    return clientEvidence("Meta-Analysis", 1, 42, false, "Meta-Analysis");
  }
  if (haystack.includes("systematic review")) {
    return clientEvidence("Systematic Review", 2, 38, false, "Systematic Review");
  }
  if (haystack.includes("randomized controlled trial") || haystack.includes("randomised controlled trial") || haystack.includes("randomized") || haystack.includes("randomised")) {
    return clientEvidence("Randomized Controlled Trial", 3, 36, true, "ensaio randomizado");
  }
  if (haystack.includes("controlled clinical trial")) {
    return clientEvidence("Controlled Clinical Trial", 4, 30, true, "ensaio clínico controlado");
  }
  if (haystack.includes("clinical trial") || haystack.includes(" trial ")) {
    return clientEvidence("Clinical Trial", 4, 28, true, "ensaio clínico");
  }
  if (
    haystack.includes("cohort") ||
    haystack.includes("observational") ||
    haystack.includes("case control") ||
    haystack.includes("comparative study") ||
    haystack.includes("prospective") ||
    haystack.includes("retrospective")
  ) {
    return clientEvidence("Cohort / Observational / Case-Control", 5, 24, true, "estudo observacional");
  }
  if (haystack.includes("editorial") || haystack.includes("letter") || haystack.includes("comment")) {
    return clientEvidence("Editorial / Letter / Comment", 7, 2, false, "tipo de publicação secundário");
  }
  if (haystack.includes("review")) {
    return clientEvidence("Review", 6, 12, false, "revisão narrativa");
  }
  return clientEvidence("Outros tipos", 6, 8, false, "tipo de estudo informado");
}

function clientEvidence(evidenceLevel, evidenceRank, typeScore, isOriginalStudy, reason) {
  return { evidenceLevel, evidenceRank, typeScore, isOriginalStudy, reason };
}

function isOriginalArticle(article = {}) {
  const scoring = article.scoring;
  if (scoring?.isOriginalStudy) return true;
  const evidence = classifyClientEvidence(article);
  return evidence.isOriginalStudy;
}

function calculateClientRelevance(article = {}) {
  const queryTokens = normalizeClientKey(`${activePayload?.searchText || ""} ${currentResult?.query?.term || ""}`)
    .split(/\s+/)
    .filter((token) => token.length >= 3 && !CLIENT_STOPWORDS.has(token));
  if (!queryTokens.length) return 0;

  const articleText = normalizeClientKey([
    article.title,
    article.studyType,
    article.description?.mainResult,
    article.description?.conclusion
  ].filter(Boolean).join(" "));
  const overlap = queryTokens.filter((token) => articleText.includes(token)).length;
  return Math.round(Math.min(18, (overlap / queryTokens.length) * 18));
}

function clientYearScore(year) {
  const parsed = Number.parseInt(year, 10);
  if (!Number.isFinite(parsed)) return 0;
  const age = Math.max(0, new Date().getFullYear() - parsed);
  if (age <= 2) return 10;
  if (age <= 5) return 7;
  if (age <= 10) return 4;
  return 1;
}

function uniqueArticles(articles) {
  const seen = new Set();
  return articles.filter((article) => {
    const key = article.pmid || article.title;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function renderStatus(title, body) {
  statusPanel.innerHTML = `<div><strong>${escapeHtml(title)}</strong><p>${escapeHtml(body)}</p></div>`;
}

function normalizeSpaces(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function setResultsChrome(hasArticles) {
  if (resultsToolbar) resultsToolbar.hidden = !hasArticles;
  if (rankingNote) rankingNote.hidden = !hasArticles;
  if (loadMorePanel) loadMorePanel.hidden = true;
}

function renderResultTabs() {
  resultTabButtons.forEach((button) => {
    const active = button.dataset.view === currentView;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });
  if (rankingNote) {
    rankingNote.hidden = !currentResult?.articles?.length || currentView === "recent";
  }
}

function renderLoadMoreState() {
  if (!loadMorePanel || !loadMoreButton || !currentResult?.articles?.length) return;
  const loaded = uniqueArticles(currentResult.articles || []).length;
  const canLoadMore = loaded < targetResultCount && currentResult.pagination?.hasMore !== false;
  loadMorePanel.hidden = !canLoadMore;
  loadMoreButton.disabled = form.dataset.busy === "true";
  loadMoreButton.textContent = canLoadMore
    ? `Carregar mais resultados (${loaded}/${targetResultCount})`
    : "Carregar mais resultados";
}

function preparePaginationState(result) {
  if (!result.pagination) result.pagination = {};
  const retstart = Number.parseInt(result.pagination.retstart || 0, 10);
  const retmax = Number.parseInt(result.pagination.retmax || result.articles?.length || 0, 10);
  result.pagination.nextRetstart = retstart + retmax;
}

function mergeSearchResults(previous, next) {
  const articles = uniqueArticles([...(previous.articles || []), ...(next.articles || [])]);
  const warnings = uniqueText([
    ...(previous.validation?.warnings || []),
    ...(next.validation?.warnings || [])
  ]);
  const checks = previous.validation?.checks || next.validation?.checks || [];
  const merged = {
    ...previous,
    generatedAt: next.generatedAt || previous.generatedAt,
    searchRuns: [...(previous.searchRuns || []), ...(next.searchRuns || [])],
    count: {
      pubMedTotal: Math.max(previous.count?.pubMedTotal || 0, next.count?.pubMedTotal || 0),
      candidatesFetched: (previous.count?.candidatesFetched || 0) + (next.count?.candidatesFetched || 0),
      excluded: (previous.count?.excluded || 0) + (next.count?.excluded || 0),
      returned: articles.length
    },
    pagination: {
      ...(next.pagination || {}),
      hasMore: articles.length < targetResultCount && next.pagination?.hasMore !== false
    },
    exclusions: [...(previous.exclusions || []), ...(next.exclusions || [])],
    articles,
    validation: {
      ...(previous.validation || {}),
      checks,
      warnings
    }
  };
  preparePaginationState(merged);
  return merged;
}

function uniqueText(items) {
  return [...new Set(items.filter(Boolean))];
}

function normalizeRequestedTotal(value) {
  const parsed = Number.parseInt(value, 10);
  if (![10, 15, 20, 25].includes(parsed)) return 10;
  return parsed;
}

async function clearSearchScreen() {
  currentResult = null;
  activePayload = null;
  currentView = "recommended";
  targetResultCount = normalizeRequestedTotal(form.maxResults.value);
  form.searchText.value = "";
  form.structuredQuery.value = "";
  if (form.freePdfOnly) form.freePdfOnly.checked = false;
  resetAdvancedRows();
  results.innerHTML = "";
  queryOutput.textContent = "";
  queryPanel.hidden = true;
  auditPanel.hidden = true;
  validationGrid.hidden = true;
  validationGrid.innerHTML = "";
  setResultsChrome(false);
  if (discussionPanel) discussionPanel.hidden = true;
  setExportButtonsEnabled(false);
  sessionStorage.removeItem(RETURN_RESTORE_KEY);
  sessionStorage.removeItem("article-search-last");
  localStorage.removeItem("article-search-last");
  saveSettings(await formPayload());
  renderStatus("Pronto para buscar", "Digite os termos principais e inicie a busca.");
  form.searchText.focus();
}

function setBusy(isBusy) {
  form.dataset.busy = isBusy ? "true" : "false";
  form.setAttribute("aria-busy", String(isBusy));
  document.body.classList.toggle("is-busy", isBusy);
  analyzeButton.classList.toggle("is-loading", isBusy);
  analyzeButton.disabled = isBusy;
  loadExampleButton.disabled = isBusy;
  homeButton.disabled = isBusy;
  if (loadMoreButton) loadMoreButton.disabled = isBusy;
  if (addQueryRowButton) addQueryRowButton.disabled = isBusy;
  if (copyDoiListButton) copyDoiListButton.disabled = isBusy;
  if (form.freePdfOnly) form.freePdfOnly.disabled = isBusy;
  if (advancedTermInput) advancedTermInput.disabled = isBusy;
  if (advancedTermOperator) advancedTermOperator.disabled = isBusy;
  if (advancedTermField) advancedTermField.disabled = isBusy;
  if (copyAdvancedQueryButton) copyAdvancedQueryButton.disabled = isBusy;
  if (discussEvidenceButton) discussEvidenceButton.disabled = isBusy;
  analyzeButton.textContent = isBusy ? "Buscando..." : "Buscar";
  renderLoadMoreState();
}

function setExportButtonsEnabled(isEnabled) {
  if (exportMdButton) exportMdButton.disabled = !isEnabled;
  if (exportJsonButton) exportJsonButton.disabled = !isEnabled;
}

function initializeAdvancedBuilder() {
  if (!queryBuilderRows) return;
  resetAdvancedRows({ preservePreview: true });
  form.structuredQuery.addEventListener("input", () => {
    form.structuredQuery.dataset.generated = "false";
  });
}

function resetAdvancedRows({ preservePreview = false } = {}) {
  if (!queryBuilderRows) return;
  advancedTerms = [];
  queryBuilderRows.innerHTML = "";
  if (advancedTermInput) advancedTermInput.value = "";
  if (advancedTermOperator) advancedTermOperator.value = "AND";
  if (advancedTermField) advancedTermField.value = "All Fields";
  if (!preservePreview) {
    form.structuredQuery.value = "";
    form.structuredQuery.dataset.generated = "true";
  }
  renderAdvancedTermList();
  renderAdvancedWarning("");
}

async function handleAddAdvancedTerm() {
  const term = advancedTermInput?.value.trim() || "";
  if (!term) {
    renderAdvancedWarning("Digite um termo antes de adicionar.");
    advancedTermInput?.focus();
    return;
  }

  const operator = normalizeOperator(advancedTermOperator?.value || "AND");
  const field = normalizeAdvancedField(advancedTermField?.value || "All Fields");
  addQueryRowButton.disabled = true;
  addQueryRowButton.textContent = "Otimizando...";

  try {
    const resolved = await resolveAdvancedTerm(term, field);
    advancedTerms.push({
      id: advancedTermId += 1,
      term,
      operator,
      field,
      concept: resolved.concept,
      expression: resolved.expression,
      warning: resolved.warning
    });
    advancedTermInput.value = "";
    advancedTermInput.focus();
    renderAdvancedTermList();
    updateAdvancedQueryPreview();
  } finally {
    addQueryRowButton.disabled = form.dataset.busy === "true";
    addQueryRowButton.textContent = "Adicionar termo";
  }
}

async function resolveAdvancedTerm(term, field) {
  const serverResolved = await resolveTermsOnServer(term, "AND");
  const concept = serverResolved?.concepts?.[0] || await resolveClientConcept(term);
  return {
    concept,
    ...buildAdvancedExpression(term, field, concept)
  };
}

function buildAdvancedExpression(term, field, concept = {}) {
  const meshTerms = uniqueClientValues(concept.mesh || []);
  const textTerms = uniqueClientValues([
    term,
    concept.label,
    ...(concept.english || []),
    ...(concept.titleAbstract || [])
  ]);

  if (field === "MeSH Terms") {
    if (meshTerms.length) {
      return {
        expression: fieldedTerms(meshTerms, "MeSH Terms"),
        effectiveField: "MeSH Terms",
        warning: ""
      };
    }

    return {
      expression: uniqueClientValues([
        fieldedTerms(textTerms, "Title/Abstract"),
        fieldedTerms([term], "All Fields")
      ]).filter(Boolean).join(" OR "),
      effectiveField: "Title/Abstract + All Fields",
      warning: `MeSH não encontrado para "${term}". Usando termo digitado e sinônimos em Title/Abstract/All Fields.`
    };
  }

  if (field === "Title/Abstract") {
    return {
      expression: fieldedTerms(textTerms, "Title/Abstract"),
      effectiveField: "Title/Abstract",
      warning: ""
    };
  }

  return {
    expression: fieldedTerms(textTerms, "All Fields"),
    effectiveField: "All Fields",
    warning: ""
  };
}

function fieldedTerms(terms, field) {
  return uniqueClientValues(terms)
    .map((term) => {
      const escaped = escapePubMedTerm(term);
      return term.includes(" ") ? `"${escaped}"[${field}]` : `${escaped}[${field}]`;
    })
    .join(" OR ");
}

function renderAdvancedTermList() {
  if (!queryBuilderRows) return;
  queryBuilderRows.innerHTML = "";

  advancedTerms.forEach((item, index) => {
    const row = document.createElement("li");
    row.className = "advanced-term-item";
    row.dataset.id = String(item.id);
    row.innerHTML = `
      ${index === 0
        ? '<span class="operator-placeholder">Inicial</span>'
        : `<select class="query-operator" aria-label="Operador do termo">
            ${["AND", "OR", "NOT"].map((operator) => `<option value="${operator}"${operator === item.operator ? " selected" : ""}>${operator}</option>`).join("")}
          </select>`}
      <span class="advanced-term-text">${escapeHtml(index === 0 ? item.term : `${item.operator} ${item.term}`)}</span>
      <select class="query-field" aria-label="Campo do termo">
        ${ADVANCED_FIELDS.map((field) => `<option value="${escapeHtml(field)}"${field === item.field ? " selected" : ""}>${escapeHtml(field)}</option>`).join("")}
      </select>
      <button class="remove-query-row" type="button">Remover</button>
    `;

    row.querySelector(".query-operator")?.addEventListener("change", (event) => {
      item.operator = normalizeOperator(event.target.value);
      renderAdvancedTermList();
      updateAdvancedQueryPreview();
    });

    row.querySelector(".query-field").addEventListener("change", (event) => {
      item.field = normalizeAdvancedField(event.target.value);
      const rebuilt = buildAdvancedExpression(item.term, item.field, item.concept);
      item.expression = rebuilt.expression;
      item.warning = rebuilt.warning;
      renderAdvancedTermList();
      updateAdvancedQueryPreview();
    });

    row.querySelector(".remove-query-row").addEventListener("click", () => {
      advancedTerms = advancedTerms.filter((term) => term.id !== item.id);
      renderAdvancedTermList();
      updateAdvancedQueryPreview();
    });

    queryBuilderRows.append(row);
  });
}

function updateAdvancedQueryPreview() {
  const built = buildAdvancedQueryFromTerms();
  if (built.query || form.structuredQuery.dataset.generated === "true") {
    form.structuredQuery.value = built.query;
    form.structuredQuery.dataset.generated = "true";
  }
  renderAdvancedWarning(built.warning);
}

function buildAdvancedQueryFromTerms() {
  const parts = [];
  const warnings = [];

  advancedTerms.forEach((item, index) => {
    if (!item.expression) return;
    const expression = `(${item.expression})`;
    if (index === 0) {
      if (item.operator === "NOT") warnings.push("O primeiro termo não deve usar NOT; ele foi tratado como termo inicial.");
      parts.push(expression);
    } else {
      parts.push(`${normalizeOperator(item.operator)} ${expression}`);
    }
    if (item.warning) warnings.push(item.warning);
  });

  if (!parts.length && form.structuredQuery.value.trim() && form.structuredQuery.dataset.generated === "true") {
    warnings.push("Adicione pelo menos um termo para gerar a query avançada.");
  }

  return {
    query: parts.join(" "),
    warning: uniqueClientValues(warnings).join(" ")
  };
}

function renderAdvancedWarning(message) {
  if (!advancedQueryWarning) return;
  advancedQueryWarning.hidden = !message;
  advancedQueryWarning.textContent = message || "";
}

function escapePubMedTerm(value) {
  return String(value).replace(/"/g, '\\"');
}

function normalizeAdvancedField(value) {
  return ADVANCED_FIELDS.includes(value) ? value : "All Fields";
}

function nextPaint() {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function tag(value) {
  return `<span class="tag">${escapeHtml(value)}</span>`;
}

function formatJournalLine(article = {}) {
  const journal = normalizeJournalForDisplay(article.journal);
  return `${journal.name} (IF: ${journal.impactFactorLabel})`;
}

function normalizeJournalForDisplay(value) {
  if (typeof value === "string") {
    return {
      name: value.trim() || "Revista não localizada",
      impactFactorLabel: "não localizado"
    };
  }

  const journal = value && typeof value === "object" ? value : {};
  return {
    name: String(journal.name || journal.title || "Revista não localizada").trim(),
    impactFactorLabel: String(journal.impactFactorLabel || journal.impactFactor || "não localizado").trim()
  };
}

async function enrichMissingJournals(articles = []) {
  const missing = articles
    .filter((article) => article?.pmid && isMissingJournal(article.journal))
    .map((article) => article.pmid);
  const ids = [...new Set(missing)];
  if (!ids.length) return;

  try {
    const url = new URL("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi");
    url.searchParams.set("db", "pubmed");
    url.searchParams.set("retmode", "json");
    url.searchParams.set("id", ids.join(","));
    url.searchParams.set("tool", "BuscaPubMed");

    const response = await fetch(url);
    if (!response.ok) return;
    const data = await response.json();
    const result = data?.result || {};

    for (const article of articles) {
      const summary = result[article.pmid];
      if (!summary) continue;
      article.journal = extractJournalFromPubMedSummary(summary);
    }
  } catch {
    // Se o navegador bloquear a consulta NCBI, o card ainda exibe fallback claro.
  }
}

function isMissingJournal(journal) {
  const name = typeof journal === "string" ? journal : journal?.name || journal?.title || "";
  return !name || /revista n[aã]o (informada|localizada)/i.test(name);
}

function extractJournalFromPubMedSummary(summary = {}) {
  const name = firstText(
    summary.fulljournalname,
    summary.fullJournalName,
    summary.journal?.title,
    summary.journal?.Title,
    summary.medlinejournalinfo?.medlineta,
    summary.medlineJournalInfo?.medlineTA,
    summary.source
  ) || "Revista não localizada";
  const abbreviation = firstText(
    summary.journal?.isoabbreviation,
    summary.journal?.ISOAbbreviation,
    summary.medlinejournalinfo?.medlineta,
    summary.medlineJournalInfo?.medlineTA,
    summary.source
  );

  return {
    name,
    abbreviation,
    issn: String(summary.issn || "").trim(),
    eissn: String(summary.essn || summary.eissn || "").trim(),
    impactFactor: null,
    impactFactorLabel: "não localizado",
    impactFactorSource: "não localizado"
  };
}

function firstText(...values) {
  return values
    .map((value) => String(value || "").replace(/\.$/, "").replace(/\s+/g, " ").trim())
    .find(Boolean) || "";
}

function definitionList(values) {
  return Object.entries(values)
    .map(([key, value]) => `<dt>${escapeHtml(key)}</dt><dd>${escapeHtml(value)}</dd>`)
    .join("");
}

function saveSettings(payload) {
  localStorage.setItem("article-search-settings", JSON.stringify({
    settingsVersion: SETTINGS_VERSION,
    searchText: payload.searchText,
    structuredQuery: payload.manualStructuredQuery,
    unpaywallEmail: payload.unpaywallEmail,
    maxResults: payload.maxResults,
    freePdfOnly: Boolean(payload.freePdfOnly),
    prioritizeEvidence: payload.prioritizeEvidence,
    applyClinicalFilter: payload.applyClinicalFilter
  }));
}

function formSnapshotPayload() {
  return {
    searchText: form.searchText.value.trim(),
    manualStructuredQuery: form.structuredQuery.value.trim(),
    unpaywallEmail: form.unpaywallEmail.value.trim(),
    maxResults: form.maxResults.value,
    freePdfOnly: Boolean(form.freePdfOnly?.checked),
    prioritizeEvidence: form.prioritizeEvidence.checked,
    applyClinicalFilter: form.applyClinicalFilter.checked
  };
}

function restoreSettings() {
  try {
    const settings = JSON.parse(localStorage.getItem("article-search-settings") || "{}");
    if (settings.searchText) form.searchText.value = settings.searchText;
    if (settings.structuredQuery) form.structuredQuery.value = settings.structuredQuery;
    if (settings.unpaywallEmail) form.unpaywallEmail.value = settings.unpaywallEmail;
    // Evita que o antigo padrão salvo como 25 continue sobrescrevendo o novo padrão 10.
    const savedMaxResults = String(settings.maxResults || "");
    const canRestoreMaxResults = ["10", "15", "20", "25"].includes(savedMaxResults)
      && settings.settingsVersion >= SETTINGS_VERSION;
    if (canRestoreMaxResults) {
      form.maxResults.value = String(settings.maxResults);
    }
    if (form.freePdfOnly) form.freePdfOnly.checked = Boolean(settings.freePdfOnly);
    form.prioritizeEvidence.checked = settings.prioritizeEvidence !== false;
    form.applyClinicalFilter.checked = Boolean(settings.applyClinicalFilter);
  } catch {
    localStorage.removeItem("article-search-settings");
  }
}

function persistLastSearch(payload, result) {
  const data = {
    savedAt: new Date().toISOString(),
    payload,
    result
  };
  sessionStorage.setItem("article-search-last", JSON.stringify(data));
  localStorage.setItem("article-search-last", JSON.stringify(data));
}

async function persistCurrentBeforeNavigation() {
  if (!currentResult) return;
  sessionStorage.setItem(RETURN_RESTORE_KEY, "true");
  persistLastSearch(activePayload || await formPayload(), currentResult);
}

function restoreLastSearch() {
  const shouldRestore = sessionStorage.getItem(RETURN_RESTORE_KEY) === "true";
  sessionStorage.removeItem(RETURN_RESTORE_KEY);
  if (!shouldRestore) {
    validationGrid.hidden = true;
    validationGrid.innerHTML = "";
    results.innerHTML = "";
    queryPanel.hidden = true;
    auditPanel.hidden = true;
    return;
  }

  const raw = sessionStorage.getItem("article-search-last") || localStorage.getItem("article-search-last");
  if (!raw) return;

  try {
    const saved = JSON.parse(raw);
    if (!saved?.result?.articles || saved.result.mode === "query-only") return;
    currentResult = saved.result;
    activePayload = saved.payload || null;
    if (saved.payload) {
      if (saved.payload.searchText) form.searchText.value = saved.payload.searchText;
      if (saved.payload.manualStructuredQuery) form.structuredQuery.value = saved.payload.manualStructuredQuery;
      if (saved.payload.maxResults && ["10", "15", "20", "25"].includes(String(saved.payload.maxResults))) {
        form.maxResults.value = String(saved.payload.maxResults);
      }
      if (form.freePdfOnly) form.freePdfOnly.checked = Boolean(saved.payload.freePdfOnly);
    }
    targetResultCount = normalizeRequestedTotal(form.maxResults.value);
    preparePaginationState(currentResult);
    renderResult(saved.result);
    renderStatus(
      "Busca restaurada",
      `A última lista foi preservada para você continuar abrindo os artigos. Salva em ${new Date(saved.savedAt).toLocaleString("pt-BR")}.`
    );
  } catch {
    sessionStorage.removeItem("article-search-last");
  }
}

function toMarkdown(result) {
  const lines = [
    "# Busca PubMed",
    "",
    `Gerado em: ${result.generatedAt}`,
    "",
    "## Query",
    "",
    "```text",
    queryText(result.query),
    "```",
    "",
    "## Artigos"
  ];

  for (const article of result.articles) {
    lines.push(
      "",
      `### ${article.title}`,
      "",
      `- Revista: ${formatJournalLine(article)}`,
      `- Ano: ${article.year || "Não informado"}`,
      `- Tipo de estudo: ${article.studyType}`,
      `- DOI: ${article.doi || "Não informado"}`,
      `- PMID: ${article.pmid}`,
      `- PMCID: ${article.pmcid || "Não informado"}`,
      `- PubMed: ${article.pubmedUrl}`,
      `- PDF: ${article.pdf?.url || "PDF não disponível (possível paywall)"}`,
      `- Fonte da descrição: ${article.description.sourceUsed}`,
      "",
      "Resultado principal:",
      "",
      article.description.mainResult,
      "",
      "Conclusão:",
      "",
      article.description.conclusion
    );
  }

  return lines.join("\n");
}

function downloadText(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // file:// e alguns navegadores bloqueiam Clipboard API; usa fallback local.
  }

  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    document.body.append(textarea);
    textarea.select();
    const ok = document.execCommand("copy");
    textarea.remove();
    return ok;
  } catch {
    return false;
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function resolveClientConcepts(searchText, operator = "AND") {
  const raw = String(searchText || "").trim();
  if (!raw) return null;
  if (looksLikePubMedSyntax(raw)) {
    return {
      concepts: [{ original: raw, label: "Query PubMed", mesh: [], english: [], source: "Query manual" }],
      notes: ["A entrada já parece conter sintaxe PubMed."],
      query: raw
    };
  }

  const serverResolved = await resolveTermsOnServer(raw, operator);
  if (serverResolved) return serverResolved;

  const parts = extractClientParts(raw);
  const concepts = [];
  for (const part of (parts.length ? parts : [raw])) {
    concepts.push(await resolveClientConcept(part));
  }

  return {
    concepts,
    notes: [
      "Tradução aplicada no navegador antes da busca.",
      "Se o termo não estiver na base local, o servidor tentará tradução online e validação MeSH/NLM."
    ],
    query: concepts.map((concept) => `(${buildClientConceptQuery(concept)})`).join(` ${operator} `)
  };
}

async function resolveTermsOnServer(searchText, operator) {
  try {
    const response = await fetch(apiUrl("/api/resolve-terms"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ searchText }),
      signal: AbortSignal.timeout(5500)
    });

    if (!response.ok) return null;
    const result = await response.json();
    if (!result?.concepts?.length) return null;

    return {
      concepts: result.concepts,
      notes: [
        ...(result.notes || []),
        `Conceitos correlacionados com ${operator}.`
      ],
      query: result.concepts
        .map((concept) => `(${buildClientConceptQuery(concept)})`)
        .join(` ${operator} `)
    };
  } catch {
    return null;
  }
}

function extractClientParts(raw) {
  const explicit = raw
    .split(/\s*(?:[\n;,]+)\s*/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (explicit.length > 1) return explicit;

  const normalized = normalizeClientKey(raw);
  const matches = [];

  for (const descriptor of CLIENT_DESCRIPTORS) {
    const matchedTerm = descriptor.terms
      .map((term) => ({ term, key: normalizeClientKey(term) }))
      .sort((a, b) => b.key.length - a.key.length)
      .find(({ key }) => key && normalized.includes(key));

    if (matchedTerm) {
      matches.push({ term: matchedTerm.term, key: matchedTerm.key, index: normalized.indexOf(matchedTerm.key) });
    }
  }

  if (matches.length === 0) return explicit;

  matches.sort((a, b) => a.index - b.index);
  const known = matches.map((match) => match.term);
  const leftovers = normalized
    .split(/\s+/)
    .filter((word) => word.length > 2 && !CLIENT_STOPWORDS.has(word))
    .filter((word) => !matches.some((match) => match.key.split(/\s+/).includes(word)));

  return uniqueClientValues([...known, ...leftovers]);
}

async function resolveClientConcept(value) {
  const key = normalizeClientKey(value);
  const descriptor = CLIENT_DESCRIPTORS.find((item) =>
    item.terms.some((term) => {
      const termKey = normalizeClientKey(term);
      return key === termKey || key.includes(termKey) || termKey.includes(key);
    })
  );

  if (!descriptor) {
    const mesh = await lookupMeshDescriptor(value);
    if (mesh) {
      return {
        original: value,
        label: mesh.label,
        mesh: [mesh.label],
        english: [],
        titleAbstract: uniqueClientValues([value, mesh.label]),
        source: "MeSH/NLM online"
      };
    }

    return {
      original: value,
      label: value,
      mesh: [],
      english: [],
      titleAbstract: [value],
      source: "Termo livre"
    };
  }

  return {
    original: value,
    label: descriptor.label,
    mesh: descriptor.mesh,
    english: descriptor.english,
    titleAbstract: uniqueClientValues([value, ...descriptor.terms, ...descriptor.english]),
    source: "Base local DeCS/MeSH"
  };
}

async function lookupMeshDescriptor(value) {
  const attempts = [
    { label: value, match: "exact" },
    { label: value, match: "contains" }
  ];

  for (const attempt of attempts) {
    try {
      const url = new URL("https://id.nlm.nih.gov/mesh/lookup/descriptor");
      url.searchParams.set("label", attempt.label);
      url.searchParams.set("match", attempt.match);
      url.searchParams.set("limit", "5");
      const response = await fetch(url, { headers: { "Accept": "application/json" } });
      if (!response.ok) continue;
      const data = await response.json();
      if (Array.isArray(data) && data.length > 0 && data[0]?.label) {
        return data[0];
      }
    } catch {
      return null;
    }
  }

  return null;
}

function buildClientConceptQuery(concept) {
  const terms = [];
  for (const mesh of concept.mesh || []) {
    terms.push(`"${escapeClientQuotes(mesh)}"[MeSH Terms]`);
  }
  for (const term of concept.titleAbstract || []) {
    const escaped = escapeClientQuotes(term);
    terms.push(term.includes(" ") ? `"${escaped}"[Title/Abstract]` : `${escaped}[Title/Abstract]`);
  }
  return uniqueClientValues(terms).join(" OR ");
}

function normalizeClientKey(value) {
  return String(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function escapeClientQuotes(value) {
  return String(value).replace(/"/g, '\\"');
}

function apiUrl(path) {
  if (window.location.protocol === "file:") {
    return configuredApiBase ? `${configuredApiBase}${path}` : `http://localhost:4173${path}`;
  }
  if (isLocalHost()) return path;
  if (configuredApiBase) return `${configuredApiBase}${path}`;
  return path;
}

function normalizeApiBase(value) {
  return String(value || "").replace(/\/+$/, "").trim();
}

function isLocalHost() {
  return ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
}

function uniqueClientValues(values) {
  const seen = new Set();
  return values.filter((value) => {
    const key = normalizeClientKey(value);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function looksLikePubMedSyntax(value) {
  return /\[[^[\]]+\]|\b(AND|OR|NOT)\b|["()]/i.test(value);
}

function normalizeOperator(value) {
  const normalized = String(value || "AND").toUpperCase();
  return ["AND", "OR", "NOT"].includes(normalized) ? normalized : "AND";
}

function pubMedSearchUrl(query) {
  return `https://pubmed.ncbi.nlm.nih.gov/?term=${encodeURIComponent(query)}`;
}
