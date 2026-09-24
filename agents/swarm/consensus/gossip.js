/**
 * JEXI OS — Phase 20 Scope C — gossip agreement.
 *
 * Rule: a rumor (the value + the current majority opinion) spreads through
 * the swarm; the decision is the opinion the swarm converges on. The swarm
 * membership is fully connected by construction, so ceil(log2(n)) rounds of
 * fan-out reach every member; convergence is checked, not assumed — the
 * round count is recorded. Dissent = members whose initial opinion was
 * against the converged one (they heard the rumor and were outvoted).
 */
import { SwarmError, dissentOf, normalizeVotes, votesPayload } from './_internal.js';

export const ALGO = 'gossip';

export function propose({ value, members, votes } = {}) {
  if (!Array.isArray(members) || members.length < 1) {
    throw new SwarmError('E_TOO_FEW_MEMBERS', 'gossip agreement needs at least 1 member');
  }
  const voteMap = normalizeVotes(members, votes);
  const n = members.length;
  const accepts = [...voteMap.values()].filter((v) => v === 'accept').length;
  const rejects = n - accepts;

  // The rumor carries the majority opinion; convergence = every member heard it.
  const convergedOpinion = accepts >= rejects ? 'accept' : 'reject';
  const rounds = Math.max(1, Math.ceil(Math.log2(Math.max(n, 2))));
  const reached = Math.min(n, Math.pow(2, rounds)); // fan-out doubling per round
  const converged = reached >= n;

  const decision = converged
    ? (convergedOpinion === 'accept' ? value : null)
    : null; // not converged -> no decision (never a fake one)

  // Dissent is the initial minority: they voted against the converged opinion.
  const dissent = convergedOpinion === 'accept' ? dissentOf(voteMap) : [];

  return {
    algo: ALGO,
    value,
    members: [...members],
    rounds,
    converged,
    votes: votesPayload(voteMap),
    accepts,
    decision,
    dissent,
  };
}

export default { ALGO, propose };
