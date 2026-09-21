/**
 * Phase 24 Scope B — chat mount layer.
 *
 * Wires the Phase 16 runtime (ui/web/console/chat/runtime.js + router.js +
 * rows/) into a DOM element. The runtime is consumed, NEVER modified:
 * mount() subscribes to the router and renders rows from REAL taxonomy
 * events produced by runtime.send().
 *
 * Contract:
 *   mount(el, { sessionId, backendUrl }) -> { unmount, send(text), mode(m), mode() }
 */
import { createRoot } from 'react-dom/client';
import { createElement as h } from 'react';
import * as runtime from './runtime.js';
import { router } from './router.js';
import rows from './rows/index.js';
import Transcript from './Transcript.jsx';
import Composer from './Composer.jsx';
import './mount.css';

export function mount(el, opts = {}) {
  const sessionId = opts.sessionId || 'console-main';
  const backendUrl = opts.backendUrl || '/api/health';

  const store = {
    rows: [],
    backend: 'checking', // checking | online | offline
    turn: 'idle',
    modes: null,
    lastError: null,
  };

  // One router subscription: every routed taxonomy event becomes a row.
  const unsubscribe = router.subscribe(sessionId, (envelope) => {
    const ev = envelope.event || {};
    let rendered = null;
    try {
      rendered = rows.render(ev);
    } catch {
      rendered = { rowType: 'text', content: JSON.stringify(ev).slice(0, 400) };
    }
    store.rows.push({
      seq: envelope.seq,
      turnId: envelope.turnId,
      type: ev.type,
      rowType: rendered.rowType,
      content: rendered.content,
      refused: !!envelope.refused,
      refuseReason: (envelope.modes && envelope.modes.reason) || null,
      approvalId: (ev.payload && ev.payload.approvalId) || null,
    });
    store.turn = runtime.state(sessionId).status;
    paint();
  });

  function refreshMeta() {
    const st = runtime.state(sessionId);
    store.turn = st.status;
    store.modes = st.modes;
    paint();
  }

  // Backend liveness probe (real fetch; composer surfaces offline honestly).
  let alive = true;
  let probeTimer = null;
  async function probe() {
    if (!alive) return;
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 2500);
      const r = await fetch(backendUrl, { signal: ctrl.signal });
      clearTimeout(t);
      store.backend = r.ok ? 'online' : 'offline';
    } catch {
      store.backend = 'offline';
    }
    paint();
    probeTimer = setTimeout(probe, 5000);
  }

  const root = createRoot(el);
  function paint() {
    if (!alive) return;
    root.render(
      h('div', { className: 'p24-chat' },
        h(Transcript, { rows: store.rows, onApprove: (id, d) => api.approve(id, d) }),
        h(Composer, {
          backend: store.backend,
          turn: store.turn,
          modes: store.modes,
          lastError: store.lastError,
          onSend: (text) => api.send(text),
          onMode: (m) => api.mode(m),
        })
      )
    );
  }

  const api = {
    send(text) {
      store.lastError = null;
      try {
        const res = runtime.send(sessionId, text);
        refreshMeta();
        return res;
      } catch (e) {
        store.lastError = (e && e.code) || 'E_SEND_FAILED';
        store.rows.push({
          seq: -1,
          type: 'local.error',
          rowType: 'turn-end-fail',
          content: `${store.lastError}: ${(e && e.message) || e}`,
          refused: false,
          refuseReason: null,
        });
        refreshMeta();
        return null;
      }
    },
    approve(approvalId, decision) {
      try {
        const out = runtime.approve(sessionId, approvalId, decision);
        refreshMeta();
        return out;
      } catch (e) {
        store.lastError = (e && e.code) || 'E_APPROVAL_FAILED';
        refreshMeta();
        return null;
      }
    },
    mode(m) {
      if (m === undefined) return runtime.state(sessionId).modes;
      const patch = typeof m === 'string' ? { interactionMode: m } : m;
      const out = runtime.mode(sessionId, patch);
      refreshMeta();
      return out.modes;
    },
    unmount() {
      alive = false;
      if (probeTimer) clearTimeout(probeTimer);
      unsubscribe();
      root.unmount();
    },
  };

  refreshMeta();
  probe();
  paint();
  return api;
}

export default mount;
