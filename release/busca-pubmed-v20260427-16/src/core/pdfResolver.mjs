const UNPAYWALL = "https://api.unpaywall.org/v2";
const PROHIBITED_HOSTS = [
  "biolincc.nhlbi.nih.gov",
  "clinicaltrials.gov"
];

export function buildPmcPdfUrl(pmcid) {
  if (!pmcid) return "";
  const clean = String(pmcid).toUpperCase().startsWith("PMC") ? pmcid : `PMC${pmcid}`;
  return `https://www.ncbi.nlm.nih.gov/pmc/articles/${clean}/pdf/`;
}

export function isAllowedPdfUrl(value) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (PROHIBITED_HOSTS.some((blocked) => host === blocked || host.endsWith(`.${blocked}`))) return false;
    return host.endsWith("ncbi.nlm.nih.gov") && url.pathname.toLowerCase().includes("/pdf");
  } catch {
    return false;
  }
}

export function hasProhibitedUrl(value) {
  try {
    const host = new URL(value).hostname.toLowerCase();
    return PROHIBITED_HOSTS.some((blocked) => host === blocked || host.endsWith(`.${blocked}`));
  } catch {
    return false;
  }
}

export async function resolvePdf(article, { fetchImpl = fetch, unpaywallEmail = "" } = {}) {
  const attempts = [];
  let pdfUrl = "";
  let status = "PDF nao disponivel (possivel paywall)";

  if (article.doi) {
    if (unpaywallEmail) {
      const unpaywall = await attemptTwice("Unpaywall por DOI", attempts, async () => {
        const url = new URL(`${UNPAYWALL}/${encodeURIComponent(article.doi)}`);
        url.searchParams.set("email", unpaywallEmail);
        const response = await fetchImpl(url, { headers: { "Accept": "application/json" } });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      });

      const candidates = collectUnpaywallPdfCandidates(unpaywall);
      const allowed = candidates.find(isAllowedPdfUrl);
      if (allowed) {
        pdfUrl = allowed;
        status = "PDF disponivel";
        attempts.push({ step: "Politica de links", ok: true, detail: "PDF aceito por apontar para PMC/NCBI." });
      } else if (candidates.length > 0) {
        attempts.push({
          step: "Politica de links",
          ok: false,
          detail: "Unpaywall encontrou PDF, mas o link nao foi usado por estar fora da politica definida."
        });
      }
    } else {
      attempts.push({
        step: "Unpaywall por DOI",
        ok: false,
        detail: "Ignorado: informe e-mail nas configuracoes para consultar Unpaywall."
      });
    }
  } else {
    attempts.push({ step: "Unpaywall por DOI", ok: false, detail: "Ignorado: DOI ausente." });
  }

  if (!pdfUrl && article.pmcid) {
    const pmcPdfUrl = buildPmcPdfUrl(article.pmcid);
    const verified = await attemptTwice("PDF via PMCID", attempts, async () => {
      const response = await fetchImpl(pmcPdfUrl, {
        method: "HEAD",
        redirect: "follow",
        headers: { "Accept": "application/pdf,*/*" }
      });
      if (response.status === 404) throw new Error("HTTP 404");
      return response.status < 500;
    });

    if (verified !== false) {
      pdfUrl = pmcPdfUrl;
      status = "PDF disponivel via PMC";
    }
  } else if (!article.pmcid) {
    attempts.push({ step: "PDF via PMCID", ok: false, detail: "Ignorado: PMCID ausente." });
  }

  if (!pdfUrl) {
    attempts.push({
      step: "Verificacao PubMed/PMC",
      ok: false,
      detail: article.pmcid
        ? "PMCID presente, mas a verificacao tecnica do PDF falhou."
        : "Sem PMCID para gerar link direto de PDF aberto."
    });
  }

  return {
    status,
    url: pdfUrl && isAllowedPdfUrl(pdfUrl) ? pdfUrl : "",
    attempts
  };
}

function collectUnpaywallPdfCandidates(payload) {
  if (!payload) return [];
  const locations = [
    payload.best_oa_location,
    ...(Array.isArray(payload.oa_locations) ? payload.oa_locations : [])
  ].filter(Boolean);

  return locations
    .map((location) => location.url_for_pdf)
    .filter(Boolean);
}

async function attemptTwice(step, attempts, task) {
  for (let index = 1; index <= 2; index += 1) {
    try {
      const value = await task();
      attempts.push({ step, ok: true, detail: index === 1 ? "Sucesso na primeira tentativa." : "Sucesso na segunda tentativa." });
      return value;
    } catch (error) {
      attempts.push({
        step,
        ok: false,
        detail: `Tentativa ${index} falhou: ${error.message}`
      });
    }
  }
  return false;
}
