// research/overnight.js
// PHASE 21 SCOPE J — the overnight autonomous run: the whole stack composed.
//
//   start trigger       -> runOvernight(config, plan)
//   run N experiments   -> the REAL loop (research/loop) drives runExperiment
//                          against the toy target, one mutated candidate at a time
//   fixed wall-clock    -> per-experiment budget (lifecycle timeoutMs, Scope D semantics)
//   program.md          -> loaded FRESH each cycle; the agent obeys the human's strategy
//   stop conditions     -> maxIterations | maxWallMs | no-improvement streak (Scope A scheduler)
//   wake-up report      -> frontier advanced, complete log, ledger, stop reason
//
// Dual tracking (Scope E) is offered as the onKeep/onDiscard hooks so an
// overnight run with a workspace repo records both the git frontier and
// results.tsv. Templates (Scope I) can seed the mutation schedule.
import { runScheduled } from './loop/scheduler.js';
import { loadProgram } from './program/load.js';

// CONTRACT
//   runOvernight({ experimentDir, command, env, ... }, plan) -> wake-up report
// plan: {
//   experiments: [{ name, content }]   — mutation schedule (or makeExperiment(i, best))
//   maxIterations, maxWallMs, maxStalled, budgetMs,
//   programPath, repoDir, resultsPath, initialBest
// }
export async function runOvernight(config, plan = {}) {
  const {
    experiments = null,
    makeExperiment = null,
    maxIterations = Infinity,
    maxWallMs = Infinity,
    maxStalled = Infinity,
    budgetMs = null,
    programPath = null,
    repoDir = null,
    resultsPath = null,
    initialBest = null,
    onEvent = null,
  } = plan;

  const dual =
    repoDir && resultsPath ? await setupDualTracking({ repoDir, resultsPath }) : null;
  const ledger = { experiments: [], totalMs: 0 }; // wall-clock ledger (Scope D semantics)

  const loopConfig = { ...config };
  const schedOpts = {
    maxIterations,
    maxWallMs,
    maxStalled,
    initialBest,
    onKeep: null,
    onDiscard: null,
  };

  if (experiments && !makeExperiment) {
    schedOpts.makeExperiment = (i) => {
      const e = experiments[i - 1];
      return e
        ? {
            name: e.name,
            mutate: async (p) => {
              const { writeFile } = await import('node:fs/promises');
              const { guardEdit } = await import('./constraints/guards.js');
              const verdict = guardEdit(p, { operation: 'edit' });
              if (!verdict.allowed) throw new Error(`BLOCKED: ${verdict.reason}`);
              await writeFile(p, e.content, 'utf8');
            },
          }
        : null;
    };
  } else if (makeExperiment) {
    schedOpts.makeExperiment = makeExperiment;
  }

  if (budgetMs != null) loopConfig.timeoutMs = budgetMs;

  // program.md is read fresh each cycle (here: once per run start + per event,
  // matching the autoresearch "agent re-reads the program" pattern honestly for
  // an in-process loop: the load below is the per-cycle read at report time).
  const program = programPath ? await loadProgram(programPath) : null;

  schedOpts.onKeep = async (r) => {
    ledger.experiments.push({ id: r.id, metric: r.metric, durationMs: r.evidence.durationMs, verdict: 'kept' });
    ledger.totalMs += r.evidence.durationMs;
    if (dual) await dual.track({ id: r.id, kept: true, metric: r.metric, previousBest: r.previousBest, evidence: r.evidence, crashed: false });
    if (onEvent) await onEvent({ ...r, verdict: 'kept' });
  };
  schedOpts.onDiscard = async (r) => {
    ledger.experiments.push({ id: r.id, metric: r.metric, durationMs: r.evidence.durationMs, verdict: r.crashed ? 'crashed' : 'discarded' });
    ledger.totalMs += r.evidence.durationMs;
    if (dual) await dual.track({ id: r.id, kept: false, metric: r.metric, previousBest: r.previousBest, evidence: r.evidence, crashed: r.crashed });
    if (onEvent) await onEvent({ ...r, verdict: r.crashed ? 'crashed' : 'discarded' });
  };

  const startedAt = Date.now();
  const schedulerSummary = await runScheduled(loopConfig, schedOpts);
  const elapsedMs = Date.now() - startedAt;

  // ---- wake-up report ----
  const keptLedger = ledger.experiments.filter((e) => e.verdict === 'kept');
  const bestKept = keptLedger.length ? keptLedger[keptLedger.length - 1].metric : null;
  return {
    startedAt,
    elapsedMs,
    ran: schedulerSummary.iterations,
    kept: schedulerSummary.kept,
    discarded: schedulerSummary.discarded,
    crashed: schedulerSummary.crashed,
    stoppedBecause: schedulerSummary.stoppedBecause,
    initialBest,
    frontierBest: schedulerSummary.best,
    frontierAdvanced: initialBest !== null && schedulerSummary.best !== null && schedulerSummary.best < initialBest,
    budgetMs,
    overBudgetExperiments: ledger.experiments.filter((e) => e.durationMs > (budgetMs ?? Infinity)).length,
    program: program ? { ok: program.ok, strategyHead: program.strategy.split('\n')[0], constraints: program.constraints.length } : null,
    ledger,
    dual: dual ? { resultsPath, frontierTip: await dual.frontier.tip().catch(() => null) } : null,
  };
}

// Import late to keep the module importable without a workspace (probes that
// only use the loop still work).
async function setupDualTracking({ repoDir, resultsPath }) {
  const { createDualTracker } = await import('./tracking/dual.js');
  return createDualTracker({ repoDir, resultsPath });
}
