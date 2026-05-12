const DEFAULT_MAX_RECENT_EVENTS = 30;
const MAX_EVENT_NAME_LENGTH = 80;
const MAX_PARAM_STRING_LENGTH = 120;

const metrics = createEmptyMetrics();

export function recordEndpointUsage({ method = "GET", route = "/", status = 200, durationMs = 0 } = {}) {
  const key = `${String(method).toUpperCase()} ${normalizeRoute(route)}`;
  const entry = metrics.endpoints.get(key) || {
    method: String(method).toUpperCase(),
    route: normalizeRoute(route),
    count: 0,
    errors: 0,
    totalDurationMs: 0,
    lastStatus: 0
  };

  entry.count += 1;
  entry.errors += Number(status >= 400);
  entry.totalDurationMs += normalizeDuration(durationMs);
  entry.lastStatus = Number(status) || 0;
  entry.averageDurationMs = roundMs(entry.totalDurationMs / entry.count);
  metrics.endpoints.set(key, entry);
}

export function recordSearchUsage({ ok = true, durationMs = 0, returned = 0, maxResults = 0, freePdfOnly = false, errorType = "" } = {}) {
  metrics.searches.total += 1;
  metrics.searches.success += Number(Boolean(ok));
  metrics.searches.errors += Number(!ok);
  metrics.searches.totalDurationMs += normalizeDuration(durationMs);
  metrics.searches.averageDurationMs = roundMs(metrics.searches.totalDurationMs / metrics.searches.total);
  metrics.searches.lastReturned = clampNonNegative(returned);
  metrics.searches.lastMaxResults = clampNonNegative(maxResults);
  metrics.searches.freePdfOnly += Number(Boolean(freePdfOnly));
  if (!ok) pushRecentError("search", errorType || "search_error");
}

export function recordAiUsage({
  ok = true,
  durationMs = 0,
  profile = "clinico",
  cacheHit = false,
  estimatedCostUsd = 0,
  selectedCount = 0,
  errorType = ""
} = {}) {
  metrics.ai.total += 1;
  metrics.ai.success += Number(Boolean(ok));
  metrics.ai.errors += Number(!ok);
  metrics.ai.cacheHits += Number(Boolean(cacheHit));
  metrics.ai.cacheMisses += Number(ok && !cacheHit);
  metrics.ai.totalDurationMs += normalizeDuration(durationMs);
  metrics.ai.averageDurationMs = roundMs(metrics.ai.totalDurationMs / metrics.ai.total);
  metrics.ai.estimatedCostUsd = roundMoney(metrics.ai.estimatedCostUsd + (ok && !cacheHit ? Number(estimatedCostUsd || 0) : 0));
  metrics.ai.lastSelectedCount = clampNonNegative(selectedCount);

  const normalizedProfile = normalizeEventName(profile || "clinico");
  metrics.ai.profiles[normalizedProfile] = (metrics.ai.profiles[normalizedProfile] || 0) + 1;
  if (!ok) pushRecentError("ai", errorType || "ai_error");
}

export function recordClientEvent({ name = "", params = {}, path = "/", timestamp = "" } = {}) {
  const eventName = normalizeEventName(name);
  if (!eventName) return;

  metrics.clientEvents[eventName] = (metrics.clientEvents[eventName] || 0) + 1;
  metrics.lastClientEvents.unshift({
    name: eventName,
    path: normalizeRoute(path),
    timestamp: normalizeTimestamp(timestamp),
    params: sanitizeEventParams(params)
  });
  metrics.lastClientEvents = metrics.lastClientEvents.slice(0, DEFAULT_MAX_RECENT_EVENTS);

  if (eventName === "page_view") metrics.accesses.total += 1;
  if (eventName === "article_opened") {
    metrics.articleOpens.total += 1;
    const destination = normalizeEventName(params.destination || "pubmed");
    metrics.articleOpens[destination] = (metrics.articleOpens[destination] || 0) + 1;
  }
}

export function getUsageMetricsSnapshot() {
  const topEndpoints = [...metrics.endpoints.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 12);
  const topProfiles = Object.entries(metrics.ai.profiles)
    .map(([profile, count]) => ({ profile, count }))
    .sort((a, b) => b.count - a.count);

  return {
    ok: true,
    service: "Tem Evidência?",
    startedAt: metrics.startedAt,
    generatedAt: new Date().toISOString(),
    privacy: "Métricas agregadas em memória. Não armazena termos de busca, IP, DOI, PMID, nomes de pacientes ou dados pessoais.",
    accesses: { ...metrics.accesses },
    searches: withoutInternalTotals(metrics.searches),
    ai: {
      ...withoutInternalTotals(metrics.ai),
      mostUsedProfile: topProfiles[0] || null,
      profiles: topProfiles
    },
    articleOpens: { ...metrics.articleOpens },
    endpoints: topEndpoints,
    clientEvents: { ...metrics.clientEvents },
    recentErrors: [...metrics.recentErrors],
    recentClientEvents: [...metrics.lastClientEvents]
  };
}

export function resetUsageMetricsForTests() {
  Object.assign(metrics, createEmptyMetrics());
}

function createEmptyMetrics() {
  return {
    startedAt: new Date().toISOString(),
    accesses: {
      total: 0
    },
    searches: {
      total: 0,
      success: 0,
      errors: 0,
      freePdfOnly: 0,
      lastReturned: 0,
      lastMaxResults: 0,
      totalDurationMs: 0,
      averageDurationMs: 0
    },
    ai: {
      total: 0,
      success: 0,
      errors: 0,
      cacheHits: 0,
      cacheMisses: 0,
      estimatedCostUsd: 0,
      lastSelectedCount: 0,
      totalDurationMs: 0,
      averageDurationMs: 0,
      profiles: {}
    },
    articleOpens: {
      total: 0
    },
    endpoints: new Map(),
    clientEvents: {},
    recentErrors: [],
    lastClientEvents: []
  };
}

function withoutInternalTotals(value) {
  const { totalDurationMs, ...publicValue } = value;
  return { ...publicValue };
}

function sanitizeEventParams(params = {}) {
  const safe = {};
  for (const [key, value] of Object.entries(params || {})) {
    const normalizedKey = normalizeEventName(key);
    if (!normalizedKey || isSensitiveParam(normalizedKey)) continue;
    if (typeof value === "boolean") safe[normalizedKey] = value;
    if (typeof value === "number" && Number.isFinite(value)) safe[normalizedKey] = value;
    if (typeof value === "string") safe[normalizedKey] = value.slice(0, MAX_PARAM_STRING_LENGTH);
  }
  return safe;
}

function isSensitiveParam(key) {
  return /search|query|term|title|abstract|doi|pmid|email|token|key|secret|patient|nome/.test(key);
}

function pushRecentError(scope, errorType) {
  metrics.recentErrors.unshift({
    scope,
    errorType: String(errorType || "unknown").slice(0, MAX_PARAM_STRING_LENGTH),
    timestamp: new Date().toISOString()
  });
  metrics.recentErrors = metrics.recentErrors.slice(0, DEFAULT_MAX_RECENT_EVENTS);
}

function normalizeRoute(route) {
  const value = String(route || "/").split("?")[0].trim() || "/";
  return value.length > MAX_PARAM_STRING_LENGTH ? value.slice(0, MAX_PARAM_STRING_LENGTH) : value;
}

function normalizeEventName(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, MAX_EVENT_NAME_LENGTH);
}

function normalizeTimestamp(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return new Date().toISOString();
  return date.toISOString();
}

function normalizeDuration(value) {
  return Math.max(0, Number(value) || 0);
}

function clampNonNegative(value) {
  return Math.max(0, Number.parseInt(value, 10) || 0);
}

function roundMs(value) {
  return Math.round((Number(value) || 0) * 10) / 10;
}

function roundMoney(value) {
  return Math.round((Number(value) || 0) * 10000) / 10000;
}
