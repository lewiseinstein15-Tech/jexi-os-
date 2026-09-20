import { createHash } from 'node:crypto';
import { load, locked, write, copy, fail } from './store.js';
import { reconstruct } from './tree.js';
export function run(directory, sessionId, { threshold = 20 } = {}) {
  if (!Number.isInteger(threshold) || threshold < 3) throw fail('E_COMPACT_THRESHOLD');
  return locked(directory, () => {
    const state = load(directory, sessionId); const nodes = state.nodes; const before = (state.physical ?? nodes).length;
    if (nodes.length < threshold || state.physical) return { before, after: before, checkpointId: state.checkpointId ?? null };
    const checkpointId = createHash('sha256').update(JSON.stringify(nodes)).digest('hex');
    // Preserve root/tip AND branch points used by other branches in the union.
    const children = new Map();
    for (const edge of reconstruct(directory, sessionId).edges) children.set(edge.from, (children.get(edge.from) ?? 0) + 1);
    const boundaries = nodes.map((n, i) => i === 0 || i === nodes.length - 1 || children.get(n.id) > 1 ? i : -1).filter(i => i >= 0);
    const physical = [copy(nodes[0])];
    for (let b = 1; b < boundaries.length; b++) {
      const lo = boundaries[b - 1] + 1, hi = boundaries[b];
      if (hi - lo > 1) {
        physical.push({ id: `summary:${checkpointId}:${lo}`, parentId: physical.at(-1).id, kind: 'compaction.summary', payload: { checkpointId, summarizedNodeIds: nodes.slice(lo, hi).map(n => n.id) }, ts: nodes[hi - 1].ts, seq: nodes[lo].seq });
      } else if (hi > lo) physical.push({ ...copy(nodes[lo]), parentId: physical.at(-1).id });
      physical.push({ ...copy(nodes[hi]), parentId: physical.at(-1).id });
    }
    write(directory, sessionId, [{ op: 'checkpoint', checkpointId, nodes }, { op: 'compact', checkpointId, nodes: physical }]);
    return { before, after: physical.length, checkpointId };
  });
}
export function physical(directory, sessionId) { const s = load(directory, sessionId); return copy(s.physical ?? s.nodes); }
export { reconstruct };
