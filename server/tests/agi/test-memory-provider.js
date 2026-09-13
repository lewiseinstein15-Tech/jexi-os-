/**
 * AGI Phase 4 (Scope A) — MemoryProvider subsystem contracts.
 *
 *   write → restart → retrieve        (SQLite survives process death)
 *   contradict → newer fact wins      (semantic stable-key supersede)
 *   expire working-tier               (auto-delete after timeout)
 *   mission isolation                 (mission A cannot see mission B)
 *   prefetch returns relevant entries within token budget
 *
 * Keyless, deterministic, no model calls. Uses a temp DATA_DIR for isolation.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'agi-mem-provider-'));
const DB = path.join(TMP, 'memory.db');

const { openMemorySystem } = await import('../../src/memory/index.js');

test('write → restart → retrieve (session tier survives process death)', async () => {
  const a = await openMemorySystem({ file: DB });
  await a.layers.session.write({ missionId: 'm-restart', content: 'the build service is online at /api/deploy', metadata: { kind: 'observation' } });
  await a.shutdown(); // simulate process death: open it fresh again

  const b = await openMemorySystem({ file: DB });
  const rows = await b.layers.session.list({ missionId: 'm-restart' });
  assert.equal(rows.length, 1, 'the entry survives a reopen');
  assert.match(rows[0].content, /build service is online/);
  await b.shutdown();
});

test('working tier is mission-scoped and auto-expires', async () => {
  const ttl = 200; // ms
  const mem = await openMemorySystem({ file: ':memory:' });
  await mem.layers.working.write({ missionId: 'm-work', content: 'scratch: integration test flaking', metadata: {}, ttlMs: ttl });
  const before = await mem.layers.working.list({ missionId: 'm-work' });
  assert.equal(before.length, 1, 'working entry present before expiry');

  await new Promise((r) => setTimeout(r, 250));
  const after = await mem.layers.working.list({ missionId: 'm-work' });
  assert.equal(after.length, 0, 'working entry vanished after TTL');
  await mem.shutdown();
});

test('mission isolation — mission A cannot see mission B memory', async () => {
  const mem = await openMemorySystem({ file: ':memory:' });
  await mem.layers.session.write({ missionId: 'mission-A', content: 'A secret: launch window is 02:00 UTC' });
  await mem.layers.episodic.record({ missionId: 'mission-B', content: 'B tried the QPS path and failed', outcome: 'failed' });

  const aView = await mem.layers.session.list({ missionId: 'mission-A' });
  const aViaRecall = await mem.recall({ missionId: 'mission-A', tier: 'session' });
  // mission B's record must NOT leak into A's view.
  assert.equal(aView.some((r) => r.content.includes('B tried')), false, 'no cross-mission bleed in list');
  assert.equal(aViaRecall.some((r) => r.content.includes('B tried')), false, 'no cross-mission bleed in recall');

  // A's own memory is visible to A.
  assert.equal(aView.some((r) => r.content.includes('02:00 UTC')), true, "A sees A's memory");
  await mem.shutdown();
});

test('contradict → newer fact wins (semantic stable key supersede)', async () => {
  const mem = await openMemorySystem({ file: ':memory:' });
  await mem.layers.semantic.record({ missionId: 'm-sem', subject: 'deploy.target', attribute: 'region', value: 'us-east-1' });
  // Newer write with same subject/attribute supersedes.
  await mem.layers.semantic.record({ missionId: 'm-sem', subject: 'deploy.target', attribute: 'region', value: 'eu-west-1' });
  const fact = await mem.layers.semantic.fact({ missionId: 'm-sem', subject: 'deploy.target', attribute: 'region' });
  assert.equal(fact.metadata.value, 'eu-west-1', 'newer fact wins');
  assert.equal(fact.content.includes('eu-west-1'), true);
  await mem.shutdown();
});

test('prefetch returns relevant entries within token budget', async () => {
  const mem = await openMemorySystem({ file: ':memory:' });
  for (let i = 0; i < 30; i++) {
    await mem.layers.semantic.record({ missionId: 'm-pf', subject: 'quic', attribute: `h-${i}`, value: `QUIC is a UDP-based multiplexed transport protocol designed to fix head-of-line blocking; entry number ${i}` });
  }
  await mem.layers.semantic.record({ missionId: 'm-pf', subject: 'keytar', attribute: 'passwords', value: 'the user stores passwords in keytar' });
  const hits = await mem.prefetch({ missionId: 'm-pf', query: 'keytar passwords', tier: ['semantic'], tokenBudget: 900 });
  assert.ok(hits.length >= 1, 'relevant entry is prefetched');
  assert.ok(hits.some((e) => e.content.includes('keytar')), 'the keytar entry is among hits');
  const totalTokens = hits.reduce((acc, e) => acc + Math.max(1, Math.ceil(e.content.length / 4)), 0);
  assert.ok(totalTokens <= 900, `prefetch respects token budget (used ${totalTokens})`);
  await mem.shutdown();
});

test('session syncTurn records conversation turns mission-scoped', async () => {
  const mem = await openMemorySystem({ file: ':memory:' });
  await mem.syncTurn({ missionId: 'm-turn', role: 'user', text: 'deploy the api to prod' });
  await mem.syncTurn({ missionId: 'm-turn', role: 'assistant', text: 'deploying now' });
  const turns = await mem.layers.session.list({ missionId: 'm-turn' });
  assert.equal(turns.length, 2);
  assert.ok(turns.some((t) => t.metadata.role === 'user'));
  assert.ok(turns.some((t) => t.metadata.role === 'assistant'));
  await mem.shutdown();
});

test('kernel refuses mission-less queries (isolation enforced at the kernel)', async () => {
  const mem = await openMemorySystem({ file: ':memory:' });
  await assert.rejects(() => mem.recall({ tier: 'session' }), /missionId is required/, 'recall without missionId is refused');
  await mem.shutdown();
});