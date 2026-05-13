import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runArticleSearch } from "./src/core/pipeline.mjs";
import { resolveSearchConceptsOnline } from "./src/core/onlineTermResolver.mjs";
import { runEvidenceDiscussion } from "./src/core/evidenceDiscussion.mjs";
import {
  getUsageMetricsSnapshot,
  recordAiUsage,
  recordClientEvent,
  recordEndpointUsage,
  recordSearchUsage
} from "./src/core/usageMetrics.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "public");
const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || "0.0.0.0";
const rateLimitWindowMs = Number(process.env.RATE_LIMIT_WINDOW_MS || 60_000);
const rateLimitMax = Number(process.env.RATE_LIMIT_MAX || 20);
const aiRateLimitWindowMs = Number(process.env.RATE_LIMIT_AI_WINDOW_MS || 10 * 60_000);
const aiRateLimitMax = Number(process.env.RATE_LIMIT_AI_MAX || 6);
const searchRateLimitMax = Number(process.env.RATE_LIMIT_SEARCH_MAX || rateLimitMax);
const maxBodySize = Number(process.env.MAX_BODY_SIZE || 1_000_000);
const rateLimitBuckets = new Map();
const defaultAllowedOrigins = [
  "https://www.temevidencia.com.br",
  "https://temevidencia.com.br",
  "https://busca-pubmed.onrender.com",
  "https://augustocruzfisioterapia.github.io",
  "http://localhost:3000",
  "http://localhost:4173",
  "http://localhost:5173",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:4173",
  "http://127.0.0.1:5173"
];

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon"
};

const server = http.createServer(async (req, res) => {
  req.startedAt = Date.now();
  try {
    if (req.method === "OPTIONS") {
      return sendOptions(req, res);
    }

    const routePath = requestPath(req);

    if (routePath === "/api/health") {
      return sendJson(req, res, 200, {
        status: "ok",
        ok: true,
        service: "Tem Evidência?",
        timestamp: new Date().toISOString(),
        version: process.env.npm_package_version || "0.1.0"
      });
    }

    if (routePath === "/api/admin/metrics" && req.method === "GET") {
      if (!isAdminMetricsAuthorized(req)) {
        return sendJson(req, res, 401, {
          ok: false,
          error: "Acesso administrativo nao autorizado."
        });
      }
      return sendJson(req, res, 200, getUsageMetricsSnapshot());
    }

    if (routePath === "/admin/metrics" && req.method === "GET") {
      if (!isAdminMetricsAuthorized(req)) {
        return sendHtml(req, res, 401, adminUnauthorizedHtml());
      }
      return sendHtml(req, res, 200, adminMetricsHtml());
    }

    if (routePath.startsWith("/api/") && !checkRateLimit(req, res)) {
      return undefined;
    }

    if (routePath === "/api/search" && req.method === "POST") {
      const searchStartedAt = Date.now();
      const body = await readJsonBody(req);
      let result;
      try {
        result = await runArticleSearch(body);
      } catch (error) {
        recordSearchUsage({
          ok: false,
          durationMs: Date.now() - searchStartedAt,
          maxResults: body.maxResults,
          freePdfOnly: Boolean(body.freePdfOnly),
          errorType: error.publicMessage || error.message
        });
        throw error;
      }
      recordSearchUsage({
        ok: !result.searchUnavailable,
        durationMs: Date.now() - searchStartedAt,
        returned: result.count?.returned || 0,
        maxResults: body.maxResults,
        freePdfOnly: Boolean(body.freePdfOnly),
        errorType: result.searchUnavailable ? result.error : ""
      });
      console.info("[usage-search]", {
        returned: result.count?.returned || 0,
        maxResults: body.maxResults,
        freePdfOnly: Boolean(body.freePdfOnly)
      });
      return sendJson(req, res, result.searchUnavailable ? 503 : 200, result);
    }

    if (routePath === "/api/metrics/event" && req.method === "POST") {
      const body = await readJsonBody(req);
      const analyticsEvent = normalizeAnalyticsEvent(body);
      recordClientEvent({
        name: analyticsEvent.name,
        params: analyticsEvent.params,
        path: analyticsEvent.path,
        timestamp: analyticsEvent.timestamp
      });
      const ga4 = await forwardGa4MeasurementEvent(analyticsEvent);
      return sendJson(req, res, 200, { ok: true, ga4 });
    }

    if (routePath === "/api/resolve-terms" && req.method === "POST") {
      const body = await readJsonBody(req);
      const result = await resolveSearchConceptsOnline(body.searchText || "");
      return sendJson(req, res, 200, { ok: true, ...result });
    }

    if (isEvidenceDiscussionRoute(routePath) && req.method === "POST") {
      const aiStartedAt = Date.now();
      const body = await readJsonBody(req);
      let result;
      try {
        result = await runEvidenceDiscussion(body);
      } catch (error) {
        recordAiUsage({
          ok: false,
          durationMs: Date.now() - aiStartedAt,
          profile: body.mode || "clinico",
          errorType: error.publicMessage || error.message
        });
        throw error;
      }
      const cacheHit = Boolean(result.cache?.hit);
      recordAiUsage({
        ok: true,
        durationMs: Date.now() - aiStartedAt,
        profile: result.mode || body.mode || "clinico",
        cacheHit,
        selectedCount: result.selectedCount || 0,
        estimatedCostUsd: Number(process.env.OPENAI_ESTIMATED_CALL_COST_USD || 0.01)
      });
      console.info("[usage-ai]", {
        selectedCount: result.selectedCount,
        cacheHit,
        callsAvoided: result.cost?.callsAvoidedPerCachedProfile || 0
      });
      return sendJson(req, res, 200, result);
    }

    if (routePath.startsWith("/api/")) {
      return sendJson(req, res, 404, {
        ok: false,
        error: "Endpoint nao encontrado.",
        endpoints: ["/api/health", "/api/search", "/api/resolve-terms", "/api/discuss-evidence", "/api/metrics/event"]
      });
    }

    return serveStatic(req, res);
  } catch (error) {
    const status = error.statusCode || 500;
    console.error("[request-error]", {
      method: req.method,
      url: req.url,
      status,
      message: error.message
    });
    return sendJson(req, res, status, {
      ok: false,
      error: error.publicMessage || "Falha ao processar a solicitacao.",
      detail: process.env.NODE_ENV === "production" ? undefined : error.message
    });
  }
});

server.listen(port, host, () => {
  const displayHost = host === "0.0.0.0" ? "localhost" : host;
  console.log(`Aplicacao disponivel em http://${displayHost}:${port}`);
});

async function serveStatic(req, res) {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const cleanPath = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);

  if (cleanPath === "/config.js") {
    return sendJavaScript(req, res, 200, clientConfigScript());
  }

  const target = path.normalize(path.join(publicDir, cleanPath));

  if (!target.startsWith(publicDir)) {
    return sendText(res, 403, "Acesso negado.", req);
  }

  try {
    const data = await readFile(target);
    const ext = path.extname(target);
    res.writeHead(200, {
      "Content-Type": contentTypes[ext] || "application/octet-stream",
      "Cache-Control": "no-store",
      ...securityHeaders()
    });
    res.end(data);
  } catch {
    sendText(res, 404, "Arquivo nao encontrado.", req);
  }
}

function requestPath(req) {
  return new URL(req.url || "/", `http://${req.headers.host || "localhost"}`).pathname;
}

function isEvidenceDiscussionRoute(routePath) {
  return ["/api/discuss-evidence", "/api/ai-discussion", "/api/analyze"].includes(routePath);
}

function sendJson(req, res, status, payload) {
  recordEndpointUsage({
    method: req.method,
    route: requestPath(req),
    status,
    durationMs: Date.now() - (req.startedAt || Date.now())
  });
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...securityHeaders(),
    ...corsHeaders(req)
  });
  res.end(JSON.stringify(payload, null, 2));
}

function sendHtml(req, res, status, html) {
  res.writeHead(status, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    ...securityHeaders(),
    ...corsHeaders(req)
  });
  res.end(html);
}

function sendJavaScript(req, res, status, code) {
  res.writeHead(status, {
    "Content-Type": "text/javascript; charset=utf-8",
    "Cache-Control": "no-store",
    ...securityHeaders(),
    ...corsHeaders(req)
  });
  res.end(code);
}

function sendText(res, status, text, req = undefined) {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8", ...securityHeaders(), ...corsHeaders(req) });
  res.end(text);
}

function sendOptions(req, res) {
  res.writeHead(204, { ...securityHeaders(), ...corsHeaders(req) });
  res.end();
}

function corsHeaders(req) {
  const origin = req?.headers?.origin;
  const headers = {
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Accept,Authorization",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };

  if (origin && allowedOrigins().has(origin.replace(/\/+$/, ""))) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  return headers;
}

function allowedOrigins() {
  const configured = [
    process.env.ALLOWED_ORIGIN,
    process.env.ALLOWED_ORIGINS,
    process.env.CORS_ORIGINS
  ]
    .filter(Boolean)
    .flatMap((value) => String(value).split(/[\s,]+/))
    .map((value) => value.trim().replace(/\/+$/, ""))
    .filter(Boolean);

  return new Set([...defaultAllowedOrigins, ...configured]);
}

function securityHeaders() {
  return {
    "Content-Security-Policy": [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' https://www.googletagmanager.com",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https://www.google-analytics.com https://*.google-analytics.com https://stats.g.doubleclick.net",
      "connect-src 'self' https://eutils.ncbi.nlm.nih.gov https://id.nlm.nih.gov https://api.mymemory.translated.net https://busca-pubmed.onrender.com https://www.temevidencia.com.br https://temevidencia.com.br https://www.googletagmanager.com https://www.google-analytics.com https://*.google-analytics.com https://analytics.google.com https://*.analytics.google.com https://stats.g.doubleclick.net",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'"
    ].join("; "),
    "X-Frame-Options": "DENY",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()"
  };
}

async function readJsonBody(req) {
  const chunks = [];
  let size = 0;

  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBodySize) {
      const error = new Error("Payload muito grande.");
      error.statusCode = 413;
      error.publicMessage = "Payload muito grande.";
      throw error;
    }
    chunks.push(chunk);
  }

  if (chunks.length === 0) return {};

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    const error = new Error("JSON invalido.");
    error.statusCode = 400;
    error.publicMessage = "JSON invalido.";
    throw error;
  }
}

function checkRateLimit(req, res) {
  const policy = rateLimitPolicy(req);
  if (!Number.isFinite(policy.windowMs) || !Number.isFinite(policy.max) || policy.max <= 0) {
    return true;
  }

  const now = Date.now();
  const ip = clientIp(req);
  const key = `${ip}:${policy.name}`;
  const bucket = rateLimitBuckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    rateLimitBuckets.set(key, { count: 1, resetAt: now + policy.windowMs });
    cleanupRateLimitBuckets(now);
    return true;
  }

  bucket.count += 1;
  if (bucket.count <= policy.max) return true;

  const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
  console.warn("[rate-limit]", {
    ip,
    path: req.url,
    policy: policy.name,
    count: bucket.count,
    retryAfterSeconds
  });
  res.writeHead(429, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Retry-After": String(retryAfterSeconds),
    ...securityHeaders(),
    ...corsHeaders(req)
  });
  res.end(JSON.stringify({
    ok: false,
    error: "Muitas buscas em sequência. Aguarde alguns segundos e tente novamente.",
    retryAfterSeconds
  }));
  return false;
}

function rateLimitPolicy(req) {
  const url = requestPath(req);
  if (isEvidenceDiscussionRoute(url)) {
    return { name: "ai", windowMs: aiRateLimitWindowMs, max: aiRateLimitMax };
  }
  if (url.startsWith("/api/search")) {
    return { name: "search", windowMs: rateLimitWindowMs, max: searchRateLimitMax };
  }
  return { name: "api", windowMs: rateLimitWindowMs, max: rateLimitMax };
}

function cleanupRateLimitBuckets(now) {
  if (rateLimitBuckets.size < 500) return;
  for (const [key, bucket] of rateLimitBuckets) {
    if (bucket.resetAt <= now) rateLimitBuckets.delete(key);
  }
}

function clientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0].trim();
  }
  return req.socket.remoteAddress || "unknown";
}

function clientConfigScript() {
  const gaMeasurementId = process.env.GA_MEASUREMENT_ID || process.env.GOOGLE_ANALYTICS_ID || "";
  return [
    "const TEM_EVIDENCIA_API_FALLBACK = \"https://busca-pubmed.onrender.com\";",
    "const TEM_EVIDENCIA_STATIC_HOSTS = new Set([\"augustocruzfisioterapia.github.io\"]);",
    "window.BUSCA_PUBMED_API_BASE = window.location.protocol === \"file:\" || TEM_EVIDENCIA_STATIC_HOSTS.has(window.location.hostname) ? TEM_EVIDENCIA_API_FALLBACK : \"\";",
    `window.BUSCA_PUBMED_GA_MEASUREMENT_ID = ${JSON.stringify(gaMeasurementId)};`,
    "window.BUSCA_PUBMED_INTERNAL_ANALYTICS = true;"
  ].join("\n");
}

function normalizeAnalyticsEvent(body = {}) {
  return {
    name: normalizeAnalyticsName(body.name || body.event || ""),
    params: sanitizeGa4Params(body.params || {}),
    clientId: normalizeAnalyticsClientId(body.clientId),
    sessionId: normalizeAnalyticsSessionId(body.sessionId),
    debugMode: Boolean(body.debugMode),
    path: String(body.path || "/").slice(0, 160),
    timestamp: normalizeAnalyticsTimestamp(body.timestamp)
  };
}

async function forwardGa4MeasurementEvent(event) {
  const measurementId = process.env.GA_MEASUREMENT_ID || process.env.GOOGLE_ANALYTICS_ID || "";
  const apiSecret = process.env.GA_API_SECRET || process.env.GA4_API_SECRET || "";
  if (!measurementId || !apiSecret || !event.name) {
    return {
      attempted: false,
      reason: !measurementId ? "GA_MEASUREMENT_ID ausente" : !apiSecret ? "GA_API_SECRET ausente" : "evento invalido"
    };
  }

  const url = new URL("https://www.google-analytics.com/mp/collect");
  url.searchParams.set("measurement_id", measurementId);
  url.searchParams.set("api_secret", apiSecret);

  const body = {
    client_id: event.clientId,
    events: [
      {
        name: event.name,
        params: {
          ...event.params,
          session_id: event.sessionId,
          engagement_time_msec: 1,
          debug_mode: event.debugMode
        }
      }
    ]
  };

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(2500)
    });
    return {
      attempted: true,
      ok: response.ok,
      status: response.status
    };
  } catch (error) {
    console.warn("[ga4-forward-error]", {
      event: event.name,
      message: error.message
    });
    return {
      attempted: true,
      ok: false,
      error: "Falha ao reenviar evento ao GA4."
    };
  }
}

function normalizeAnalyticsName(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

function sanitizeGa4Params(params = {}) {
  const safe = {};
  for (const [key, value] of Object.entries(params || {})) {
    const normalizedKey = normalizeAnalyticsName(key);
    if (!normalizedKey || isSensitiveAnalyticsParam(normalizedKey)) continue;
    if (typeof value === "boolean") safe[normalizedKey] = value;
    if (typeof value === "number" && Number.isFinite(value)) safe[normalizedKey] = value;
    if (typeof value === "string") safe[normalizedKey] = value.slice(0, 120);
  }
  return safe;
}

function isSensitiveAnalyticsParam(key) {
  if (key === "page_title") return false;
  return /search|query|term|title|abstract|doi|pmid|email|token|key|secret|patient|nome/.test(key);
}

function normalizeAnalyticsClientId(value) {
  const clean = String(value || "").replace(/[^a-zA-Z0-9._-]/g, "").slice(0, 80);
  return clean || `server-${Date.now()}`;
}

function normalizeAnalyticsSessionId(value) {
  const clean = String(value || "").replace(/\D/g, "").slice(0, 20);
  return clean || String(Math.floor(Date.now() / 1000));
}

function normalizeAnalyticsTimestamp(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return new Date().toISOString();
  return date.toISOString();
}

function isAdminMetricsAuthorized(req) {
  const token = process.env.ADMIN_METRICS_TOKEN || "";
  if (!token) {
    return process.env.NODE_ENV !== "production" || isLocalRequest(req);
  }
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const bearer = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
  const provided = url.searchParams.get("token") || bearer;
  return safeTokenCompare(provided, token);
}

function isLocalRequest(req) {
  const hostHeader = String(req.headers.host || "").toLowerCase();
  return hostHeader.startsWith("localhost")
    || hostHeader.startsWith("127.0.0.1")
    || hostHeader.startsWith("[::1]");
}

function safeTokenCompare(provided = "", expected = "") {
  if (!provided || !expected || provided.length !== expected.length) return false;
  let diff = 0;
  for (let index = 0; index < expected.length; index += 1) {
    diff |= expected.charCodeAt(index) ^ provided.charCodeAt(index);
  }
  return diff === 0;
}

function adminUnauthorizedHtml() {
  return `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Métricas | Tem Evidência?</title>
    <style>
      body { margin: 0; font-family: Arial, sans-serif; background: #f3f5f1; color: #10231f; }
      main { max-width: 720px; margin: 12vh auto; padding: 24px; }
      .panel { background: #fff; border: 1px solid #d9ded8; border-radius: 8px; padding: 24px; }
      code { background: #edf2ef; padding: 2px 5px; border-radius: 4px; }
    </style>
  </head>
  <body>
    <main>
      <section class="panel">
        <h1>Acesso administrativo protegido</h1>
        <p>Configure <code>ADMIN_METRICS_TOKEN</code> no Render e abra <code>/admin/metrics?token=...</code>.</p>
        <p>As métricas são agregadas e não armazenam termos de busca ou dados pessoais.</p>
      </section>
    </main>
  </body>
</html>`;
}

function adminMetricsHtml() {
  return `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Dashboard | Tem Evidência?</title>
    <style>
      :root { color-scheme: light; --ink: #10231f; --muted: #5d6c66; --line: #d9ded8; --paper: #fff; --bg: #f3f5f1; --accent: #1c6b5b; --warm: #c7833e; }
      * { box-sizing: border-box; }
      body { margin: 0; font-family: Inter, Arial, sans-serif; background: var(--bg); color: var(--ink); }
      header { padding: 28px clamp(16px, 4vw, 48px); background: #10231f; color: #f8faf7; }
      header span { color: #b8c8c1; }
      main { padding: clamp(16px, 4vw, 48px); display: grid; gap: 18px; }
      .grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; }
      .card, .panel { background: var(--paper); border: 1px solid var(--line); border-radius: 8px; padding: 18px; }
      .card strong { display: block; font-size: clamp(24px, 4vw, 38px); margin-top: 8px; }
      .muted { color: var(--muted); font-size: 14px; }
      .panels { display: grid; grid-template-columns: 1.1fr .9fr; gap: 18px; }
      .bar { height: 12px; background: #edf2ef; border-radius: 999px; overflow: hidden; margin: 8px 0 14px; }
      .bar span { display: block; height: 100%; background: var(--accent); }
      table { width: 100%; border-collapse: collapse; font-size: 14px; }
      th, td { border-bottom: 1px solid var(--line); padding: 10px 8px; text-align: left; }
      code { background: #edf2ef; padding: 2px 5px; border-radius: 4px; }
      @media (max-width: 900px) { .grid, .panels { grid-template-columns: 1fr; } }
    </style>
  </head>
  <body>
    <header>
      <h1>Dashboard Tem Evidência?</h1>
      <span>Métricas agregadas de acesso, busca, IA, cache e custo estimado.</span>
    </header>
    <main>
      <section id="summary" class="grid" aria-label="Resumo das métricas"></section>
      <section class="panels">
        <article class="panel">
          <h2>Perfis de IA</h2>
          <div id="profiles"></div>
        </article>
        <article class="panel">
          <h2>Endpoints mais usados</h2>
          <div id="endpoints"></div>
        </article>
      </section>
      <section class="panel">
        <h2>Eventos recentes</h2>
        <p class="muted" id="privacy"></p>
        <div id="events"></div>
      </section>
    </main>
    <script>
      const token = new URLSearchParams(window.location.search).get("token") || "";
      const params = token ? "?token=" + encodeURIComponent(token) : "";
      fetch("/api/admin/metrics" + params, { headers: { Accept: "application/json" } })
        .then((response) => response.ok ? response.json() : Promise.reject(new Error("Acesso negado.")))
        .then(renderDashboard)
        .catch((error) => {
          document.querySelector("main").innerHTML = '<section class="panel"><h2>Não foi possível carregar as métricas</h2><p>' + escapeHtml(error.message) + '</p></section>';
        });

      function renderDashboard(data) {
        document.querySelector("#privacy").textContent = data.privacy || "";
        document.querySelector("#summary").innerHTML = [
          card("Acessos", data.accesses?.total || 0, "page views internas"),
          card("Buscas", data.searches?.total || 0, (data.searches?.success || 0) + " com sucesso"),
          card("Chamadas IA", data.ai?.total || 0, (data.ai?.cacheHits || 0) + " cache hits"),
          card("Cache IA", (data.ai?.cacheHits || 0) + "/" + (data.ai?.cacheMisses || 0), "hits/misses"),
          card("Tempo médio", (data.searches?.averageDurationMs || 0) + " ms", "busca"),
          card("Custo estimado", "$" + Number(data.ai?.estimatedCostUsd || 0).toFixed(4), "OpenAI, sem cache")
        ].join("");
        renderProfiles(data.ai?.profiles || []);
        renderEndpoints(data.endpoints || []);
        renderEvents(data.recentClientEvents || []);
      }

      function renderProfiles(profiles) {
        const max = Math.max(1, ...profiles.map((item) => item.count));
        document.querySelector("#profiles").innerHTML = profiles.length
          ? profiles.map((item) => bar(item.profile, item.count, max)).join("")
          : '<p class="muted">Nenhum perfil usado ainda.</p>';
      }

      function renderEndpoints(endpoints) {
        document.querySelector("#endpoints").innerHTML = endpoints.length
          ? '<table><thead><tr><th>Endpoint</th><th>Uso</th><th>Tempo médio</th></tr></thead><tbody>' + endpoints.map((item) => '<tr><td><code>' + escapeHtml(item.route) + '</code></td><td>' + item.count + '</td><td>' + (item.averageDurationMs || 0) + ' ms</td></tr>').join("") + '</tbody></table>'
          : '<p class="muted">Nenhum endpoint registrado ainda.</p>';
      }

      function renderEvents(events) {
        document.querySelector("#events").innerHTML = events.length
          ? '<table><thead><tr><th>Evento</th><th>Rota</th><th>Horário</th></tr></thead><tbody>' + events.map((item) => '<tr><td>' + escapeHtml(item.name) + '</td><td>' + escapeHtml(item.path) + '</td><td>' + new Date(item.timestamp).toLocaleString("pt-BR") + '</td></tr>').join("") + '</tbody></table>'
          : '<p class="muted">Nenhum evento recente.</p>';
      }

      function card(label, value, detail) {
        return '<article class="card"><span class="muted">' + escapeHtml(label) + '</span><strong>' + escapeHtml(String(value)) + '</strong><span class="muted">' + escapeHtml(detail) + '</span></article>';
      }

      function bar(label, count, max) {
        const width = Math.max(4, Math.round((count / max) * 100));
        return '<div><strong>' + escapeHtml(label) + ' (' + count + ')</strong><div class="bar"><span style="width:' + width + '%"></span></div></div>';
      }

      function escapeHtml(value) {
        return String(value || "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
      }
    </script>
  </body>
</html>`;
}
