/**
 * JEXI OS — Phase 20 Scope C — CRDT merge agreement.
 *
 * Rule: conflict-free replicated merge. Every member contributes an
 * add-wins set; the merged value is the union of all contributions, which
 * is order-independent and lossless — no vote can be "against" a merge, so
 * dissent is structurally empty and recorded as such. Deterministic union:
 * items sorted, duplicates collapsed.
 */
import { SwarmError, normalizeVotes, votesPayload } from './_internal.js';

export const ALGO = 'crdt';

export function propose({ value, members, votes, states } = {}) {
  if (!Array.isArray(members) || members.length < 1) {
    throw new SwarmError('E_TOO_FEW_MEMBERS', 'crdt merge needs at least 1 member');
  }
  const voteMap = normalizeVotes(members, votes);

  // Per-member contribution: states[memberId] = array of items; default = [value].
  const contributions = new Map();
  for (const m of members) {
    const given = states && states[m] !== undefined ? states[m] : [value];
    if (!Array.isArray(given)) {
      throw new SwarmError('E_INVALID_STATE', `state for "${m}" must be an array of items, got ${JSON.stringify(given)}`);
    }
    contributions.set(m, given);
  }

  const union = new Set();
  for (const items of contributions.values()) {
    for (const item of items) union.add(item);
  }
  const merged = [...union].sort((a, b) => (String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0));

  return {
    algo: ALGO,
    value,
    members: [...members],
    states: Object.fromEntries(contributions),
    votes: votesPayload(voteMap),
    decision: merged,
    dissent: [], // conflict-free: a merge has no losing side
  };
}

export default { ALGO, propose };
