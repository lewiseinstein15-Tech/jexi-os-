/**
 * B224 — Part 29: SSE PUSH for mission events.
 *
 * The browser opens one stream per open mission; the server tails the
 * append-only events.jsonl (1s) and pushes each new event. Native SSE
 * reconnect (Last-Event-ID) replays exactly the missed tail. The REST
 * polling fabric stays as the fallback (the spec permits it; the client
 * stretches its intervals while SSE is live).
 *
 * Extracted as a mountable handler so the chain can test the real wire
 * behavior on an ephemeral server (test-b224.js) — index.js mounts this
 * at GET /api/missions/:id/events/stream.
 */

import { loadMission, loadMissionEvents } from '../services/director/Mission.js';

const REPLAY_CAP = 300; // the design contract: keep 300
const PUSH_MS = Number(process.env.MISSION_SSE_PUSH_MS || 1000);
const HEARTBEAT_MS = Number(process.env.MISSION_SSE_HEARTBEAT_MS || 15000);

export function missionEventStream(req, res) {
  const m = loadMission(req.params.id);
  if (!m) return res.status(404).json({ ok: false, error: 'mission not found' });
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // proxies: do not buffer the stream
  });
  res.flushHeaders?.();
  let lastId = String(req.headers['last-event-id'] || req.query.sinceEventId || '');
  let replayed = 0;
  const send = (evt) => {
    if (evt && evt.id) lastId = evt.id;
    res.write(`id: ${evt.id}\nevent: mission-event\ndata: ${JSON.stringify(evt)}\n\n`);
  };
  // replay: bounded tail (first connect: last 300)
  try {
    let backlog = loadMissionEvents(m.id, lastId);
    if (!lastId && backlog.length > REPLAY_CAP) backlog = backlog.slice(-REPLAY_CAP);
    for (const e of backlog) { send(e); replayed++; }
  } catch { /* no events yet — fine */ }
  res.write(`event: ready\ndata: ${JSON.stringify({ missionId: m.id, lastId, replayed })}\n\n`);
  // the push loop: tail the append-only log; the client never polls
  const timer = setInterval(() => {
    try {
      for (const e of loadMissionEvents(m.id, lastId)) send(e);
    } catch { /* mission dir may be gone — heartbeat keeps the stream honest */ }
  }, PUSH_MS);
  // heartbeat so proxies do not idle the connection out
  const hb = setInterval(() => { try { res.write(': ping\n\n'); } catch { /* closed */ } }, HEARTBEAT_MS);
  req.on('close', () => { clearInterval(timer); clearInterval(hb); });
}
