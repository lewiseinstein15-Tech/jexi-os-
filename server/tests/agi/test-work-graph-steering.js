/**
 * ARENA REBUILD — Phase 2 proof: Work Graph steering contracts
 * (spec Part 11: "mid-task steering — preserve work, replan affected only").
 *
 * Pure unit level against the REAL WorkGraph: no LLM, no lanes, no mocks of
 * the engine itself — only the graph and its persistence. What is proven:
 *   1. DONE work is NEVER touched by steering invalidation
 *   2. only the affected subgraph is superseded; unrelated work continues
 *   3. supersede lineage is recorded (SUPERSEDES relation — no silent loss)
 *   4. restart recovery re-opens in-flight work honestly (leases cleared)
 *   5. readyWork respects BLOCKS dependencies + priority order
 *   6. claim leases prevent double-execution of the same item
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// isolate persistence BEFORE any director import resolves DATA_DIR
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'arena-wg-'));
process.env.DATA_DIR = TMP;

const { WorkGraph, loadWorkGraph, WORK_STATUSES } = await import('../../src/services/director/WorkGraph.js');

function freshGraph(id = 'm-test') {
  return new WorkGraph(id);
}

test('steering invalidation preserves DONE work, supersedes only the affected subgraph', () => {
  const g = freshGraph('m-steer');
  const a = g.addItem({ title: 'research the API', capability: 'research' });
  const b = g.addItem({ title: 'write the integration', capability: 'coding', dependsOn: [a.id] });
  const c = g.addItem({ title: 'test the integration', capability: 'coding', dependsOn: [b.id] });
  const d = g.addItem({ title: 'unrelated report', capability: 'reasoning' });
  g.addRelation('BLOCKS', a.id, b.id, 'a before b');
  g.addRelation('BLOCKS', b.id, c.id, 'b before c');

  // A completes; B starts
  g.complete(a.id, { content: 'api v2 exists' });
  g.claim(b.id, 'w1');

  // steering hits B: invalidate downstream of B
  const superseded = g.invalidateDownstream([b.id], null, 'steering: use v2 instead');
  const A = g.get(a.id), B = g.get(b.id), C = g.get(c.id), D = g.get(d.id);

  assert.equal(A.status, 'DONE', 'completed work is sacred — steering never reverts it');
  assert.equal(A.result.content, 'api v2 exists', 'and its result is intact');
  assert.ok(WORK_STATUSES.includes(B.status), 'B moves to a defined state');
  assert.ok(B.status === 'SUPERSEDED' || B.status === 'SKIPPED' || B.status === 'PENDING', `B superseded/replanned, got ${B.status}`);
  assert.ok(superseded.includes(b.id), 'B is listed as superseded');
  assert.ok(superseded.includes(c.id), 'its dependent C is invalidated with it (never runs stale)');
  assert.equal(D.status, 'PENDING', 'unrelated work D is untouched by the steering');
});

test('supersede lineage is recorded — replacement links to what it replaced', () => {
  const g = freshGraph('m-lineage');
  const root = g.addItem({ title: 'old approach' });
  const child = g.addItem({ title: 'build on old approach', dependsOn: [root.id] });
  g.addRelation('BLOCKS', root.id, child.id, 'order');
  g.fail(root.id, 'dead end');
  assert.equal(g.get(root.id).status, 'FAILED', 'the failed item keeps its honest terminal record');

  // replan: the pending child is superseded, a replacement takes its place
  const fresh = g.addItem({ title: 'new approach', dependsOn: [] });
  const superseded = g.invalidateDownstream([child.id], fresh.id, 'replan: dead end');
  assert.ok(superseded.includes(child.id), 'the stale pending child is superseded, never run');
  assert.equal(g.get(child.id).status, 'SUPERSEDED');
  const rel = g.relations.find((r) => r.type === 'SUPERSEDES' && r.from === fresh.id && r.to === child.id);
  assert.ok(rel, 'SUPERSEDES relation exists — history is auditable, nothing silently vanishes');
  assert.equal(g.get(fresh.id).status, 'PENDING', 'the replacement is open for execution');
});

test('restart recovery re-opens in-flight items and clears stale leases', () => {
  const g = freshGraph('m-restart');
  const a = g.addItem({ title: 'item one' });
  const b = g.addItem({ title: 'item two' });
  g.claim(a.id, 'worker-that-died');
  g.claim(b.id, 'worker-that-died');
  // simulate: b actually finished but the crash happened before persist-of-complete
  g.complete(b.id, 'done just in time');
  assert.equal(g.get(a.id).status, 'RUNNING');

  g.recoverAfterRestart('container replaced');

  assert.equal(g.get(a.id).status, 'PENDING', 'in-flight work is honestly re-opened, not fake-completed');
  assert.equal(g.get(b.id).status, 'DONE', 'work that finished stays done');
  assert.equal(Object.keys(g.leases || {}).length, 0, 'no stale leases survive a restart');
});

test('readyWork respects dependencies and orders by priority', () => {
  const g = freshGraph('m-ready');
  const root = g.addItem({ title: 'root', priority: 'normal' });
  const high = g.addItem({ title: 'independent high', priority: 'high' });
  const child = g.addItem({ title: 'child of root', priority: 'high', dependsOn: [root.id] });
  g.addRelation('BLOCKS', root.id, child.id, 'order');
  const ready = g.readyWork();
  assert.ok(ready.some((i) => i.id === high.id), 'independent high-priority work is ready');
  assert.ok(ready.some((i) => i.id === root.id), 'unblocked root work is ready');
  assert.ok(!ready.some((i) => i.id === child.id), 'a blocked item is NEVER offered as ready');
  assert.ok(ready.indexOf(ready.find((i) => i.id === high.id)) < ready.indexOf(ready.find((i) => i.id === root.id)), 'high priority is claimed first');
});

test('claim leases prevent double execution', () => {
  const g = freshGraph('m-lease');
  const a = g.addItem({ title: 'single owner' });
  const first = g.claim(a.id, 'worker-a', 60_000);
  assert.ok(first, 'first claim wins (returns the item)');
  const second = g.claim(a.id, 'worker-b', 60_000);
  assert.equal(second, null, 'second claim on a live lease is refused — one item, one worker');
  g.releaseLease(a.id);
  const third = g.claim(a.id, 'worker-c', 60_000);
  assert.ok(third, 'after release the item is claimable again');
});

test('the graph persists and reloads with every item and relation', () => {
  const g = freshGraph('m-persist');
  const a = g.addItem({ title: 'persisted item', capability: 'research' });
  const b = g.addItem({ title: 'dependent', dependsOn: [a.id] });
  g.addRelation('BLOCKS', a.id, b.id, 'order');
  g.complete(a.id, 'findings survive');
  const reloaded = loadWorkGraph('m-persist');
  assert.ok(reloaded, 'graph reloads from disk');
  assert.equal(reloaded.items.length, 2, 'all items survive');
  assert.equal(reloaded.get(a.id).status, 'DONE', 'status survives');
  assert.ok(reloaded.relations.some((r) => r.type === 'BLOCKS'), 'relations survive');
  assert.equal(reloaded.get(b.id).dependsOn[0], a.id, 'dependencies survive');
});

// cleanup tmp
test.after?.(() => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* best effort */ } });
