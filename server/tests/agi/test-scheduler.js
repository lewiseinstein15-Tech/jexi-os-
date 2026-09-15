/**
 * AGI Phase 6 Scope B — SCHEDULER (autonomy).
 *
 * Proves the scheduler subsystem with real behavior (no mocks):
 *
 *   B1  cron: 5-field parsing, matching, and next-fire computation.
 *   B2  persistent queue: jobs + runs survive a store reopen (SQLite).
 *   B3  priority: higher priority pops first; ties break FIFO.
 *   B4  fairness: no lane is starved across picks.
 *   B5  concurrency: the pool never exceeds `max` (default 3).
 *   B6  event trigger: an Observer event fires a subscribed job.
 *   B7  condition trigger: a polled predicate fires on the false→true edge.
 *   B8  delivery: a fired job lands on the Observer bus and in run history.
 *   B9  restart honesty: interrupted runs are marked, not silently dropped.
 *
 * node:sqlite is experimental on Node 22; when unavailable the store degrades
 * to memory and the persistence assertions skip honestly.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const {
  SchedulerEngine,
  registerCondition,
  _resetSchedulerForTests,
} = await import('../../src/scheduler/index.js');
const { parseCron, cronMatches, nextCronDate } = await import('../../src/scheduler/triggers/cron.js');
const { PriorityQueue } = await import('../../src/scheduler/queue/priority.js');
const { selectFairIndex, recordPick } = await import('../../src/scheduler/queue/fairness.js');
const { ConcurrencyPool } = await import('../../src/scheduler/execution/concurrent.js');
const { JobStore } = await import('../../src/scheduler/queue/store.js');
const { emit, _clear } = await import('../../src/services/Observer.js');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'agi-scheduler-'));

test('B1 — cron: parse, match, and next-fire', () => {
  const p = parseCron('*/15 9-17 * * 1-5');
  assert.deepEqual([...p.minute].sort((a, b) => a - b), [0, 15, 30, 45]);
  assert.deepEqual([...p.hour].sort((a, b) => a - b), [9, 10, 11, 12, 13, 14, 15, 16, 17]);

  assert.equal(cronMatches('* * * * *', new Date(2026, 0, 1, 0, 0)), true);
  assert.equal(cronMatches('30 8 * * *', new Date(2026, 0, 1, 8, 30)), true);
  assert.equal(cronMatches('30 8 * * *', new Date(2026, 0, 1, 8, 31)), false);

  // Every minute: next fire is the next minute boundary.
  const from = new Date(2026, 5, 10, 10, 30, 45);
  const next = nextCronDate('* * * * *', from);
  assert.equal(next.getMinutes(), 31);
  assert.equal(next.getSeconds(), 0);

  // 0 9 * * * → next 09:00 strictly after.
  const nine = nextCronDate('0 9 * * *', new Date(2026, 5, 10, 10, 0));
  assert.equal(nine.getDate(), 11);
  assert.equal(nine.getHours(), 9);
  assert.equal(nine.getMinutes(), 0);

  assert.throws(() => parseCron('* * *'), /5 fields/);
  assert.throws(() => parseCron('99 * * * *'), /out of range/);
  assert.throws(() => parseCron('* * * * 9'), /out of range/);
});

test('B2 — persistent queue survives a store reopen', () => {
  const file = path.join(TMP, 'persist.db');
  const a = new JobStore({ file });
  const persist = a.available;
  a.saveJob({ id: 'job-p', name: 'persist', kind: 'cron', cron: '*/5 * * * *', action: { type: 'emit' }, createdAt: Date.now() });
  const run = a.createRun({ jobId: 'job-p', trigger: 'cron' });
  a.finishRun(run.id, { status: 'completed', result: { ok: true } });
  a.close();

  const b = new JobStore({ file });
  assert.equal(b.getJob('job-p').cron, '*/5 * * * *');
  assert.equal(b.getRun(run.id).status, 'completed');
  assert.deepEqual(b.getRun(run.id).result, { ok: true });
  b.close();

  if (!persist) console.log('  (skip note) node:sqlite unavailable — memory fallback exercised only');
  assert.ok(true);
});

test('B3 — priority queue: higher first, FIFO on ties', () => {
  const q = new PriorityQueue();
  q.push('low', 1);
  q.push('high', 10);
  q.push('mid-a', 5);
  q.push('mid-b', 5);
  assert.equal(q.pop(), 'high');
  assert.equal(q.pop(), 'mid-a'); // tie → earliest submitted
  assert.equal(q.pop(), 'mid-b');
  assert.equal(q.pop(), 'low');
  assert.equal(q.size, 0);
});

test('B4 — fairness: no lane is starved', () => {
  const candidates = [
    { lane: 'hot', priority: 100 },
    { lane: 'hot', priority: 100 },
    { lane: 'hot', priority: 100 },
    { lane: 'cold', priority: 1 },
  ];
  const picks = new Map();
  const served = [];
  for (let i = 0; i < 4; i++) {
    const idx = selectFairIndex(candidates, { picks });
    served.push(candidates[idx].lane);
    recordPick(picks, candidates[idx].lane);
  }
  assert.ok(served.includes('cold'), `cold lane starved: ${served.join(',')}`);
});

test('B5 — concurrency pool never exceeds max', async () => {
  const pool = new ConcurrencyPool(3);
  let live = 0;
  let peak = 0;
  const task = async () => {
    live += 1;
    peak = Math.max(peak, live);
    await wait(20);
    live -= 1;
  };
  await Promise.all(Array.from({ length: 9 }, () => pool.run(task)));
  assert.equal(peak, 3);
  assert.equal(pool.stats().completed, 9);
  assert.equal(pool.stats().running, 0);
});

test('B6 — event trigger fires on an Observer event', async () => {
  _resetSchedulerForTests();
  _clear();
  const engine = new SchedulerEngine({ dbFile: ':memory:' });
  engine.start();
  const out = engine.createJob({
    name: 'on mission completed',
    kind: 'event',
    event: 'mission.completed',
    action: { type: 'emit', event: 'probe.event-fired' },
  });
  assert.ok(out.ok, out.error);
  emit('mission.completed', { missionId: 'm-1', summary: 'done' });
  await wait(120);
  const hist = engine.history({ limit: 5 });
  assert.equal(hist.counts.byStatus.completed, 1);
  assert.equal(hist.runs[0].trigger, 'event');
  engine.stop();
});

test('B7 — condition trigger fires on the false→true edge', async () => {
  _resetSchedulerForTests();
  let flag = false;
  const unreg = registerCondition('flag-true', async () => flag);
  const engine = new SchedulerEngine({ dbFile: ':memory:', tickMs: 50 });
  engine.start();
  const out = engine.createJob({
    name: 'when flag',
    kind: 'condition',
    condition: 'flag-true',
    intervalSeconds: 0.05,
    action: { type: 'emit', event: 'probe.condition-fired' },
  });
  assert.ok(out.ok, out.error);
  await wait(120);
  let hist = engine.history({ limit: 5 });
  assert.equal(hist.counts.runs, 0, 'fired while the predicate was false');

  flag = true;
  await wait(250);
  hist = engine.history({ limit: 5 });
  assert.ok(hist.counts.byStatus.completed >= 1, 'condition never fired after turning true');
  assert.equal(hist.runs[0].trigger, 'condition');
  engine.stop();
  unreg();
});

test('B8 — a fired job lands on the Observer bus and in run history', async () => {
  _resetSchedulerForTests();
  _clear();
  const engine = new SchedulerEngine({ dbFile: ':memory:' });
  engine.start();
  const out = engine.createJob({
    name: 'emit tick',
    kind: 'cron',
    cron: '* * * * *',
    action: { type: 'emit', event: 'probe.cron-fired' },
  });
  const run = engine.runNow(out.job.id);
  assert.ok(run.ok);
  await wait(150);

  const { recent } = await import('../../src/services/Observer.js');
  const fired = recent({ limit: 50, typePrefix: 'scheduler.job' });
  const types = fired.map((e) => e.type);
  assert.ok(types.includes('scheduler.job.completed'), `missing completion event: ${types.join(',')}`);
  assert.ok(recent({ limit: 50, typePrefix: 'probe.' }).some((e) => e.type === 'probe.cron-fired'), 'action event not emitted');

  const hist = engine.history({ limit: 5 });
  assert.equal(hist.counts.byStatus.completed, 1);
  assert.deepEqual(hist.runs[0].result, { emitted: 'probe.cron-fired', eventId: hist.runs[0].result.eventId });
  engine.stop();
});

test('B9 — restart honesty: interrupted runs are marked', () => {
  const file = path.join(TMP, 'interrupt.db');
  const a = new JobStore({ file });
  const run = a.createRun({ jobId: 'job-x', trigger: 'cron', status: 'running' });
  a.close();

  const b = new JobStore({ file });
  const n = b.recoverInterrupted();
  assert.ok(n >= 1, 'no interrupted run recovered');
  assert.equal(b.getRun(run.id).status, 'interrupted');
  b.close();
});

test('B10 — a failing action is recorded honestly, not swallowed', async () => {
  _resetSchedulerForTests();
  const engine = new SchedulerEngine({ dbFile: ':memory:' });
  engine.start();
  const out = engine.createJob({
    name: 'bad handler',
    kind: 'cron',
    cron: '* * * * *',
    action: { type: 'handler', name: 'does-not-exist' },
  });
  engine.runNow(out.job.id);
  await wait(120);
  const hist = engine.history({ limit: 5 });
  assert.equal(hist.counts.byStatus.failed, 1);
  assert.match(hist.runs[0].error, /no action handler registered/);
  engine.stop();
});