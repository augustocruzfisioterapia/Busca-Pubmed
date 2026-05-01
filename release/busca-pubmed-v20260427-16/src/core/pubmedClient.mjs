import { parsePmcFullText, parsePubmedArticles } from "./extractors.mjs";

const EUTILS = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";

export class PubMedClient {
  constructor({ fetchImpl = fetch, timeoutMs = 12000, retries = 2 } = {}) {
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.retries = retries;
  }

  async search(term, { retmax = 30 } = {}) {
    const url = new URL(`${EUTILS}/esearch.fcgi`);
    url.searchParams.set("db", "pubmed");
    url.searchParams.set("retmode", "json");
    url.searchParams.set("sort", "pub date");
    url.searchParams.set("retmax", String(retmax));
    url.searchParams.set("term", term);

    const json = await this.fetchJson(url);
    return {
      count: Number(json.esearchresult?.count || 0),
      ids: json.esearchresult?.idlist || []
    };
  }

  async summary(ids) {
    if (!ids.length) return [];

    const url = new URL(`${EUTILS}/esummary.fcgi`);
    url.searchParams.set("db", "pubmed");
    url.searchParams.set("retmode", "json");
    url.searchParams.set("id", ids.join(","));

    const json = await this.fetchJson(url);
    const uids = json.result?.uids || [];
    return uids.map((uid) => json.result?.[uid]).filter(Boolean);
  }

  async abstracts(ids) {
    if (!ids.length) return new Map();

    const url = new URL(`${EUTILS}/efetch.fcgi`);
    url.searchParams.set("db", "pubmed");
    url.searchParams.set("retmode", "xml");
    url.searchParams.set("id", ids.join(","));

    const xml = await this.fetchText(url);
    return parsePubmedArticles(xml);
  }

  async pmcFullText(pmcid) {
    const numericId = String(pmcid || "").replace(/^PMC/i, "");
    if (!numericId) return [];

    const url = new URL(`${EUTILS}/efetch.fcgi`);
    url.searchParams.set("db", "pmc");
    url.searchParams.set("retmode", "xml");
    url.searchParams.set("id", numericId);

    const xml = await this.fetchText(url);
    return parsePmcFullText(xml);
  }

  async fetchJson(url) {
    const response = await this.fetchWithRetry(url, {
      headers: { "Accept": "application/json" }
    });
    if (!response.ok) throw new Error(`PubMed respondeu HTTP ${response.status}.`);
    return response.json();
  }

  async fetchText(url) {
    const response = await this.fetchWithRetry(url, {
      headers: { "Accept": "application/xml,text/xml,text/plain" }
    });
    if (!response.ok) throw new Error(`PubMed respondeu HTTP ${response.status}.`);
    return response.text();
  }

  async fetchWithRetry(url, options = {}) {
    let lastError;

    for (let attempt = 0; attempt <= this.retries; attempt += 1) {
      try {
        const response = await this.fetchImpl(url, {
          ...options,
          signal: timeoutSignal(this.timeoutMs)
        });

        if (response.status === 429 || response.status >= 500) {
          throw new Error(`PubMed respondeu HTTP ${response.status}.`);
        }

        return response;
      } catch (error) {
        lastError = error;
        if (attempt < this.retries) {
          await delay(250 * (attempt + 1));
        }
      }
    }

    throw new Error(`Falha temporaria ao consultar PubMed: ${lastError?.message || "erro desconhecido"}`);
  }
}

function timeoutSignal(timeoutMs) {
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
    return AbortSignal.timeout(timeoutMs);
  }
  return undefined;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
