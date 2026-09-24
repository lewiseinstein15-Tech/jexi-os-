import { copyJson, failure } from './storage.js';

export const DEFAULT_MAX_TURNS = 10;
export const DEFAULT_MAX_TOKENS = 100_000;
export const DEFAULT_MAX_WALL_MS = 60_000;

function iso(clock) {
  const date = new Date(clock());
  if (Number.isNaN(date.valueOf())) throw failure('E_CLOCK');
  return date.toISOString();
}

function positiveInteger(value, fallback, code, { zero = false } = {}) {
  if (value == null) return fallback;
  if (!Number.isSafeInteger(value) || value < (zero ? 0 : 1)) throw failure(code);
  return value;
}

function goalById(state, goalId) {
  const goal = state.goals.find(candidate => candidate.id === goalId);
  if (!goal) throw failure('E_GOAL_NOT_FOUND');
  return goal;
}

function publicGoal(goal) {
  return copyJson(goal);
}

/** Persistent lifecycle for goals belonging to one session. */
export function createGoals({ storage, clock, gate }) {
  function get(goalId) {
    return publicGoal(goalById(storage.read(), goalId));
  }

  return {
    set({ description, maxTurns, maxTokens, maxWallMs, gateCommand } = {}) {
      if (typeof description !== 'string' || !description.trim()) throw failure('E_GOAL_DESCRIPTION');
      const limits = {
        maxTurns: positiveInteger(maxTurns, DEFAULT_MAX_TURNS, 'E_MAX_TURNS'),
        maxTokens: positiveInteger(maxTokens, DEFAULT_MAX_TOKENS, 'E_MAX_TOKENS', { zero: true }),
        maxWallMs: positiveInteger(maxWallMs, DEFAULT_MAX_WALL_MS, 'E_MAX_WALL_MS'),
      };
      if (gateCommand != null && (typeof gateCommand !== 'string' || !gateCommand.trim())) throw failure('E_GATE_COMMAND');
      return storage.transaction((state) => {
        const createdAt = iso(clock);
        const goal = {
          id: `goal-${state.nextGoalSeq}`,
          description: description.trim(),
          ...limits,
          gateCommand: gateCommand?.trim() || null,
          createdAt,
          status: 'active',
          completedAt: null,
          evidence: null,
        };
        state.nextGoalSeq += 1;
        state.goals.push(goal);
        return { goalId: goal.id, createdAt };
      });
    },

    get,

    isComplete(goalId) {
      return get(goalId).status === 'completed';
    },

    complete(goalId, evidence = null, { gateTimeoutMs, canComplete } = {}) {
      const requestedEvidence = copyJson(evidence);
      const initial = get(goalId);
      if (initial.status === 'completed') return { completed: true, evidence: copyJson(initial.evidence) };

      let gateResult = null;
      if (initial.gateCommand) {
        gateResult = gate.run(initial.gateCommand, { timeoutMs: gateTimeoutMs });
        if (!gateResult.passed) {
          return { completed: false, evidence: requestedEvidence, gate: gateResult, errorCode: 'E_GATE_FAILED' };
        }
      }

      return storage.transaction((state) => {
        const current = goalById(state, goalId);
        if (current.status === 'completed') return { completed: true, evidence: copyJson(current.evidence) };
        if (typeof canComplete === 'function' && !canComplete()) {
          return { completed: false, evidence: requestedEvidence, errorCode: 'E_COMPLETION_BOUNDARY' };
        }
        current.status = 'completed';
        current.completedAt = iso(clock);
        current.evidence = requestedEvidence;
        return gateResult
          ? { completed: true, evidence: copyJson(requestedEvidence), gate: gateResult }
          : { completed: true, evidence: copyJson(requestedEvidence) };
      });
    },

    list() {
      return storage.read().goals.map(publicGoal);
    },
  };
}

export default createGoals;
