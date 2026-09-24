/**
 * JEXI OS — Phase 20 Scope C — Raft-style leader agreement.
 *
 * Rule: the leader proposes; a strict majority of members accepting commits
 * the value. The leader must be one of the members (it casts the first
 * vote); the term is deterministic (term 1 per proposal).
 */
import { SwarmError, dissentOf, majorityOf, normalizeVotes, votesPayload } from './_internal.js';

export const ALGO = 'raft';

export function propose({ value, members, votes, leader } = {}) {
  if (!Array.isArray(members) || members.length < 1) {
    throw new SwarmError('E_TOO_FEW_MEMBERS', 'raft agreement needs at least 1 member');
  }
  const lead = leader !== undefined ? leader : members[0];
  if (!members.includes(lead)) {
    throw new SwarmError('E_UNKNOWN_LEADER', `leader "${String(lead)}" is not a member of this decision`);
  }
  const voteMap = normalizeVotes(members, votes);
  const accepts = [...voteMap.values()].filter((v) => v === 'accept').length;
  const needed = majorityOf(members.length);
  const committed = accepts >= needed;
  return {
    algo: ALGO,
    value,
    members: [...members],
    leader: lead,
    term: 1,
    votes: votesPayload(voteMap),
    accepts,
    needed,
    decision: committed ? value : null,
    dissent: dissentOf(voteMap),
  };
}

export default { ALGO, propose };
