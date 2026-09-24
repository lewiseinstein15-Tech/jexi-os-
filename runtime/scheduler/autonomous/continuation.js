import { copyJson, failure } from './storage.js';

function iso(clock) {
  const date = new Date(clock());
  if (Number.isNaN(date.valueOf())) throw failure('E_CLOCK');
  return date.toISOString();
}

function tokenReport(value) {
  if (!value || typeof value !== 'object') return 0;
  const tokens = value.tokens ?? value.tokenCount ?? 0;
  if (!Number.isSafeInteger(tokens) || tokens < 0) throw failure('E_TOKEN_REPORT');
  return tokens;
}

function completion(value) {
  if (value === true || typeof value === 'string') return { complete: true, evidence: { result: copyJson(value) } };
  if (!value || typeof value !== 'object') return { complete: false, evidence: null };
  if (value.complete === true || value.done === true) {
    return { complete: true, evidence: Object.hasOwn(value, 'evidence') ? copyJson(value.evidence) : { result: copyJson(value) } };
  }
  return { complete: false, evidence: null };
}

/** Run a task repeatedly, checking every configured boundary before completion. */
export function createContinuation({ goals, clock = () => Date.now() } = {}) {
  return {
    async run(goalId, taskRunner) {
      const goal = goals.get(goalId);
      const startedMs = clock();
      const startedAt = iso(() => startedMs);
      let turnsRun = 0;
      let tokensUsed = 0;
      const finish = (stoppedBecause, finalEvidence, extra = {}) => ({
        turnsRun,
        stoppedBecause,
        startedAt,
        endedAt: iso(clock),
        ...(finalEvidence === undefined ? {} : { finalEvidence: copyJson(finalEvidence) }),
        ...extra,
      });

      if (goal.status === 'completed') return finish('goal-complete', goal.evidence);
      if (typeof taskRunner !== 'function') return finish('error', undefined, { errorCode: 'E_TASK_RUNNER' });

      while (true) {
        if (clock() - startedMs >= goal.maxWallMs) return finish('max-wall-ms', undefined, { tokensUsed });
        if (turnsRun >= goal.maxTurns) return finish('max-turns', undefined, { tokensUsed });

        let outcome;
        try {
          outcome = await taskRunner({
            goal: copyJson(goal),
            turn: turnsRun + 1,
            turnsRun,
            tokensUsed,
            elapsedMs: Math.max(0, clock() - startedMs),
          });
        } catch (cause) {
          return finish('error', undefined, { tokensUsed, error: String(cause?.message || cause) });
        }
        turnsRun += 1;

        try {
          tokensUsed += tokenReport(outcome);
        } catch (cause) {
          return finish('error', undefined, { tokensUsed, errorCode: cause.code || 'E_TOKEN_REPORT' });
        }
        if (tokensUsed > goal.maxTokens) return finish('max-tokens', undefined, { tokensUsed });
        if (clock() - startedMs >= goal.maxWallMs) return finish('max-wall-ms', undefined, { tokensUsed });
        if (goals.isComplete(goalId)) return finish('goal-complete', goals.get(goalId).evidence, { tokensUsed });

        const complete = completion(outcome);
        if (!complete.complete) continue;
        try {
          const remainingWallMs = goal.maxWallMs - (clock() - startedMs);
          if (remainingWallMs < 1) return finish('max-wall-ms', undefined, { tokensUsed });
          const marked = await goals.complete(goalId, complete.evidence, {
            gateTimeoutMs: remainingWallMs,
            canComplete: () => clock() - startedMs < goal.maxWallMs,
          });
          if (marked.completed) return finish('goal-complete', marked.evidence, { tokensUsed, ...(marked.gate ? { gate: marked.gate } : {}) });
          if (clock() - startedMs >= goal.maxWallMs) return finish('max-wall-ms', undefined, { tokensUsed, ...(marked.gate ? { gate: marked.gate } : {}) });
          if (marked.errorCode === 'E_GATE_FAILED') return finish('gate-failed', undefined, { tokensUsed, gate: marked.gate });
          if (marked.errorCode === 'E_COMPLETION_BOUNDARY') return finish('max-wall-ms', undefined, { tokensUsed });
          return finish('error', undefined, { tokensUsed, errorCode: marked.errorCode || 'E_GOAL_COMPLETE' });
        } catch (cause) {
          return finish('error', undefined, { tokensUsed, error: String(cause?.message || cause) });
        }
      }
    },
  };
}

export default createContinuation;
