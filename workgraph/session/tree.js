import fs from 'node:fs';
import { load, copy, fail } from './store.js';
// Union contains all distinct node identities in a family. Branch view contains
// only the immutable fork prefix plus that branch's own descendants and overrides.
export function reconstruct(directory, sessionId, opts = {}) {
  const session = load(directory, sessionId);
  const ids = fs.readdirSync(directory).filter(f => f.endsWith('.ndjson')).map(f => f.slice(0, -7)).sort();
  // Origin session first ensures branch-local payload overrides never rewrite it.
  ids.sort((a, b) => a === session.family ? -1 : b === session.family ? 1 : a.localeCompare(b));
  const union = new Map();
  for (const id of ids) { const s = load(directory, id); if (s.family === session.family) for (const node of s.nodes) if (!union.has(node.id)) union.set(node.id, node); }
  const nodes = [...union.values()];
  const result = { nodes: copy(nodes), edges: nodes.filter(n => n.parentId !== null).map(n => ({ from: n.parentId, to: n.id })), rootId: nodes.find(n => n.parentId === null)?.id ?? null };
  if (opts.branch) {
    const branch = load(directory, opts.branch); if (branch.family !== session.family) throw fail('E_BRANCH_FAMILY');
    result.branchView = { branchNodeIds: branch.nodes.map(n => n.id), branchHeadId: branch.nodes.at(-1)?.id ?? null, nodes: copy(branch.nodes) };
  }
  return result;
}
