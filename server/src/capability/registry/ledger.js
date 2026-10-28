/**
 * JEXI OS — capability registry — the outcome ledger.
 *
 * "Registered" and "available" are promises. Only the ledger knows what
 * actually worked. It records, per tool invocation, whether the call really
 * succeeded, and maps tools back to capabilities so the runtime can answer
 * "has this capability ever actually worked in this session?" — which is the
 * only honest basis for the claim "JEXI can do X".
 *
 * Two distinctions the old code did not make:
 *
 *   1. A transport-level `ok:true` is not success. A test tool returns ok with
 *      a red suite; a refusal is not a failure of the tool but it is also not
 *      evidence the capability works. Only a real, non-refused success counts.
 *   2. Blocked/refused calls are recorded as their own outcome, so a permission
 *      denial is never laundered into "the capability is broken" OR into
 *      "the capability works".
 *
 * In-memory by default (deterministic for tests); `persist` can be pointed at
 * a JSON file so the record survives a restart within the same install.
 */
import fs from 'node:fs';
import path from 'node:path';
import { CAPABILITIES } from './catalog.js';

/** tool slug → capability id. */
export const TOOL_TO_CAPABILITY = new Map();
for (const c of CAPABILITIES) {
  for (const p of c.providers) {
    if (p.tool && !TOOL_TO_CAPABILITY.has(p.tool)) TOOL_TO_CAPABILITY.set(p.tool, c.id);
  }
}

/** Outcome kinds. `refused` is deliberately distinct from `failed`. */
export const OUTCOMES = Object.freeze({
  SUCCEEDED: 'succeeded',
  FAILED: 'failed',
  REFUSED: 'refused',
  ERROR: 'error',
});

const MAX_EVENTS = 500;

let _events = [];
let _persistPath = null;

/** Point the ledger at a JSON file (optional). Returns the previous path. */
export function setLedgerPath(p) {
  const prev = _persistPath;
  _persistPath = p || null;
  return prev;
}

function loadFromDisk() {
  if (!_persistPath) return;
  try {
    const raw = fs.readFileSync(_persistPath, 'utf8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) _events = parsed.slice(-MAX_EVENTS);
  } catch { /* absent or corrupt — start clean, never throw on a ledger read */ }
}

function saveToDisk() {
  if (!_persistPath) return;
  try {
    fs.mkdirSync(path.dirname(_persistPath), { recursive: true });
    fs.writeFileSync(_persistPath, JSON.stringify(_events.slice(-MAX_EVENTS)));
  } catch { /* persistence is best-effort; the in-memory ledger is authoritative */ }
}

/**
 * Classify a raw execution result into an outcome.
 *
 * A result counts as SUCCEEDED only when it is ok AND not blocked/refused AND
 * not carrying a failing verdict (status 'fail'/'failed'). Anything else that
 * reached the engine is FAILED; a permission refusal is REFUSED.
 */
export function classifyOutcome(result) {
  if (!result || typeof result !== 'object') return OUTCOMES.ERROR;
  if (result.blocked === true || result.permission === false) return OUTCOMES.REFUSED;
  const msg = String(result.error || '');
  if (/permission denied|needs .* permission|not allowed|refus/i.test(msg)) return OUTCOMES.REFUSED;
  if (result.ok === false) return OUTCOMES.FAILED;
  const status = String(result.status || result.result?.status || '').toLowerCase();
  if (['fail', 'failed', 'error', 'timeout'].includes(status)) return OUTCOMES.FAILED;
  return OUTCOMES.SUCCEEDED;
}

/**
 * Record one tool invocation.
 *
 * @param {object} o
 * @param {string} o.tool       the tool slug that ran
 * @param {object} [o.result]   the raw result (classified here)
 * @param {string} [o.outcome]  override the classification
 * @param {string} [o.capability] override the tool→capability mapping
 * @param {string} [o.reason]   short human reason (error text, etc.)
 */
export function recordOutcome({ tool, result, outcome, capability, reason } = {}) {
  const cap = capability || TOOL_TO_CAPABILITY.get(String(tool || '')) || null;
  const kind = outcome || classifyOutcome(result);
  const event = {
    at: Date.now(),
    tool: String(tool || ''),
    capability: cap,
    outcome: kind,
    reason: reason || (result?.error ? String(result.error).slice(0, 300) : null),
  };
  _events.push(event);
  if (_events.length > MAX_EVENTS) _events = _events.slice(-MAX_EVENTS);
  saveToDisk();
  return event;
}

/** Every recorded event (newest last). */
export function ledgerEvents() {
  return _events.slice();
}

/**
 * Capabilities with at least one real SUCCEEDED outcome. Refusals and failures
 * never appear here — that is the whole point.
 */
export function succeededCapabilities() {
  const out = new Set();
  for (const e of _events) {
    if (e.outcome === OUTCOMES.SUCCEEDED && e.capability) out.add(e.capability);
  }
  return out;
}

/** Capabilities that were attempted and refused (permission/plan mode). */
export function refusedCapabilities() {
  const out = new Set();
  for (const e of _events) {
    if (e.outcome === OUTCOMES.REFUSED && e.capability) out.add(e.capability);
  }
  return out;
}

/** Capabilities that were attempted and genuinely failed. */
export function failedCapabilities() {
  const out = new Set();
  for (const e of _events) {
    if ((e.outcome === OUTCOMES.FAILED || e.outcome === OUTCOMES.ERROR) && e.capability) out.add(e.capability);
  }
  return out;
}

/** Per-capability roll-up: counts by outcome. */
export function capabilityStats() {
  const stats = new Map();
  for (const e of _events) {
    if (!e.capability) continue;
    const s = stats.get(e.capability) || { succeeded: 0, failed: 0, refused: 0, error: 0, lastAt: 0 };
    s[e.outcome] = (s[e.outcome] || 0) + 1;
    s.lastAt = Math.max(s.lastAt, e.at);
    stats.set(e.capability, s);
  }
  return stats;
}

/** Test seam: clear the ledger (and reload from disk if configured). */
export function _resetLedger({ reload = false } = {}) {
  _events = [];
  if (reload) loadFromDisk();
}

loadFromDisk();
