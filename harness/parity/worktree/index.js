/** JEXI OS — Phase 30 Scope E — public subagent worktree facade. */
import { createWorktreeManager } from './create.js';

let manager;
const defaultManager = () => {
  manager ??= createWorktreeManager();
  return manager;
};

export const worktree = Object.freeze({
  create: (options) => defaultManager().create(options),
  commit: (worktreeId, options) => defaultManager().commit(worktreeId, options),
  merge: (worktreeId, options) => defaultManager().merge(worktreeId, options),
  discard: (worktreeId) => defaultManager().discard(worktreeId),
  list: () => defaultManager().list(),
});

export default worktree;
export { createWorktreeManager, deterministicWorktreeId } from './create.js';
export { createWorktreeHookEmitter } from './hooks.js';
