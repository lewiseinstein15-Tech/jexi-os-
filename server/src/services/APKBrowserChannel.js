/**
 * ARENA — APK BROWSER CHANNEL (server side of spec Part 17's Android worker).
 *
 * Lets the JEXI Android app register its own WebView as a REAL browser
 * worker with the BrowserRouter. The app side is a future APK build — this
 * is the live, tested server contract it will plug into:
 *
 *   POST /api/browser/apk/register { deviceId, capabilities? }  → { ok, token }
 *   POST /api/browser/apk/poll    { token }   → an op to run (held open up
 *                                               to ~25s; 204 when idle)
 *   POST /api/browser/apk/result  { token, taskId, ok, ...payload } → { ok }
 *
 * Safety: the BrowserRouter's policy gate runs BEFORE any op reaches the
 * app (CAPTCHA never bypassed, private storage never read, high-impact
 * actions need Lewis's explicit authorization). The channel adds no
 * privileges — it only transports policy-cleared work to the phone.
 *
 * Liveness: a worker is "online" while it polls at least every 90s; miss
 * that and it drops off the router until it polls again. No zombie workers.
 */
import crypto from 'node:crypto';

const POLL_HOLD_MS = 25_000; // long-poll window
const OP_TIMEOUT_MS = 60_000; // an op the app accepted but never answered
const ONLINE_WINDOW_MS = 90_000; // no poll in this window → offline

/* deviceId → { token, capabilities, lastSeen, queue: [op], waiters: [fn], inflight: Map } */
const devices = new Map();

function deviceKey(token) {
  for (const d of devices.values()) if (d.token === token) return d;
  return null;
}

export function apkChannelStatus() {
  return [...devices.values()].map((d) => ({
    deviceId: d.deviceId,
    online: Date.now() - d.lastSeen < ONLINE_WINDOW_MS,
    capabilities: d.capabilities,
    waitingOps: d.waiters.length,
    registeredAt: d.registeredAt,
  }));
}

/** Register (or re-register) the phone's WebView worker. Idempotent. */
export function apkRegister({ deviceId, capabilities } = {}) {
  const id = String(deviceId || '').trim().slice(0, 80) || `apk-${crypto.randomBytes(4).toString('hex')}`;
  const caps = Array.isArray(capabilities) && capabilities.length
    ? capabilities.map((c) => String(c).slice(0, 30)).slice(0, 8)
    : ['navigate', 'read', 'act', 'screenshot'];
  let d = devices.get(id);
  const token = crypto.randomBytes(16).toString('hex');
  if (!d) {
    d = { deviceId: id, token, capabilities: caps, lastSeen: 0, registeredAt: new Date().toISOString(), queue: [], waiters: [], inflight: new Map() };
    devices.set(id, d);
  } else {
    d.token = token; // fresh token per registration (old token dies with it)
    d.capabilities = caps;
  }
  return { ok: true, deviceId: id, token, pollHoldMs: POLL_HOLD_MS, opTimeoutMs: OP_TIMEOUT_MS };
}

/** The app long-polls for work. Resolves with an op, or null after the hold. */
export async function apkPoll({ token, waitMs } = {}, { onWait = () => {} } = {}) {
  const d = deviceKey(String(token || ''));
  if (!d) return { error: 'unknown token — register again' };
  d.lastSeen = Date.now();
  // work queued while the phone was between polls? deliver it NOW — a poll
  // must never miss an op that arrived before it started waiting.
  if (d.queue.length) {
    const immediate = d.queue.shift();
    return { op: { taskId: immediate.taskId, op: immediate.op, params: immediate.params } };
  }
  const holdMs = Math.max(0, Math.min(Number(waitMs ?? POLL_HOLD_MS), POLL_HOLD_MS)); // 0 = instant check-in
  const op = await new Promise((resolve) => {
    if (holdMs === 0) { resolve(null); return; } // quick poll: check the queue, never hold the line — and NEVER register a waiter (a dead waiter would later steal a queued op)
    const timer = setTimeout(() => resolve(null), holdMs);
    timer.unref?.();
    d.waiters.push(() => { clearTimeout(timer); resolve(d.queue.shift() || null); });
    onWait();
  });
  if (op) return { op: { taskId: op.taskId, op: op.op, params: op.params } };
  return { idle: true }; // nothing to do — poll again
}

/** The app posts a result for an op it ran. */
export function apkResult({ token, taskId, ok = true, ...payload } = {}) {
  const d = deviceKey(String(token || ''));
  if (!d) return { error: 'unknown token' };
  const task = d.inflight.get(String(taskId));
  if (!task) return { error: `no inflight op ${taskId}` };
  d.inflight.delete(String(taskId));
  clearTimeout(task.timer);
  task.resolve({ ok: ok !== false, ...payload });
  return { ok: true };
}

/** Wire the channel into the BrowserRouter as a live android-webview worker. */
export function attachApkWorkerToRouter(browserRouter, deviceId = 'apk-webview') {
  if (!devices.has(deviceId)) apkRegister({ deviceId });
  const d = devices.get(deviceId);
  browserRouter.registerWorker({
    id: `android-webview-${deviceId}`,
    kind: 'android', // ranks after desktop, before remote
    capabilities: d.capabilities,
    online: () => Boolean(d) && Date.now() - d.lastSeen < ONLINE_WINDOW_MS,
    execute: (op, params) => new Promise((resolve) => {
      const taskId = crypto.randomBytes(6).toString('hex');
      const timer = setTimeout(() => {
        d.inflight.delete(taskId);
        resolve({ ok: false, error: `the phone did not answer op "${op}" within ${OP_TIMEOUT_MS / 1000}s — reported honestly, nothing faked` });
      }, OP_TIMEOUT_MS);
      timer.unref?.();
      d.inflight.set(taskId, { resolve, timer });
      d.queue.push({ taskId, op, params });
      // wake ONE waiting poller (the first in line)
      const wake = d.waiters.shift();
      if (wake) wake();
    }),
  });
  return { ok: true, workerId: `android-webview-${deviceId}` };
}
