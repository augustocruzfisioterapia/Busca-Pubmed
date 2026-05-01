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
const loadExampleButton = document.querySelector("#load-example");
const homeButton = document.querySelector("#home-button");
const analyzeButton = form.querySelector('button[type="submit"]');

let currentResult = null;
const RETURN_RESTORE_KEY = "article-search-returning";

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

restoreSettings();
restoreLastSearch();

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (form.dataset.busy === "true") return;

  setBusy(true);
  renderStatus("Preparando busca", "Processando termos, sinônimos e MeSH antes de consultar a PubMed.");
  results.innerHTML = "";
  queryOutput.textContent = "";
  validationGrid.hidden = true;
  validationGrid.innerHTML = "";
  queryPanel.hidden = true;
  await nextPaint();

  try {
    const payload = await formPayload();
    saveSettings(payload);
    renderStatus("Buscando artigos", "Consultando PubMed, metadados, PDFs e fontes de texto.");

    const response = await fetch("/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const result = await response.json();
    if (!response.ok || (!result.ok && !result.articles)) {
      throw new Error(result.error || "Falha na busca.");
    }
    if (!result.query?.translation && payload.clientTranslation?.concepts?.length) {
      result.query = {
        ...(result.query || {}),
        term: result.query?.term || payload.structuredQuery,
        translation: payload.clientTranslation,
        strategy: result.query?.strategy || "A busca foi interpretada localmente antes do envio ao PubMed."
      };
    }
    currentResult = result;
    persistLastSearch(payload, result);
    renderResult(result);
  } catch (error) {
    currentResult = null;
    renderStatus("Falha na busca", error.message);
    setExportButtonsEnabled(false);
  } finally {
    setBusy(false);
  }
});

loadExampleButton.addEventListener("click", () => {
  form.searchText.value = "mobilização precoce, unidade de terapia intensiva, segurança";
  form.structuredQuery.value = "";
  form.maxResults.value = "8";
  form.conceptOperator.value = "AND";
});

homeButton.addEventListener("click", () => {
  clearSearchScreen();
});

copyQueryButton.addEventListener("click", async () => {
  if (!currentResult?.query) return;
  await navigator.clipboard.writeText(queryToCopy(currentResult.query));
  copyQueryButton.textContent = "Copiado";
  setTimeout(() => {
    copyQueryButton.textContent = "Copiar query";
  }, 1200);
});

exportMdButton?.addEventListener("click", () => {
  if (!currentResult) return;
  downloadText("busca-pubmed.md", toMarkdown(currentResult), "text/markdown");
});

exportJsonButton?.addEventListener("click", () => {
  if (!currentResult) return;
  downloadText("busca-pubmed.json", JSON.stringify(currentResult, null, 2), "application/json");
});

async function formPayload() {
  const data = new FormData(form);
  const searchText = String(data.get("searchText") || "").trim();
  const manualStructuredQuery = String(data.get("structuredQuery") || "").trim();
  const conceptOperator = normalizeOperator(data.get("conceptOperator"));
  const clientTranslation = manualStructuredQuery ? null : await resolveClientConcepts(searchText, conceptOperator);

  return {
    searchText,
    structuredQuery: manualStructuredQuery || clientTranslation?.query || "",
    manualStructuredQuery,
    clientTranslation,
    conceptOperator,
    useOnlineResolver: true,
    maxResults: data.get("maxResults"),
    unpaywallEmail: data.get("unpaywallEmail"),
    prioritizeEvidence: data.get("prioritizeEvidence") === "on",
    applyClinicalFilter: data.get("applyClinicalFilter") === "on"
  };
}

function renderResult(result) {
  const returned = result.count.returned;
  renderStatus(
    returned ? `${returned} artigo${returned === 1 ? "" : "s"} retornado${returned === 1 ? "" : "s"}` : "Nenhum artigo retornado",
    `${result.count.candidatesFetched} candidatos analisados, ${result.count.excluded} excluídos por protocolo/registro/dataset.`
  );

  queryOutput.textContent = queryText(result.query);
  queryPanel.hidden = false;
  if (result.articles.length) {
    renderValidation(result.validation);
  } else {
    validationGrid.innerHTML = "";
    validationGrid.hidden = true;
  }
  renderArticles(result.articles);
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

function renderArticles(articles) {
  results.innerHTML = "";

  if (!articles.length) {
    const empty = document.createElement("section");
    empty.className = "empty-state";
    empty.innerHTML = `
      <h2>Nenhum artigo encontrado</h2>
      <p>A busca ampla tambem nao retornou artigos. Tente menos termos, revise sinonimos ou pesquise a query diretamente na PubMed oficial.</p>
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

  for (const article of articles) {
    const node = template.content.firstElementChild.cloneNode(true);
    node.querySelector("h2").textContent = article.title;
    node.querySelector(".article-meta").innerHTML = [
      tag(article.year || "Ano indisponível"),
      tag(article.evidenceLabel || "Artigo"),
      tag(article.studyType || "Tipo não informado"),
      article.pmcid ? tag(article.pmcid) : "",
      article.doi ? tag("DOI") : ""
    ].join("");

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

function renderStatus(title, body) {
  statusPanel.innerHTML = `<div><strong>${escapeHtml(title)}</strong><p>${escapeHtml(body)}</p></div>`;
}

async function clearSearchScreen() {
  currentResult = null;
  form.searchText.value = "";
  form.structuredQuery.value = "";
  form.conceptOperator.value = "AND";
  results.innerHTML = "";
  queryOutput.textContent = "";
  queryPanel.hidden = true;
  validationGrid.hidden = true;
  validationGrid.innerHTML = "";
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
  analyzeButton.textContent = isBusy ? "Buscando..." : "Buscar";
}

function setExportButtonsEnabled(isEnabled) {
  if (exportMdButton) exportMdButton.disabled = !isEnabled;
  if (exportJsonButton) exportJsonButton.disabled = !isEnabled;
}

function nextPaint() {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function tag(value) {
  return `<span class="tag">${escapeHtml(value)}</span>`;
}

function definitionList(values) {
  return Object.entries(values)
    .map(([key, value]) => `<dt>${escapeHtml(key)}</dt><dd>${escapeHtml(value)}</dd>`)
    .join("");
}

function saveSettings(payload) {
  localStorage.setItem("article-search-settings", JSON.stringify({
    searchText: payload.searchText,
    structuredQuery: payload.manualStructuredQuery,
    conceptOperator: payload.conceptOperator,
    unpaywallEmail: payload.unpaywallEmail,
    maxResults: payload.maxResults,
    prioritizeEvidence: payload.prioritizeEvidence,
    applyClinicalFilter: payload.applyClinicalFilter
  }));
}

function restoreSettings() {
  try {
    const settings = JSON.parse(localStorage.getItem("article-search-settings") || "{}");
    if (settings.searchText) form.searchText.value = settings.searchText;
    if (settings.structuredQuery) form.structuredQuery.value = settings.structuredQuery;
    if (settings.conceptOperator) form.conceptOperator.value = settings.conceptOperator;
    if (settings.unpaywallEmail) form.unpaywallEmail.value = settings.unpaywallEmail;
    if (settings.maxResults) form.maxResults.value = settings.maxResults;
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
  persistLastSearch(await formPayload(), currentResult);
}

function restoreLastSearch() {
  const shouldRestore = sessionStorage.getItem(RETURN_RESTORE_KEY) === "true";
  sessionStorage.removeItem(RETURN_RESTORE_KEY);
  if (!shouldRestore) {
    validationGrid.hidden = true;
    validationGrid.innerHTML = "";
    results.innerHTML = "";
    queryPanel.hidden = true;
    return;
  }

  const raw = sessionStorage.getItem("article-search-last") || localStorage.getItem("article-search-last");
  if (!raw) return;

  try {
    const saved = JSON.parse(raw);
    if (!saved?.result?.articles || saved.result.mode === "query-only") return;
    currentResult = saved.result;
    if (saved.payload) {
      if (saved.payload.searchText) form.searchText.value = saved.payload.searchText;
      if (saved.payload.manualStructuredQuery) form.structuredQuery.value = saved.payload.manualStructuredQuery;
      if (saved.payload.conceptOperator) form.conceptOperator.value = saved.payload.conceptOperator;
    }
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
    const response = await fetch("/api/resolve-terms", {
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
  return String(value || "AND").toUpperCase() === "OR" ? "OR" : "AND";
}

function pubMedSearchUrl(query) {
  return `https://pubmed.ncbi.nlm.nih.gov/?term=${encodeURIComponent(query)}`;
}
