/**
 * JEXI OS — Phase 28 Scope F — source-isolated hot-memory recall.
 * `since` is an injected operation sequence, not a timestamp.
 */
import { SemanticaError } from '../../semantica/_internal.js';
import { assertFactKind } from './kinds.js';

const bySeqThenId = (a, b) => (a.op_seq - b.op_seq) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const clone = (fact) => ({ ...fact });

export function recallFacts(facts, { since, kind, sourceId = 'default', sessionId } = {}) {
  if (typeof sourceId !== 'string' || sourceId === '') {
    throw new SemanticaError('E_INVALID_ARGUMENT', 'recall sourceId must be a non-empty string');
  }
  if (since !== undefined && (!Number.isInteger(since) || since < 0)) {
    throw new SemanticaError('E_INVALID_ARGUMENT', 'recall since must be a non-negative operation sequence');
  }
  if (kind !== undefined) assertFactKind(kind);
  return facts
    .filter((fact) => fact.source_id === sourceId)
    .filter((fact) => since === undefined || fact.op_seq >= since)
    .filter((fact) => kind === undefined || fact.kind === kind)
    .filter((fact) => sessionId === undefined || fact.session_id === sessionId)
    .sort(bySeqThenId)
    .map(clone);
}

export function formatRecallMarkdown(facts, { title = 'Hot Memory — Today' } = {}) {
  const lines = [`## ${title}`, ''];
  if (facts.length === 0) lines.push('_No facts._');
  for (const fact of facts) {
    lines.push(`- [op ${fact.op_seq}] **${fact.kind}** ${fact.fact}`);
    lines.push(`  - evidence: ${fact.evidence}`);
  }
  return lines.join('\n');
}

/** `--today` surface: midnightSeq is injected by the caller; no clock read. */
export function recallToday(facts, { midnightSeq, sourceId = 'default', kind } = {}) {
  if (!Number.isInteger(midnightSeq) || midnightSeq < 0) {
    throw new SemanticaError('E_INVALID_ARGUMENT', 'recall --today requires injected non-negative midnightSeq');
  }
  return formatRecallMarkdown(recallFacts(facts, { since: midnightSeq, sourceId, kind }));
}
