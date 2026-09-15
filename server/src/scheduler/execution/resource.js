/**
 * JEXI OS — Phase 6 Scope B: scheduler execution — resource governor.
 *
 * Keeps a live ledger of what the scheduler is consuming so the UI and the
 * runner can answer "what is running right now, and for which trigger kind".
 * Pure bookkeeping — it never blocks; the ConcurrencyPool enforces the bound.
 */

export class ResourceGovernor {
  constructor() {
    this.running = new Map(); // runId → { jobId, kind, lane, startedAt }
    this.byKind = new Map();
    this.totals = { started: 0, finished: 0, failed: 0 };
  }

  acquire(runId, meta = {}) {
    const rec = { runId, jobId: meta.jobId ?? null, kind: meta.kind ?? 'unknown', lane: meta.lane ?? 'default', startedAt: Date.now() };
    this.running.set(runId, rec);
    this.byKind.set(rec.kind, (this.byKind.get(rec.kind) || 0) + 1);
    this.totals.started += 1;
    return rec;
  }

  release(runId, { failed = false } = {}) {
    const rec = this.running.get(runId);
    if (!rec) return null;
    this.running.delete(runId);
    const k = this.byKind.get(rec.kind) || 0;
    if (k <= 1) this.byKind.delete(rec.kind);
    else this.byKind.set(rec.kind, k - 1);
    this.totals.finished += 1;
    if (failed) this.totals.failed += 1;
    rec.durationMs = Date.now() - rec.startedAt;
    return rec;
  }

  snapshot() {
    return {
      active: this.running.size,
      byKind: Object.fromEntries(this.byKind.entries()),
      totals: { ...this.totals },
      running: [...this.running.values()].map((r) => ({ ...r, durationMs: Date.now() - r.startedAt })),
    };
  }
}