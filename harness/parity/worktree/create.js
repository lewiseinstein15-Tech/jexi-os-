/** JEXI OS — Phase 30 Scope E — real git worktree lifecycle manager. */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SemanticaError } from '../../../services/semantica/_internal.js';
import { createFleet } from '../../../runtime/session/fleet/index.js';
import { createSessions } from '../../../runtime/workgraph/session/index.js';
import { createWorktreeHookEmitter } from './hooks.js';
import {
  branchExists,
  commitWorktree,
  discardWorktree,
  mergeWorktree,
  runGit,
} from './cleanup.js';

const SESSION_ID_RE = /^[A-Za-z0-9_-]{1,100}$/;
const clone = (value) => JSON.parse(JSON.stringify(value));

function fail(code, message, details = {}) {
  return Object.assign(new SemanticaError(code, message), details);
}

export function deterministicWorktreeId(sessionId, sequence) {
  return crypto.createHash('sha256').update(`${sessionId}:${sequence}`).digest('hex');
}

function publicRecord(record) {
  return clone({
    worktreeId: record.worktreeId,
    path: record.path,
    branch: record.branch,
    baseBranch: record.baseBranch,
    sessionId: record.sessionId,
    sequence: record.sequence,
    composition: record.composition,
    mergedInto: record.mergedInto ?? null,
    mergedSha: record.mergedSha ?? null,
  });
}

function readComposition(fleet, sessions, sessionId) {
  let fleetSession = null;
  try {
    const row = fleet.list().find((entry) => entry.sessionId === sessionId);
    if (row) fleetSession = { sessionId: row.sessionId, state: row.state };
  } catch (error) {
    throw fail('E_WORKTREE_FLEET_CONTEXT', `unable to read Phase 27 fleet: ${error.code ?? error.message}`);
  }

  let sessionTree = null;
  try {
    const tree = sessions.tree.reconstruct(sessionId, { branch: sessionId });
    sessionTree = {
      rootId: tree.rootId,
      headId: tree.branchView?.branchHeadId ?? null,
      nodeCount: tree.branchView?.nodes.length ?? tree.nodes.length,
    };
  } catch (error) {
    if (!['E_SESSION_NOT_FOUND', 'E_SESSION_ID'].includes(error?.code)) {
      throw fail('E_WORKTREE_SESSION_CONTEXT', `unable to read Phase 10 session tree: ${error.code ?? error.message}`);
    }
  }
  return { fleetSession, sessionTree };
}

export function createWorktreeManager(options = {}) {
  const root = path.resolve(options.root ?? process.cwd());
  const rootKey = crypto.createHash('sha256').update(root).digest('hex').slice(0, 16);
  const worktreesDir = path.resolve(options.worktreesDir
    ?? path.join(os.tmpdir(), 'jexi-worktrees', rootKey));
  const fleet = options.fleet ?? createFleet({
    dir: options.fleetDir ?? path.join(os.tmpdir(), 'jexi-worktree-fleet', rootKey),
  });
  const sessions = options.sessions ?? createSessions({
    directory: options.sessionsDir ?? path.join(root, '.jexi', 'sessions'),
  });
  const hookEmitter = createWorktreeHookEmitter();
  const active = new Map();
  let sequence = 0;
  let supportChecked = false;

  const context = { root, worktreesDir, fleet, sessions, hooks: hookEmitter, active, audit: [] };

  function ensureSupport() {
    if (supportChecked) return;
    const supported = runGit(context, ['worktree', 'list', '--porcelain'], { allowFailure: true });
    if (!supported.ok) {
      throw fail('E_NO_WORKTREE_SUPPORT', 'git worktree support is unavailable for this sandbox or repository', {
        detail: (supported.stderr || supported.stdout).trim(),
      });
    }
    supportChecked = true;
  }

  function requireRecord(worktreeId) {
    const record = active.get(worktreeId);
    if (!record) throw fail('E_UNKNOWN_WORKTREE', `unknown active worktree ${JSON.stringify(worktreeId)}`);
    return record;
  }

  function create({ baseBranch, sessionId } = {}) {
    ensureSupport();
    if (typeof baseBranch !== 'string' || baseBranch.trim() === '') {
      throw fail('E_INVALID_BASE_BRANCH', 'baseBranch must be a non-empty string');
    }
    if (typeof sessionId !== 'string' || !SESSION_ID_RE.test(sessionId)) {
      throw fail('E_INVALID_SESSION_ID', `invalid sessionId ${JSON.stringify(sessionId)}`);
    }
    const checkedBranch = runGit(context, ['check-ref-format', '--branch', baseBranch], {
      allowFailure: true,
    });
    if (!checkedBranch.ok || !branchExists(context, baseBranch)) {
      throw fail('E_INVALID_BASE_BRANCH', `base branch ${JSON.stringify(baseBranch)} does not exist`);
    }

    const nextSequence = sequence + 1;
    const worktreeId = deterministicWorktreeId(sessionId, nextSequence);
    const branch = `worktree/${sessionId}/${worktreeId}`;
    const worktreePath = path.join(worktreesDir, worktreeId);
    if (active.has(worktreeId) || fs.existsSync(worktreePath) || branchExists(context, branch)) {
      throw fail('E_WORKTREE_EXISTS', `deterministic worktree ${worktreeId} already exists`);
    }
    const composition = readComposition(fleet, sessions, sessionId);
    fs.mkdirSync(worktreesDir, { recursive: true });
    const added = runGit(context, ['worktree', 'add', '-b', branch, worktreePath, baseBranch], {
      allowFailure: true,
    });
    if (!added.ok) {
      runGit(context, ['worktree', 'prune'], { allowFailure: true });
      throw fail('E_WORKTREE_CREATE', (added.stderr || added.stdout).trim(), {
        worktreeId,
        branch,
        path: worktreePath,
      });
    }

    sequence = nextSequence;
    const record = {
      worktreeId,
      path: worktreePath,
      branch,
      baseBranch,
      sessionId,
      sequence,
      composition,
    };
    active.set(worktreeId, record);
    hookEmitter.emit('WorktreeCreate', {
      worktreeId,
      path: worktreePath,
      branch,
      baseBranch,
      sessionId,
    });
    return { worktreeId, path: worktreePath, branch };
  }

  function commit(worktreeId, optionsForCommit) {
    return commitWorktree(context, requireRecord(worktreeId), optionsForCommit);
  }

  function merge(worktreeId, optionsForMerge) {
    return mergeWorktree(context, requireRecord(worktreeId), optionsForMerge);
  }

  function discard(worktreeId) {
    const record = requireRecord(worktreeId);
    const result = discardWorktree(context, record);
    active.delete(worktreeId);
    return result;
  }

  function list() {
    return [...active.values()]
      .filter((record) => fs.existsSync(record.path))
      .sort((a, b) => a.worktreeId < b.worktreeId ? -1 : a.worktreeId > b.worktreeId ? 1 : 0)
      .map(publicRecord);
  }

  function audit() {
    return context.audit.map(clone);
  }

  function hookInvocations() {
    return hookEmitter.list();
  }

  return Object.freeze({ create, commit, merge, discard, list, audit, hookInvocations });
}
