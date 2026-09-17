/**
 * B231 / Phase 7 F — HUD transport: GET /api/hud + SSE GET /api/hud/stream.
 *
 * The HUD payload (events/hud/, contract jexi.hud-status.v1) is the single
 * source of truth for every console panel. This module is the wire: it
 * serves the current payload and pushes every change the moment the
 * producer publishes. Same SSE discipline as missionStream.js (B224):
 * native Last-Event-ID reconnect, heartbeat so proxies never idle out,
 * and cleanup on close.
 */

import { wireHud, currentPayload, subscribe, bindProducer, hudInfo, consume, snapshot as hudSnapshot } from '../../../events/hud/index.js';

const HEARTBEAT_MS = Number(process.env.HUD_SSE_HEARTBEAT_MS || 15000);

let bound = false;

export function mountHud(app) {
  if (!bound) { bindProducer(); bound = true; } // producer → consumer fan-out, once
  wireHud().catch(() => { /* cold boot without subsystems — GET retries */ });

  // GET /api/hud — the ONE state endpoint the console reads.
  app.get('/api/hud', async (req, res) => {
    try {
      const payload = await currentPayload();
      // Consumer-side gate: refuse anything that fails the contract (P10).
      consume(payload);
      res.setHeader('Cache-Control', 'no-store');
      const info = hudInfo();
      res.json({ ok: true, revision: info.revision, publishedAt: info.publishedAt, hud: payload });
    } catch (err) {
      const refused = err && err.code === 'HUD_REFUSED';
      res.status(refused ? 409 : 500).json({
        ok: false,
        error: refused ? 'hud payload refused by contract' : (err && err.message) || 'hud unavailable',
        code: err && err.code,
      });
    }
  });

  // GET /api/hud/stream — SSE: the current payload, then one push per change.
  app.get('/api/hud/stream', async (req, res) => {
    try {
      const payload = await currentPayload();
      consume(payload); // same refusal rule on the stream path
    } catch (err) {
      res.status(409).json({ ok: false, error: 'hud payload refused by contract', code: err && err.code });
      return;
    }
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // proxies: do not buffer the stream
    });
    res.flushHeaders?.();

    let lastRevision = Number(req.headers['last-event-id'] || req.query.sinceRevision || 0) || 0;
    const send = (revision, payload) => {
      lastRevision = revision;
      res.write(`id: ${revision}\nevent: hud\ndata: ${JSON.stringify(payload)}\n\n`);
    };

    const info = hudInfo();
    res.write(`event: ready\ndata: ${JSON.stringify({ version: info.version, revision: info.revision, subscribers: info.subscribers })}\n\n`);
    // replay the current payload when the client is fresh or behind
    if (info.revision > lastRevision) {
      const current = hudSnapshot().payload;
      if (current) send(info.revision, current);
    }

    const unsub = subscribe((revision, payload) => {
      try { if (revision > lastRevision) send(revision, payload); } catch { /* closed */ }
    });
    const hb = setInterval(() => { try { res.write(': ping\n\n'); } catch { /* closed */ } }, HEARTBEAT_MS);
    req.on('close', () => { clearInterval(hb); unsub(); });
  });
}
