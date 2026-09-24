/**
 * JEXI OS — Phase 28 Scope F — immutable supersession audit.
 *
 * A contradiction links old -> replacement. Neither fact is deleted. Repeated
 * identical links are idempotent. All ordering uses injected op_seq.
 */
import { createHash } from 'node:crypto';
import { SemanticaError } from '../../semantica/_internal.js';

const bySeqThenId = (a, b) => (a.op_seq - b.op_seq) || (a.id < b.id ? -1 : 1);
const linkId = (oldId, newId, sourceId, opSeq) => 'sup-' + createHash('sha256')
  .update(`${sourceId}\0${oldId}\0${newId}\0${opSeq}`, 'utf8').digest('hex').slice(0, 16);

export function createSupersessionAudit() {
  const links = [];

  return {
    record({ factId, supersededBy, sourceId, opSeq, evidence = 'contradiction' }) {
      if (typeof factId !== 'string' || typeof supersededBy !== 'string' || factId === supersededBy ||
          typeof sourceId !== 'string' || sourceId === '' || !Number.isInteger(opSeq)) {
        throw new SemanticaError('E_INVALID_ARGUMENT',
          'supersession requires distinct factId/supersededBy, sourceId, and integer opSeq');
      }
      const prior = links.find((link) => link.fact_id === factId && link.superseded_by === supersededBy);
      if (prior) return prior;
      const link = {
        id: linkId(factId, supersededBy, sourceId, opSeq),
        fact_id: factId,
        superseded_by: supersededBy,
        source_id: sourceId,
        op_seq: opSeq,
        reason: 'contradiction',
        evidence: String(evidence),
      };
      links.push(link);
      links.sort(bySeqThenId);
      return link;
    },

    forFact(factId) {
      return links.filter((link) => link.fact_id === factId).map((link) => ({ ...link }));
    },

    all() {
      return links.map((link) => ({ ...link }));
    },
  };
}
