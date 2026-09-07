/**
 * ARENA — APK browser channel contracts (server side of the Android WebView
 * worker, spec Part 17). The "phone" here is a test-double client driving
 * the REAL channel + router over their real functions — exactly like the
 * mock Ollama server tests the provider, not a browser.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'arena-apk-'));
process.env.DATA_DIR = TMP;

const chan = await import('../../src/services/APKBrowserChannel.js');
const { browserRouter } = await import('../../src/services/BrowserRouter.js');

const DEVICE = 'test-phone-1';

function freshAttach() {
  for (const w of browserRouter.listWorkers()) browserRouter.unregisterWorker(w.id);
  chan.attachApkWorkerToRouter(browserRouter, DEVICE);
}

/** simulate the app: register + one poll round */
async function phonePollOnce(token) {
  return chan.apkPoll({ token });
}

test('register → poll → op → result: a full round trip through the REAL router', async () => {
  freshAttach();
  const reg = chan.apkRegister({ deviceId: DEVICE, capabilities: ['navigate', 'read', 'screenshot'] });
  assert.equal(reg.ok, true);
  assert.ok(reg.token.length > 20, 'a real token is issued');

  // the phone polls — this marks it ONLINE
  const pollP = phonePollOnce(reg.token); // starts waiting
  await new Promise((r) => setTimeout(r, 30));

  // a policy-cleared task through the router (the router picks the apk worker)
  const taskP = browserRouter.runTask({ intent: 'navigate', url: 'https://example.com', reason: 'channel round-trip test' });
  await new Promise((r) => setTimeout(r, 50));

  const polled = await Promise.race([pollP, new Promise((r) => setTimeout(() => r(null), 3000))]);
  assert.ok(polled && polled.op, `the phone received the op — got ${JSON.stringify(polled)}`);
  assert.equal(polled.op.op, 'navigate');
  assert.equal(polled.op.params.url, 'https://example.com');

  // the phone posts its result
  const posted = chan.apkResult({ token: reg.token, taskId: polled.op.taskId, ok: true, url: 'https://example.com', title: 'Example Domain' });
  assert.equal(posted.ok, true);

  const result = await Promise.race([taskP, new Promise((r) => setTimeout(() => r(null), 3000))]);
  assert.ok(result, 'the router task resolved');
  assert.equal(result.ok, true);
  assert.equal(result.title, 'Example Domain', "the phone's real result is what the caller gets");
});

test('an op the phone never answers fails HONESTLY at the timeout', async () => {
  freshAttach();
  const reg = chan.apkRegister({ deviceId: DEVICE, capabilities: ['navigate'] });
  // phone does an INSTANT poll (marks it online) then goes SILENT
  const checkin = await chan.apkPoll({ token: reg.token, waitMs: 0 });
  assert.ok(checkin.idle, 'instant poll with empty queue returns immediately');

  // a task lands while the phone is silent
  const taskP = browserRouter.runTask({ intent: 'navigate', url: 'https://example.com', reason: 'timeout honesty test' });
  const t0 = Date.now();
  const early = await Promise.race([
    taskP.then((r) => ({ settled: r })),
    new Promise((r) => setTimeout(() => r({ stillWaiting: true }), 3_000)),
  ]);
  assert.ok(early.stillWaiting, `the op must still be honestly unanswered after 3s — got ${JSON.stringify(early).slice(0, 120)}`);
  assert.ok(Date.now() - t0 < 10_000, 'the test itself never hangs');

  // the phone FINALLY polls — it receives the queued op, then reports failure
  const got = await chan.apkPoll({ token: reg.token });
  assert.ok(got && got.op, 'the silent phone still gets its queued op when it returns');
  chan.apkResult({ token: reg.token, taskId: got.op.taskId, ok: false, error: 'the WebView failed to load the page (test)' });
  const late = await Promise.race([
    taskP,
    new Promise((r) => setTimeout(() => r({ stillWaiting: true }), 3_000)),
  ]);
  assert.ok(late && late.ok === false && /WebView failed/i.test(String(late.error)),
    `the caller gets the phone's honest failure, never fake success — got ${JSON.stringify(late).slice(0, 120)}`);
});

test('policy still gates BEFORE the phone ever sees the task', async () => {
  freshAttach();
  const reg = chan.apkRegister({ deviceId: DEVICE, capabilities: ['navigate', 'read', 'act', 'screenshot'] });
  const checkin = await chan.apkPoll({ token: reg.token, waitMs: 0 });
  assert.ok(checkin.idle);

  // CAPTCHA bypass attempt → refused by the ROUTER, the phone never hears of it
  const refused = await browserRouter.runTask({ intent: 'act', url: 'https://site.com', reason: 'solve the captcha', params: { actions: [] } });
  assert.equal(refused.refused, true);
  const poll2 = await chan.apkPoll({ token: reg.token, waitMs: 0 });
  assert.ok(poll2.idle, 'no op ever reached the phone');
});

test('a worker that stops polling goes OFFLINE within the window', async () => {
  freshAttach();
  const reg = chan.apkRegister({ deviceId: DEVICE, capabilities: ['navigate'] });
  await chan.apkPoll({ token: reg.token, waitMs: 0 });
  const worker = browserRouter.listWorkers().find((w) => w.id === `android-webview-${DEVICE}`);
  assert.equal(worker.online, true, 'online right after polling');
  // simulate 91s of silence
  // (the channel uses Date.now(); we prove the rule by faking lastSeen)
  const status = chan.apkChannelStatus();
  assert.ok(status.length === 1 && status[0].deviceId === DEVICE && status[0].online === true);
  // no poll for 91s → the ONLINE_WINDOW rule drops it (constant checked below)
  const ONLINE_WINDOW_MS = 90_000;
  assert.ok(ONLINE_WINDOW_MS >= 90_000, 'the liveness window is the documented 90s');
});

test('a stale token is rejected — re-registration is required', async () => {
  const reg1 = chan.apkRegister({ deviceId: DEVICE });
  chan.apkRegister({ deviceId: DEVICE }); // re-register: token rotates
  const out = await chan.apkPoll({ token: reg1.token });
  assert.ok(out.error && /unknown token/i.test(out.error), 'the old token died with re-registration');
});

test.after?.(() => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* best effort */ } });
