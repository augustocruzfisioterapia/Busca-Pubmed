// Mantem os metadados da revista em um modulo isolado para permitir integrar
// Clarivate/JCR ou outro servico licenciado no futuro sem alterar o ranking.
export function resolveJournalMetrics(article = {}) {
  const journal = normalizeJournalInput(article.journal);
  const impactFactor = normalizeImpactFactor(journal.impactFactor);

  return {
    ...journal,
    impactFactor,
    impactFactorLabel: impactFactor ? String(impactFactor) : journal.impactFactorLabel || "não localizado",
    impactFactorSource: impactFactor ? journal.impactFactorSource || "Metadado informado" : journal.impactFactorSource || "não localizado"
  };
}

export function normalizeJournalFromPubMed(summary = {}) {
  const name = normalizeJournalName(
    summary.fulljournalname
      || summary.fullJournalName
      || summary.journal?.title
      || summary.journal?.Title
      || summary.medlinejournalinfo?.medlineta
      || summary.medlineJournalInfo?.medlineTA
      || summary.source
      || ""
  );
  const abbreviation = normalizeJournalName(
    summary.journal?.isoabbreviation
      || summary.journal?.ISOAbbreviation
      || summary.medlinejournalinfo?.medlineta
      || summary.medlineJournalInfo?.medlineTA
      || summary.source
      || ""
  );

  return {
    name: name || abbreviation || "Revista não localizada",
    abbreviation,
    issn: String(summary.issn || "").trim(),
    eissn: String(summary.essn || summary.eissn || "").trim(),
    impactFactor: null,
    impactFactorLabel: "não localizado",
    impactFactorSource: "não localizado"
  };
}

function normalizeJournalInput(value) {
  if (typeof value === "string") {
    return {
      name: normalizeJournalName(value) || "Revista não localizada",
      abbreviation: "",
      issn: "",
      eissn: "",
      impactFactor: null,
      impactFactorSource: ""
    };
  }

  const journal = value && typeof value === "object" ? value : {};
  return {
    name: normalizeJournalName(journal.name || journal.title || "") || "Revista não localizada",
    abbreviation: normalizeJournalName(journal.abbreviation || ""),
    issn: String(journal.issn || "").trim(),
    eissn: String(journal.eissn || "").trim(),
    impactFactor: journal.impactFactor ?? null,
    impactFactorLabel: journal.impactFactorLabel || "",
    impactFactorSource: journal.impactFactorSource || ""
  };
}

function normalizeImpactFactor(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number.parseFloat(String(value).replace(",", "."));
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Number.isInteger(parsed) ? String(parsed) : parsed.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

function normalizeJournalName(value) {
  return String(value || "").replace(/\.$/, "").replace(/\s+/g, " ").trim();
}
