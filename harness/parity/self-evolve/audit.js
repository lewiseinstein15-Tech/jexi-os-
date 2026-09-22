/** JEXI OS — Phase 30 Scope G — Phase 14 decision and PROV-O audit bridge. */
import { SemanticaError } from '../../../semantica/_internal.js';
import { decisions } from '../../../semantica/decisions/index.js';
import { prov } from '../../../semantica/provenance/index.js';

const clone = (value) => JSON.parse(JSON.stringify(value));

function fail(code, message) {
  return new SemanticaError(code, message);
}

export function createEvolutionAudit({ decisionLog = decisions.create() } = {}) {
  const entries = new Map();
  let ordinal = 0;

  function record({ agentId, skillId, diff, reason, runId, relativePath, targetPath, before, after }) {
    const nextOrdinal = ordinal + 1;
    const payload = { agentId, skillId, diff: clone(diff), reason };
    const { decisionId } = decisionLog.record({
      subject: `self-evolve:${agentId}:${skillId}`,
      chosen: JSON.stringify(payload),
      alternatives: ['retain-prior-version'],
      rationale: reason,
      by: agentId,
      when: `${runId}:${nextOrdinal}`,
    });
    ordinal = nextOrdinal;
    const node = decisionLog.graph().getNode(decisionId);
    const provenance = prov.of(node);
    if (!provenance) throw fail('E_MISSING_PROVENANCE', `decision ${decisionId} has no PROV-O record`);
    entries.set(decisionId, {
      decisionId,
      agentId,
      skillId,
      diff: clone(diff),
      reason,
      runId,
      relativePath,
      targetPath,
      before: Buffer.from(before),
      after: Buffer.from(after),
      rolledBack: false,
      provenance,
    });
    return { decisionId };
  }

  function publicEntry(entry) {
    return {
      decisionId: entry.decisionId,
      agentId: entry.agentId,
      skillId: entry.skillId,
      diff: clone(entry.diff),
      reason: entry.reason,
      runId: entry.runId,
      relativePath: entry.relativePath,
      rolledBack: entry.rolledBack,
      provenance: clone(entry.provenance),
      decision: clone(decisionLog.get(entry.decisionId)),
    };
  }

  function list(agentId) {
    return [...entries.values()]
      .filter((entry) => agentId === undefined || entry.agentId === agentId)
      .map(publicEntry);
  }

  function rollbackInfo(decisionId) {
    const entry = entries.get(decisionId);
    if (!entry) throw fail('E_UNKNOWN_DECISION', `unknown self-evolution decision ${JSON.stringify(decisionId)}`);
    const node = decisionLog.graph().getNode(decisionId);
    const provenance = prov.of(node);
    if (!provenance) throw fail('E_MISSING_PROVENANCE', `decision ${decisionId} has no PROV-O record`);
    return {
      entry: {
        ...entry,
        diff: clone(entry.diff),
        before: Buffer.from(entry.before),
        after: Buffer.from(entry.after),
      },
      provenance,
    };
  }

  function markRolledBack(decisionId) {
    entries.get(decisionId).rolledBack = true;
  }

  return Object.freeze({ record, list, rollbackInfo, markRolledBack, decisions: decisionLog });
}
