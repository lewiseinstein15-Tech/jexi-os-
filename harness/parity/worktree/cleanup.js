/** JEXI OS — Phase 30 Scope E — commit, no-ff merge and safe discard. */
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { SemanticaError } from '../../../semantica/_internal.js';

function fail(code, message, details = {}) {
  return Object.assign(new SemanticaError(code, message), details);
}

function commandText(result) {
  return (result.stderr || result.stdout || `git exited ${result.status}`).trim();
}

export function runGit(context, args, { cwd = context.root, allowFailure = false } = {}) {
  const command = { cwd, argv: ['git', '-C', cwd, ...args] };
  context.audit.push(command);
  const result = spawnSync('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  });
  if (result.error?.code === 'ENOENT') {
    throw fail('E_NO_WORKTREE_SUPPORT', 'git executable is unavailable in this sandbox');
  }
  const normalized = {
    ok: result.status === 0,
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
  if (!normalized.ok && !allowFailure) {
    throw fail('E_WORKTREE_GIT', commandText(normalized), { command: [...command.argv] });
  }
  return normalized;
}

export function branchExists(context, branch) {
  return runGit(context, ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], {
    allowFailure: true,
  }).ok;
}

function head(context, cwd = context.root) {
  const result = runGit(context, ['rev-parse', 'HEAD'], { cwd });
  return result.stdout.trim();
}

function status(context, cwd) {
  return runGit(context, ['status', '--porcelain=v1', '--untracked-files=all'], { cwd }).stdout.trim();
}

export function commitWorktree(context, record, { message } = {}) {
  if (typeof message !== 'string' || message.trim() === '') {
    throw fail('E_INVALID_WORKTREE_COMMIT', 'commit message must be a non-empty string');
  }
  if (!fs.existsSync(record.path)) {
    throw fail('E_UNKNOWN_WORKTREE', `worktree path no longer exists for ${record.worktreeId}`);
  }

  runGit(context, ['add', '--all'], { cwd: record.path });
  const changed = runGit(context, ['diff', '--cached', '--quiet'], {
    cwd: record.path,
    allowFailure: true,
  });
  if (changed.status !== 0 && changed.status !== 1) {
    throw fail('E_WORKTREE_COMMIT', commandText(changed), { worktreeId: record.worktreeId });
  }
  if (changed.status === 1) {
    const committed = runGit(context, ['commit', '--no-gpg-sign', '-m', message], {
      cwd: record.path,
      allowFailure: true,
    });
    if (!committed.ok) {
      throw fail('E_WORKTREE_COMMIT', commandText(committed), { worktreeId: record.worktreeId });
    }
  }
  const sha = head(context, record.path);
  record.commitSha = sha;
  return { sha };
}

export function mergeWorktree(context, record, { into } = {}) {
  if (typeof into !== 'string' || into.trim() === '') {
    throw fail('E_INVALID_WORKTREE_TARGET', 'merge target must be a non-empty branch name');
  }
  if (!branchExists(context, into)) {
    throw fail('E_INVALID_WORKTREE_TARGET', `merge target branch ${JSON.stringify(into)} does not exist`);
  }
  if (!fs.existsSync(record.path)) {
    throw fail('E_UNKNOWN_WORKTREE', `worktree path no longer exists for ${record.worktreeId}`);
  }
  const worktreeStatus = status(context, record.path);
  if (worktreeStatus !== '') {
    throw fail('E_WORKTREE_DIRTY', `worktree ${record.worktreeId} has uncommitted changes`, {
      worktreeId: record.worktreeId,
      status: worktreeStatus,
    });
  }
  const mainStatus = status(context, context.root);
  if (mainStatus !== '') {
    throw fail('E_WORKTREE_MAIN_DIRTY', 'main worktree must be clean before merge', { status: mainStatus });
  }

  const current = runGit(context, ['branch', '--show-current']).stdout.trim();
  if (current !== into) {
    const switched = runGit(context, ['switch', into], { allowFailure: true });
    if (!switched.ok) {
      throw fail('E_WORKTREE_MERGE', commandText(switched), { worktreeId: record.worktreeId, into });
    }
  }

  const before = head(context);
  const merged = runGit(context, ['merge', '--no-ff', '--no-edit', record.branch], {
    allowFailure: true,
  });
  if (!merged.ok) {
    const conflicts = runGit(context, ['diff', '--name-only', '--diff-filter=U'], {
      allowFailure: true,
    }).stdout.split(/\r?\n/).filter(Boolean).sort();
    if (conflicts.length > 0) {
      const aborted = runGit(context, ['merge', '--abort'], { allowFailure: true });
      if (!aborted.ok) {
        throw fail('E_WORKTREE_MERGE_ABORT', commandText(aborted), {
          worktreeId: record.worktreeId,
          into,
          conflicts,
        });
      }
      throw fail('E_WORKTREE_CONFLICT', `merge conflict in ${conflicts.join(', ')}`, {
        worktreeId: record.worktreeId,
        into,
        conflicts,
      });
    }
    throw fail('E_WORKTREE_MERGE', commandText(merged), { worktreeId: record.worktreeId, into });
  }

  const sha = head(context);
  if (sha !== before) {
    const parents = runGit(context, ['rev-list', '--parents', '-n', '1', sha])
      .stdout.trim().split(/\s+/).slice(1);
    if (parents.length < 2) {
      throw fail('E_WORKTREE_MERGE_POLICY', 'merge did not create a --no-ff merge commit', {
        worktreeId: record.worktreeId,
        into,
        sha,
      });
    }
  }
  record.mergedInto = into;
  record.mergedSha = sha;
  return { merged: sha };
}

export function discardWorktree(context, record) {
  const mainBefore = head(context);
  if (fs.existsSync(record.path)) {
    const worktreeStatus = status(context, record.path);
    if (worktreeStatus !== '') {
      throw fail('E_WORKTREE_DIRTY', `refusing to discard dirty worktree ${record.worktreeId}`, {
        worktreeId: record.worktreeId,
        status: worktreeStatus,
      });
    }
    const removed = runGit(context, ['worktree', 'remove', record.path], { allowFailure: true });
    if (!removed.ok) {
      throw fail('E_WORKTREE_DISCARD', commandText(removed), { worktreeId: record.worktreeId });
    }
  }
  if (branchExists(context, record.branch)) {
    const deleted = runGit(context, ['branch', '-D', record.branch], { allowFailure: true });
    if (!deleted.ok) {
      throw fail('E_WORKTREE_DISCARD', commandText(deleted), { worktreeId: record.worktreeId });
    }
  }
  runGit(context, ['worktree', 'prune']);
  const mainAfter = head(context);
  if (mainAfter !== mainBefore) {
    throw fail('E_WORKTREE_MAIN_CHANGED', 'discard changed the main worktree HEAD', {
      before: mainBefore,
      after: mainAfter,
    });
  }
  context.hooks.emit('WorktreeRemove', {
    worktreeId: record.worktreeId,
    path: record.path,
    branch: record.branch,
    sessionId: record.sessionId,
    reason: 'discard',
  });
  return { discarded: true };
}
