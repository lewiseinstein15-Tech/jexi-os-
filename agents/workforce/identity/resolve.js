/**
 * JEXI OS — PHASE 13 SCOPE D — ENTITY RESOLUTION.
 *
 * Thin helpers over the graph for the questions callers actually ask, plus the
 * one the roster forces: where does the same display name point to more than
 * one agent, and does the graph know it.
 *
 *   resolveName(graph, 'UI Designer')
 *   resolveAll(graph, ['ui-designer', 'UI Designer'])
 *   duplicateNames(roster)                 -> the 12 name collisions
 *   seedFromRoster(graph, roster)          -> create every agent, report collisions
 *
 * `duplicateNames` reads Scope A's roster READ-ONLY (it never writes to it) and
 * groups agents by lowercased display name. That is exactly the condition Scope
 * C surfaced as E_AMBIGUOUS_IDENTITY, measured here at roster scale.
 */

import { ERRORS as GRAPH_ERRORS } from './graph.js';
import { StrategyError } from '../nexus/strategy.js';

/** Error codes surfaced by resolution (re-exported for callers). */
export const ERRORS = GRAPH_ERRORS;

/**
 * Resolve one name against a graph.
 *
 * Returns `{ ok: true, did, agentId }` or `{ ok: false, code, error }` — a form
 * that suits a scan over many names without try/catch at each step. The failing
 * `code` is the graph's own refusal code, unchanged.
 */
export function resolveName(graph, name) {
  try {
    const r = graph.resolve(name);
    return { ok: true, did: r.did, agentId: r.agentId, resolvedFrom: r.resolvedFrom };
  } catch (err) {
    if (err instanceof StrategyError) return { ok: false, code: err.code, error: err.message, name: String(name) };
    throw err;
  }
}

/** Resolve many names; returns one result per name, in input order. */
export function resolveAll(graph, names) {
  return (names || []).map((n) => ({ name: n, ...resolveName(graph, n) }));
}

/**
 * Group roster agents by lowercased display name.
 *
 *   duplicateNames(roster) -> [{ name, agents: [{id, origin, division}] , count }]
 *
 * Read-only. Sorted by name; agents within a group sort by id. Groups with one
 * member are dropped — the result is only the collisions.
 */
export function duplicateNames(roster) {
  const agents = roster && Array.isArray(roster.agents) ? roster.agents : [];
  const byName = new Map();
  for (const a of agents) {
    const key = String(a.name || '').trim().toLowerCase();
    if (!key) continue;
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push({ id: a.id, name: a.name, origin: a.origin || null, division: a.division || null });
  }
  return [...byName.entries()]
    .filter(([, v]) => v.length > 1)
    .map(([name, v]) => ({ name, count: v.length, agents: [...v].sort((a, b) => a.id.localeCompare(b.id)) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Seed a graph from a roster: one identity per agent, its display name as an
 * alias. Read-only with respect to the roster.
 *
 *   seedFromRoster(graph, roster) -> {
 *     created: [{ did, agentId }], collisions: [...], skipped: [...]
 *   }
 *
 * `collisions` are the names now held by more than one identity — the graph
 * does not merge them, it reports them. `skipped` are agents already present
 * (E_DUPLICATE_AGENT), so re-seeding a loaded graph is safe.
 */
export function seedFromRoster(graph, roster) {
  const agents = roster && Array.isArray(roster.agents) ? roster.agents : [];
  const created = [];
  const skipped = [];
  for (const a of agents) {
    try {
      created.push(graph.create({ id: a.id, name: a.name }));
    } catch (err) {
      if (err instanceof StrategyError && err.code === GRAPH_ERRORS.DUPLICATE_AGENT) skipped.push({ id: a.id, code: err.code });
      else throw err;
    }
  }
  const collisions = duplicateNames(roster).map((g) => {
    const roots = new Set();
    const unresolved = [];
    for (const a of g.agents) {
      const r = resolveName(graph, a.id);
      if (r.ok) roots.add(r.did);
      else unresolved.push({ id: a.id, code: r.code });
    }
    return {
      name: g.name,
      agents: g.agents,
      distinctIdentities: [...roots].sort(),
      collapsed: roots.size === 1,
      unresolved,
    };
  });
  return { created, skipped, collisions };
}

/**
 * The duplicate-name report: for each colliding name, whether the graph sees
 * one identity or several. Used by the Scope D probe to answer "do the 12 pairs
 * collapse into 6 merged DIDs?" with what the graph actually holds, rather than
 * with a forced result.
 */
export function duplicateReport(graph, roster) {
  const groups = duplicateNames(roster);
  return groups.map((g) => {
    const entries = g.agents.map((a) => {
      const r = resolveName(graph, a.id);
      return { id: a.id, origin: a.origin, division: a.division, ...r };
    });
    const dids = [...new Set(entries.filter((e) => e.ok).map((e) => e.did))].sort();
    // Collapsed means every member resolved AND they agree. A group where one
    // member is ambiguous has fewer DIDs among its resolved subset, which would
    // otherwise look collapsed while the name is in fact still refused.
    const merged = entries.every((e) => e.ok) && dids.length === 1;
    return { name: g.name, count: g.count, entries, distinctDids: dids, merged };
  });
}

/** Show what a merge would do without performing it. */
export function mergePreview(graph, didA, didB) {
  const g = graph.graph();
  const nodeA = g.nodes.find((n) => n.did === didA);
  const nodeB = g.nodes.find((n) => n.did === didB);
  if (!nodeA || !nodeB) {
    throw new StrategyError(GRAPH_ERRORS.UNKNOWN_IDENTITY, `unknown identity in preview: ${!nodeA ? didA : didB}`, { didA, didB });
  }
  const survivor = (nodeA.seq <= nodeB.seq) ? nodeA : nodeB;
  const absorbed = survivor === nodeA ? nodeB : nodeA;
  const aliasesA = new Set(graph.aliases(nodeA.did));
  const aliasesB = new Set(graph.aliases(nodeB.did));  return {
    survivor: { did: survivor.did, agentId: survivor.agentId, seq: survivor.seq },
    absorbed: { did: absorbed.did, agentId: absorbed.agentId, seq: absorbed.seq },
    aliasesAfter: [...new Set([...aliasesA, ...aliasesB])].sort(),
    sameIdentity: nodeA.root === nodeB.root,
  };
}

export { StrategyError };
