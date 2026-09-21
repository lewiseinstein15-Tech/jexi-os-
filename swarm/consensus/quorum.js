/**
 * JEXI OS — Phase 20 Scope C — quorum agreement.
 *
 * Rule: N of M threshold. threshold defaults to the strict majority; any
 * threshold above the member count (or below 1) is unsatisfiable ->
 * E_IMPOSSIBLE_QUORUM. Accepts >= threshold commits the value.
 */
import { SwarmError, dissentOf, majorityOf, normalizeVotes, votesPayload } from './_internal.js';

export const ALGO = 'quorum';

export function propose({ value, members, votes, threshold } = {}) {
  if (!Array.isArray(members) || members.length < 1) {
    throw new SwarmError('E_TOO_FEW_MEMBERS', 'quorum agreement needs at least 1 member');
  }
  const n = members.length;
  const need = threshold !== undefined ? threshold : majorityOf(n);
  if (!Number.isInteger(need) || need < 1 || need > n) {
    throw new SwarmError('E_IMPOSSIBLE_QUORUM', `threshold ${JSON.stringify(need)} is unsatisfiable for ${n} member(s) (need 1..${n})`);
  }
  const voteMap = normalizeVotes(members, votes);
  const accepts = [...voteMap.values()].filter((v) => v === 'accept').length;
  const decision = accepts >= need ? value : null;
  return {
    algo: ALGO,
    value,
    members: [...members],
    threshold: need,
    votes: votesPayload(voteMap),
    accepts,
    decision,
    dissent: dissentOf(voteMap),
  };
}

export default { ALGO, propose };
