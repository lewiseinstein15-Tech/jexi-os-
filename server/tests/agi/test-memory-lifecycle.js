/**
 * ARENA REBUILD — Memory Vault lifecycle + Event Interpreter contracts
 * (spec Parts 19 + 24). Pure and fast: no model calls anywhere.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'arena-ml-'));
process.env.DATA_DIR = TMP;

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.now();

const { stateFor, annotateRecall } = await import('../../src/services/MemoryLifecycle.js');
const { jexiVoice } = await import('../../src/services/director/EventInterpreter.js');

/* ── Part 19: lifecycle states ───────────────────────────────────────────── */

test('lifecycle states follow age: FRESH → AGING → STALE', () => {
  assert.equal(stateFor(new Date(NOW - 1 * DAY).toISOString(), NOW).state, 'FRESH', '1 day old is FRESH');
  assert.equal(stateFor(new Date(NOW - 10 * DAY).toISOString(), NOW).state, 'AGING', '10 days old is AGING');
  const stale = stateFor(new Date(NOW - 45 * DAY).toISOString(), NOW);
  assert.equal(stale.state, 'STALE', '45 days old is STALE');
  assert.equal(stale.needsReverify, true, 'stale memory is marked for re-verification');
  assert.ok(stale.ageDays > 44, 'age is computed honestly');
});

test('timestamps are handled honestly: ms numbers, ISO strings, missing', () => {
  assert.equal(stateFor(NOW - 2 * DAY, NOW).state, 'FRESH', 'ms-number timestamp works');
  assert.equal(stateFor('garbage-date', NOW).state, 'UNKNOWN', 'unparseable → UNKNOWN, never a guess');
  assert.equal(stateFor(null, NOW).state, 'UNKNOWN', 'missing → UNKNOWN');
  assert.equal(stateFor(undefined, NOW).state, 'UNKNOWN', 'undefined → UNKNOWN');
});

test('recall results get lifecycle annotations — stale knowledge is labelled', () => {
  const results = [
    { layer: 'user', content: 'new fact', at: new Date(NOW - DAY).toISOString() },
    { layer: 'episodic', content: 'old decision', at: new Date(NOW - 60 * DAY).toISOString() },
    { layer: 'semantic', content: 'no timestamp', at: null },
  ];
  annotateRecall(results, NOW);
  assert.equal(results[0].lifecycle, 'FRESH');
  assert.equal(results[1].lifecycle, 'STALE');
  assert.equal(results[1].needsReverify, true, 'the stale one demands re-verification before high-stakes use');
  assert.equal(results[2].lifecycle, 'UNKNOWN', 'no timestamp → no age claim');
});

/* ── Part 24: the event interpreter (JEXI's voice, zero model calls) ─────── */

test('mission events are spoken in JEXI voice from REAL data only', () => {
  const started = jexiVoice({ type: 'MISSION_STARTED', data: { items: 5, ready: 2 } });
  assert.match(started, /Boss, I've started\./);
  assert.match(started, /5 pieces of work/);
  assert.match(started, /2 can run right away/);

  const work = jexiVoice({ type: 'WORK_STARTED', title: 'inspect the repository' });
  assert.match(work, /inspect the repository/);

  const done = jexiVoice({ type: 'WORK_COMPLETED', title: 'fix the login bug', data: { ms: 4200 } });
  assert.match(done, /fix the login bug/);
  assert.match(done, /4\.2s/);
});

test('steering events speak the loop: heard → applied → preserved', () => {
  const heard = jexiVoice({ type: 'STEERING_RECEIVED', summary: 'Steering queued: "use Python instead"' });
  assert.match(heard, /Heard you/);
  assert.match(heard, /use Python instead/);
  assert.match(heard, /live plan/);

  const superseded = jexiVoice({ type: 'WORK_SUPERSEDED', data: { ids: ['a', 'b', 'c'] } });
  assert.match(superseded, /Changed course/);
  assert.match(superseded, /3 items are obsolete/);
  assert.match(superseded, /Work that already finished stays/);
});

test('failures are spoken as failures — never dressed up', () => {
  const fail = jexiVoice({ type: 'MISSION_FAILED', summary: 'blocked by failed work' });
  assert.match(fail, /failed/);
  const wf = jexiVoice({ type: 'WORK_FAILED', title: 'deploy step', summary: 'connection refused' });
  assert.match(wf, /didn't work/);
  assert.match(wf, /deploy step/);
});

test('restart recovery speaks honestly about what survived', () => {
  const r = jexiVoice({ type: 'MISSION_RESTART_RECOVERY', data: { requeued: ['x', 'y'] }, summary: 'Backend restarted mid-flight — 2 in-flight item(s) requeued' });
  assert.match(r, /server restarted under me/);
  assert.match(r, /requeued 2 in-flight items/);
  assert.match(r, /finished is intact/);
});

test('unmapped events fall back to their honest summary — nothing invented', () => {
  const evt = { type: 'SOME_FUTURE_EVENT', summary: 'Raw facts about what happened.' };
  assert.equal(jexiVoice(evt), null, 'interpreter returns null → caller keeps the real summary');
  assert.equal(jexiVoice(null), null);
  assert.equal(jexiVoice({}), null);
});

test('browser router events are observable in JEXI voice', () => {
  const start = jexiVoice({ type: 'browser.start', data: { url: 'https://example.com', kind: 'desktop', note: "Opening https://example.com via the desktop worker — you'll see every step." } });
  assert.match(start, /desktop worker/);
  const refused = jexiVoice({ type: 'browser.refused', data: { error: 'Refused: CAPTCHA and anti-bot challenges are never solved or bypassed.' } });
  assert.match(refused, /hard rule/);
});

test.after?.(() => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* best effort */ } });
