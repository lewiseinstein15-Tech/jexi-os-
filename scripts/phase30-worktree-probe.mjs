#!/usr/bin/env node
/** Phase 30 Scope E live probe: real subagent git-worktree isolation (P1-P7). */
import nodeAssert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createFleet } from '../runtime/session/fleet/index.js';
import { createSessions } from '../runtime/workgraph/session/index.js';
import {
  createWorktreeManager,
  deterministicWorktreeId,
} from '../harness/parity/worktree/index.js';

const [remoteRef, fleetBlob, sessionBlob, hooksBlob] = process.argv.slice(2);
nodeAssert.ok(remoteRef, 'authoritative remote ref argument is required');
nodeAssert.ok(fleetBlob, 'authoritative Phase 27 fleet blob argument is required');
nodeAssert.ok(sessionBlob, 'authoritative Phase 10 session blob argument is required');
nodeAssert.ok(hooksBlob, 'authoritative Scope A hooks blob argument is required');

function gitBlob(relativeUrl) {
  const filePath = fileURLToPath(new URL(relativeUrl, import.meta.url));
  const bytes = fs.readFileSync(filePath);
  return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
}

nodeAssert.equal(gitBlob('../runtime/session/fleet/index.js'), fleetBlob);
nodeAssert.equal(gitBlob('../runtime/workgraph/session/index.js'), sessionBlob);
nodeAssert.equal(gitBlob('../harness/parity/hooks/index.js'), hooksBlob);

process.env.GIT_AUTHOR_DATE = '2026-09-22T00:00:00Z';
process.env.GIT_COMMITTER_DATE = '2026-09-22T00:00:00Z';

function git(root, args) {
  return execFileSync('git', ['-C', root, ...args], {
    encoding: 'utf8',
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  }).trim();
}

function gitResult(root, args) {
  return spawnSync('git', ['-C', root, ...args], {
    encoding: 'utf8',
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  });
}

function initRepo(root) {
  fs.mkdirSync(root, { recursive: true });
  git(root, ['init', '-b', 'main']);
  git(root, ['config', 'user.name', 'JEXI Scope E']);
  git(root, ['config', 'user.email', 'scope-e@jexi.invalid']);
  fs.writeFileSync(path.join(root, 'shared.txt'), 'initial\n');
  git(root, ['add', 'shared.txt']);
  git(root, ['commit', '--no-gpg-sign', '-m', 'initial']);
}

function hasBranch(root, branch) {
  return gitResult(root, ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`]).status === 0;
}

function capture(run) {
  try {
    return { returned: run() };
  } catch (error) {
    return {
      error: {
        name: error.name,
        code: error.code,
        message: error.message,
        worktreeId: error.worktreeId,
        into: error.into,
        conflicts: error.conflicts,
      },
    };
  }
}

async function waitFleet(fleet, sessionId, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const row = fleet.roster.get(sessionId);
    if (row.state !== 'running') return row;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`fleet session ${sessionId} did not settle`);
}

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'jexi-phase30-worktree-'));
const root = path.join(temp, 'main');
const worktreesDir = path.join(temp, 'worktrees');
const fleetDir = path.join(temp, 'fleet');
const sessionsDir = path.join(temp, 'sessions');
let fleet;

try {
  initRepo(root);

  const sessionId = 'scope-e-main';
  fleet = createFleet({ dir: fleetDir });
  fleet.spawn('printf phase27-fleet', { id: sessionId });
  const fleetRecord = await waitFleet(fleet, sessionId);
  nodeAssert.equal(fleetRecord.state, 'exited');

  const sessions = createSessions({ directory: sessionsDir });
  const sessionNode = sessions.store(sessionId).append({
    parentId: null,
    kind: 'subagent',
    payload: { isolation: 'worktree' },
    ts: '2026-09-22T00:00:00.000Z',
  });

  const manager = createWorktreeManager({
    root,
    worktreesDir,
    fleet,
    sessions,
  });

  console.log('P1 CREATE REAL WORKTREE');
  const created = manager.create({ baseBranch: 'main', sessionId });
  const active = manager.list();
  const p1 = {
    created,
    pathExists: fs.existsSync(created.path),
    branchExists: hasBranch(root, created.branch),
    active,
    compositionSources: {
      remoteRef,
      phase27Fleet: { path: 'session/fleet/index.js', blob: fleetBlob },
      phase10SessionTree: { path: 'workgraph/session/index.js', blob: sessionBlob },
      scopeAHooks: { path: 'harness/parity/hooks/index.js', blob: hooksBlob },
    },
  };
  console.log(JSON.stringify(p1, null, 2));
  nodeAssert.equal(created.worktreeId, deterministicWorktreeId(sessionId, 1));
  nodeAssert.equal(created.branch, `worktree/${sessionId}/${created.worktreeId}`);
  nodeAssert.equal(p1.pathExists, true);
  nodeAssert.equal(p1.branchExists, true);
  nodeAssert.equal(active.length, 1);
  nodeAssert.deepEqual(active[0].composition, {
    fleetSession: { sessionId, state: 'exited' },
    sessionTree: { rootId: sessionNode.id, headId: sessionNode.id, nodeCount: 1 },
  });
  console.log('P1 PASS');

  console.log('\nP2 SCOPE A WORKTREE HOOK INVOCATIONS');
  const hookTree = manager.create({ baseBranch: 'main', sessionId: 'scope-e-hooks' });
  const hookDiscard = manager.discard(hookTree.worktreeId);
  const p2Events = manager.hookInvocations()
    .filter((invocation) => invocation.payload.worktreeId === hookTree.worktreeId);
  const p2 = { worktreeId: hookTree.worktreeId, discard: hookDiscard, invocations: p2Events };
  console.log(JSON.stringify(p2, null, 2));
  nodeAssert.deepEqual(p2Events.map((invocation) => invocation.event), [
    'WorktreeCreate',
    'WorktreeRemove',
  ]);
  nodeAssert.ok(p2Events.every((invocation) => invocation.lifecycle === 'worktree'));
  nodeAssert.deepEqual(hookDiscard, { discarded: true });
  console.log('P2 PASS');

  console.log('\nP3 ISOLATED SUBAGENT WRITE');
  const mainHeadBefore = git(root, ['rev-parse', 'HEAD']);
  const mainStatusBefore = git(root, ['status', '--porcelain=v1', '--untracked-files=all']);
  const isolatedPath = path.join(created.path, 'isolated.txt');
  fs.writeFileSync(isolatedPath, 'subagent-only\n');
  const worktreeStatus = git(created.path, ['status', '--porcelain=v1', '--untracked-files=all']);
  const mainStatusAfter = git(root, ['status', '--porcelain=v1', '--untracked-files=all']);
  const mainHeadAfter = git(root, ['rev-parse', 'HEAD']);
  const p3 = {
    worktreeStatus,
    mainStatusBefore,
    mainStatusAfter,
    mainHeadBefore,
    mainHeadAfter,
    worktreeFileExists: fs.existsSync(isolatedPath),
    mainFileExists: fs.existsSync(path.join(root, 'isolated.txt')),
    mainTreeUnchanged: mainStatusBefore === mainStatusAfter && mainHeadBefore === mainHeadAfter,
  };
  console.log(JSON.stringify(p3, null, 2));
  nodeAssert.match(worktreeStatus, /\?\? isolated\.txt/);
  nodeAssert.equal(mainStatusBefore, '');
  nodeAssert.equal(mainStatusAfter, '');
  nodeAssert.equal(p3.worktreeFileExists, true);
  nodeAssert.equal(p3.mainFileExists, false);
  nodeAssert.equal(p3.mainTreeUnchanged, true);
  console.log('P3 PASS');

  console.log('\nP4 COMMIT AND --NO-FF MERGE');
  const committed = manager.commit(created.worktreeId, { message: 'isolated subagent work' });
  const mainFileBeforeMerge = fs.existsSync(path.join(root, 'isolated.txt'));
  const mainStatusBeforeMerge = git(root, ['status', '--porcelain=v1', '--untracked-files=all']);
  const merged = manager.merge(created.worktreeId, { into: 'main' });
  const parents = git(root, ['show', '-s', '--format=%P', merged.merged]).split(/\s+/).filter(Boolean);
  const auditAtMerge = manager.audit();
  const mergeCommands = auditAtMerge
    .map((entry) => entry.argv)
    .filter((argv) => argv.includes('merge'));
  const pushCommands = auditAtMerge
    .map((entry) => entry.argv)
    .filter((argv) => argv.includes('push'));
  const p4 = {
    committed,
    mainFileBeforeMerge,
    mainStatusBeforeMerge,
    merged,
    mainFileAfterMerge: fs.existsSync(path.join(root, 'isolated.txt')),
    mergeParents: parents,
    parentCount: parents.length,
    mergeCommands,
    pushCommands,
    noFf: mergeCommands.some((argv) => argv.includes('--no-ff')),
    forcedPush: pushCommands.length > 0,
  };
  console.log(JSON.stringify(p4, null, 2));
  nodeAssert.match(committed.sha, /^[0-9a-f]{40}$/);
  nodeAssert.match(merged.merged, /^[0-9a-f]{40}$/);
  nodeAssert.equal(mainFileBeforeMerge, false);
  nodeAssert.equal(mainStatusBeforeMerge, '');
  nodeAssert.equal(p4.mainFileAfterMerge, true);
  nodeAssert.equal(parents.length, 2);
  nodeAssert.equal(p4.noFf, true);
  nodeAssert.deepEqual(pushCommands, []);
  nodeAssert.equal(p4.forcedPush, false);
  console.log('P4 PASS');

  console.log('\nP5 CONFLICT RETURNS E_WORKTREE_CONFLICT');
  const conflictTree = manager.create({ baseBranch: 'main', sessionId: 'scope-e-conflict' });
  fs.writeFileSync(path.join(conflictTree.path, 'shared.txt'), 'worktree-side\n');
  manager.commit(conflictTree.worktreeId, { message: 'worktree conflict side' });
  fs.writeFileSync(path.join(root, 'shared.txt'), 'main-side\n');
  git(root, ['add', 'shared.txt']);
  git(root, ['commit', '--no-gpg-sign', '-m', 'main conflict side']);
  const conflictHeadBefore = git(root, ['rev-parse', 'HEAD']);
  const conflict = capture(() => manager.merge(conflictTree.worktreeId, { into: 'main' }));
  const conflictHeadAfter = git(root, ['rev-parse', 'HEAD']);
  const p5 = {
    ...conflict,
    mainHeadBefore: conflictHeadBefore,
    mainHeadAfter: conflictHeadAfter,
    mainStatusAfterAbort: git(root, ['status', '--porcelain=v1', '--untracked-files=all']),
    mainContentAfterAbort: fs.readFileSync(path.join(root, 'shared.txt'), 'utf8'),
    conflictWorktreeStillExists: fs.existsSync(conflictTree.path),
  };
  console.log(JSON.stringify(p5, null, 2));
  nodeAssert.equal(conflict.error?.name, 'SemanticaError');
  nodeAssert.equal(conflict.error?.code, 'E_WORKTREE_CONFLICT');
  nodeAssert.deepEqual(conflict.error?.conflicts, ['shared.txt']);
  nodeAssert.equal(conflictHeadAfter, conflictHeadBefore);
  nodeAssert.equal(p5.mainStatusAfterAbort, '');
  nodeAssert.equal(p5.mainContentAfterAbort, 'main-side\n');
  nodeAssert.equal(p5.conflictWorktreeStillExists, true);
  manager.discard(conflictTree.worktreeId);
  console.log('P5 PASS');

  console.log('\nP6 SAFE DISCARD REMOVES WORKTREE AND BRANCH');
  const discardMainBefore = git(root, ['rev-parse', 'HEAD']);
  const beforeDiscard = {
    activeIds: manager.list().map((entry) => entry.worktreeId),
    pathExists: fs.existsSync(created.path),
    branchExists: hasBranch(root, created.branch),
    mainHead: discardMainBefore,
  };
  const discarded = manager.discard(created.worktreeId);
  const afterDiscard = {
    activeIds: manager.list().map((entry) => entry.worktreeId),
    pathExists: fs.existsSync(created.path),
    branchExists: hasBranch(root, created.branch),
    mainHead: git(root, ['rev-parse', 'HEAD']),
  };
  const p6 = { before: beforeDiscard, result: discarded, after: afterDiscard };
  console.log(JSON.stringify(p6, null, 2));
  nodeAssert.deepEqual(discarded, { discarded: true });
  nodeAssert.ok(beforeDiscard.activeIds.includes(created.worktreeId));
  nodeAssert.equal(beforeDiscard.pathExists, true);
  nodeAssert.equal(beforeDiscard.branchExists, true);
  nodeAssert.ok(!afterDiscard.activeIds.includes(created.worktreeId));
  nodeAssert.equal(afterDiscard.pathExists, false);
  nodeAssert.equal(afterDiscard.branchExists, false);
  nodeAssert.equal(afterDiscard.mainHead, discardMainBefore);
  console.log('P6 PASS');

  console.log('\nP7 DETERMINISTIC WORKTREE ID');
  const deterministicRoot = path.join(temp, 'deterministic-main');
  const deterministicTrees = path.join(temp, 'deterministic-worktrees');
  initRepo(deterministicRoot);
  const deterministicArgs = { baseBranch: 'main', sessionId: 'same-session' };
  const managerOne = createWorktreeManager({
    root: deterministicRoot,
    worktreesDir: deterministicTrees,
    fleetDir: path.join(temp, 'det-fleet-one'),
    sessionsDir: path.join(temp, 'det-sessions'),
  });
  const first = managerOne.create(deterministicArgs);
  managerOne.discard(first.worktreeId);
  const managerTwo = createWorktreeManager({
    root: deterministicRoot,
    worktreesDir: deterministicTrees,
    fleetDir: path.join(temp, 'det-fleet-two'),
    sessionsDir: path.join(temp, 'det-sessions'),
  });
  const second = managerTwo.create(deterministicArgs);
  const expected = deterministicWorktreeId('same-session', 1);
  const p7 = {
    args: deterministicArgs,
    first: { worktreeId: first.worktreeId, branch: first.branch },
    second: { worktreeId: second.worktreeId, branch: second.branch },
    expected,
    byteIdentical: first.worktreeId === second.worktreeId,
  };
  console.log(JSON.stringify(p7, null, 2));
  nodeAssert.equal(first.worktreeId, expected);
  nodeAssert.equal(second.worktreeId, expected);
  nodeAssert.equal(first.worktreeId, second.worktreeId);
  nodeAssert.equal(first.branch, second.branch);
  managerTwo.discard(second.worktreeId);
  console.log('P7 PASS');

  console.log('\nNO-WORKTREE SUPPORT GUARD');
  const unsupportedRoot = path.join(temp, 'not-a-repository');
  fs.mkdirSync(unsupportedRoot);
  const unsupported = createWorktreeManager({
    root: unsupportedRoot,
    worktreesDir: path.join(temp, 'unsupported-worktrees'),
    fleetDir: path.join(temp, 'unsupported-fleet'),
    sessionsDir: path.join(temp, 'unsupported-sessions'),
  });
  const supportGuard = capture(() => unsupported.create({ baseBranch: 'main', sessionId: 'unsupported' }));
  console.log(JSON.stringify(supportGuard, null, 2));
  nodeAssert.equal(supportGuard.error?.name, 'SemanticaError');
  nodeAssert.equal(supportGuard.error?.code, 'E_NO_WORKTREE_SUPPORT');
  console.log('E_NO_WORKTREE_SUPPORT PASS');

  console.log('\nPHASE30_SCOPE_E_PASS');
} finally {
  if (fleet) {
    for (const row of fleet.roster.list()) {
      if (row.state === 'running') await fleet.kill(row.sessionId);
    }
  }
  fs.rmSync(temp, { recursive: true, force: true });
}
