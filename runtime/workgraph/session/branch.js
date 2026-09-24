import fs from 'node:fs';
import { load, records, locked, write, sessionPath, fail, copy } from './store.js';
import { reconstruct } from './tree.js';
function choose(directory, source, type, supplied) {
  let id = supplied;
  if (!id) { let n = 1; do { id = `${source}-${type}-${n++}`; } while (fs.existsSync(sessionPath(directory, id))); }
  sessionPath(directory, id); if (records(directory, id).length) throw fail('E_SESSION_EXISTS'); return id;
}
export function fork(directory, sessionId, atNodeId, opts = {}) {
  return locked(directory, () => {
    const parent = load(directory, sessionId); const at = parent.nodes.findIndex(n => n.id === atNodeId);
    if (at < 0) throw fail('E_NODE_NOT_FOUND');
    const id = choose(directory, sessionId, 'fork', opts.sessionId);
    // Copy-on-write snapshot of exactly the ancestor prefix; never parent suffix.
    const nodes = copy(parent.nodes.slice(0, at + 1));
    write(directory, id, [{ op: 'session', family: parent.family, forkedFrom: sessionId, atNodeId, nodes }]);
    return { newBranchId: id, newBranchHeadId: atNodeId, branchNodeIds: nodes.map(n => n.id), unionNodeCount: reconstruct(directory, sessionId).nodes.length };
  });
}
export function clone(directory, sessionId, opts = {}) {
  return locked(directory, () => {
    const source = load(directory, sessionId); const id = choose(directory, sessionId, 'clone', opts.sessionId);
    const nodes = copy(source.nodes).map((n, i) => ({ ...n, id: `${id}:${i}`, parentId: i ? `${id}:${i - 1}` : null }));
    write(directory, id, [{ op: 'session', family: id, nodes }]); return id;
  });
}
