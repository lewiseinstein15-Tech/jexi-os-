/**
 * JEXI OS — Phase 20 Scope F — Ralph (persistent retry loop).
 *
 * Ported from the ruflo ralph / "Wiggum loop" pattern: an agent that keeps
 * trying with adjusted context after each failure, until success or budget
 * exhausted.
 *
 *   ralph.run(task, { maxAttempts, adjustContext, initialContext })
 *     -> { attempts, result, stoppedBy, contextLog[] }
 *        stoppedBy: 'success' | 'max-attempts'
 *
 * `task` is the attempted work: fn(context, attempt) -> { ok: true, ... }
 * on success or { ok: false, failure } on a handled failure; a thrown error
 * is a failure whose reason is the error message.
 *
 * Semantics:
 * - Attempt 1 runs with initialContext (default undefined). After each
 *   failure, the next context is adjustContext(prevContext, failure); with
 *   no adjuster the context carries over unchanged.
 * - contextLog records { attempt, context, failure? } for every attempt —
 *   the success attempt has no failure field.
 * - Success -> stoppedBy 'success', attempts = ACTUAL count, result = the
 *   successful result. Exhaustion -> 'max-attempts', result = the last
 *   failure record.
 * - Deterministic given the same task and adjuster.
 */
import { SwarmError } from '../topologies/_internal.js';

export const DEFAULT_MAX_ATTEMPTS = 5;

export function run(task, opts = {}) {
  const {
    maxAttempts = DEFAULT_MAX_ATTEMPTS,
    adjustContext,
    initialContext,
  } = opts;

  if (typeof task !== 'function') {
    throw new SwarmError('E_INVALID_TASK', `task must be a function (context, attempt) => result, got ${typeof task}`);
  }
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new SwarmError('E_INVALID_MAX_ATTEMPTS', `maxAttempts must be an integer >= 1, got ${JSON.stringify(maxAttempts)}`);
  }
  if (adjustContext !== undefined && typeof adjustContext !== 'function') {
    throw new SwarmError('E_INVALID_ADJUSTER', `adjustContext must be a function or undefined, got ${typeof adjustContext}`);
  }

  let context = initialContext;
  const contextLog = [];

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let outcome;
    try {
      outcome = task(context, attempt);
    } catch (err) {
      outcome = { ok: false, failure: err.message };
    }
    if (!outcome || typeof outcome !== 'object' || typeof outcome.ok !== 'boolean') {
      throw new SwarmError('E_INVALID_OUTCOME', `attempt ${attempt} must return { ok: boolean, ... }, got ${JSON.stringify(outcome)}`);
    }

    if (outcome.ok) {
      contextLog.push({ attempt, context });
      return { attempts: attempt, result: outcome, stoppedBy: 'success', contextLog };
    }

    const failure = outcome.failure !== undefined ? outcome.failure : 'unspecified failure';
    contextLog.push({ attempt, context, failure });
    if (adjustContext) context = adjustContext(context, failure);
  }

  return {
    attempts: maxAttempts,
    result: { ok: false, failure: contextLog[contextLog.length - 1].failure },
    stoppedBy: 'max-attempts',
    contextLog,
  };
}

export default { DEFAULT_MAX_ATTEMPTS, run };
