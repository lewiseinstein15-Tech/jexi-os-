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
import { createTranscript, applyEvent, pushLocal, resetTranscript } from './transcript.js';
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
  };

  const writer = createWriter(output);
  const cleanup = installTerminal(input, output, state, writer);
  const keys = readKeys(input, state)[Symbol.asyncIterator]();

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
        await submit();
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
        state.scroll += 1; state.needRender = true; return;
      case 'DOWN':
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

    if (q.startsWith('/')) { await command(q); state.needRender = true; render(); return; }

    pushLocal(state.t, 'user', q);
    state.busy = true;
    state.abort = new AbortController();
    state.notice = '';
    state.needRender = true;
    render();

    try {
      await runTurn(q, keys);
    } catch (e) {
      pushLocal(state.t, 'turn-end-fail', `turn failed: ${(e && e.message) || e}`);
    } finally {
      state.busy = false;
      state.abort = null;
      state.needRender = true;
      render();
    }
  };

  const runTurn = async (query, keyIter) => {
    let pendingSecret = null;
    const t0 = Date.now();
    const res = await api.chatStream(query, {
      signal: state.abort ? state.abort.signal : null,
      onEvent: (evt) => {
        const out = applyEvent(state.t, evt);
        if (out.secretAsk) pendingSecret = out.secretAsk;
        if (out.changed) { state.needRender = true; render(); }
      },
    });

    if (pendingSecret && pendingSecret.id) {
      const ask = pendingSecret;
      const value = await askSecret(ask, keyIter);
      if (value) {
        const ans = await api.secretsAnswer({ conv: ask.conv, id: ask.id, value })
          .catch((e) => ({ ok: false, data: { error: e.message } }));
        if (ans.ok && ans.data && ans.data.ok) {
          pushLocal(state.t, 'narration', 'key accepted — continuing the turn…');
          state.needRender = true;
          render();
          return runTurn(`continue: ${query}`, keyIter);
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
   * One-time secret paste, read through the SAME key iterator (never a second
   * stdin consumer). Input is masked; the value goes straight to the backend
   * and is never written to disk.
   */
  const askSecret = async (ask, keyIter) => {
    let buf = '';
    const paintPrompt = () => {
      state.input = `[one-time ${ask.tool || 'key'}] ${'•'.repeat(buf.length)}`;
      state.cursor = state.input.length;
      state.notice = 'Enter to submit · Esc to skip';
      state.needRender = true;
      render();
    };
    paintPrompt();
    for (;;) {
      const { value: key, done } = await keyIter.next();
      if (done) return '';
      if (key === 'ENTER') break;
      if (key === 'ESC' || key === 'CTRL_C') { buf = ''; break; }
      if (key === 'BACKSPACE') { buf = buf.slice(0, -1); paintPrompt(); continue; }
      if (isTextKey(key)) { buf += key; paintPrompt(); }
    }
    state.input = '';
    state.cursor = 0;
    state.notice = '';
    state.needRender = true;
    render();
    return buf;
  };

  const command = async (line) => {
    const [cmd, ...rest] = line.slice(1).split(' ');
    switch (cmd) {
      case 'help':
        pushLocal(state.t, 'log', '/help /clear /new /model /doctor /exit');
        pushLocal(state.t, 'log', 'Enter sends · ↑↓ scroll · PgUp/PgDn page · Ctrl+C cancels or quits');
        return;
      case 'clear':
        resetTranscript(state.t);
        return;
      case 'new':
        state.t.sessionId = `tui-${Date.now().toString(36)}`;
        resetTranscript(state.t);
        pushLocal(state.t, 'narration', `new session ${state.t.sessionId}`);
        return;
      case 'model':
        if (rest.join(' ').trim()) { state.model = rest.join(' ').trim(); return; }
        if (await refreshModel()) pushLocal(state.t, 'log', `model: ${state.model}`);
        else pushLocal(state.t, 'log', 'no provider configured — set one with: jexi init --model');
        return;
      case 'doctor':
        await doctor();
        return;
      case 'exit':
      case 'quit':
        state.quit = true;
        return;
      default:
        pushLocal(state.t, 'log', `unknown command: /${cmd} — try /help`);
    }
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
      const { value: key, done } = await keys.next();
      if (done) break;
      await handleKey(key);
    }
  } finally {
    cleanup();
  }
  return state;
}

/** Is this yielded key printable text the user actually typed? */
const NAMED_KEYS = new Set(['ENTER', 'BACKSPACE', 'DELETE', 'TAB', 'ESC',
  'LEFT', 'RIGHT', 'UP', 'DOWN', 'HOME', 'END', 'PGUP', 'PGDN',
  'CTRL_C', 'CTRL_D', 'CTRL_L']);

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
  };
}

export default { runTui, readKeys, createWriter };
