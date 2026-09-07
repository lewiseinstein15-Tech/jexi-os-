/**
 * ARENA REBUILD — Browser Router contracts (spec Part 17).
 *
 * The ROUTER is 100% real here. The WORKER is a test double (like the mock
 * Ollama server — you test the router's brain, not a real browser): in-test
 * workers implement the real protocol { id, kind, capabilities, online,
 * execute }. No real browser is needed or pretended in this sandbox.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'arena-br-'));
process.env.DATA_DIR = TMP; // isolate the audit log

const { browserRouter, registerDesktopWorker } = await import('../../src/services/BrowserRouter.js');

function cleanup() {
  for (const w of browserRouter.listWorkers()) browserRouter.unregisterWorker(w.id);
}

test('no worker connected → honest failure, never fake browsing', async () => {
  cleanup();
  const events = [];
  browserRouter.onEvent = (e, d) => events.push(e);
  const r = await browserRouter.runTask({ intent: 'navigate', url: 'https://example.com', reason: 'test honesty' });
  assert.equal(r.ok, false);
  assert.match(r.error, /No browser worker/i);
  assert.ok(events.includes('browser.unavailable'), 'the refusal is observable');
});

test('policy: CAPTCHA bypass is refused BEFORE any worker sees the task', async () => {
  cleanup();
  let executed = false;
  browserRouter.registerWorker({
    id: 'fake-desktop', kind: 'desktop', capabilities: ['navigate', 'read', 'act', 'screenshot'],
    online: () => true,
    execute: async () => { executed = true; return { ok: true, text: 'should never run' }; },
  });
  const r = await browserRouter.runTask({ intent: 'act', url: 'https://site.com', reason: 'solve the captcha on this page', params: { actions: [{ type: 'click', text: 'captcha' }] } });
  assert.equal(r.refused, true, 'refused by policy');
  assert.match(r.error, /CAPTCHA/i);
  assert.equal(executed, false, 'the worker NEVER ran — policy gates first');
});

test('policy: browser-private storage is never read or exported', async () => {
  cleanup();
  let executed = false;
  browserRouter.registerWorker({
    id: 'fake-2', kind: 'desktop', capabilities: ['navigate', 'read', 'act', 'screenshot'],
    online: () => true, execute: async () => { executed = true; return { ok: true }; },
  });
  for (const bad of [
    { intent: 'navigate', url: 'chrome://settings/passwords', reason: 'read saved passwords' },
    { intent: 'read', url: 'https://x.com', reason: 'export the cookies' },
    { intent: 'read', url: 'https://bank.com', reason: 'grab wallet credentials' },
  ]) {
    const r = await browserRouter.runTask(bad);
    assert.equal(r.refused, true, `must refuse: ${bad.reason}`);
  }
  assert.equal(executed, false, 'no worker ran for any private-storage task');
});

test('policy: high-impact actions need explicit authorization', async () => {
  cleanup();
  let executed = false;
  browserRouter.registerWorker({
    id: 'fake-3', kind: 'desktop', capabilities: ['navigate', 'act'],
    online: () => true, execute: async () => { executed = true; return { ok: true }; },
  });
  const refused = await browserRouter.runTask({ intent: 'act', url: 'https://shop.com', reason: 'complete the payment checkout', params: { actions: [{ type: 'click', text: 'Pay now' }] } });
  assert.equal(refused.refused, true, 'unauthorized payment action refused');
  assert.equal(refused.needsAuthorization, true);
  assert.equal(executed, false);
  const allowed = await browserRouter.runTask({ intent: 'act', url: 'https://shop.com', reason: 'complete the payment checkout', authorized: true, params: { actions: [{ type: 'click', text: 'Pay now' }] } });
  assert.equal(allowed.ok, true, 'with explicit authorization the task runs');
  assert.equal(executed, true);
});

test('capability routing: a task goes to a worker that can actually do it', async () => {
  cleanup();
  const calls = [];
  browserRouter.registerWorker({
    id: 'reader-only', kind: 'remote', capabilities: ['read'],
    online: () => true, execute: async (op) => { calls.push(['reader', op]); return { ok: true, text: 'page text' }; },
  });
  browserRouter.registerWorker({
    id: 'full-desktop', kind: 'desktop', capabilities: ['navigate', 'read', 'act', 'screenshot'],
    online: () => true, execute: async (op) => { calls.push(['desktop', op]); return { ok: true, note: 'done' }; },
  });
  const events = [];
  browserRouter.onEvent = (e) => events.push(e);

  const nav = await browserRouter.runTask({ intent: 'navigate', url: 'https://example.com', reason: 'test routing' });
  assert.equal(nav.ok, true);
  assert.deepEqual(calls[0], ['desktop', 'navigate'], 'desktop (full capabilities, local preference) takes the navigate task');

  const shot = await browserRouter.runTask({ intent: 'screenshot', url: 'https://example.com', reason: 'evidence shot' });
  assert.equal(shot.ok, true);
  assert.ok(calls.some((c) => c[0] === 'desktop' && c[1] === 'screenshot'), 'screenshot went to the capable worker');
  assert.ok(events.includes('browser.start') && events.includes('browser.done'), 'work is observable start→done');
});

test('an offline worker is skipped honestly (no zombie routing)', async () => {
  cleanup();
  browserRouter.registerWorker({
    id: 'dead-worker', kind: 'desktop', capabilities: ['navigate'],
    online: () => false, execute: async () => ({ ok: true, fake: true }),
  });
  const r = await browserRouter.runTask({ intent: 'navigate', url: 'https://example.com', reason: 'probe offline worker' });
  assert.equal(r.ok, false, 'the offline worker must not run');
  assert.match(r.error, /No online browser worker/i);
});

test('every task and refusal lands in the bounded audit log', async () => {
  cleanup();
  const entries = browserRouter.recentAudit(50);
  assert.ok(entries.length >= 3, `audit has the history from the tests above (${entries.length} entries)`);
  assert.ok(entries.some((e) => e.op === 'refused'), 'refusals are audited');
  assert.ok(entries.some((e) => e.op === 'task'), 'executed tasks are audited with worker + ms');
  assert.ok(entries.every((e) => e.at && e.reason), 'each entry is timestamped and carries the stated reason');
});

test('desktop worker registration is HONEST on a host with no browser', async () => {
  // This sandbox has no Chromium — registration must say so, not fake a worker.
  cleanup();
  const r = await registerDesktopWorker();
  if (r.ok) {
    // A browser exists on this host: then the worker must be genuinely registered and listed.
    const listed = browserRouter.listWorkers().find((w) => w.id === 'desktop-local');
    assert.ok(listed, 'registered worker is listed');
  } else {
    assert.equal(r.ok, false);
    assert.match(r.error, /No local browser|disabled on this host|unavailable/i);
    assert.ok(!browserRouter.listWorkers().some((w) => w.id === 'desktop-local'), 'no phantom worker registered');
  }
});

test.after?.(() => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* best effort */ } });
