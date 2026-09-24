/**
 * JEXI OS — Phase 14 Scope D — near-duplicate detection + merge plan.
 *
 *   deduplicate(nodes) -> { merged, groups }
 *
 * Two nodes are near-duplicates when they share a kind AND a
 * normalized label (lowercase, trim, whitespace collapsed). Groups
 * hold 2+ members; the survivor (`keep`) is the lowest id, the rest
 * are `absorb`. Ordering is deterministic: groups by normalized
 * label then kind; members by id.
 *
 * CONTRACT (documented): deduplicate() ONLY inspects the provided
 * node array and returns a plan —
 *   merged: [{ keep, absorb, normalized, kind }]
 *   groups: [{ normalized, kind, members }]
 * It never mutates a graph. The caller applies the plan with
 * applyMerge({ nodes, edges }, plan), which returns NEW arrays:
 * absorbed nodes removed and every edge endpoint rewritten to the
 * survivor (resulting self-loops and duplicate triples dropped), so
 * the rebuilt graph stays connected. Load the result into a
 * prov.strictGraph() if you need it as a live graph.
 */
import { fail } from '../_internal.js';

export function normalizeLabel(label) {
  return String(label ?? '').toLowerCase().trim().replace(/\s+/g, ' ');
}

const groupKey = (kind, normalized) => [kind, normalized].join(String.fromCharCode(0));

export function deduplicate(nodes) {
  if (!Array.isArray(nodes)) {
    throw fail('E_INVALID_NODES', 'deduplicate needs an array of node records');
  }
  const byKey = new Map();
  for (const n of nodes) {
    const key = groupKey(n.kind, normalizeLabel(n.label));
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(n);
  }
  const groups = [];
  for (const members of byKey.values()) {
    if (members.length < 2) continue;
    const sorted = [...members].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    groups.push({
      normalized: normalizeLabel(sorted[0].label),
      kind: sorted[0].kind,
      members: sorted.map((m) => m.id),
    });
  }
  groups.sort((a, b) => {
    if (a.normalized !== b.normalized) return a.normalized < b.normalized ? -1 : 1;
    return a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0;
  });
  const merged = groups.map((g) => ({
    keep: g.members[0],
    absorb: g.members.slice(1),
    normalized: g.normalized,
    kind: g.kind,
  }));
  return { merged, groups };
}

/**
 * Apply a merge plan to plain { nodes, edges } arrays. Returns NEW
 * arrays; absorbed ids are rewritten to the survivor everywhere.
 */
export function applyMerge({ nodes, edges }, plan) {
  const rewrite = new Map();
  for (const m of plan.merged) {
    for (const id of m.absorb) rewrite.set(id, m.keep);
  }
  const outNodes = nodes.filter((n) => !rewrite.has(n.id));
  const seen = new Set();
  const outEdges = [];
  for (const e of edges) {
    const from = rewrite.get(e.from) ?? e.from;
    const to = rewrite.get(e.to) ?? e.to;
    if (from === to) continue; // absorbed self-loop
    const key = [from, to, e.kind].join(String.fromCharCode(0));
    if (seen.has(key)) continue; // duplicate triple after rewrite
    seen.add(key);
    outEdges.push({ ...e, from, to });
  }
  return { nodes: outNodes, edges: outEdges };
}
