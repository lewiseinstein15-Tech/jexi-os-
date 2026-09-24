import path from 'node:path';
import { createStore } from './store.js';
import { reconstruct } from './tree.js';
import { fork, clone } from './branch.js';
import { run, physical } from './compact.js';
export { createStore };
export function createSessions({ directory = path.resolve('.jexi/sessions') } = {}) {
  directory = path.resolve(directory);
  return {
    store: sessionId => createStore({ directory, sessionId }),
    tree: { reconstruct: (sessionId, opts) => reconstruct(directory, sessionId, opts) },
    branch: { fork: (sessionId, atNodeId, opts) => fork(directory, sessionId, atNodeId, opts), clone: (sessionId, opts) => clone(directory, sessionId, opts) },
    compact: { run: (sessionId, opts) => run(directory, sessionId, opts), reconstruct: (sessionId, opts) => reconstruct(directory, sessionId, opts), physical: sessionId => physical(directory, sessionId) },
  };
}
export default createSessions;
