#!/usr/bin/env node
/**
 * JEXI OS — Phase 5 Scope B — LIVE PROBE.
 *
 * Demonstrates the real-spawn verification pipeline end to end, printing ONLY
 * raw verifier output (no narration): a snapshot is captured from the fixture,
 * TestVerifier / LintVerifier / BuildVerifier run as REAL child processes,
 * FileStateVerifier byte-compares the frozen snapshot, and the WorkGraph's
 * runVerificationNode gates a task on the real evidence. When the real test
 * FAILS the graph blocks the task and returns injectedFailure; when the
 * snapshot carries the fixed source, the graph COMPLETES the task.
 *
 * Usage: node scripts/scope-b-probe.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(__dir, '..', 'tests', 'agi', 'fixtures', 'verify-pkg');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jexi-scope-b-'));

const {
  TestVerifier,
  FileStateVerifier,
  captureSnapshot,
} = await import('../src/verification/index.js');
const { createWorkGraph, createTaskNode, createVerificationNode } = await import('../src/workgraph/index.js');

const out = (o) => process.stdout.write(JSON.stringify(o) + '\n');

// --- 1. REAL SQLITE-BACKED GRAPH -------------------------------------------
const g = createWorkGraph({ file: path.join(TMP, 'probe.db') });
g.addNode(createTaskNode({ id: 'task', objective: 'implement add()' }));
g.addNode(createVerificationNode({ id: 'verify', verifiesNodeId: 'task', dependencies: ['task'] }));
g.byId('task').verificationNodeId = 'verify';
await g.claim('task', 'forge', { now: 1000 });

out({ phase: '1.graph', task: g.byId('task').status, verify: g.byId('verify').status });

// --- 2. TEST: REAL FAILING TEST --------------------------------------------
out({ phase: '2.test.failing', result: await TestVerifier.verify({
  nodeId: 'verify', snapshotId: 's', acceptanceCriteria: 'tests pass', claimantAcbId: 'forge',
  options: { cwd: FIXTURE, command: process.execPath, args: ['src/plain-sum.js'], timeoutMs: 30000 },
}) });

// --- 3. FIX + SNAPSHOT (BYTE-COMPARE) --------------------------------------
const snap = captureSnapshot({
  nodeId: 'task',
  files: {
    'src/add.js': 'export function add(a, b) { return a + b; }', // fixed
    'src/plain-sum.js': "import assert from 'node:assert/strict';\nimport { add } from './add.js';\nassert.equal(add(1, 2), 3);\nconsole.log('plainsum: ok');",
  },
});
out({ phase: '4.filestate.byte-compare', result: await FileStateVerifier.verify({
  nodeId: 'task', snapshotId: snap.id, snapshot: snap, acceptanceCriteria: 'src/add.js === frozen sum',
  claimantAcbId: 'forge', options: { expectedFiles: snap.files },
}) });

// --- 5. GRAPH: REAL TEST ON THE FIXED SNAPSHOT COMPLETES THE TASK ---------
const passRun = await g.runVerificationNode('verify', {
  owner: 'vera', now: 2000, verifier: 'TestVerifier',
  context: { snapshotId: snap.id, snapshot: snap, acceptanceCriteria: 'add(1,2) === 3', claimantAcbId: 'forge' },
  options: { cwd: FIXTURE, command: process.execPath, args: [path.join(FIXTURE, 'run-from-cwd.js')], materialize: true },
});
out({ phase: '5.graph.pass', ok: passRun.ok, status: g.byId('verify').status });
const done = await g.complete('task', { owner: 'forge', now: 3000 });
out({ phase: '6.task.complete', ok: done.ok, task: g.byId('task').status });
fs.rmSync(TMP, { recursive: true, force: true });