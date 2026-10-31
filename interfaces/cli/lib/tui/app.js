/**
 * JEXI TUI — the application loop.
 *
 * Owns the raw terminal: alternate screen, raw mode, key handling, resize,
 * the streaming turn, and the one-time secret paste. All layout math lives in
 * render.js so this file stays about I/O and control flow.
 *
 * The backend is never faked. If /api/chat is unreachable the turn reports the
 * real error and the loop keeps running.
 */
import { composeView, CHROME_ROWS } from './render.js';
import { createTranscript, applyEvent, pushLocal, pushList, resetTranscript } from './transcript.js';
import { parseCommand, helpLines, isLocalCommand } from './commands.js';
import { JexiApi } from '../api.js';

const ALT_ON = '\x1b[?1049h';
const ALT_OFF = '\x1b[?1049l';
const CURSOR_HIDE = '\x1b[?25l';
const CURSOR_SHOW = '\x1b[?25h';
const CLEAR = '\x1b[2J\x1b[H';
const SYNC_ON = '\x1b[?2026h';
const SYNC_OFF = '\x1b[?2026l';
const EOL = '\x1b[K';

/**
 * Run the TUI. `deps` is injectable for tests:
 *   { input, output, api, model, workspace, baseUrl, headless }
 */
export async function runTui(deps = {}) {
  const input = deps.input || process.stdin;
  const output = deps.output || process.stdout;
  const api = deps.api || new JexiApi({ baseUrl: deps.baseUrl || 'http://127.0.0.1:3210', session: 'tui' });

  const state = {
    t: createTranscript(),
    input: '',
    cursor: 0,
    scroll: 0,
    busy: false,
    notice: '',
    model: deps.model || '',
    workspace: deps.workspace || '',
    baseUrl: api.baseUrl,
    quit: false,
    abort: null,
    cols: output.columns || 80,
    rows: output.rows || 24,
    needRender: true,
    history: [],       // submitted inputs (↑ recalls)
    histIdx: -1,       // -1 = editing a fresh line
    pendingApproval: null, // { tool, approvalId, details } from a paused action
    secretAsk: null,       // ask.secret seen during a turn (handled after it)
    pendingSecret: null,   // open one-time paste prompt (owns the keyboard)
    turn: null,            // in-flight turn promise (awaited on exit)
  };

  const writer = createWriter(output);
  const cleanup = installTerminal(input, output, state, writer);

  /* M13 — KEY PUMP. The old loop awaited the whole turn before reading the
     next key, so Ctrl+C during a turn did nothing (the turn held the loop).
     The pump reads stdin continuously into an inbox, so the app can process
     keys DURING a streaming turn — which is what makes cancellation real. */
  const inbox = [];
  let waiter = null;
  const pushKey = (k) => { if (waiter) { const w = waiter; waiter = null; w(k); } else inbox.push(k); };
  const nextKey = () => (inbox.length ? Promise.resolve(inbox.shift())
    : new Promise((resolve) => { waiter = resolve; }));
  (async () => {
    try {
      for await (const k of readKeys(input, state)) { if (state.quit) break; pushKey(k); }
    } catch { /* stream error ends the pump */ }
    pushKey(null);
  })();

  const render = () => {
    if (!state.needRender) return;
    state.needRender = false;
    writer.frame(composeView(state.t, {
      cols: state.cols,
      rows: state.rows,
      scroll: state.scroll,
      input: state.input,
      busy: state.busy,
      model: state.model,
      notice: state.notice,
      header: { baseUrl: state.baseUrl, workspace: state.workspace, sessionId: state.t.sessionId },
    }));
  };

  const handleKey = async (key) => {
    // A one-time secret paste owns the keyboard while it is open.
    if (state.pendingSecret) { routeSecretKey(key); return; }
    switch (key) {
      case 'CTRL_C':
      case 'CTRL_D':
        if (state.busy && state.abort) {
          state.abort.abort();
          state.notice = 'cancelling…';
          state.needRender = true;
          render();
          return;
        }
        state.quit = true;
        return;
      case 'ENTER':
        if (state.busy) return;
        submit();
        return;
      case 'BACKSPACE':
        if (state.cursor > 0) {
          state.input = state.input.slice(0, state.cursor - 1) + state.input.slice(state.cursor);
          state.cursor -= 1;
          state.needRender = true;
        }
        return;
      case 'DELETE':
        if (state.cursor < state.input.length) {
          state.input = state.input.slice(0, state.cursor) + state.input.slice(state.cursor + 1);
          state.needRender = true;
        }
        return;
      case 'LEFT':
        state.cursor = Math.max(0, state.cursor - 1); state.needRender = true; return;
      case 'RIGHT':
        state.cursor = Math.min(state.input.length, state.cursor + 1); state.needRender = true; return;
      case 'HOME':
        state.cursor = 0; state.needRender = true; return;
      case 'END':
        state.cursor = state.input.length; state.needRender = true; return;
      case 'UP':
        // ↑ recalls history when the composer is not scrolled up.
        if (state.scroll === 0 && state.history.length) {
          state.histIdx = Math.min(state.history.length - 1, state.histIdx + 1);
          state.input = state.history[state.history.length - 1 - state.histIdx];
          state.cursor = state.input.length;
          state.needRender = true;
          return;
        }
        state.scroll += 1; state.needRender = true; return;
      case 'DOWN':
        if (state.scroll === 0 && state.histIdx >= 0) {
          state.histIdx -= 1;
          state.input = state.histIdx < 0 ? '' : state.history[state.history.length - 1 - state.histIdx];
          state.cursor = state.input.length;
          state.needRender = true;
          return;
        }
        state.scroll = Math.max(0, state.scroll - 1); state.needRender = true; return;
      case 'PGUP':
        state.scroll += Math.max(1, state.rows - CHROME_ROWS); state.needRender = true; return;
      case 'PGDN':
        state.scroll = Math.max(0, state.scroll - Math.max(1, state.rows - CHROME_ROWS)); state.needRender = true; return;
      case 'TAB':
        return; // reserved — no completion yet, but never insert the name
      case 'ESC':
        if (state.input) { state.input = ''; state.cursor = 0; state.needRender = true; }
        return;
      case 'CTRL_L':
        writer.reset(); state.needRender = true; return;
      default:
        if (isTextKey(key)) {
          state.input = state.input.slice(0, state.cursor) + key + state.input.slice(state.cursor);
          state.cursor += key.length;
          state.needRender = true;
        }
    }
  };

  const submit = async () => {
    const q = state.input.trim();
    if (!q) return;
    state.input = '';
    state.cursor = 0;
    state.scroll = 0;
    state.histIdx = -1;
    state.history.push(q);

    const parsed = parseCommand(q);
    if (parsed.isCommand) { await command(parsed); state.needRender = true; render(); return; }

    // Detached: the key pump keeps running so Ctrl+C can abort mid-turn.
    beginTurn(q);
  };

  /**
   * Start a chat turn WITHOUT blocking the key loop. The key pump keeps
   * feeding keys while this runs, so Ctrl+C can abort mid-turn. `state.turn`
   * is the in-flight promise the loop awaits on exit.
   */
  const beginTurn = (query) => {
    if (state.busy) return state.turn;
    pushLocal(state.t, 'user', query);
    state.busy = true;
    state.abort = new AbortController();
    state.notice = '';
    state.needRender = true;
    render();
    state.turn = (async () => {
      try {
        await runTurn(query);
      } catch (e) {
        if (!(e && (e.name === 'AbortError' || /aborted/i.test(e.message || '')))) {
          pushLocal(state.t, 'turn-end-fail', `turn failed: ${(e && e.message) || e}`);
        } else {
          pushLocal(state.t, 'log', 'turn cancelled');
        }
      } finally {
        state.busy = false;
        state.abort = null;
        state.needRender = true;
        render();
      }
    })();
    return state.turn;
  };

  const runTurn = async (query) => {
    const t0 = Date.now();
    const res = await api.chatStream(query, {
      signal: state.abort ? state.abort.signal : null,
      onEvent: (evt) => {
        const out = applyEvent(state.t, evt);
        if (out.secretAsk) state.secretAsk = out.secretAsk;
        // M13 — a protected action paused: remember it so /approve and /deny
        // can answer the engine's OWN confirmation (a plain yes/no turn).
        const ap = approvalFromEvent(evt);
        if (ap) state.pendingApproval = ap;
        if (out.changed) { state.needRender = true; render(); }
      },
    });

    if (state.secretAsk && state.secretAsk.id) {
      const ask = state.secretAsk;
      state.secretAsk = null;
      const value = await openSecretPrompt(ask);
      if (value) {
        const ans = await api.secretsAnswer({ conv: ask.conv, id: ask.id, value })
          .catch((e) => ({ ok: false, data: { error: e.message } }));
        if (ans.ok && ans.data && ans.data.ok) {
          pushLocal(state.t, 'narration', 'key accepted — continuing the turn…');
          state.needRender = true;
          render();
          return runTurn(`continue: ${query}`);
        }
        pushLocal(state.t, 'turn-end-fail', `key rejected: ${(ans.data && ans.data.error) || `HTTP ${ans.status}`}`);
      } else {
        pushLocal(state.t, 'log', 'secret skipped');
      }
    }

    if (!res.done) {
      pushLocal(state.t, 'log', `turn ended without a terminal event (${res.events} events, ${Date.now() - t0}ms)`);
    }
  };

  /**
   * One-time secret paste. The prompt is opened here and the KEY PUMP routes
   * keys to it (routeSecretKey), so the turn never owns stdin directly.
   * Resolves with the pasted value ('' if skipped). Never written to disk.
   */
  const openSecretPrompt = (ask) => new Promise((resolve) => {
    state.pendingSecret = { ask, buf: '', resolve };
    state.input = `[one-time ${ask.tool || 'key'}] `;
    state.cursor = state.input.length;
    state.notice = 'Enter to submit · Esc to skip';
    state.needRender = true;
    render();
  });

  const routeSecretKey = (key) => {
    const ps = state.pendingSecret;
    if (!ps) return;
    if (key === 'ENTER') return finishSecret(ps.buf);
    if (key === 'ESC' || key === 'CTRL_C' || key === 'CTRL_D') return finishSecret('');
    if (key === 'BACKSPACE') {
      ps.buf = ps.buf.slice(0, -1);
      state.input = `[one-time ${ps.ask.tool || 'key'}] ${'•'.repeat(ps.buf.length)}`;
      state.cursor = state.input.length;
      state.needRender = true;
      render();
      return;
    }
    if (isTextKey(key)) {
      ps.buf += key;
      state.input = `[one-time ${ps.ask.tool || 'key'}] ${'•'.repeat(ps.buf.length)}`;
      state.cursor = state.input.length;
      state.needRender = true;
      render();
    }
  };

  const finishSecret = (value) => {
    const ps = state.pendingSecret;
    if (!ps) return;
    state.pendingSecret = null;
    state.input = '';
    state.cursor = 0;
    state.notice = '';
    state.needRender = true;
    render();
    ps.resolve(value);
  };

  const command = async (parsed) => {
    const { name, arg } = parsed;
    if (parsed.unknown) {
      pushLocal(state.t, 'log', `unknown command: /${name} — try /help`);
      return;
    }
    switch (name) {
      case 'help':
        for (const line of helpLines()) pushLocal(state.t, 'log', line);
        return;
      case 'clear':
        resetTranscript(state.t);
        return;
      case 'new':
        state.t.sessionId = `tui-${Date.now().toString(36)}`;
        api.setSession(state.t.sessionId);
        state.pendingApproval = null;
        resetTranscript(state.t);
        pushLocal(state.t, 'narration', `new session ${state.t.sessionId}`);
        return;
      case 'resume':
        await resume(arg);
        return;
      case 'model':
        if (arg) { state.model = arg; pushLocal(state.t, 'log', `model label set to ${arg} (backend model unchanged — use jexi init to switch)`); return; }
        if (await refreshModel()) pushLocal(state.t, 'log', `model: ${state.model}`);
        else pushLocal(state.t, 'log', 'no provider configured — set one with: jexi init --model');
        return;
      case 'tools':
        await listTools(arg);
        return;
      case 'skills':
        await listSkills(arg);
        return;
      case 'memory':
        await showMemory(arg);
        return;
      case 'status':
        await showStatus();
        return;
      case 'permissions':
        await permissions(arg);
        return;
      case 'approve':
        await answerApproval(true);
        return;
      case 'deny':
        await answerApproval(false);
        return;
      case 'cancel':
        if (state.busy && state.abort) { state.abort.abort(); pushLocal(state.t, 'log', 'cancelling…'); }
        else pushLocal(state.t, 'log', 'nothing to cancel');
        return;
      case 'doctor':
        await doctor();
        return;
      case 'exit':
        state.quit = true;
        return;
      default:
        pushLocal(state.t, 'log', `unknown command: /${name} — try /help`);
    }
  };

  /** /resume — list sessions, or switch to one by id (real conversation). */
  const resume = async (arg) => {
    if (!arg) {
      const r = await api.sessions().catch((e) => ({ ok: false, data: { error: e.message } }));
      const convs = (r && r.data && (r.data.conversations || r.data.convs)) || [];
      if (!r.ok || !convs.length) { pushLocal(state.t, 'log', `no sessions found (${(r.data && r.data.error) || `HTTP ${r.status}`})`); return; }
      const items = convs.slice(0, 12).map((c) => `${c.id}  ${c.title ? `· ${c.title}` : ''}`);
      pushList(state.t, 'sessions', items, { more: convs.length > 12 ? convs.length - 12 : 0 });
      pushLocal(state.t, 'log', 'resume with: /resume <id>');
      return;
    }
    // Switch the session, then replay the stored conversation so the user sees
    // the real history (not a fabricated summary).
    const r = await api.conversation(arg).catch((e) => ({ ok: false, data: { error: e.message } }));
    if (!r.ok || !r.data || !r.data.events) {
      pushLocal(state.t, 'turn-end-fail', `cannot resume ${arg}: ${(r.data && r.data.error) || `HTTP ${r.status}`}`);
      return;
    }
    api.setSession(arg);
    state.t.sessionId = arg;
    state.pendingApproval = null;
    resetTranscript(state.t);
    for (const e of r.data.events) {
      if (!e || !e.role || !e.text) continue;
      if (e.role === 'user') pushLocal(state.t, 'user', e.text);
      else pushLocal(state.t, 'text', e.text);
    }
    pushLocal(state.t, 'narration', `resumed session ${arg} (${r.data.events.length} events)`);
  };

  /** /tools [filter] — real native tool catalog. */
  const listTools = async (filter) => {
    const r = await api.tools().catch((e) => ({ ok: false, data: { error: e.message } }));
    if (!r.ok || !r.data || !Array.isArray(r.data.tools)) {
      pushLocal(state.t, 'turn-end-fail', `cannot list tools: ${(r.data && r.data.error) || `HTTP ${r.status}`}`);
      return;
    }
    const q = String(filter || '').toLowerCase();
    const all = r.data.tools;
    const match = q ? all.filter((t) => `${t.slug} ${t.name} ${t.desc || ''}`.toLowerCase().includes(q)) : all;
    const items = match.slice(0, 30).map((t) => `${(t.slug || t.name || '').padEnd(20)} ${t.tier || ''} ${t.permission || ''} ${oneLineLocal(t.desc || '', 70)}`.trim());
    pushList(state.t, `tools (${match.length}${q ? ` match "${q}"` : ''}${r.data.activeProfile ? `, profile ${r.data.activeProfile}` : ''})`, items, { more: match.length > 30 ? match.length - 30 : 0 });
  };

  /** /skills [filter] — real skills registry. */
  const listSkills = async (filter) => {
    const r = await api.skills().catch((e) => ({ ok: false, data: { error: e.message } }));
    if (!r.ok || !r.data) {
      pushLocal(state.t, 'turn-end-fail', `cannot list skills: ${(r.data && r.data.error) || `HTTP ${r.status}`}`);
      return;
    }
    const q = String(filter || '').toLowerCase();
    const skills = Array.isArray(r.data.skills) ? r.data.skills : [];
    const match = q ? skills.filter((s) => `${s.slug} ${s.name} ${s.desc || ''} ${s.category || ''}`.toLowerCase().includes(q)) : skills;
    const items = match.slice(0, 30).map((s) => `${(s.slug || s.name || '').padEnd(24)} ${s.category ? `[${s.category}] ` : ''}${oneLineLocal(s.desc || '', 60)}`.trim());
    pushList(state.t, `skills (${match.length}${q ? ` match "${q}"` : ''} of ${r.data.total ?? skills.length})`, items, { more: match.length > 30 ? match.length - 30 : 0 });
  };

  /** /memory [query] — stored memory, or a real semantic search. */
  const showMemory = async (arg) => {
    const q = String(arg || '').trim();
    if (q.length >= 3) {
      const r = await api.memorySearch(q).catch((e) => ({ ok: false, data: { error: e.message } }));
      const results = (r && r.data && r.data.results) || [];
      if (!r.ok) { pushLocal(state.t, 'turn-end-fail', `memory search failed: ${(r.data && r.data.error) || `HTTP ${r.status}`}`); return; }
      const items = results.slice(0, 12).map((x) => oneLineLocal(x.text || x.summary || JSON.stringify(x), 100));
      pushList(state.t, `memory search "${q}" (${results.length})`, items.length ? items : ['(no matches)']);
      return;
    }
    const r = await api.memory().catch((e) => ({ ok: false, data: { error: e.message } }));
    if (!r.ok || !r.data) { pushLocal(state.t, 'turn-end-fail', `cannot read memory: ${(r.data && r.data.error) || `HTTP ${r.status}`}`); return; }
    const m = r.data;
    const items = [];
    if (Array.isArray(m.userProfile?.facts) && m.userProfile.facts.length) {
      items.push('profile facts:');
      for (const f of m.userProfile.facts.slice(0, 8)) items.push(`  · ${oneLineLocal(typeof f === 'string' ? f : (f.text || f.fact || JSON.stringify(f)), 90)}`);
    }
    const chatLen = Array.isArray(m.chatHistory) ? m.chatHistory.length : 0;
    items.push(`chat history entries: ${chatLen}`);
    const keys = Object.keys(m).filter((k) => !['userProfile', 'chatHistory'].includes(k));
    if (keys.length) items.push(`sections: ${keys.join(', ')}`);
    pushList(state.t, 'memory', items);
  };

  /** /status — backend, model, session, permissions. */
  const showStatus = async () => {
    const items = [];
    const h = await api.health().catch(() => null);
    if (h && h.ok && h.data) items.push(`backend: ${h.data.name || 'brain'} v${h.data.version || '?'} · up ${h.data.uptime || 0}s · port ${h.data.port ?? '?'}`);
    else items.push(`backend: unreachable at ${state.baseUrl}`);
    items.push(`session: ${state.t.sessionId}`);
    items.push(`model: ${state.model || '(none configured)'}`);
    items.push(`workspace: ${state.workspace || '(unset)'}`);
    const p = await api.permissions().catch(() => null);
    if (p && p.ok && p.data) items.push(`permissions: preset ${p.data.preset} · approval ${p.data.approval} · sandbox ${p.data.sandbox}`);
    items.push(`tools used this session: ${state.t.stats.tools}${state.t.stats.toolErrors ? ` (${state.t.stats.toolErrors} failed)` : ''}`);
    if (state.pendingApproval) items.push(`⚠ pending approval: ${state.pendingApproval.tool || 'protected action'} — /approve or /deny`);
    pushList(state.t, 'status', items);
  };

  /** /permissions [preset] — show or set the session approval preset. */
  const permissions = async (arg) => {
    if (arg) {
      const r = await api.setPermissions(arg).catch((e) => ({ ok: false, data: { error: e.message } }));
      if (!r.ok) { pushLocal(state.t, 'turn-end-fail', `cannot set preset: ${(r.data && r.data.error) || `HTTP ${r.status}`}`); return; }
      pushLocal(state.t, 'narration', `permission preset → ${(r.data && r.data.preset) || arg}`);
      return;
    }
    const r = await api.permissions().catch((e) => ({ ok: false, data: { error: e.message } }));
    if (!r.ok || !r.data) { pushLocal(state.t, 'turn-end-fail', `cannot read permissions: ${(r.data && r.data.error) || `HTTP ${r.status}`}`); return; }
    const items = [`preset: ${r.data.preset}`, `approval: ${r.data.approval}`, `sandbox: ${r.data.sandbox}`];
    const presets = (r.data.presets || []).map((p) => p.key);
    if (presets.length) items.push(`available presets: ${presets.join(', ')}`);
    pushList(state.t, 'permissions', items);
  };

  /**
   * /approve and /deny — answer the engine's own confirmation.
   *
   * The engine parks a protected action and resumes it when the NEXT turn is
   * "yes"/"no" (CONFIRM_RE / DECLINE_RE in server/index.js). So this submits
   * that literal turn through the SAME stream; it does not call any private
   * approval API and it cannot grant anything the engine would refuse.
   */
  const answerApproval = async (yes) => {
    if (!state.pendingApproval) { pushLocal(state.t, 'log', 'no pending approval'); return; }
    const word = yes ? 'yes' : 'no';
    const tool = state.pendingApproval.tool || 'protected action';
    state.pendingApproval = null;
    pushLocal(state.t, 'user', yes ? `/approve (yes) — ${tool}` : `/deny (no) — ${tool}`);
    await beginTurn(word);
  };

  const refreshModel = async () => {
    const r = await api.providersActive().catch(() => null);
    const a = r && r.data && r.data.active;
    if (a && a.configured) { state.model = `${a.provider}/${a.model}`; return true; }
    return false;
  };

  const doctor = async () => {
    const h = await api.health().catch((e) => ({ ok: false, data: { error: e.message } }));
    if (h.ok && h.data && h.data.ok) {
      pushLocal(state.t, 'log', `backend ok · ${h.data.name || 'brain'} v${h.data.version || '?'} · up ${h.data.uptime || 0}s`);
    } else {
      pushLocal(state.t, 'turn-end-fail', `backend unreachable at ${state.baseUrl}`);
    }
    await refreshModel();
  };

  try {
    if (!deps.headless) pushLocal(state.t, 'narration', 'JEXI is ready. Type a task — /help for commands.');
    // Resolve the live model for the status bar unless the caller supplied one.
    if (!state.model) await refreshModel().catch(() => false);
    render();
    while (!state.quit) {
      const key = await nextKey();
      if (key === null || key === undefined) break; // stdin closed
      await handleKey(key);
    }
    // Let any in-flight turn settle before tearing the terminal down.
    if (state.turn) await state.turn.catch(() => {});
  } finally {
    cleanup();
  }
  return state;
}

/** Is this yielded key printable text the user actually typed? */
const NAMED_KEYS = new Set(['ENTER', 'BACKSPACE', 'DELETE', 'TAB', 'ESC',
  'LEFT', 'RIGHT', 'UP', 'DOWN', 'HOME', 'END', 'PGUP', 'PGDN',
  'CTRL_C', 'CTRL_D', 'CTRL_L']);

/** Collapse whitespace and clip for one-line list output. */
function oneLineLocal(s, max = 90) {
  const t = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/**
 * Extract a pending approval from a wire event, if it is one.
 * Recognizes the engine's real shapes: an `approval.requested` event, or a
 * tool result flagged approvalRequired/paused. Returns null otherwise.
 */
export function approvalFromEvent(evt) {
  if (!evt || typeof evt !== 'object') return null;
  const p = (evt.payload && typeof evt.payload === 'object') ? evt.payload : evt;
  if (evt.type === 'approval.requested') {
    return { tool: p.tool || p.action || '', approvalId: p.approvalId || '', details: oneLineLocal(p.details || p.reason || '', 200) };
  }
  if (p.approvalRequired === true || p.paused === true) {
    return { tool: p.tool || p.name || '', approvalId: p.approvalId || '', details: oneLineLocal(p.details || p.error || '', 200) };
  }
  return null;
}

export function isTextKey(key) {
  return typeof key === 'string' && key.length >= 1
    && key.charCodeAt(0) >= 32 && !NAMED_KEYS.has(key);
}

/** Reads keys from a raw stream and yields normalized key names. */
export async function* readKeys(input, state) {
  // Buffer BYTES, not strings: a multi-byte character can be split across
  // chunks, and Buffer→String per chunk would turn it into replacement chars
  // that can never be rejoined. Sequences are decoded once a full code point
  // is present.
  let buf = Buffer.alloc(0);
  for await (const chunk of input) {
    buf = Buffer.concat([buf, Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), 'utf8')]);
    let i = 0;
    while (i < buf.length) {
      if (buf[i] === 0x1b) {
        const seq = matchEscape(buf.subarray(i).toString('latin1'));
        if (seq === null) break; // incomplete — wait for more bytes
        i += seq.len;
        if (seq.key) yield seq.key;
        continue;
      }
      const need = utf8Length(buf[i]);
      if (need === 0) { i += 1; continue; } // stray continuation byte
      if (i + need > buf.length) break; // split code point — wait
      const ch = buf.subarray(i, i + need).toString('utf8');
      i += need;
      if (ch === '\r' || ch === '\n') { yield 'ENTER'; continue; }
      if (ch === '\x7f' || ch === '\b') { yield 'BACKSPACE'; continue; }
      if (ch === '\x03') { yield 'CTRL_C'; continue; }
      if (ch === '\x04') { yield 'CTRL_D'; continue; }
      if (ch === '\x0c') { yield 'CTRL_L'; continue; }
      if (ch === '\t') { yield 'TAB'; continue; }
      if (ch < ' ') continue;
      yield ch;
    }
    buf = buf.subarray(i);
    if (state.quit) return;
  }
}

/** UTF-8 sequence length for a lead byte; 0 for a continuation byte. */
function utf8Length(byte) {
  if (byte < 0x80) return 1;
  if (byte >= 0xf0) return 4;
  if (byte >= 0xe0) return 3;
  if (byte >= 0xc0) return 2;
  return 0;
}

function matchEscape(s) {
  const table = {
    '\x1b[A': 'UP', '\x1b[B': 'DOWN', '\x1b[C': 'RIGHT', '\x1b[D': 'LEFT',
    '\x1b[H': 'HOME', '\x1b[F': 'END', '\x1b[1~': 'HOME', '\x1b[4~': 'END',
    '\x1b[3~': 'DELETE', '\x1b[5~': 'PGUP', '\x1b[6~': 'PGDN',
    '\x1bOA': 'UP', '\x1bOB': 'DOWN', '\x1bOC': 'RIGHT', '\x1bOD': 'LEFT',
  };
  for (const [seq, key] of Object.entries(table)) {
    if (s.startsWith(seq)) return { key, len: seq.length };
  }
  if (s.startsWith('\x1b[') || s.startsWith('\x1bO')) {
    const m = /^\x1b\[[0-9;]*[A-Za-z~]/.exec(s) || /^\x1bO[A-Za-z~]/.exec(s);
    if (m) return { key: '', len: m[0].length };
    return s.length > 8 ? { key: '', len: 2 } : null;
  }
  if (s.length === 1) return null; // lone ESC — hold briefly for a sequence
  return { key: 'ESC', len: 1 };
}

/**
 * Frame writer. One frame is a home-cursor + line-per-row write wrapped in a
 * synchronized-update block, so the terminal never paints a half-drawn frame.
 * Each line is followed by clear-to-EOL so shorter lines never leave debris.
 * ANSI colors are preserved.
 */
export function createWriter(output) {
  let active = false;
  return {
    enter() {
      if (active) return;
      active = true;
      output.write(ALT_ON + CURSOR_HIDE + CLEAR);
    },
    leave() {
      if (!active) return;
      active = false;
      output.write(CURSOR_SHOW + ALT_OFF);
    },
    reset() { output.write(CLEAR); },
    frame(lines) {
      const body = lines.map((l) => l + EOL).join('\n');
      output.write(`${SYNC_ON}\x1b[H${body}\x1b[0J${SYNC_OFF}`);
    },
  };
}

/** Put the terminal into raw mode and wire resize/cleanup. */
function installTerminal(input, output, state, writer) {
  const wasRaw = input.isRaw;
  if (input.isTTY && input.setRawMode) input.setRawMode(true);
  // NOTE: do NOT call input.resume() here. readKeys() drives the stream
  // through its async iterator; resuming first would put the stream in
  // flowing mode with no consumer attached and silently discard any bytes
  // already buffered (the user's first keystrokes).
  writer.enter();

  const onResize = () => {
    state.cols = output.columns || state.cols;
    state.rows = output.rows || state.rows;
    state.needRender = true;
  };
  const onExit = () => writer.leave();
  output.on?.('resize', onResize);
  process.once('exit', onExit);

  return () => {
    output.off?.('resize', onResize);
    process.removeListener('exit', onExit);
    writer.leave();
    if (input.isTTY && input.setRawMode) input.setRawMode(wasRaw || false);
    input.pause?.();
    // The key pump holds stdin open in a detached async loop; unref it so the
    // handle does not keep the event loop alive once the loop has quit.
    input.unref?.();
  };
}

export default { runTui, readKeys, createWriter };
