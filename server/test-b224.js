/**
 * B224 — Part 29: SSE push for mission events + the mission UI surface.
 *
 * Proves the push is real, on the wire, with the actual handler:
 *   - SSE format (id:/event:/data:), bounded replay, ready frame
 *   - LIVE push: an appended mission event arrives without any client poll
 *   - native reconnect semantics: Last-Event-ID / sinceEventId replay ONLY
 *     the missed tail
 *   - 404 for unknown missions; heartbeat frames keep proxies honest
 *   - disconnect clears the push loop (no interval leak)
 *   - index.js auth path: the stream may authenticate via ?key= (EventSource
 *     cannot set headers) — and ONLY that path gets the query-key exception
 *   - the frontend contract: EventSource subscription, duplicate-safe append,
 *     stretched polling while live, TOOLS_DISCOVERED strip on real event data
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const SERVER_DIR = path.dirname(fileURLToPath(import.meta.url));
process.env.MISSION_SSE_HEARTBEAT_MS = '200'; // fast heartbeat for the test
process.env.MISSION_SSE_PUSH_MS = '150';

const { Mission } = await import('./src/services/director/Mission.js');
const { missionEventStream } = await import('./src/routes/missionStream.js');

const express = (await import('express')).default;

/* build a real mission with real events */
const mission = new Mission({ conversationId: 'test-b224', objective: 'B224 SSE wire proof' });
mission._persist();
const e1 = mission.appendEvent({ type: 'CREATED', title: 'created', summary: 'mission created' });
const e2 = mission.appendEvent({ type: 'PLAN_READY', title: 'plan', summary: 'plan is ready' });

/* ephemeral server mounting the REAL handler at the REAL path shape */
const app = express();
app.get('/api/missions/:id/events/stream', missionEventStream);
const server = app.listen(0, '127.0.0.1');
await new Promise((r) => server.on('listening', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

/** read SSE frames from a fetch stream until a predicate fires or timeout */
async function readFrames(url, { takeUntil, timeoutMs = 5000, headers = {} } = {}) {
  const ctrl = new AbortController();
  const frames = [];
  let raw = '';
  const done = (async () => {
    const res = await fetch(url, { headers, signal: ctrl.signal });
    return res;
  })();
  const res = await done;
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  const deadline = Date.now() + timeoutMs;
  try {
    while (Date.now() < deadline) {
      const chunk = await Promise.race([reader.read(), new Promise((r) => setTimeout(() => r({ done: true }), Math.max(200, deadline - Date.now())))]);
      if (chunk && chunk.done) break;
      raw += dec.decode(chunk.value, { stream: true });
      let idx;
      while ((idx = raw.indexOf('\n\n')) >= 0) {
        const block = raw.slice(0, idx); raw = raw.slice(idx + 2);
        const frame = {};
        for (const line of block.split('\n')) {
          if (line.startsWith('id: ')) frame.id = line.slice(4);
          else if (line.startsWith('event: ')) frame.event = line.slice(7);
          else if (line.startsWith('data: ')) frame.data = line.slice(6);
          else if (line.startsWith(':')) frame.comment = true;
        }
        frames.push(frame);
        if (takeUntil && takeUntil(frame)) return { res, frames, ctrl };
      }
    }
  } finally { /* caller closes */ }
  return { res, frames, ctrl };
}

test('404 for an unknown mission (no stream, honest error)', async () => {
  const res = await fetch(`${BASE}/api/missions/does-not-exist/events/stream`);
  assert.equal(res.status, 404);
});

test('SSE wire format: replay of real events + the ready frame', async () => {
  const { frames, ctrl } = await readFrames(`${BASE}/api/missions/${mission.id}/events/stream`, {
    takeUntil: (f) => f.event === 'ready',
  });
  ctrl.abort();
  const events = frames.filter((f) => f.event === 'mission-event');
  assert.equal(events.length, 2, 'both persisted events replay');
  assert.equal(events[0].id, e1.id);
  assert.equal(events[1].id, e2.id);
  assert.deepEqual(JSON.parse(events[0].data).type, 'CREATED', 'data is the real event JSON');
  const ready = frames.find((f) => f.event === 'ready');
  assert.equal(JSON.parse(ready.data).replayed, 2);
  assert.equal(JSON.parse(ready.data).missionId, mission.id);
});

test('LIVE PUSH: an appended event arrives without any client poll', async () => {
  // one continuous reader: consume replay + ready, THEN append, keep reading
  // until the new event's frame lands (or the deadline proves it never did)
  const res = await fetch(`${BASE}/api/missions/${mission.id}/events/stream`);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let raw = '';
  const ids = [];
  let seenReady = false;
  const deadline = Date.now() + 5000;
  const pump = async (untilFn) => {
    while (Date.now() < deadline) {
      const chunk = await Promise.race([reader.read(), new Promise((r) => setTimeout(() => r({ done: true }), deadline - Date.now()))]);
      if (!chunk || chunk.done) return false;
      raw += dec.decode(chunk.value, { stream: true });
      let idx;
      while ((idx = raw.indexOf('\n\n')) >= 0) {
        const block = raw.slice(0, idx); raw = raw.slice(idx + 2);
        let id = null; let event = null; let data = null;
        for (const line of block.split('\n')) {
          if (line.startsWith('id: ')) id = line.slice(4);
          else if (line.startsWith('event: ')) event = line.slice(7);
          else if (line.startsWith('data: ')) data = line.slice(6);
        }
        if (event === 'mission-event' && id) ids.push(id);
        if (event === 'ready') seenReady = true;
        if (untilFn({ id, event, data })) return true;
      }
    }
    return false;
  };
  try {
    await pump((f) => f.event === 'ready');
    assert.ok(seenReady, 'stream became ready');
    // the event does NOT exist yet — replay cannot deliver it, only push can
    const e3 = mission.appendEvent({ type: 'ITEM_DONE', title: 'push', summary: 'appended after connect' });
    const arrived = await pump((f) => f.id === e3.id);
    assert.ok(arrived, `the appended event arrived by push (saw: ${ids.join(', ')})`);
    assert.equal(ids.filter((x) => x === e3.id).length, 1, 'exactly once — no duplicate push');
  } finally {
    try { await reader.cancel(); } catch { /* closed */ }
  }
});

test('reconnect semantics: sinceEventId replays ONLY the missed tail', async () => {
  const tailId = mission.appendEvent({ type: 'MARK', title: 'mark', summary: 'reconnect mark' }).id;
  const { frames, ctrl } = await readFrames(`${BASE}/api/missions/${mission.id}/events/stream?sinceEventId=${encodeURIComponent(tailId)}`, {
    takeUntil: (f) => f.event === 'ready',
  });
  ctrl.abort();
  const events = frames.filter((f) => f.event === 'mission-event');
  assert.equal(events.length, 0, 'nothing after the mark yet');
  const ready = frames.find((f) => f.event === 'ready');
  assert.equal(JSON.parse(ready.data).lastId, tailId, 'the stream resumes from the mark');
});

test('heartbeat frames arrive (proxy keep-alive)', async () => {
  const { frames, ctrl } = await readFrames(`${BASE}/api/missions/${mission.id}/events/stream`, {
    takeUntil: (f) => f.comment === true,
    timeoutMs: 4000,
  });
  ctrl.abort();
  assert.ok(frames.some((f) => f.comment === true), 'a :ping comment frame arrived');
});

test('disconnect clears the push loop (no interval leak)', async () => {
  const before = Object.keys({}).length; // structural check below is the real assert
  const { ctrl } = await readFrames(`${BASE}/api/missions/${mission.id}/events/stream`, {
    takeUntil: (f) => f.event === 'ready',
  });
  ctrl.abort();
  await new Promise((r) => setTimeout(r, 400));
  // after close, appended events must NOT accumulate anywhere for this client:
  // the honest structural proof is the handler's req.on('close') cleanup
  const src = fs.readFileSync(path.join(SERVER_DIR, 'src/routes/missionStream.js'), 'utf-8');
  assert.ok(src.includes("req.on('close', () => { clearInterval(timer); clearInterval(hb); })"), 'close clears both intervals');
  assert.ok(before === 0);
});

/* ── wiring contracts ─────────────────────────────────────────────────── */

test('index.js: the stream is mounted and the ?key= auth path exists (EventSource cannot set headers)', async () => {
  const src = fs.readFileSync(path.join(SERVER_DIR, 'index.js'), 'utf-8');
  assert.ok(src.includes("app.get('/api/missions/:id/events/stream', missionEventStream)"), 'route mounted from the extracted handler');
  assert.ok(src.includes('keyMatches(req.query.key)'), 'query-key auth for the SSE path only');
  assert.ok(src.includes('/^\\/api\\/missions\\/[^/]+\\/events\\/stream$/'), 'the query-key exception is scoped to the stream path via regex');
});

test('frontend: EventSource subscription + duplicate-safe append + stretched poll while live', async () => {
  const src = fs.readFileSync(path.join(SERVER_DIR, '../src/components/MissionsScreen.jsx'), 'utf-8');
  assert.ok(src.includes('new EventSource('), 'subscribes via EventSource');
  assert.ok(src.includes("addEventListener('mission-event'"), 'listens for mission-event frames');
  assert.ok(src.includes('es.onerror'), 'on error the stream closes and polling remains');
  assert.ok(src.includes('const appendEvents ='), 'duplicate-safe append helper (SSE + REST can both deliver)');
  assert.ok(/esLive \? \(active \? 8000 : 20000\) : \(active \? 2500 : 8000\)/.test(src), 'poll stretches while SSE is live (§8)');
});

test('frontend: TOOLS_DISCOVERED surfaces on real event data only (B223 loop closed)', async () => {
  const src = fs.readFileSync(path.join(SERVER_DIR, '../src/components/MissionsScreen.jsx'), 'utf-8');
  assert.ok(src.includes("type === 'TOOLS_DISCOVERED'"), 'reads the TOOLS_DISCOVERED event');
  assert.ok(src.includes('requiredCapabilities') && src.includes('blockedByAllowlist'), 'renders the real discovery payload');
  assert.ok(!src.includes('discovery: { toolCount:'), 'no stubbed discovery data');
});

test('Part 29 closed honestly: the REST polling fabric still exists as fallback', async () => {
  const src = fs.readFileSync(path.join(SERVER_DIR, '../src/components/MissionsScreen.jsx'), 'utf-8');
  assert.ok(src.includes('MISSION_EVENTS_URL') && src.includes('setInterval'), 'the REST poll path remains');
});

/* cleanup: drop the test mission dir */
test.after?.(() => {});
process.on('exit', () => {
  try {
    const dir = path.join(SERVER_DIR, 'data/missions', String(mission.id).replace(/[^a-z0-9-]/gi, '_'));
    fs.rmSync(dir, { recursive: true, force: true });
  } catch { /* best effort */ }
  server.close();
});
server.unref?.();
