import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runArticleSearch } from "./src/core/pipeline.mjs";
import { resolveSearchConceptsOnline } from "./src/core/onlineTermResolver.mjs";
import { runEvidenceDiscussion } from "./src/core/evidenceDiscussion.mjs";

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

    if (routePath.startsWith("/api/") && !checkRateLimit(req, res)) {
      return undefined;
    }

    if (routePath === "/api/search" && req.method === "POST") {
      const body = await readJsonBody(req);
      const result = await runArticleSearch(body);
      console.info("[usage-search]", {
        ip: clientIp(req),
        returned: result.count?.returned || 0,
        maxResults: body.maxResults,
        freePdfOnly: Boolean(body.freePdfOnly)
      });
      return sendJson(req, res, result.searchUnavailable ? 503 : 200, result);
    }

    if (routePath === "/api/resolve-terms" && req.method === "POST") {
      const body = await readJsonBody(req);
      const result = await resolveSearchConceptsOnline(body.searchText || "");
      return sendJson(req, res, 200, { ok: true, ...result });
    }

    if (isEvidenceDiscussionRoute(routePath) && req.method === "POST") {
      const body = await readJsonBody(req);
      const result = await runEvidenceDiscussion(body);
      console.info("[usage-ai]", {
        ip: clientIp(req),
        selectedCount: result.selectedCount,
        cacheHit: Boolean(result.cache?.hit),
        callsAvoided: result.cost?.callsAvoidedPerCachedProfile || 0
      });
      return sendJson(req, res, 200, result);
    }

    if (routePath.startsWith("/api/")) {
      return sendJson(req, res, 404, {
        ok: false,
        error: "Endpoint nao encontrado.",
        endpoints: ["/api/health", "/api/search", "/api/resolve-terms", "/api/discuss-evidence"]
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
  const target = path.normalize(path.join(publicDir, cleanPath));

  if (!target.startsWith(publicDir)) {
    return sendText(res, 403, "Acesso negado.");
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
    sendText(res, 404, "Arquivo nao encontrado.");
  }
}

function requestPath(req) {
  return new URL(req.url || "/", `http://${req.headers.host || "localhost"}`).pathname;
}

function isEvidenceDiscussionRoute(routePath) {
  return ["/api/discuss-evidence", "/api/ai-discussion", "/api/analyze"].includes(routePath);
}

function sendJson(req, res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...securityHeaders(),
    ...corsHeaders(req)
  });
  res.end(JSON.stringify(payload, null, 2));
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
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "connect-src 'self' https://eutils.ncbi.nlm.nih.gov https://id.nlm.nih.gov https://api.mymemory.translated.net https://busca-pubmed.onrender.com https://www.temevidencia.com.br https://temevidencia.com.br",
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
  for (const [ip, bucket] of rateLimitBuckets) {
    if (bucket.resetAt <= now) rateLimitBuckets.delete(ip);
  }
}

function clientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0].trim();
  }
  return req.socket.remoteAddress || "unknown";
}
