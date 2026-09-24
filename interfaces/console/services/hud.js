/* hud.js — the console's ONLY state artery (Phase 7 F).
   The HUD status contract (jexi.hud-status.v1) is the single source of
   truth for every operational panel:

   - fetchHud()        GET  /api/hud          → one snapshot
   - useHudStream()    SSE  /api/hud/stream   → pushed on EVERY change
   - useHud()          read the shared HUD context (ConsoleApp provides it)

   Every payload passes the client-side refusal gate: missing or foreign
   `version` → the payload is refused and NEVER reaches a panel (the
   contract's P10 half). A refused or absent section renders as honest
   "no data" — panels never fabricate (P7). */

import { useEffect, useRef, useState } from 'react';
import { getBackendUrl, getSessionId } from '../utils/helpers';

export const HUD_VERSION = 'jexi.hud-status.v1';

/* ── refusal gate — the console only renders conforming payloads ─────── */
export function acceptHud(payload) {
  if (!payload || typeof payload !== 'object') {
    return { ok: false, error: 'refused: payload is not an object' };
  }
  if (!payload.version) {
    return { ok: false, error: 'refused: version key missing (contract jexi.hud-status.v1)' };
  }
  if (payload.version !== HUD_VERSION) {
    return { ok: false, error: `refused: version "${payload.version}" != "${HUD_VERSION}"` };
  }
  return { ok: true, hud: payload };
}

/* ── one-shot fetch of the current payload ───────────────────────────── */
export async function fetchHud(timeoutMs = 15000) {
  const base = getBackendUrl();
  if (!base) return { ok: false, error: 'No brain configured — set the Server address in the sidebar.' };
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(`${base}/api/hud`, {
      headers: { 'x-jexi-session': getSessionId() },
      signal: ctl.signal,
    });
    const body = await res.json().catch(() => null);
    if (!res.ok || !body || !body.ok) {
      return { ok: false, error: (body && body.error) || `HTTP ${res.status} on /api/hud` };
    }
    const v = acceptHud(body.hud);
    if (!v.ok) return v;
    return { ok: true, hud: v.hud, revision: body.revision, publishedAt: body.publishedAt };
  } catch (e) {
    return { ok: false, error: (e && e.message) || 'hud fetch failed' };
  } finally {
    clearTimeout(t);
  }
}

/* ── the live stream: SSE push on every change, polling fallback ───────
   One connection per console. Events: `ready` (handshake), `hud` (full
   payload per change), heartbeat comments every 15s keep it honest. Any
   stream failure degrades to a 10s GET /api/hud poll — same payload,
   same refusal gate, same panels. */
export function useHudStream() {
  const [hud, setHud] = useState(null);
  const [revision, setRevision] = useState(0);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState('');
  const pollRef = useRef(null);
  const esRef = useRef(null);
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    const base = getBackendUrl();
    let lastRev = 0;
    let gotAny = false;

    const apply = (payload, rev) => {
      const v = acceptHud(payload);
      if (!v.ok) { setError(v.error); return; } // refused payloads never touch panels
      if (!aliveRef.current) return;
      setError('');
      setHud(v.hud);
      if (rev) { setRevision(rev); lastRev = rev; }
      gotAny = true;
    };

    const startPolling = () => {
      if (pollRef.current || !aliveRef.current) return;
      pollRef.current = setInterval(async () => {
        const r = await fetchHud(10000);
        if (r.ok) { apply(r.hud, r.revision); setConnected(true); }
        else if (aliveRef.current) { setConnected(false); setError(r.error); }
      }, 10000);
    };
    const stopPolling = () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } };

    // immediate snapshot so panels paint before the first push
    fetchHud().then((r) => {
      if (!aliveRef.current) return;
      if (r.ok) { apply(r.hud, r.revision); setConnected(true); }
      else setError(r.error);
    });

    try {
      const es = new EventSource(`${base}/api/hud/stream`);
      esRef.current = es;
      es.addEventListener('ready', (ev) => {
        if (!aliveRef.current) return;
        try {
          const info = JSON.parse(ev.data);
          if (info.revision > lastRev) setRevision(info.revision);
        } catch { /* handshake is informational */ }
        setConnected(true);
      });
      es.addEventListener('hud', (ev) => {
        try { const p = JSON.parse(ev.data); apply(p, Number(ev.lastEventId) || 0); } catch { /* skip malformed frame */ }
      });
      es.onerror = () => {
        if (!aliveRef.current) return;
        setConnected(false);
        // EventSource retries natively; if it stays dark for 2 ticks, poll.
        setTimeout(() => { if (aliveRef.current && !gotAny && es.readyState !== 1) startPolling(); }, 10000);
      };
    } catch {
      startPolling(); // no EventSource in this environment
    }

    return () => {
      aliveRef.current = false;
      stopPolling();
      if (esRef.current) { esRef.current.close(); esRef.current = null; }
    };
  }, []);

  return { hud, revision, connected, error };
}
