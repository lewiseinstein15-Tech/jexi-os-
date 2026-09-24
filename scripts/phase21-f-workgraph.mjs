// PHASE 21 — SCOPE F — LIVE PROBE: experiment node in the REAL Phase 4 work graph.
// Zone-compliant: graph is imported (never edited); checkpoint DB lives under
// research/.probes/ and is removed in the finally block.
import { mkdtempSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert';

import { createExperimentGraph, EXPERIMENT_OWNER } from '../services/research/workgraph/experiment-node.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const probesDir = join(root, 'research', '.probes');
const dir = mkdtempSync(join(probesDir, 'scope-f-'));
const dbFile = join(dir, 'workgraph.sqlite');

const showState = (eg, label) => {
  console.log(`[state ${label}]`);
  for (const n of eg.graphState()) {
    console.log(
      `  ${String(n.id).padEnd(12)} type=${String(n.type).padEnd(10)} status=${String(n.status).padEnd(10)} metric=${n.metric ?? '-'} retries=${n.retryCount}`,
    );
  }
};

try {
  const eg = createExperimentGraph({ file: dbFile });

  // ---- 1. create three experiment nodes (one depends on another) ----
  const expKept = eg.addExperimentNode({
    id: 'exp-2-true-slope',
    hypothesis: 'predict 0.7x+0.2 — the latent function',
    experimentDir: 'research/.probes/scope-f-ws',
    metricName: 'val_metric',
  });
  const expDiscard = eg.addExperimentNode({
    id: 'exp-3-flatter',
    hypothesis: 'predict 0.3x+0.6 — flatter slope',
    dependencies: ['exp-2-true-slope'],
  });
  const expCrash = eg.addExperimentNode({
    id: 'exp-4-boom',
    hypothesis: 'candidate throws — crash path',
    dependencies: ['exp-3-flatter'],
  });
  console.log(`[create] 3 experiment nodes added (exp-3 and exp-4 depend on earlier ones)`);
  console.log(`[ready] claimable nodes: ${JSON.stringify(eg.graph.readyWork())}`);
  showState(eg, 'after create');
  assert.deepEqual(eg.graph.readyWork(), ['exp-2-true-slope'], 'only the dependency-free node is ready initially');

  // ---- 2. kept experiment -> node completes with metric evidence ----
  const r1 = await eg.runExperimentNode('exp-2-true-slope', async () => ({
    kept: true,
    metric: 1.0001,
    evidence: { stdout: 'val_metric=1.0001', exitCode: 0, durationMs: 98 },
  }));
  console.log(`\n[run exp-2-true-slope] verdict=${r1.verdict} status=${r1.status}`);
  showState(eg, 'after kept experiment');
  assert.equal(r1.verdict, 'kept');
  assert.equal(r1.status, 'completed');
  assert.equal(eg.graph.byId('exp-2-true-slope').status, 'completed');
  assert.equal(r1.node.evidence[0].meta.metric, 1.0001, 'completion carries metric evidence');

  // ---- 3. dependency satisfied; discarded experiment -> superseded ----
  const r2 = await eg.runExperimentNode('exp-3-flatter', async () => ({
    kept: false,
    metric: 1.0265,
    evidence: { stdout: 'val_metric=1.0265', exitCode: 0, durationMs: 95 },
  }));
  console.log(`\n[run exp-3-flatter] verdict=${r2.verdict} status=${r2.status}`);
  showState(eg, 'after discarded experiment');
  assert.equal(r2.verdict, 'discarded');
  assert.equal(r2.status, 'superseded');
  assert.equal(eg.graph.byId('exp-3-flatter').status, 'superseded');

  // ---- 4a. transient crash: graph decides retry -> node returns to pending ----
  const r3 = await eg.runExperimentNode('exp-4-boom', async () => {
    throw new Error('candidate threw RangeError');
  });
  console.log(`\n[run exp-4-boom] verdict=${r3.verdict} decision=${r3.decision} status=${r3.node.status}`);
  showState(eg, 'after transient crash');
  assert.equal(r3.verdict, 'crashed');
  assert.equal(r3.decision, 'retry');
  assert.equal(eg.graph.byId('exp-4-boom').status, 'pending');
  assert.equal(eg.graph.byId('exp-4-boom').retryCount, 1, 'graph recorded the failure attempt');

  // ---- 4b. permanent crash: recovery node is spawned by the real classifier ----
  const r4 = await eg.runExperimentNode('exp-4-boom', async () => ({
    crashed: true,
    error: 'TOY_CANDIDATE module not found on disk',
    errorClass: 'missing_dependency',
  }));
  console.log(`\n[run exp-4-boom again] verdict=${r4.verdict} decision=${r4.decision}`);
  console.log(`[recovery] spawned: ${r4.recoveryNode ? r4.recoveryNode.id : 'none'}`);
  showState(eg, 'after permanent crash');
  assert.equal(r4.verdict, 'crashed');
  assert.equal(r4.decision, 'permanent');
  assert.equal(eg.graph.byId('exp-4-boom').status, 'failed');
  assert.ok(eg.graph.nodes.some((n) => n.type === 'recovery'), 'real recovery node exists');
  assert.ok(r4.recoveryNode, 'fail() returned the recovery node');

  // ---- 5. superseded status must unblock dependents (graph BLOCKS/depends semantics) ----
  console.log(`\n[ready] claimable after all outcomes: ${JSON.stringify(eg.graph.readyWork())}`);

  // ---- 6. checkpoint round-trip on the REAL persistence layer ----
  await eg.graph.checkpoint();
  const eg2 = createExperimentGraph({ file: dbFile });
  await eg2.graph.restore();
  console.log(`\n[restore] nodes after restart: ${eg2.graph.nodes.length}`);
  showState(eg2, 'after restore');
  assert.equal(eg2.graph.nodes.length, 4, 'checkpoint restores every node incl. recovery');
  assert.equal(eg2.graph.byId('exp-2-true-slope').status, 'completed');
  assert.equal(eg2.graph.byId('exp-3-flatter').status, 'superseded');

  console.log('\nSCOPE F PROBE PASSED');
} finally {
  rmSync(dir, { recursive: true, force: true });
}
