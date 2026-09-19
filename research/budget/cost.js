// research/budget/cost.js
// Total-run cost accounting: a ledger of per-experiment wall-clock spend.
// Honest by construction — records only what actually ran; nothing is
// extrapolated beyond recorded durations.
export function createCostLedger() {
  const entries = [];
  let totalMs = 0;

  return {
    record(experimentId, durationMs, meta = {}) {
      const ms = Number(durationMs);
      const entry = {
        experimentId,
        durationMs: Number.isFinite(ms) ? ms : 0,
        overBudget: meta.overBudget === true,
        killed: meta.killed === true,
      };
      entries.push(entry);
      totalMs += entry.durationMs;
      return entry;
    },
    total() {
      return {
        experiments: entries.length,
        totalMs,
        overBudgetCount: entries.filter((e) => e.overBudget).length,
        killedCount: entries.filter((e) => e.killed).length,
        avgMs: entries.length ? Math.round(totalMs / entries.length) : 0,
      };
    },
    entries() {
      return entries.map((e) => ({ ...e }));
    },
    toJSON() {
      return { total: this.total(), entries: this.entries() };
    },
  };
}

// Tie the ledger to budget enforcement: record every run, over-budget or not.
// Usage: const run = withLedger(enforceBudget, ledger); await run(fn, ms, { experimentId })
export function withLedger(enforceBudgetFn, ledger) {
  return function runWithLedger(fn, ms, opts = {}) {
    return enforceBudgetFn(fn, ms, opts).then((outcome) => {
      ledger.record(opts.experimentId ?? 'experiment', outcome.elapsedMs, {
        overBudget: outcome.overBudget,
        killed: outcome.killed,
      });
      return outcome;
    });
  };
}
