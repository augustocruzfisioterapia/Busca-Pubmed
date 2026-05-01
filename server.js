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
const maxBodySize = Number(process.env.MAX_BODY_SIZE || 1_000_000);
const rateLimitBuckets = new Map();

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
      return sendOptions(res);
    }

    if (req.url === "/api/health") {
      return sendJson(res, 200, {
        ok: true,
        service: "article-evidence-search",
        version: process.env.npm_package_version || "0.1.0"
      });
    }

    if (req.url?.startsWith("/api/") && !checkRateLimit(req, res)) {
      return undefined;
    }

    if (req.url === "/api/search" && req.method === "POST") {
      const body = await readJsonBody(req);
      const result = await runArticleSearch(body);
      return sendJson(res, result.searchUnavailable ? 503 : 200, result);
    }

    if (req.url === "/api/resolve-terms" && req.method === "POST") {
      const body = await readJsonBody(req);
      const result = await resolveSearchConceptsOnline(body.searchText || "");
      return sendJson(res, 200, { ok: true, ...result });
    }

    if (req.url === "/api/discuss-evidence" && req.method === "POST") {
      const body = await readJsonBody(req);
      const result = await runEvidenceDiscussion(body);
      return sendJson(res, 200, result);
    }

    if (req.url?.startsWith("/api/")) {
      return sendJson(res, 404, { ok: false, error: "Endpoint nao encontrado." });
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
    return sendJson(res, status, {
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
      "Cache-Control": "no-store"
    });
    res.end(data);
  } catch {
    sendText(res, 404, "Arquivo nao encontrado.");
  }
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...corsHeaders()
  });
  res.end(JSON.stringify(payload, null, 2));
}

function sendText(res, status, text) {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8", ...corsHeaders() });
  res.end(text);
}

function sendOptions(res) {
  res.writeHead(204, corsHeaders());
  res.end();
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Accept"
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
  if (!Number.isFinite(rateLimitWindowMs) || !Number.isFinite(rateLimitMax) || rateLimitMax <= 0) {
    return true;
  }

  const now = Date.now();
  const ip = clientIp(req);
  const bucket = rateLimitBuckets.get(ip);

  if (!bucket || bucket.resetAt <= now) {
    rateLimitBuckets.set(ip, { count: 1, resetAt: now + rateLimitWindowMs });
    cleanupRateLimitBuckets(now);
    return true;
  }

  bucket.count += 1;
  if (bucket.count <= rateLimitMax) return true;

  const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
  res.writeHead(429, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Retry-After": String(retryAfterSeconds),
    ...corsHeaders()
  });
  res.end(JSON.stringify({
    ok: false,
    error: "Muitas buscas em sequência. Aguarde alguns segundos e tente novamente.",
    retryAfterSeconds
  }));
  return false;
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
