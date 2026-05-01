export function decodeXml(value = "") {
  return String(value)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number.parseInt(dec, 10)))
    .replace(/\s+/g, " ")
    .trim();
}

export function parsePubmedArticles(xml = "") {
  const articles = new Map();
  const blocks = xml.match(/<PubmedArticle[\s\S]*?<\/PubmedArticle>/g) || [];

  for (const block of blocks) {
    const pmid = firstMatch(block, /<PMID[^>]*>([^<]+)<\/PMID>/);
    if (!pmid) continue;

    const abstractSections = [];
    const abstractPattern = /<AbstractText([^>]*)>([\s\S]*?)<\/AbstractText>/g;
    let match;

    while ((match = abstractPattern.exec(block)) !== null) {
      const attrs = match[1] || "";
      const label = firstMatch(attrs, /Label="([^"]+)"/) || firstMatch(attrs, /NlmCategory="([^"]+)"/) || "";
      const text = decodeXml(match[2]);
      if (text) abstractSections.push({ label: normalizeLabel(label), text });
    }

    articles.set(pmid, {
      pmid,
      abstractSections,
      abstractText: abstractSections.map((section) => section.text).join(" ")
    });
  }

  return articles;
}

export function parsePmcFullText(xml = "") {
  const sections = [];
  const secPattern = /<sec\b[^>]*>([\s\S]*?)<\/sec>/g;
  let match;

  while ((match = secPattern.exec(xml)) !== null) {
    const sec = match[1];
    const title = decodeXml(firstMatch(sec, /<title[^>]*>([\s\S]*?)<\/title>/) || "");
    const paragraphs = [];
    const paragraphPattern = /<p[^>]*>([\s\S]*?)<\/p>/g;
    let paragraph;

    while ((paragraph = paragraphPattern.exec(sec)) !== null) {
      const text = decodeXml(paragraph[1]);
      if (text) paragraphs.push(text);
    }

    if (title && paragraphs.length > 0) {
      sections.push({
        title,
        normalizedTitle: normalizeLabel(title),
        text: paragraphs.join(" ")
      });
    }
  }

  return sections;
}

export function deriveScientificDescription({ article, abstractRecord, pmcSections }) {
  const fullTextResult = findSection(pmcSections, ["result", "findings"]);
  const fullTextConclusion = findSection(pmcSections, ["conclusion", "discussion"]);

  if (fullTextResult || fullTextConclusion) {
    return {
      sourceUsed: "Texto completo PMC",
      mainResult: summarizeText(fullTextResult?.text || fullTextConclusion?.text),
      conclusion: summarizeText(fullTextConclusion?.text || fullTextResult?.text),
      limitation: fullTextResult && fullTextConclusion ? "" : "Texto completo disponivel, mas secoes estruturadas incompletas."
    };
  }

  const abstractSections = abstractRecord?.abstractSections || [];
  const abstractResult = findAbstractSection(abstractSections, ["result", "findings"]);
  const abstractConclusion = findAbstractSection(abstractSections, ["conclusion"]);
  const abstractAny = abstractRecord?.abstractText || "";

  if (abstractResult || abstractConclusion || abstractAny) {
    return {
      sourceUsed: "Abstract",
      mainResult: summarizeText(abstractResult?.text || abstractAny),
      conclusion: summarizeText(abstractConclusion?.text || abstractAny),
      limitation: abstractResult && abstractConclusion ? "" : "Abstract nao estruturado ou sem secoes de resultado/conclusao claramente rotuladas."
    };
  }

  return {
    sourceUsed: "Metadados PubMed",
    mainResult: "Resultado principal nao disponivel nos metadados do PubMed.",
    conclusion: "Conclusao nao disponivel nos metadados do PubMed.",
    limitation: `Sem abstract ou texto completo recuperavel para PMID ${article.pmid}.`
  };
}

export function summarizeText(text = "", maxLength = 700) {
  const clean = String(text).replace(/\s+/g, " ").trim();
  if (clean.length <= maxLength) return clean || "Informacao nao disponivel.";

  const candidate = clean.slice(0, maxLength);
  const lastStop = Math.max(candidate.lastIndexOf(". "), candidate.lastIndexOf("; "), candidate.lastIndexOf(", "));
  if (lastStop > 240) return `${candidate.slice(0, lastStop + 1).trim()}...`;
  return `${candidate.trim()}...`;
}

function findSection(sections = [], needles = []) {
  return sections.find((section) => needles.some((needle) => section.normalizedTitle.includes(needle)));
}

function findAbstractSection(sections = [], needles = []) {
  return sections.find((section) => needles.some((needle) => section.label.includes(needle)));
}

function normalizeLabel(value = "") {
  return String(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function firstMatch(value, pattern) {
  const match = String(value).match(pattern);
  return match ? decodeXml(match[1]) : "";
}
