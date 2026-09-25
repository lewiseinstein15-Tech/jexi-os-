/**
 * Phase 24 Scope B — chat mount layer.
 *
 * Wires the Phase 16 runtime (ui/web/console/chat/runtime.js + router.js +
 * rows/) into a DOM element. The runtime is consumed, NEVER modified:
 * mount() subscribes to the router and renders rows from REAL taxonomy
 * events produced by runtime.send().
 *
 * PHASE 31 Scope 2 (WA6 + S2-COMP) — wiring entry for the shipped Phase 16
 * runtime modules. CONNECT-ONLY: artifacts.js / checkpoints.js / queue.js /
 * steer.js / multiagent.js are consumed through their public APIs and are
 * never modified. Surfaces added at this seam:
 *   - Artifacts panel      (artifacts.panel/open/close + a sync workspace reader)
 *   - Checkpoints panel    (checkpoints.create/list/restore/branch)
 *   - Multi-agent panel    (multiagent.view/setMode over the routed log)
 *   - Queue chip           (queue.enqueue is now the send path: holds while a
 *                            turn streams, auto-starts the next turn)
 *   - Steer control        (steer.inject into the active turn)
 *   - /gui <task> command  (S2-COMP dispatch: GET /api/computer/status +
 *                            POST /api/computer/call — verbatim envelopes;
 *                            unavailable backends render truthfully, no fake
 *                            progress; Phase 29 Scope K events reach this
 *                            surface through the shipped computer/events emit
 *                            seam -> router -> rows)
 *
 * Contract:
 *   mount(el, { sessionId, backendUrl }) -> { unmount, send(text), mode(m), mode() }
 */
import { createRoot } from 'react-dom/client';
import { createElement as h, useState } from 'react';
import * as runtime from './runtime.js';
import { router } from './router.js';
import rows from './rows/index.js';
import { toolcards } from './toolcards.js';
import { artifacts } from './artifacts.js';
import { checkpoints } from './checkpoints.js';
import { queue } from './queue.js';
import { steer } from './steer.js';
import { multiagent } from './multiagent.js';
import Transcript from '../components/transcript/Transcript.jsx';
import Composer from './Composer.premium.jsx';
import { backendAgent } from './backendAgent.js';
import './mount.css';

/* ---------------- Phase 31 Scope 2 — strip/panel components ---------------- */

const stripBtn = {
  background: 'var(--jx-surface, rgba(255,255,255,.04))',
  border: '1px solid var(--jx-border, rgba(255,255,255,.12))',
  color: 'inherit', borderRadius: 8, padding: '3px 10px', fontSize: 11, cursor: 'pointer',
};

function SteerBox({ onSteer }) {
  const [text, setText] = useState('');
  const submit = () => { if (text.trim()) { onSteer(text.trim()); setText(''); } };
  return h('span', { style: { display: 'inline-flex', gap: 6, alignItems: 'center' } },
    h('input', {
      className: 'p31-steer-input', 'data-testid': 'p31-steer-input', value: text,
      placeholder: 'steer the active turn…',
      onChange: (e) => setText(e.target.value),
      onKeyDown: (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } },
      style: { background: 'transparent', border: '1px solid rgba(255,255,255,.14)', borderRadius: 8, color: 'inherit', fontSize: 11, padding: '2px 8px', width: 220 },
    }),
    h('button', { className: 'p31-steer-btn', 'data-testid': 'p31-steer-btn', style: stripBtn, onClick: submit }, 'steer'),
  );
}

function QueueBox({ onQueue }) {
  const [text, setText] = useState('');
  const submit = () => { if (text.trim()) { onQueue(text.trim()); setText(''); } };
  return h('span', { style: { display: 'inline-flex', gap: 6, alignItems: 'center' } },
    h('input', {
      className: 'p31-queue-input', 'data-testid': 'p31-queue-input', value: text,
      placeholder: 'queue for the next turn…',
      onChange: (e) => setText(e.target.value),
      onKeyDown: (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } },
      style: { background: 'transparent', border: '1px solid rgba(255,255,255,.14)', borderRadius: 8, color: 'inherit', fontSize: 11, padding: '2px 8px', width: 220 },
    }),
    h('button', { className: 'p31-queue-btn', 'data-testid': 'p31-queue-btn', style: stripBtn, onClick: submit }, 'queue'),
  );
}

function ControlStrip({ state, actions }) {
  const busy = state.turn === 'opening' || state.turn === 'streaming' || state.turn === 'awaiting-approval' || state.turn === 'closing';
  return h('div', {
    className: 'p31-strip', 'data-testid': 'p31-strip',
    style: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', padding: '6px 10px', borderTop: '1px solid rgba(255,255,255,.07)', borderBottom: '1px solid rgba(255,255,255,.07)' },
  },
  h('button', { className: 'p31-strip-btn', 'data-testid': 'p31-artifacts-btn', style: { ...stripBtn, borderColor: state.panel === 'artifacts' ? 'rgba(255,122,61,.55)' : undefined }, onClick: actions.toggleArtifacts }, 'Artifacts'),
  h('button', { className: 'p31-strip-btn', 'data-testid': 'p31-checkpoints-btn', style: { ...stripBtn, borderColor: state.panel === 'checkpoints' ? 'rgba(255,122,61,.55)' : undefined }, onClick: actions.toggleCheckpoints }, 'Checkpoints'),
  h('button', { className: 'p31-strip-btn', 'data-testid': 'p31-multiagent-btn', style: { ...stripBtn, borderColor: state.panel === 'multiagent' ? 'rgba(255,122,61,.55)' : undefined }, onClick: actions.toggleMultiagent }, 'Agents view'),
  state.queueCount > 0 && h('span', { className: 'p31-queue-chip', 'data-testid': 'p31-queue-chip', style: { fontSize: 10, padding: '2px 8px', borderRadius: 999, border: '1px solid rgba(255,122,61,.4)', color: '#ffb88c' } }, `queue: ${state.queueCount}`),
  state.steerCount > 0 && h('span', { className: 'p31-steer-chip', 'data-testid': 'p31-steer-chip', style: { fontSize: 10, padding: '2px 8px', borderRadius: 999, border: '1px solid rgba(229,181,103,.4)', color: '#e5b567' } }, `steer pending: ${state.steerCount}`),
  busy && h(QueueBox, { onQueue: actions.queueSend }),
  busy && h(SteerBox, { onSteer: actions.steer }),
  );
}

function ArtifactsPanel({ model, view, onOpen, onCloseView }) {
  return h('div', { className: 'p31-panel p31-artifacts', 'data-testid': 'p31-artifacts-panel', style: { margin: '8px 10px', border: '1px solid rgba(255,122,61,.35)', borderRadius: 10, padding: '8px 10px', maxHeight: 220, overflowY: 'auto', fontSize: 11 } },
    h('div', { style: { fontWeight: 600, marginBottom: 6 } }, `Artifacts — turn ${model.turnId ?? '—'}${model.empty ? ' (none produced)' : ''}`),
    model.error && h('div', { style: { color: '#ff9d9d' } }, `${model.error}: ${model.message || ''}`),
    (model.entries || []).map((e) => h('div', { key: e.path + e.kind, style: { display: 'flex', gap: 8, alignItems: 'baseline', padding: '2px 0' } },
      h('span', { style: { fontFamily: 'monospace' } }, e.path),
      h('span', { style: { opacity: 0.65 } }, e.kind),
      h('span', { style: { opacity: 0.65 } }, `${e.size}B`),
      h('button', { 'data-testid': 'p31-artifact-open', style: stripBtn, onClick: () => onOpen(e.path) }, 'open'),
      e.stale && h('span', { style: { color: '#e5b567' } }, 'stale'),
    )),
    model.empty && !model.error && h('div', { style: { opacity: 0.6 } }, 'this turn produced no inline artifacts (Scope K cards carry none yet)'),
    view && h('div', { 'data-testid': 'p31-artifact-view', style: { marginTop: 6, borderTop: '1px solid rgba(255,255,255,.1)', paddingTop: 6 } },
      h('div', { style: { display: 'flex', gap: 8, alignItems: 'baseline' } },
        h('span', { style: { fontFamily: 'monospace' } }, view.path),
        view.stale && h('span', { style: { color: '#e5b567' } }, 'STALE — content hash drifted'),
        h('button', { style: stripBtn, onClick: onCloseView }, 'close'),
      ),
      view.error
        ? h('div', { style: { color: '#ff9d9d' } }, view.error)
        : h('pre', { style: { whiteSpace: 'pre-wrap', margin: '4px 0 0', fontFamily: 'monospace', fontSize: 10 } }, view.content),
    ),
  );
}

function CheckpointsPanel({ items, note, onCreate, onRestore, onBranch }) {
  return h('div', { className: 'p31-panel p31-checkpoints', 'data-testid': 'p31-checkpoints-panel', style: { margin: '8px 10px', border: '1px solid rgba(76,195,138,.35)', borderRadius: 10, padding: '8px 10px', maxHeight: 220, overflowY: 'auto', fontSize: 11 } },
    h('div', { style: { display: 'flex', gap: 8, alignItems: 'baseline', marginBottom: 6 } },
      h('span', { style: { fontWeight: 600 } }, 'Checkpoints'),
      h('button', { 'data-testid': 'p31-checkpoint-create', style: stripBtn, onClick: onCreate }, 'checkpoint now'),
    ),
    items.length === 0 && h('div', { style: { opacity: 0.6 } }, 'no checkpoints yet — one marks a replayable point (restore drops later events, branch forks a new session)'),
    items.map((c) => h('div', { key: c.checkpointId, style: { display: 'flex', gap: 8, alignItems: 'baseline', padding: '2px 0' } },
      h('span', { style: { fontFamily: 'monospace' } }, c.checkpointId),
      h('span', { style: { opacity: 0.65 } }, `${c.eventCount} events`),
      h('button', { 'data-testid': 'p31-checkpoint-restore', style: stripBtn, onClick: () => onRestore(c.checkpointId) }, 'restore'),
      h('button', { 'data-testid': 'p31-checkpoint-branch', style: stripBtn, onClick: () => onBranch(c.checkpointId) }, 'branch'),
    )),
    note && h('div', { 'data-testid': 'p31-checkpoint-note', style: { marginTop: 6, color: '#ffb88c' } }, note),
  );
}

function MultiAgentPanel({ view, modes, onMode }) {
  return h('div', { className: 'p31-panel p31-multiagent', 'data-testid': 'p31-multiagent-panel', style: { margin: '8px 10px', border: '1px solid rgba(122,162,247,.35)', borderRadius: 10, padding: '8px 10px', maxHeight: 260, overflowY: 'auto', fontSize: 11 } },
    h('div', { style: { display: 'flex', gap: 6, alignItems: 'baseline', marginBottom: 6 } },
      h('span', { style: { fontWeight: 600 } }, 'Multi-agent view'),
      modes.map((m) => h('button', { key: m, 'data-testid': `p31-ma-${m}`, style: { ...stripBtn, borderColor: view.mode === m ? 'rgba(122,162,247,.6)' : undefined }, onClick: () => onMode(m) }, m)),
    ),
    h('div', { style: { display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 6 } },
      view.agents.map((a) => h('span', { key: a.agentId, style: { borderBottom: `2px solid ${a.color}` } }, `${a.agentId} (${a.eventCount})`)),
    ),
    view.layout.map((pane) => h('div', { key: pane.paneId, style: { marginBottom: 6 } },
      pane.agentId && h('div', { style: { opacity: 0.7 } }, `pane: ${pane.agentId}`),
      pane.events.map((ev) => h('div', {
        key: `${pane.paneId}-${ev.seq}`,
        style: { borderLeft: `3px solid ${ev.rail || 'transparent'}`, paddingLeft: 6 + (ev.indent || 0) * 14, paddingY: 1, opacity: ev.indent ? 0.85 : 1 },
      }, `${ev.type}${ev.toolName ? ` · ${ev.toolName}` : ''}${ev.delta ? ` · ${String(ev.delta).slice(0, 60)}` : ''}`)),
    )),
  );
}

export function mount(el, opts = {}) {
  const sessionId = opts.sessionId || 'console-main';
  const backendUrl = opts.backendUrl || '/api/health';

  // PHASE 31 WA6 — attach the session so the runtime-module contracts hold
  // (checkpoints/multiagent assert runtime.isAttached). Idempotent.
  // ui-rebuild-premium — sends now run the REAL backend agent (POST /api/chat
  // NDJSON model pipeline). The keyword-driven defaultAgent stays in
  // runtime.js as the library fallback; here the real pipeline is the default.
  runtime.attach(sessionId, { agent: opts.agent || backendAgent() });

  // PHASE 31 WA6 — artifacts content source: synchronous read over the
  // server workspace endpoint. Real I/O; null -> honest E_ARTIFACT_UNREADABLE
  // from artifacts.open() (the module refuses to fabricate content).
  artifacts.useSource({
    read(p) {
      try {
        const x = new XMLHttpRequest();
        x.open('GET', `/api/workspace/file?name=${encodeURIComponent(p)}`, false);
        x.send(null);
        if (x.status !== 200) return null;
        const j = JSON.parse(x.responseText);
        return j && j.success === true && typeof j.content === 'string' ? j.content : null;
      } catch { return null; }
    },
  });

  const store = {
    rows: [],
    backend: 'checking', // checking | online | offline
    turn: 'idle',
    modes: null,
    lastError: null,
    // PHASE 31 WA6 — panel/strip state (consumer-side only).
    panel: null,          // null | 'artifacts' | 'checkpoints' | 'multiagent'
    note: null,           // honest refusal/error note surfaced inside panels
    artifactView: null,   // { path, content?, stale?, error? }
    maMode: 'single',
    queueCount: 0,
    steerCount: 0,
  };

  // Console-local row sequencing: negative, so it can never collide with
  // router seqs. Used ONLY for the /gui dispatch surface (server responses
  // rendered verbatim) and command refusals — never for agent events.
  let localSeq = 0;
  function pushRow(row) {
    localSeq += 1;
    store.rows.push({
      seq: -localSeq,
      turnId: null,
      type: row.type || 'gui.command',
      rowType: row.rowType || 'text',
      content: row.content || '',
      refused: false,
      refuseReason: null,
      approvalId: null,
      verb: null,
      raw: row.raw || null,
    });
    paint();
  }

  // Latest turnId that produced a tool card (artifacts panel target).
  // get(cardId).tool = { name, toolCallId, sessionId, turnId, seq }; prefer
  // the latest turn whose card actually carries artifact metadata.
  function latestArtifactsTurn() {
    const cards = toolcards.list();
    const turns = [];
    for (let i = cards.length - 1; i >= 0; i--) {
      try {
        const c = toolcards.get(cards[i].cardId);
        if (c && c.tool && c.tool.turnId) turns.push(c.tool.turnId);
      } catch { /* card vanished; keep scanning */ }
    }
    for (const t of [...new Set(turns)]) {
      try { if (!artifacts.panel(t).empty) return t; } catch { /* keep scanning */ }
    }
    return turns[0] || null;
  }

  function artifactsModel(turnId) {
    if (!turnId) return { turnId: null, empty: true, entries: [] };
    try { return artifacts.panel(turnId); }
    catch (e) { return { turnId, empty: true, entries: [], error: (e && e.code) || 'E_PANEL', message: String((e && e.message) || e) }; }
  }

  function openArtifact(path, turnId) {
    try {
      const pid = artifacts.panel(turnId).panelId;
      const res = artifacts.open(pid, path);
      store.artifactView = { path, content: String(res.content).slice(0, 1200), stale: !!res.stale };
    } catch (e) {
      store.artifactView = { path, error: `${(e && e.code) || 'E_OPEN'}: ${String((e && e.message) || e).slice(0, 140)}` };
    }
    paint();
  }

  function safeCheckpoints() {
    try { return checkpoints.list(sessionId); }
    catch (e) { store.note = `checkpoints: ${(e && e.code) || 'E_PANEL'}`; return []; }
  }

  function safeMaView() {
    try { return multiagent.view(sessionId, store.maMode); }
    catch (e) { return { mode: store.maMode, agents: [], layout: [{ paneId: 'main', agentId: null, events: [] }] }; }
  }

  // PHASE 31 S2-COMP — /gui <task>: dispatch a GUI task through the REAL
  // server computer surface and render the verbatim envelopes. Unavailable
  // backends render their truthful reason; nothing is faked. Phase 29 Scope
  // K events reach the transcript through the shipped emit seam when a loop
  // actually runs (probe replays real loop-captured events through it).
  async function guiDispatch(task) {
    if (!task) {
      pushRow({ rowType: 'tool-error', type: 'gui.command', content: '/gui requires a task: /gui <task description>' });
      return;
    }
    pushRow({ rowType: 'tool-use', type: 'gui.command', content: 'gui dispatch', raw: JSON.stringify({ command: '/gui', task }) });
    try {
      const r = await fetch('/api/computer/status');
      const st = await r.json();
      const caps = st.capabilities || {};
      pushRow({ rowType: 'text', type: 'gui.status', content: `computer runtime: provider=${st.provider} browser=${!!caps.browser} screenshot=${!!caps.screenshot} input=${!!caps.input} (GET /api/computer/status)` });
    } catch (e) {
      pushRow({ rowType: 'tool-error', type: 'gui.status', content: `computer status unreachable: ${String((e && e.message) || e).slice(0, 120)}` });
    }
    try {
      const res = await fetch('/api/computer/call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: 'screenshot-json', payload: { task } }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        pushRow({ rowType: 'tool-error', type: 'gui.capture', content: `gui capture refused (HTTP ${res.status}): ${String(body.error || JSON.stringify(body)).slice(0, 220)} — live GUI loop NOT VERIFIED (no display / no VLM credentials in this environment; no fake progress rendered)` });
      } else if (body && body.unavailable) {
        pushRow({ rowType: 'tool-error', type: 'gui.capture', content: `operator unavailable — ${String(body.reason || '').slice(0, 220)} (truthful no-display path; Phase 29 loop requires a real operator + VLM; no fake progress rendered)` });
      } else {
        pushRow({ rowType: 'tool-result', type: 'gui.capture', content: JSON.stringify(body).slice(0, 300) });
      }
    } catch (e) {
      pushRow({ rowType: 'tool-error', type: 'gui.capture', content: `gui capture failed: ${String((e && e.message) || e).slice(0, 180)} (live GUI loop NOT VERIFIED)` });
    }
  }

  // One router subscription: every routed taxonomy event becomes a row.
  // ui-rebuild-premium additions (consumer-side only, no runtime changes):
  //   - turn wall-clock timing (first envelope of a turn -> turn-end row ms)
  //   - voice tagging from the runtime messageId contract
  //     (msg-<turnId>-user vs msg-<turnId>-N) so user vs JEXI rows render
  //     right/left aligned
  //   - streaming: consecutive JEXI message.delta rows of the same turn
  //     merge into one growing row instead of one row per token
  const turnStarts = new Map(); // turnId -> Date.now() at first envelope
  const unsubscribe = router.subscribe(sessionId, (envelope) => {
    // PHASE 31 WA6 — feed the Scope K toolcard store (the artifacts panel
    // aggregates card artifacts from here). Read-only consumption of the
    // routed envelope; a card-build failure must never kill the row path.
    try { if (toolcards.isToolEvent(envelope)) toolcards.build(envelope); } catch { /* card already open / terminal */ }
    const ev = envelope.event || {};
    if (envelope.turnId && !turnStarts.has(envelope.turnId)) turnStarts.set(envelope.turnId, Date.now());
    const isUser = !!(ev.payload && typeof ev.payload.messageId === 'string' && /-user$/.test(ev.payload.messageId));
    let rendered = null;
    try {
      rendered = rows.render(ev);
    } catch {
      rendered = { rowType: 'text', content: JSON.stringify(ev).slice(0, 400) };
    }
    const toolName = (ev.payload && ev.payload.toolName) || (rendered && rendered.toolName) || null;

    // ui-rebuild-premium-v2 — narration rows carry the REAL narrationType and
    // the RAW payload.input. rows/narration.js prefers the builder template
    // text ('Let me check the existing code first — …'), but the Arena-style
    // transcript needs the actual data: reasoning text for recon, step text
    // for progress, plan lines for decision. Consumer-side only — the runtime
    // and the narration scope are untouched.
    let narrationType = null;
    let toolUse = null;
    if (ev.type === 'narration.line' && ev.payload) {
      narrationType = typeof ev.payload.narrationType === 'string' ? ev.payload.narrationType : null;
      if (typeof ev.payload.input === 'string' && ev.payload.input) {
        rendered = { ...rendered, content: ev.payload.input };
      }
      // backendAgent relays REAL server-side tool runs (ToolUseBridge shape:
      // paired running->success/error with id + duration_ms) inside the
      // narration ctx. They become the tool row family here so the Arena
      // transcript renders CommandBlock/ToolCallBlock from real executions.
      const tu = ev.payload.ctx && ev.payload.ctx.toolUse;
      if (tu && tu.id) {
        toolUse = tu;
        rendered = {
          rowType: tu.status === 'success' ? 'tool-result' : tu.status === 'error' ? 'tool-error' : 'tool-use',
          content: String(tu.detail || tu.summary || ''),
        };
      }
    }

    // Streaming merge: a JEXI text delta of the active turn appends to the
    // turn's last delta row (if any) so the answer grows in place.
    const streamingStatus = runtime.state(sessionId).status;
    const last = store.rows.length ? store.rows[store.rows.length - 1] : null;
    const mergeable = !isUser
      && rendered.rowType === 'text'
      && ev.type === 'message.delta'
      && last
      && last.turnId === envelope.turnId
      && last.type === 'message.delta'
      && last.rowType === 'text'
      && last.voice === 'jexi';
    if (mergeable) {
      last.content += rendered.content;
      last.streaming = streamingStatus === 'streaming';
      store.turn = streamingStatus;
      paint();
      return;
    }
    // ui-rebuild-premium-v2 — thinking streams too: consecutive recon
    // narrations of the same turn merge into ONE growing row so the
    // ThinkingBlock grows in place instead of stacking a row per chunk.
    const reconMerge = !isUser
      && rendered.rowType === 'narration'
      && narrationType === 'recon'
      && last
      && last.turnId === envelope.turnId
      && last.type === 'narration.line'
      && last.narrationType === 'recon';
    if (reconMerge) {
      last.content += (last.content ? '\n' : '') + rendered.content;
      last.streaming = streamingStatus === 'streaming';
      store.turn = streamingStatus;
      paint();
      return;
    }
    // Any non-delta event clears the streaming chip off the last row.
    if (last && last.streaming) last.streaming = false;

    let content = rendered.content;
    // Turn footer with REAL wall-clock ms: "turn completed: <id> · <ms> ms".
    if ((rendered.rowType === 'turn-end-ok' || rendered.rowType === 'turn-end-fail') && turnStarts.has(envelope.turnId)) {
      const ms = Date.now() - turnStarts.get(envelope.turnId);
      content = rendered.rowType === 'turn-end-ok'
        ? `turn completed: ${envelope.turnId} · ${ms} ms`
        : `turn failed: ${envelope.turnId} · ${(ev.payload && ev.payload.error) || 'error'} · ${ms} ms`;
    }

    store.rows.push({
      seq: envelope.seq,
      turnId: envelope.turnId,
      type: ev.type,
      rowType: rendered.rowType,
      narrationType,
      toolUse,
      t: Date.now(),
      content,
      refused: !!envelope.refused,
      refuseReason: (envelope.modes && envelope.modes.reason) || null,
      approvalId: (ev.payload && ev.payload.approvalId) || null,
      verb: (envelope.modes && envelope.modes.rowOverride) || null,
      toolName,
      voice: isUser ? 'user' : 'jexi',
      streaming: false,
      // Phase 24: full untruncated args for tool rows so the display-mode
      // clip in Transcript decides verbosity (Phase 16 renderer caps at 80).
      raw: (ev.type === 'tool.started' && ev.payload && ev.payload.args !== undefined)
        ? JSON.stringify(ev.payload.args)
        : null,
    });
    store.turn = streamingStatus;
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
    // PHASE 31 WA6 — strip state recomputed from the REAL modules each paint
    // (queue/steer surface events re-render the transcript anyway).
    try { store.queueCount = queue.list(sessionId).length; } catch { store.queueCount = 0; }
    try { store.steerCount = steer.pending(sessionId).length; } catch { store.steerCount = 0; }

    let panelEl = null;
    if (store.panel === 'artifacts') {
      const turnId = latestArtifactsTurn();
      panelEl = h(ArtifactsPanel, {
        model: artifactsModel(turnId),
        view: store.artifactView,
        onOpen: (path) => openArtifact(path, turnId),
        onCloseView: () => { store.artifactView = null; paint(); },
      });
    } else if (store.panel === 'checkpoints') {
      panelEl = h(CheckpointsPanel, {
        items: safeCheckpoints(),
        note: store.note,
        onCreate: () => {
          try { checkpoints.create(sessionId); store.note = null; }
          catch (e) { store.note = `checkpoint refused: ${(e && e.code) || ''} ${String((e && e.message) || e).slice(0, 100)}`; }
          paint();
        },
        onRestore: (id) => {
          try { checkpoints.restore(sessionId, id); store.note = null; }
          catch (e) { store.note = `restore refused: ${(e && e.code) || ''} — ${String((e && e.message) || e).slice(0, 110)}`; }
          paint();
        },
        onBranch: (id) => {
          try { const out = checkpoints.branch(sessionId, id); store.note = `branched -> ${out.newSessionId}`; }
          catch (e) { store.note = `branch refused: ${(e && e.code) || ''} ${String((e && e.message) || e).slice(0, 100)}`; }
          paint();
        },
      });
    } else if (store.panel === 'multiagent') {
      panelEl = h(MultiAgentPanel, {
        view: safeMaView(),
        modes: multiagent.MODES,
        onMode: (m) => {
          store.maMode = m;
          try { multiagent.setMode(sessionId, m); } catch { /* view-local fallback */ }
          paint();
        },
      });
    }

    root.render(
      h('div', { className: 'p24-chat' },
        h(Transcript, { rows: store.rows, onApprove: (id, d) => api.approve(id, d) }),
        panelEl,
        h(ControlStrip, {
          state: { turn: store.turn, panel: store.panel, queueCount: store.queueCount, steerCount: store.steerCount },
          actions: {
            toggleArtifacts: () => { store.panel = store.panel === 'artifacts' ? null : 'artifacts'; store.note = null; store.artifactView = null; paint(); },
            toggleCheckpoints: () => { store.panel = store.panel === 'checkpoints' ? null : 'checkpoints'; store.note = null; paint(); },
            toggleMultiagent: () => { store.panel = store.panel === 'multiagent' ? null : 'multiagent'; store.note = null; paint(); },
            steer: (text) => {
              try { steer.inject(sessionId, text); store.note = null; }
              catch (e) { store.note = `steer refused: ${(e && e.code) || ''} — ${String((e && e.message) || e).slice(0, 110)}`; }
              paint();
            },
            // Queue affordance (the Phase 24 composer disables sends while a
            // turn streams — the Scope M hold path lives HERE): routes through
            // the same api.send -> queue.enqueue; held while busy.
            queueSend: (text) => { api.send(text); },
          },
        }),
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
      // PHASE 31 S2-COMP — /gui command surface (chat command dispatch).
      if (typeof text === 'string' && text.startsWith('/gui')) {
        void guiDispatch(text.slice(4).trim());
        return null;
      }
      try {
        // PHASE 31 WA6 — sends now flow through the Scope M queue: while a
        // turn streams the message is HELD (queue chip + narration rows) and
        // auto-starts as the next turn when the active one completes; while
        // idle it dispatches immediately (runtime.send semantics preserved).
        const res = queue.enqueue(sessionId, text);
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
