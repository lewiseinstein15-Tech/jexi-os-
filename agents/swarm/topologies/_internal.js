/**
 * JEXI OS — Phase 20 Scope A — shared internals for swarm topologies.
 *
 * Private to swarm/topologies/**: error type, member validation, and the
 * deterministic BFS router every topology routes with. A route is a real
 * walk over the topology's own edge set — never fabricated. Same edges
 * (in the same deterministic order) always yield the same path.
 */
import assert from 'node:assert/strict';

/** Error carrying a stable code, so callers branch on code, not message text. */
export class SwarmError extends Error {
  constructor(code, reason) {
    super(`${code}: ${reason}`);
    this.name = 'SwarmError';
    this.code = code;
  }
}

/**
 * Validate the member list. Members are agent ids: unique, non-empty strings.
 * Fewer than 2 -> E_TOO_FEW_MEMBERS; duplicates -> E_DUPLICATE_MEMBERS.
 */
export function assertMembers(members) {
  if (!Array.isArray(members) || members.length < 2) {
    throw new SwarmError('E_TOO_FEW_MEMBERS', `a topology needs at least 2 members, got ${members ? members.length : String(members)}`);
  }
  const seen = new Set();
  for (const m of members) {
    if (typeof m !== 'string' || m.trim() === '') {
      throw new SwarmError('E_INVALID_MEMBER', `member ids must be non-empty strings, got ${JSON.stringify(m)}`);
    }
    if (seen.has(m)) {
      throw new SwarmError('E_DUPLICATE_MEMBERS', `member "${m}" appears more than once`);
    }
    seen.add(m);
  }
}

/** Index lookup for deterministic ordering (position in the input array wins). */
export function indexOf(members) {
  const map = new Map();
  members.forEach((m, i) => map.set(m, i));
  return map;
}

/**
 * Deterministic edges: every undirected pair is emitted once, ordered so the
 * endpoint earlier in `members` is `from`. Insertion order of the returned
 * array is the caller's iteration order (i asc, then j asc).
 */
export function pair(from, to, role) {
  return { from, to, role };
}

/**
 * Deterministic BFS route over an edge set. Neighbors are explored in member
 * order, so the same edges always yield the same path. Returns the path as an
 * array of member ids, or null when either endpoint is unknown or no path
 * exists — never a fabricated path.
 */
export function router(members, edges) {
  const order = indexOf(members);
  const adjacency = new Map(members.map((m) => [m, []]));
  for (const e of edges) {
    assert.ok(adjacency.has(e.from), `edge references unknown member ${e.from}`);
    assert.ok(adjacency.has(e.to), `edge references unknown member ${e.to}`);
    adjacency.get(e.from).push(e.to);
    adjacency.get(e.to).push(e.from);
  }
  for (const [m, neighbors] of adjacency) {
    neighbors.sort((a, b) => order.get(a) - order.get(b));
    adjacency.set(m, neighbors);
  }
  return function route(from, to) {
    if (!adjacency.has(from) || !adjacency.has(to)) return null;
    if (from === to) return [from];
    const parent = new Map([[from, null]]);
    const queue = [from];
    while (queue.length) {
      const cur = queue.shift();
      for (const next of adjacency.get(cur)) {
        if (parent.has(next)) continue;
        parent.set(next, cur);
        if (next === to) {
          const path = [];
          for (let step = to; step !== null; step = parent.get(step)) path.push(step);
          return path.reverse();
        }
        queue.push(next);
      }
    }
    return null;
  };
}
