/**
 * JEXI OS — Observability Agent.
 *
 * Streams structured traces, latency, token usage, gate results and provider
 * health for every task. Emits OpenTelemetry-compatible span/event shapes and
 * powers the live GET /api/metrics endpoint. Pure in-memory ring buffers —
 * no external collector needed; /api/metrics never exposes secrets.
 *
 * Spans are OpenTelemetry-flavored: { traceId, spanId, parentSpanId, name,
 * kind, startTime, endTime, durationMs, status, attributes }.
 */

const MAX_SPANS = 200;
const MAX_EVENTS = 200;

const spans = [];
const events = [];
const counters = new Map();   // name -> { count, totalMs, min, max, last }
const gauges = new Map();     // name -> latest value + at

let traceSeq = 0;
let activeSpans = new Map();  // name -> { traceId, spanId, startTime }

function now() { return Date.now(); }

/** Open a new trace span. Returns { traceId, spanId }. */
export function startTrace(name, attributes = {}) {
  traceSeq += 1;
  const traceId = `tr-${Date.now().toString(36)}-${traceSeq}`;
  const spanId = `sp-${traceSeq}-${Math.random().toString(36).slice(2, 8)}`;
  const span = {
    traceId, spanId, parentSpanId: null, name: String(name || 'task'),
    kind: 'internal', startTime: new Date().toISOString(), endTime: null,
    durationMs: null, status: 'running', attributes: { ...attributes },
  };
  spans.push(span);
  if (spans.length > MAX_SPANS) spans.shift();
  activeSpans.set(name, span);
  return { traceId, spanId };
}

/** Close a trace span, recording duration and status. */
export function endTrace(name, status = 'ok', attributes = {}) {
  const span = activeSpans.get(name);
  if (!span) return null;
  activeSpans.delete(name);
  span.endTime = new Date().toISOString();
  span.durationMs = now() - new Date(span.startTime).getTime();
  span.status = status;
  span.attributes = { ...span.attributes, ...attributes };
  recordCounter(`trace.${name}.${status}`, span.durationMs);
  return { ...span };
}

/** Record a counter / histogram metric (latency, tokens, gate results). */
export function emitMetric(name, value = 1, tags = {}) {
  const key = String(name || 'metric');
  const cur = counters.get(key) || { count: 0, totalMs: 0, min: Infinity, max: -Infinity, last: 0, tags: {} };
  cur.count += 1;
  cur.totalMs += Number(value) || 0;
  cur.min = Math.min(cur.min, Number(value) || 0);
  cur.max = Math.max(cur.max, Number(value) || 0);
  cur.last = Number(value) || 0;
  cur.tags = { ...cur.tags, ...tags };
  counters.set(key, cur);
  gauges.set(key, { value: Number(value) || 0, at: new Date().toISOString() });
  events.push({ type: 'metric', name: key, value: Number(value) || 0, tags, at: new Date().toISOString() });
  if (events.length > MAX_EVENTS) events.shift();
  return cur;
}

function recordCounter(name, durationMs) {
  const cur = counters.get(name) || { count: 0, totalMs: 0, min: Infinity, max: -Infinity, last: 0, tags: {} };
  cur.count += 1;
  cur.totalMs += durationMs;
  cur.min = Math.min(cur.min, durationMs);
  cur.max = Math.max(cur.max, durationMs);
  cur.last = durationMs;
  counters.set(name, cur);
}

/** Score provider health 0..1 from real call outcomes (no secrets). */
export function scoreProviderHealth(snapshot = []) {
  const rows = Array.isArray(snapshot) ? snapshot : [];
  if (!rows.length) return { score: 0, healthy: 0, total: 0 };
  const configured = rows.filter((r) => r.configured);
  if (!configured.length) return { score: 0, healthy: 0, total: 0 };
  const healthy = configured.filter((r) => r.ok && !r.inCooldown).length;
  const score = Math.round((healthy / configured.length) * 100) / 100;
  return { score, healthy, total: configured.length };
}

/** Aggregate summary for /api/metrics — aggregates only, never raw secrets. */
export function metricsSummary() {
  const summary = {};
  for (const [name, c] of counters) {
    summary[name] = {
      count: c.count,
      totalMs: Math.round(c.totalMs),
      avgMs: c.count ? Math.round(c.totalMs / c.count) : 0,
      minMs: c.min === Infinity ? 0 : c.min,
      maxMs: c.max === -Infinity ? 0 : c.max,
      last: c.last,
    };
  }
  return {
    spans: {
      total: spans.length,
      running: activeSpans.size,
      recent: spans.slice(-10).map((s) => ({
        name: s.name, status: s.status, durationMs: s.durationMs,
        traceId: s.traceId, spanId: s.spanId,
      })),
    },
    counters: summary,
    gauges: Object.fromEntries([...gauges].map(([k, v]) => [k, v.value])),
    events: events.slice(-20),
    since: events[0]?.at || new Date().toISOString(),
    time: new Date().toISOString(),
  };
}

/** Recent trace spans (for debug UI). */
export function recentSpans(n = 20) {
  return spans.slice(-Math.max(1, n));
}

/** Reset all observability state (test helper). */
export function resetObservability() {
  spans.length = 0;
  events.length = 0;
  counters.clear();
  gauges.clear();
  activeSpans.clear();
  traceSeq = 0;
}
