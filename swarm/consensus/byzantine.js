/**
 * JEXI OS — Phase 20 Scope C — Byzantine fault tolerant agreement.
 *
 * Rule: with f faulty members tolerated, agreement is only possible when
 * n >= 3f + 1; the decision needs a strict majority of n AND the Byzantine
 * quorum of 2f + 1 accepts. f >= (members-1)/3 -> E_BYZANTINE_IMPOSSIBLE
 * (there is no honest majority left to win with).
 */
import { SwarmError, dissentOf, majorityOf, normalizeVotes, votesPayload } from './_internal.js';

export const ALGO = 'byzantine';

export function propose({ value, members, votes, f = 0 } = {}) {
  if (!Array.isArray(members) || members.length < 1) {
    throw new SwarmError('E_TOO_FEW_MEMBERS', 'byzantine agreement needs at least 1 member');
  }
  if (!Number.isInteger(f) || f < 0) {
    throw new SwarmError('E_INVALID_F', `f must be a non-negative integer, got ${JSON.stringify(f)}`);
  }
  const n = members.length;
  if (n < 3 * f + 1) {
    throw new SwarmError('E_BYZANTINE_IMPOSSIBLE', `n=${n} cannot tolerate f=${f} faulty members (needs n >= 3f+1 = ${3 * f + 1})`);
  }
  const voteMap = normalizeVotes(members, votes);
  const accepts = [...voteMap.values()].filter((v) => v === 'accept').length;
  const needed = Math.max(majorityOf(n), 2 * f + 1);
  const decision = accepts >= needed ? value : null;
  return {
    algo: ALGO,
    value,
    members: [...members],
    f,
    votes: votesPayload(voteMap),
    accepts,
    needed,
    decision,
    dissent: dissentOf(voteMap),
  };
}

export default { ALGO, propose };
