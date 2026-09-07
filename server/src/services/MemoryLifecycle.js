/**
 * ARENA REBUILD — Memory Vault lifecycle (spec Part 19: FRESH → AGING →
 * STALE → REVERIFY).
 *
 * A lifecycle layer OVER the existing stores — nothing is replaced or
 * migrated. Every memory record with a timestamp gets an honest age state:
 *
 *   FRESH  — recent (default < 7 days): safe to lean on
 *   AGING  — between fresh and stale (default 7–30 days): still usable,
 *            flagged as aging
 *   STALE  — old (default > 30 days): usable but marked; high-stakes use
 *            should re-verify it first (needsReverify: true)
 *   UNKNOWN — no timestamp available: no age claim either way
 *
 * REVERIFY is honest by design: the lifecycle MARKS what is stale and lists
 * it for re-verification; it never silently "refreshes" a memory. Actual
 * re-verification happens through real work (a mission / tool / reasoning
 * pass) when JEXI next relies on that memory.
 *
 * Thresholds overridable: MEMORY_FRESH_DAYS, MEMORY_STALE_DAYS.
 */
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '../config.js';

const REPORT_FILE = path.join(DATA_DIR, 'memory-lifecycle.json');

const FRESH_DAYS = Number(process.env.MEMORY_FRESH_DAYS || 7);
const STALE_DAYS = Number(process.env.MEMORY_STALE_DAYS || 30);
const DAY_MS = 24 * 60 * 60 * 1000;

/** Parse a record's timestamp (ms number, ISO string, or null). */
function ts(v) {
  if (v == null) return null;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const p = Date.parse(String(v));
  return Number.isFinite(p) ? p : null;
}

/** The lifecycle state of one record timestamp. Pure, total. */
export function stateFor(at, now = Date.now()) {
  const t = ts(at);
  if (t == null) return { state: 'UNKNOWN', ageDays: null };
  const ageDays = Math.max(0, (now - t) / DAY_MS);
  if (ageDays < FRESH_DAYS) return { state: 'FRESH', ageDays: Math.round(ageDays * 10) / 10 };
  if (ageDays < STALE_DAYS) return { state: 'AGING', ageDays: Math.round(ageDays * 10) / 10 };
  return { state: 'STALE', ageDays: Math.round(ageDays * 10) / 10, needsReverify: true };
}

/** Annotate recall() results with their lifecycle state (in place, honest). */
export function annotateRecall(results, now = Date.now()) {
  for (const r of Array.isArray(results) ? results : []) {
    try {
      const s = stateFor(r.at, now);
      r.lifecycle = s.state;
      if (Number.isFinite(s.ageDays)) r.lifecycleAgeDays = s.ageDays;
      if (s.needsReverify) r.needsReverify = true;
    } catch { /* annotation never breaks recall */ }
  }
  return results;
}

/**
 * Scan the memory vault: which layers hold what, in what lifecycle state.
 * The decision store is enumerated fully; the timestamp-less layers report
 * counts only (never a fake age). Persists a bounded report.
 */
export async function lifecycleScan({ now = Date.now() } = {}) {
  const report = {
    at: new Date(now).toISOString(),
    thresholds: { freshDays: FRESH_DAYS, staleDays: STALE_DAYS },
    layers: {},
    reverifyQueue: [], // stale high-value memories, listed honestly
  };

  // episodic + project: the decision store (full enumeration)
  try {
    const { retrieveDecisions, memoryStats } = await import('./DecisionMemory.js');
    const all = retrieveDecisions({ limit: 1000 });
    const counts = { FRESH: 0, AGING: 0, STALE: 0, UNKNOWN: 0 };
    for (const d of all) {
      const s = stateFor(d.at || d.createdAt, now);
      counts[s.state] += 1;
      if (s.state === 'STALE' && !d.supersededBy) {
        report.reverifyQueue.push({ id: d.id, type: d.type, content: String(d.content || '').slice(0, 160), ageDays: s.ageDays, project: d.project || '' });
      }
    }
    report.layers.episodicProject = { total: all.length, counts, storeStats: safeStats(memoryStats) };
  } catch (e) {
    report.layers.episodicProject = { error: `decision store unavailable: ${String(e && e.message || e).slice(0, 120)}` };
  }

  // user facts + knowledge: counts via stats (ages are per-record at recall time)
  try {
    const { getMemoryStats } = await import('./MemoryManager.js');
    const st = getMemoryStats();
    report.layers.userAndKnowledge = {
      userFacts: st.userFacts ?? null,
      internetKnowledge: st.internetKnowledge ?? null,
      note: 'per-record lifecycle rides recall() annotation (store lists are not enumerable here)',
    };
  } catch (e) {
    report.layers.userAndKnowledge = { error: String(e && e.message || e).slice(0, 120) };
  }

  report.reverifyQueue = report.reverifyQueue.slice(0, 50); // bounded
  persistReport(report);
  return report;
}

function safeStats(fn) { try { return fn ? fn() : null; } catch { return null; } }

function persistReport(report) {
  try {
    fs.mkdirSync(path.dirname(REPORT_FILE), { recursive: true });
    fs.writeFileSync(REPORT_FILE, JSON.stringify(report, null, 1));
  } catch { /* best-effort */ }
}

export function lastLifecycleReport() {
  try {
    if (!fs.existsSync(REPORT_FILE)) return null;
    return JSON.parse(fs.readFileSync(REPORT_FILE, 'utf8'));
  } catch { return null; }
}
