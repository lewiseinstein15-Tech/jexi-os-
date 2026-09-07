/**
 * ARENA REBUILD — Request Meter (spec Part 1/3: "track model calls per
 * request + latency breakdown").
 *
 * One meter per chat turn. Every model call made anywhere in that turn —
 * fast path, Director, planner, tools, mission lane — is counted HERE
 * automatically via AsyncLocalStorage: no opts threading, no missed calls.
 *
 * Lifecycle: meterEnter() at the top of the request handler (scopes the
 * rest of the async chain) → meterLap() at lane boundaries → the response
 * carries requestMeterReport() → meterFreeze() stops background work
 * (a mission continuing server-side) from charging a finished request.
 *
 * Independent module on purpose: LLMClient must import it without cycles.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

const als = new AsyncLocalStorage();

/** Create a meter object (pure data — no side effects). */
function newMeter(meta = {}) {
  return {
    meta: { ...meta },
    t0: Date.now(),
    lastLap: Date.now(),
    stages: {},        // stage name → ms (cumulative per stage)
    stageOrder: [],    // first-seen order, for a readable timeline
    modelCalls: [],    // { provider, model, ms, ok }
    frozen: false,
  };
}

/**
 * Bind a meter to the CURRENT async context. Everything this request does
 * afterwards — any await chain, any lane — lands in the same meter.
 * Idempotent per context: nested calls reuse the existing meter.
 */
export function meterEnter(meta = {}) {
  const existing = als.getStore();
  if (existing) return existing;
  const meter = newMeter(meta);
  try { als.enterWith(meter); } catch { /* meter is best-effort, never fatal */ }
  return meter;
}

/** The live meter for the current async context (or null). */
export function currentMeter() {
  return als.getStore() || null;
}

/**
 * Mark the end of a processing stage ("safety", "missionLane", "kernel",
 * "director", "planner", …). Elapsed time since the previous lap is charged
 * to this stage. Cheap; safe outside a meter (no-op).
 */
export function meterLap(stage) {
  const m = als.getStore();
  if (!m || m.frozen) return;
  const now = Date.now();
  const ms = Math.max(0, now - m.lastLap);
  m.lastLap = now;
  if (!(stage in m.stages)) m.stageOrder.push(stage);
  m.stages[stage] = (m.stages[stage] || 0) + ms;
}

/**
 * Record ONE real model call (an attempt that actually left for a provider —
 * success or failure; both cost time and possibly quota). Called from
 * LLMClient's provider walks, so coverage is automatic and total.
 */
export function noteMeterModelCall(provider, model = null, ms = null, ok = true) {
  const m = als.getStore();
  if (!m || m.frozen) return;
  m.modelCalls.push({ provider, model, ms: ms == null ? null : Math.round(ms), ok: Boolean(ok) });
}

/** Stop the meter: a report was sent; background tails can't charge it. */
export function meterFreeze() {
  const m = als.getStore();
  if (m) m.frozen = true;
}

/** Full report for the current context's meter — or null if none. */
export function requestMeterReport() {
  const m = als.getStore();
  if (!m) return null;
  const byProvider = {};
  for (const c of m.modelCalls) byProvider[c.provider] = (byProvider[c.provider] || 0) + 1;
  return {
    totalMs: Date.now() - m.t0,
    modelCalls: m.modelCalls.length,
    modelCallsByProvider: byProvider,
    modelCallsFailed: m.modelCalls.filter((c) => !c.ok).length,
    stages: m.stageOrder.map((s) => ({ stage: s, ms: m.stages[s] })),
    // the raw call list (bounded by honesty: it IS what happened)
    calls: m.modelCalls.map((c) => `${c.provider}${c.model ? `:${c.model}` : ''}${c.ok ? '' : '(failed)'}`),
  };
}

/** Test helper: run `fn` inside a fresh meter scope (no enterWith leak). */
export function runWithMeter(meta, fn) {
  return als.run(newMeter(meta), fn);
}
