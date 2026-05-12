const TEM_EVIDENCIA_API_FALLBACK = "https://busca-pubmed.onrender.com";
const TEM_EVIDENCIA_STATIC_HOSTS = new Set(["augustocruzfisioterapia.github.io"]);

window.BUSCA_PUBMED_API_BASE =
  window.location.protocol === "file:" || TEM_EVIDENCIA_STATIC_HOSTS.has(window.location.hostname)
    ? TEM_EVIDENCIA_API_FALLBACK
    : "";
