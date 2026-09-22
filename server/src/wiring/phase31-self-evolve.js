/**
 * JEXI OS — PHASE 31 SCOPE 6 — P30.G consumer wiring (connect-only).
 *
 * Self-evolve -> agent runtime post-run callback. When the agent declares
 * ownership of skills (the Phase 30 subagent contract `skills` field), the
 * post-run callback fires the shipped selfEvolve.afterRun — bounded
 * skill-file evolution with a Phase 14 decision + PROV-O provenance per
 * update (harness/parity/self-evolve is READ-ONLY).
 *
 * The evolution root is boot-scoped (runtime/self-evolve-skills): the
 * shipped guardrail refuses paths escaping the root, so repository skill
 * files are never touched by this wiring. Errors fail soft with the
 * shipped error codes surfaced verbatim — a broken post-run hook must not
 * kill the agent run.
 *
 * Disclosure: the live AgentLoop.js post-run call site is OUTSIDE this
 * scope's named call sites — production routing is an owner call. The
 * callback itself is fully real and probe-driven end-to-end.
 *
 * WIRING RULE: connect, do not rebuild. Log lines carry NO timestamps.
 */

import path from 'node:path';
import { createSelfEvolve } from '../../../harness/parity/self-evolve/evolve.js';
import { decisions } from '../../../semantica/decisions/index.js';

const state = { mounted: null };

export function initSelfEvolve({ root } = {}) {
  const resolvedRoot = path.resolve(root ?? path.join('.jexi', 'self-evolve-skills'));
  const evolve = createSelfEvolve({ root: resolvedRoot, decisionLog: decisions.create() });

  /**
   * The post-run callback. Fires selfEvolve.afterRun only when the agent
   * DECLARES ownership of skills; otherwise an honest no-op receipt.
   */
  const postRun = (agent, runResult = {}) => {
    const owns = Array.isArray(agent?.skills) && agent.skills.length > 0;
    if (!owns) {
      return { fired: false, reason: 'agent declares no skill ownership' };
    }
    try {
      const out = evolve.afterRun({
        agentId: String(agent.id ?? agent.agentId ?? ''),
        runId: String(runResult.runId ?? ''),
        skillsUpdated: Array.isArray(runResult.skillUpdates) ? runResult.skillUpdates : [],
      });
      return {
        fired: true,
        agentId: String(agent.id ?? agent.agentId ?? ''),
        updated: out.updated,
        decisionIds: out.decisionIds,
        refused: out.refused,
      };
    } catch (error) {
      return {
        fired: false,
        agentId: String(agent.id ?? agent.agentId ?? ''),
        error: { code: error?.code ?? 'E_SELF_EVOLVE', message: String(error && error.message || error).slice(0, 200) },
      };
    }
  };

  const mounted = {
    postRun,
    audit: (agentId) => evolve.audit(agentId),
    rollback: (decisionId) => evolve.rollback(decisionId),
    root: resolvedRoot,
  };
  state.mounted = mounted;
  return mounted;
}

export function selfEvolveWiring() {
  return state.mounted;
}
