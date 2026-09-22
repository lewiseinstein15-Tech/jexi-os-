/**
 * JEXI OS — PHASE 31 SCOPE 6 — P30.C consumer wiring (connect-only).
 *
 * Subagent contract fields (allowedTools / maxTurns / permissionMode) ->
 * dispatch enforcement. The Phase 30 contract primitive
 * (harness/parity/subagent) is READ-ONLY: this consumer composes
 * extendSpec + enforce into the workforce dispatch seam and mounts it on
 * the boot seam. Every refusal reuses the shipped error classes
 * (E_INVALID_SPEC / E_MAX_TURNS / E_TOOL_NOT_ALLOWED).
 *
 * Disclosure: the live SubagentRuntime.js call site is OUTSIDE this scope's
 * named call sites — production routing through this seam is an owner call.
 * The seam itself is fully real (same primitive, same errors) and is driven
 * end-to-end by the scope probe.
 *
 * WIRING RULE: connect, do not rebuild. Log lines carry NO timestamps.
 */

import { extendSpec, validate, enforce } from '../../../harness/parity/subagent/index.js';

const state = { mounted: null };

export function initSubagentEnforcement() {
  const journal = [];

  /** Enforced dispatch: extend -> enforce at call time. Throws on refusal. */
  const dispatch = (spec, call = {}) => {
    const extended = extendSpec(spec);
    const agentId = String(extended.id ?? '(unknown subagent)');
    const tool = String(call?.tool ?? '(no tool)');
    const turn = call?.turn ?? call?.turns ?? call?.turnCount ?? null;
    try {
      enforce(extended, call);
      const verdict = {
        agentId, tool, turn, allowed: true, code: null,
        permissionMode: extended.permissionMode,
      };
      journal.push(verdict);
      return { allowed: true, spec: extended, verdict };
    } catch (error) {
      const verdict = {
        agentId, tool, turn, allowed: false,
        code: error?.code ?? 'E_ENFORCE',
        reason: String(error && error.message || error).slice(0, 200),
      };
      journal.push(verdict);
      throw error;
    }
  };

  const mounted = {
    dispatch,
    enforce,
    validate,
    extendSpec,
    journal: () => journal.map((entry) => ({ ...entry })),
  };
  state.mounted = mounted;
  return mounted;
}

export function subagentEnforcement() {
  return state.mounted;
}
