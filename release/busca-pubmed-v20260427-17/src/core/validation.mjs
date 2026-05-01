import { hasProhibitedUrl, isAllowedPdfUrl } from "./pdfResolver.mjs";

export function validateSearchOutput(articles = []) {
  const checks = [];
  const warnings = [];

  const hasPubMedLinks = articles.every((article) => /^https:\/\/pubmed\.ncbi\.nlm\.nih\.gov\/\d+\//.test(article.pubmedUrl));
  checks.push({
    label: "Todos os artigos possuem link PubMed",
    ok: hasPubMedLinks
  });

  const hasForbiddenLinks = articles.some((article) => {
    const urls = [article.pubmedUrl, article.pdf?.url].filter(Boolean);
    return urls.some(hasProhibitedUrl);
  });
  checks.push({
    label: "Nenhum link proibido foi incluido",
    ok: !hasForbiddenLinks
  });

  const onlyAllowedPdfs = articles.every((article) => !article.pdf?.url || isAllowedPdfUrl(article.pdf.url));
  checks.push({
    label: "PDFs seguem a politica de links diretos permitidos",
    ok: onlyAllowedPdfs
  });

  const sorted = articles.every((article, index) => {
    if (index === 0) return true;
    return article.sortDate <= articles[index - 1].sortDate;
  });
  checks.push({
    label: "Lista ordenada por data do mais recente para o mais antigo",
    ok: sorted
  });

  const hasScientificFields = articles.every((article) => article.description?.mainResult && article.description?.conclusion);
  checks.push({
    label: "Resultado principal e conclusao preenchidos",
    ok: hasScientificFields
  });

  for (const article of articles) {
    if (!article.pdf?.url) {
      const attemptCount = article.pdf?.attempts?.length || 0;
      if (attemptCount < 2) {
        warnings.push(`PMID ${article.pmid}: poucas tentativas documentadas para PDF.`);
      }
    }

    if (article.description?.limitation) {
      warnings.push(`PMID ${article.pmid}: ${article.description.limitation}`);
    }
  }

  return {
    ok: checks.every((check) => check.ok),
    checks,
    warnings
  };
}
