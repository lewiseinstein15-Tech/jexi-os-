/**
 * JEXI OS — Phase 28 Scope I — cron-friendly deterministic dream-cycle driver.
 * Fixed order is a contract. Logical durationMs is phase-reported (default 0),
 * never wall-clock sampled, so equal inputs can be byte-identical.
 */
import { SemanticaError } from '../../semantica/_internal.js';
import lint from './phases/lint.js';
import backlinks from './phases/backlinks.js';
import sync from './phases/sync.js';
import extract from './phases/extract.js';
import extractFacts from './phases/extract-facts.js';
import resolveSymbolEdges from './phases/resolve-symbol-edges.js';
import synthesizeConcepts from './phases/synthesize-concepts.js';
import recomputeEmotionalWeight from './phases/recompute-emotional-weight.js';
import consolidate from './phases/consolidate.js';
import proposeTakes from './phases/propose-takes.js';
import gradeTakes from './phases/grade-takes.js';
import embed from './phases/embed.js';
import orphans from './phases/orphans.js';
import { checkPhaseBudget, createBudgetCaps } from './budget.js';

export const PHASES = Object.freeze([
  lint,
  backlinks,
  sync,
  extract,
  extractFacts,
  resolveSymbolEdges,
  synthesizeConcepts,
  recomputeEmotionalWeight,
  consolidate,
  proposeTakes,
  gradeTakes,
  embed,
  orphans,
]);

export const DECLARED_PHASE_ORDER = Object.freeze(PHASES.map((phase) => phase.name));
export const DETERMINISTIC_PHASES = Object.freeze([
  'lint', 'backlinks', 'sync', 'extract', 'resolve-symbol-edges', 'embed', 'orphans',
]);
export const LLM_BACKED_PHASES = Object.freeze([
  'synthesize-concepts', 'propose-takes', 'grade-takes',
]);

const clone = (value) => JSON.parse(JSON.stringify(value));
const commitState = (target, draft) => {
  for (const key of Object.keys(target)) delete target[key];
  Object.assign(target, draft);
};

function selectedPhases(filter) {
  if (filter === undefined || filter === null) return [...PHASES];
  const requested = typeof filter === 'string' ? [filter] : filter;
  if (!Array.isArray(requested) || requested.some((name) => typeof name !== 'string')) {
    throw new SemanticaError('E_INVALID_ARGUMENT', 'phaseFilter must be a phase name or array of phase names');
  }
  const unknown = requested.filter((name) => !DECLARED_PHASE_ORDER.includes(name));
  if (unknown.length > 0) throw new SemanticaError('E_INVALID_ARGUMENT', `unknown cycle phase(s): ${unknown.join(', ')}`);
  const wanted = new Set(requested);
  return PHASES.filter((phase) => wanted.has(phase.name));
}

function phaseError(error) {
  return {
    code: typeof error?.code === 'string' ? error.code : 'E_PHASE_FAILED',
    message: typeof error?.message === 'string' ? error.message : String(error),
    retryable: false,
  };
}

export function createDreamCycle({
  repo,
  hot,
  index,
  llm,
  facts = [],
  takes = [],
  edges = [],
  sourceIds = [],
  phaseOverrides = {},
  budgetCaps = {},
  forceLintFailure,
} = {}) {
  const caps = createBudgetCaps(budgetCaps);
  const overrides = { ...phaseOverrides };
  for (const [name, handler] of Object.entries(overrides)) {
    if (!DECLARED_PHASE_ORDER.includes(name) || typeof handler !== 'function') {
      throw new SemanticaError('E_INVALID_ARGUMENT', `invalid phase override ${JSON.stringify(name)}`);
    }
  }
  const state = {
    facts: clone(facts),
    takes: clone(takes),
    edges: clone(edges),
    sourceIds: [...sourceIds],
    backlinks: [],
    concepts: [],
    orphans: [],
    consolidationAudit: [],
    sync: { added: [], modified: [], removed: [] },
    embedding: null,
    forceLintFailure,
  };
  const audit = [];

  return Object.freeze({
    async run({ dryRun = false, phaseFilter } = {}) {
      if (typeof dryRun !== 'boolean') {
        throw new SemanticaError('E_INVALID_ARGUMENT', 'dryRun must be boolean');
      }
      const selected = selectedPhases(phaseFilter);
      if (dryRun === true) {
        return {
          phases: selected.map((phase) => ({
            name: phase.name,
            ok: true,
            durationMs: 0,
            budgetUsed: 0,
            status: 'dry-run',
            ...(phase.llmBacked ? { label: phase.label } : {}),
          })),
        };
      }

      const records = [];
      for (const phase of selected) {
        const handler = overrides[phase.name] ?? phase.run;
        const draft = clone(state);
        try {
          const outcome = await handler({
            repo, hot, index, llm, state: draft, dryRun: false,
            budgetCap: caps[phase.name],
          });
          if (!outcome || typeof outcome !== 'object') {
            throw new SemanticaError('E_PHASE_CONTRACT', `${phase.name} returned no phase outcome`);
          }
          const budget = checkPhaseBudget(phase.name, outcome.budgetUsed ?? 0, caps);
          const durationMs = Number.isFinite(outcome.durationMs) && outcome.durationMs >= 0
            ? Number(outcome.durationMs) : 0;
          if (!budget.allowed) {
            const record = {
              name: phase.name,
              ok: false,
              durationMs,
              budgetUsed: budget.budgetUsed,
              status: 'budget-aborted',
              cap: budget.cap,
              error: { code: budget.code, message: budget.message, retryable: false },
            };
            records.push(record);
            audit.push({ phase: phase.name, event: 'budget-aborted', ...record.error, budgetUsed: budget.budgetUsed, cap: budget.cap });
            continue;
          }
          if (typeof outcome.commit === 'function') await outcome.commit();
          commitState(state, draft);
          records.push({
            name: phase.name,
            ok: true,
            durationMs,
            budgetUsed: budget.budgetUsed,
            status: 'ok',
            ...(outcome.label ? { label: outcome.label } : {}),
            ...(outcome.details ? { details: clone(outcome.details) } : {}),
          });
        } catch (error) {
          const normalized = phaseError(error);
          const record = {
            name: phase.name,
            ok: false,
            durationMs: 0,
            budgetUsed: 0,
            status: phase.gate ? 'gate-aborted' : 'error',
            error: normalized,
          };
          records.push(record);
          audit.push({ phase: phase.name, event: record.status, ...normalized });
          if (phase.gate) break;
        }
      }
      return { phases: records };
    },

    state: () => clone(state),
    audit: () => clone(audit),
    budgets: () => ({ ...caps }),
  });
}

export const createCycle = createDreamCycle;
export const cycle = createDreamCycle();
export default cycle;
