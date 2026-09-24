/**
 * JEXI OS — PHASE 31 SCOPE 6 — P30.E consumer wiring (connect-only).
 *
 * Worktree isolation -> subagent runtime dispatch. When a subagent spec
 * declares isolation:'worktree' (Phase 30 contract field), the dispatched
 * run executes inside a REAL git worktree created by the shipped Phase 30
 * manager (harness/parity/worktree — READ-ONLY); the main tree is never
 * touched by the isolated run. Non-isolated specs pass through unchanged.
 *
 * The manager root is injectable: boot mounts it over the repository, and
 * the accessor accepts a per-call repoRoot override (the scope probe drives
 * it against a throwaway fixture repo so the jexi-29 git state stays
 * untouched). WorktreeCreate/WorktreeRemove hook emissions ride the
 * shipped manager's own hook emitter.
 *
 * WIRING RULE: connect, do not rebuild. Log lines carry NO timestamps.
 */

import path from 'node:path';
import { createWorktreeManager } from '../../../harness/parity/worktree/create.js';
import { extendSpec } from '../../../harness/parity/subagent/index.js';

const state = { mounted: null, managers: new Map() };

function managerFor({ repoRoot, worktreesDir, fleetDir, sessionsDir }) {
  const key = path.resolve(repoRoot);
  let manager = state.managers.get(key);
  if (!manager) {
    manager = createWorktreeManager({
      root: key,
      worktreesDir,
      fleetDir,
      sessionsDir,
    });
    state.managers.set(key, manager);
  }
  return manager;
}

export function initWorktreeIsolation({ repoRoot, worktreesDir, fleetDir, sessionsDir } = {}) {
  const defaults = {
    repoRoot: repoRoot ?? process.cwd(),
    worktreesDir,
    fleetDir,
    sessionsDir,
  };

  /**
   * Isolation-aware dispatch. run({ cwd, branch, worktreeId }) executes the
   * subagent body; for isolation:'worktree' the cwd IS the fresh worktree
   * and the worktree (plus its branch) is discarded afterwards.
   */
  const dispatchIsolated = async (spec, { run, baseBranch, sessionId, repoRoot, worktreesDir, fleetDir, sessionsDir } = {}) => {
    if (typeof run !== 'function') {
      throw Object.assign(new Error('dispatchIsolated requires a run fn'), { code: 'E_WIRING' });
    }
    const outcome = { removed: false, removalError: null };
    const extended = extendSpec(spec);
    if (extended.isolation !== 'worktree') {
      const result = await run({ cwd: null, branch: null, worktreeId: null });
      return { isolated: false, result, worktree: null };
    }
    if (typeof baseBranch !== 'string' || baseBranch.trim() === '') {
      throw Object.assign(new Error('worktree isolation requires baseBranch'), { code: 'E_INVALID_BASE_BRANCH' });
    }
    if (typeof sessionId !== 'string' || sessionId.trim() === '') {
      throw Object.assign(new Error('worktree isolation requires sessionId'), { code: 'E_INVALID_SESSION_ID' });
    }
    const manager = managerFor({
      repoRoot: repoRoot ?? defaults.repoRoot,
      worktreesDir: worktreesDir ?? defaults.worktreesDir,
      fleetDir: fleetDir ?? defaults.fleetDir,
      sessionsDir: sessionsDir ?? defaults.sessionsDir,
    });
    const created = manager.create({ baseBranch, sessionId });
    let result;
    try {
      result = await run({ cwd: created.path, branch: created.branch, worktreeId: created.worktreeId });
    } finally {
      // The isolated run's scratch space is discarded either way. The shipped
      // safe-discard REFUSES dirty worktrees (data-loss guard) — that refusal
      // is disclosed, not swallowed: the owner workflow is commit/merge.
      let removed = true;
      let removalError = null;
      try { manager.discard(created.worktreeId); }
      catch (error) {
        removed = false;
        removalError = { code: error?.code ?? 'E_WORKTREE_DISCARD', message: String(error && error.message || error).slice(0, 160) };
      }
      Object.assign(outcome, { removed, removalError });
    }
    return {
      isolated: true,
      result,
      worktree: { worktreeId: created.worktreeId, path: created.path, branch: created.branch },
      ...outcome,
    };
  };

  const mounted = {
    dispatchIsolated,
    list: ({ repoRoot } = {}) => managerFor({ ...defaults, repoRoot: repoRoot ?? defaults.repoRoot }).list(),
    hookInvocations: ({ repoRoot } = {}) => managerFor({ ...defaults, repoRoot: repoRoot ?? defaults.repoRoot }).hookInvocations(),
  };
  state.mounted = mounted;
  return mounted;
}

export function worktreeIsolation() {
  return state.mounted;
}
