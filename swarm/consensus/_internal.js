/**
 * JEXI OS — Phase 20 Scope C — shared internals for consensus algorithms.
 *
 * Private to swarm/consensus/**: vote normalization shared by all five
 * algorithms. Votes are per-member 'accept' | 'reject'; a member with no
 * recorded vote defaults deterministically to 'accept'. Votes from ids that
 * are not members are refused — a non-member cannot sway a swarm decision.
 */
import { SwarmError } from '../topologies/_internal.js';

export { SwarmError };

/** Majority threshold for n members. */
export function majorityOf(n) {
  return Math.floor(n / 2) + 1;
}

/**
 * Normalize a votes map against the member list.
 * Returns Map memberId -> 'accept' | 'reject' in member order.
 */
export function normalizeVotes(members, votes = {}) {
  const known = new Set(members);
  const map = new Map(members.map((m) => [m, 'accept'])); // deterministic default
  for (const [voter, vote] of Object.entries(votes || {})) {
    if (!known.has(voter)) {
      throw new SwarmError('E_UNKNOWN_VOTER', `voter "${voter}" is not a member of this decision`);
    }
    if (vote !== 'accept' && vote !== 'reject') {
      throw new SwarmError('E_INVALID_VOTE', `vote must be 'accept' or 'reject', got ${JSON.stringify(vote)} from "${voter}"`);
    }
    map.set(voter, vote);
  }
  return map;
}

/** Member ids that voted reject, in member order (the dissent list). */
export function dissentOf(voteMap) {
  return [...voteMap.entries()].filter(([, v]) => v === 'reject').map(([m]) => m);
}

export function votesPayload(voteMap) {
  return Object.fromEntries(voteMap);
}
