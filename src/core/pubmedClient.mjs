import { parsePmcFullText, parsePubmedArticles } from "./extractors.mjs";

const EUTILS = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";
const runtimeEnv = typeof process !== "undefined" ? process.env : {};

export class PubMedClient {
  constructor({
    fetchImpl = fetch,
    timeoutMs = 12000,
    retries = 2,
    apiKey = runtimeEnv.NCBI_API_KEY || "",
    tool = runtimeEnv.NCBI_TOOL || runtimeEnv.APP_NAME || "BuscaPubMed",
    email = runtimeEnv.NCBI_EMAIL || ""
  } = {}) {
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.retries = retries;
    this.apiKey = apiKey;
    this.tool = tool;
    this.email = email;
  }

  async search(term, { retmax = 30, retstart = 0 } = {}) {
    const url = new URL(`${EUTILS}/esearch.fcgi`);
    url.searchParams.set("db", "pubmed");
    url.searchParams.set("retmode", "json");
    url.searchParams.set("sort", "pub date");
    url.searchParams.set("retmax", String(retmax));
    url.searchParams.set("retstart", String(retstart));
    url.searchParams.set("term", term);
    this.addIdentityParams(url);

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
    this.addIdentityParams(url);

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
    this.addIdentityParams(url);

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
    this.addIdentityParams(url);

    const xml = await this.fetchText(url);
    return parsePmcFullText(xml);
  }

  addIdentityParams(url) {
    if (this.tool) url.searchParams.set("tool", this.tool);
    if (this.email) url.searchParams.set("email", this.email);
    if (this.apiKey) url.searchParams.set("api_key", this.apiKey);
  }

  async fetchJson(url) {
    const response = await this.fetchWithRetry(url, {
      headers: { "Accept": "application/json" }
    });
    if (!response.ok) throw await pubmedHttpError(response);
    return response.json();
  }

  async fetchText(url) {
    const response = await this.fetchWithRetry(url, {
      headers: { "Accept": "application/xml,text/xml,text/plain" }
    });
    if (!response.ok) throw await pubmedHttpError(response);
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

async function pubmedHttpError(response) {
  let body = "";
  try {
    body = await response.text();
  } catch {
    body = "";
  }

  if (/API key invalid/i.test(body)) {
    return new Error("NCBI_API_KEY invalida. Remova a chave do Render ou configure uma chave real gerada na sua conta NCBI.");
  }

  const detail = body ? ` Detalhe: ${body.slice(0, 240)}` : "";
  return new Error(`PubMed respondeu HTTP ${response.status}.${detail}`);
}
