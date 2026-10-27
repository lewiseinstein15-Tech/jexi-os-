/**
 * JEXI TUI — offline tests (no backend spawn, no network, no TTY).
 *
 * Covers: the ANSI primitives (width/wrap/truncate/paint), the wire→row
 * mapping for every event the backend actually emits, the transcript reducer
 * (streaming append, tool in-place update, stats), frame composition (exact
 * height, no overflow, scroll), key decoding (arrows, paste, multi-byte), the
 * frame writer (alt screen, sync blocks, EOL clear), and a full headless app
 * loop driven by a fake backend and a fake stdin.
 *
 * Run: node test-tui.js   (from cli/)
 */
import assert from 'node:assert';
import { Readable, Writable } from 'node:stream';

const ansi = await import('./lib/tui/ansi.js');
const rows = await import('./lib/tui/rows.js');
const tx = await import('./lib/tui/transcript.js');
const render = await import('./lib/tui/render.js');
const app = await import('./lib/tui/app.js');

let passed = 0;
const ok = async (name, fn) => {
  try {
    await fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    console.error(`  ✗ ${name}\n    ${String(e.stack).split('\n').slice(0, 3).join('\n    ')}`);
    process.exitCode = 1;
  }
};

/** Force a deterministic color mode for assertions. */
function withColor(env, fn) {
  const keys = ['NO_COLOR', 'COLORTERM', 'TERM'];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  for (const k of keys) {
    if (env[k] === undefined) delete process.env[k];
    else process.env[k] = env[k];
  }
  try { return fn(); } finally {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
    }
  }
}

console.log('jexi tui:');

// ── ansi ──────────────────────────────────────────────────────────────────
await ok('ansi: visible width ignores SGR and counts wide chars', () => {
  assert.strictEqual(ansi.visibleWidth('abc'), 3);
  assert.strictEqual(ansi.visibleWidth('\x1b[38;2;1;2;3mabc\x1b[0m'), 3);
  assert.strictEqual(ansi.visibleWidth('日本'), 4);
  assert.strictEqual(ansi.visibleWidth('a日b'), 4);
  assert.strictEqual(ansi.visibleWidth(''), 0);
});

await ok('ansi: wrap preserves newlines and hard-splits long tokens', () => {
  assert.deepStrictEqual(ansi.wrap('a b c', 3), ['a b', 'c']);
  assert.deepStrictEqual(ansi.wrap('line1\nline2', 20), ['line1', 'line2']);
  const split = ansi.wrap('x'.repeat(25), 10);
  assert.strictEqual(split.length, 3);
  assert.ok(split.every((l) => ansi.visibleWidth(l) <= 10));
  assert.strictEqual(split.join(''), 'x'.repeat(25));
});

await ok('ansi: truncate never exceeds width and adds ellipsis', () => {
  assert.strictEqual(ansi.truncate('hello world', 5), 'hell…');
  assert.strictEqual(ansi.truncate('hi', 5), 'hi');
  assert.strictEqual(ansi.truncate('日本語', 4), '日…');
  assert.ok(ansi.visibleWidth(ansi.truncate('日本語テスト', 5)) <= 5);
});

await ok('ansi: pad fills to exact width', () => {
  assert.strictEqual(ansi.pad('ab', 5), 'ab   ');
  assert.strictEqual(ansi.visibleWidth(ansi.pad('日本語', 6)), 6);
  assert.strictEqual(ansi.pad('abcdef', 3), 'ab…');
});

await ok('ansi: paint emits truecolor, 256, and mono honestly', () => {
  const tc = withColor({ COLORTERM: 'truecolor', NO_COLOR: undefined }, () => ansi.paint('x', 'ember'));
  assert.ok(tc.includes('38;2;255;122;61'), `expected truecolor, got ${JSON.stringify(tc)}`);
  const x256 = withColor({ COLORTERM: undefined, TERM: 'xterm-256color' }, () => ansi.paint('x', 'ember'));
  assert.ok(x256.includes('38;5;209'), `expected 256, got ${JSON.stringify(x256)}`);
  const mono = withColor({ NO_COLOR: '1' }, () => ansi.paint('x', 'ember'));
  assert.strictEqual(mono, 'x');
  // Attributes still apply in mono mode (bold works without color).
  const bold = withColor({ NO_COLOR: '1' }, () => ansi.paint('x', 'ember', { bold: true }));
  assert.strictEqual(bold, '\x1b[1mx\x1b[0m');
});

// ── rows: the real emitted vocabulary ─────────────────────────────────────
await ok('rows: stream/think/narration/log map to their row kinds', () => {
  const r = (e) => rows.eventToRows(e);
  assert.strictEqual(r({ type: 'stream', text: 'hi' })[0].kind, 'text');
  assert.strictEqual(r({ type: 'message.delta', payload: { delta: 'x' } })[0].kind, 'text');
  assert.strictEqual(r({ type: 'think', text: 'hmm', by: 'Coder' })[0].kind, 'thinking');
  assert.strictEqual(r({ type: 'narration', text: 'ok' })[0].kind, 'narration');
  assert.strictEqual(r({ type: 'log', agent: 'JEXI', message: 'doing' })[0].kind, 'log');
  assert.strictEqual(r({ type: 'log', agent: 'JEXI', message: 'doing' })[0].agent, 'JEXI');
});

await ok('rows: plan carries real steps', () => {
  const [row] = rows.eventToRows({ type: 'plan', intent: 'research', steps: [{ title: 'a' }, { name: 'b' }], roster: ['x'] });
  assert.strictEqual(row.kind, 'plan');
  assert.deepStrictEqual(row.meta.steps, ['a', 'b']);
  assert.strictEqual(row.meta.roster, 1);
});

await ok('rows: tool_use status picks the row family', () => {
  const run = rows.eventToRows({ type: 'tool_use', id: 'tu-1', tool: 'Bash', slug: 'ls -la', status: 'running' })[0];
  assert.strictEqual(run.kind, 'tool-use');
  assert.strictEqual(run.id, 'tu-1');
  const done = rows.eventToRows({ type: 'tool_use', id: 'tu-1', tool: 'Bash', status: 'success', duration_ms: 12, summary: 'ok' })[0];
  assert.strictEqual(done.kind, 'tool-result');
  assert.strictEqual(done.meta.durationMs, 12);
  const bad = rows.eventToRows({ type: 'tool_use', id: 'tu-2', tool: 'Bash', status: 'error', summary: 'boom' })[0];
  assert.strictEqual(bad.kind, 'tool-error');
  assert.ok(bad.meta.error.includes('boom'));
});

await ok('rows: taxonomy tool events also map', () => {
  const s = rows.eventToRows({ type: 'tool.started', payload: { toolName: 'read_file', args: { path: '/x' } } })[0];
  assert.strictEqual(s.kind, 'tool-use');
  assert.ok(s.meta.args.includes('/x'));
  const c = rows.eventToRows({ type: 'tool.completed', payload: { toolName: 'read_file', result: 'body' } })[0];
  assert.strictEqual(c.kind, 'tool-result');
  const f = rows.eventToRows({ type: 'tool.failed', payload: { toolName: 'read_file', error: 'nope' } })[0];
  assert.strictEqual(f.kind, 'tool-error');
});

await ok('rows: done / turn.completed / error are terminal', () => {
  const d = rows.eventToRows({ type: 'done', summary: 'All good', durationMs: 42, firstTokenMs: 7, by: 'Jexi' })[0];
  assert.strictEqual(d.kind, 'turn-end-ok');
  assert.strictEqual(d.meta.durationMs, 42);
  assert.strictEqual(d.meta.firstTokenMs, 7);
  const fail = rows.eventToRows({ type: 'done', success: false, summary: 'nope' })[0];
  assert.strictEqual(fail.kind, 'turn-end-fail');
  const err = rows.eventToRows({ type: 'error', error: 'boom' })[0];
  assert.strictEqual(err.kind, 'turn-end-fail');
  assert.ok(rows.isTerminal({ type: 'done' }) && rows.isTerminal({ type: 'error' }));
  assert.ok(!rows.isTerminal({ type: 'stream' }));
});

await ok('rows: approval + agent + command events map', () => {
  assert.strictEqual(rows.eventToRows({ type: 'approval.requested', payload: { reason: 'write file' } })[0].kind, 'approval');
  assert.strictEqual(rows.eventToRows({ type: 'agent.spawned', payload: { agentName: 'Coder' } })[0].kind, 'agent');
  const cmd = rows.eventToRows({ type: 'command', id: 'c1', cmd: 'ls' })[0];
  assert.strictEqual(cmd.kind, 'command');
  assert.strictEqual(cmd.id, 'c1');
  const cdone = rows.eventToRows({ type: 'command.done', id: 'c1', exit: 0, stdout: 'ok' })[0];
  assert.strictEqual(cdone.meta.status, 'success');
});

await ok('rows: telemetry and unknown events produce no rows', () => {
  assert.strictEqual(rows.eventToRows({ type: 'heartbeat' }).length, 0);
  assert.strictEqual(rows.eventToRows({ type: 'team', event: {} }).length, 0);
  assert.strictEqual(rows.eventToRows({ type: 'totally.unknown' }).length, 0);
  assert.strictEqual(rows.eventToRows(null).length, 0);
});

await ok('rows: ask.secret is surfaced, not rendered', () => {
  const evt = { type: 'ask.secret', conv: 'c', id: 'gk-1', tool: 'github', reason: 'to push' };
  assert.strictEqual(rows.eventToRows(evt).length, 0);
  assert.deepStrictEqual(rows.secretAskOf(evt), { conv: 'c', id: 'gk-1', tool: 'github', reason: 'to push' });
  assert.strictEqual(rows.secretAskOf({ type: 'stream' }), null);
});

// ── transcript ────────────────────────────────────────────────────────────
await ok('transcript: streaming deltas merge into one row', () => {
  const t = tx.createTranscript();
  tx.applyEvent(t, { type: 'stream', text: 'Hel' });
  tx.applyEvent(t, { type: 'stream', text: 'lo' });
  tx.applyEvent(t, { type: 'stream', text: ' world' });
  assert.strictEqual(t.rows.length, 1);
  assert.strictEqual(t.rows[0].text, 'Hello world');
});

await ok('transcript: a different agent starts a new text row', () => {
  const t = tx.createTranscript();
  tx.applyEvent(t, { type: 'stream', text: 'a', by: 'JEXI' });
  tx.applyEvent(t, { type: 'stream', text: 'b', by: 'Coder' });
  assert.strictEqual(t.rows.length, 2);
});

await ok('transcript: tool rows update in place and count once', () => {
  const t = tx.createTranscript();
  tx.applyEvent(t, { type: 'tool_use', id: 'tu-1', tool: 'Bash', status: 'running' });
  assert.strictEqual(t.rows.length, 1);
  assert.strictEqual(t.stats.tools, 0);
  tx.applyEvent(t, { type: 'tool_use', id: 'tu-1', tool: 'Bash', status: 'success', duration_ms: 5 });
  assert.strictEqual(t.rows.length, 1, 'still one row after completion');
  assert.strictEqual(t.rows[0].kind, 'tool-result');
  assert.strictEqual(t.stats.tools, 1);
  assert.strictEqual(t.stats.toolErrors, 0);
});

await ok('transcript: a failing tool counts as an error', () => {
  const t = tx.createTranscript();
  tx.applyEvent(t, { type: 'tool_use', id: 'tu-9', tool: 'Bash', status: 'running' });
  tx.applyEvent(t, { type: 'tool_use', id: 'tu-9', tool: 'Bash', status: 'error', summary: 'x' });
  assert.strictEqual(t.stats.tools, 1);
  assert.strictEqual(t.stats.toolErrors, 1);
});

await ok('transcript: terminal events bump the turn count and capture stats', () => {
  const t = tx.createTranscript();
  const out = tx.applyEvent(t, { type: 'done', summary: 'ok', durationMs: 1234, firstTokenMs: 88, by: 'Jexi' });
  assert.ok(out.terminal);
  assert.strictEqual(t.stats.turns, 1);
  assert.strictEqual(t.stats.lastDurationMs, 1234);
  assert.strictEqual(t.stats.firstTokenMs, 88);
  assert.strictEqual(t.stats.by, 'Jexi');
});

await ok('transcript: heartbeats change nothing', () => {
  const t = tx.createTranscript();
  const out = tx.applyEvent(t, { type: 'heartbeat' });
  assert.strictEqual(out.changed, false);
  assert.strictEqual(t.rows.length, 0);
});

await ok('transcript: local rows and reset', () => {
  const t = tx.createTranscript();
  tx.pushLocal(t, 'user', 'hello');
  assert.strictEqual(t.rows[0].kind, 'user');
  tx.applyEvent(t, { type: 'stream', text: 'x' });
  tx.resetTranscript(t);
  assert.strictEqual(t.rows.length, 0);
  assert.strictEqual(t.stats.tools, 0);
});

// ── render ────────────────────────────────────────────────────────────────
await ok('render: frame is exactly `rows` lines, none wider than `cols`', () => {
  const t = tx.createTranscript();
  tx.pushLocal(t, 'user', 'write a scheduler runbook');
  tx.applyEvent(t, { type: 'narration', text: 'Understood.' });
  tx.applyEvent(t, { type: 'stream', text: 'Working on it. '.repeat(40) });
  tx.applyEvent(t, { type: 'tool_use', id: 'tu-1', tool: 'write_file', slug: 'runbook.md', status: 'running' });
  tx.applyEvent(t, { type: 'tool_use', id: 'tu-1', tool: 'write_file', status: 'success', duration_ms: 12, summary: 'wrote runbook.md' });
  tx.applyEvent(t, { type: 'done', summary: 'Done.', durationMs: 900, firstTokenMs: 100 });

  for (const [cols, rws] of [[80, 24], [120, 40], [40, 12], [200, 60]]) {
    const lines = render.composeView(t, { cols, rows: rws, model: 'groq/llama', header: { baseUrl: 'http://127.0.0.1:3210' } });
    assert.strictEqual(lines.length, rws, `height for ${cols}x${rws}`);
    for (const l of lines) {
      assert.ok(ansi.visibleWidth(l) <= cols, `line overflows ${cols}: ${JSON.stringify(l)}`);
    }
  }
});

await ok('render: header and status carry real values', () => {
  const t = tx.createTranscript();
  tx.applyEvent(t, { type: 'tool_use', id: 'tu-1', tool: 'Bash', status: 'running' });
  tx.applyEvent(t, { type: 'tool_use', id: 'tu-1', tool: 'Bash', status: 'success' });
  const lines = render.composeView(t, {
    cols: 100, rows: 20, model: 'groq/llama-3',
    header: { baseUrl: 'http://127.0.0.1:3210', workspace: '/tmp/ws', sessionId: 'tui-1' },
  });
  const all = lines.join('\n');
  assert.ok(all.includes('http://127.0.0.1:3210'), 'backend url in header');
  assert.ok(all.includes('/tmp/ws'), 'workspace in header');
  assert.ok(all.includes('groq/llama-3'), 'model in status');
  assert.ok(all.includes('1 tools'), 'tool count in status');
});

await ok('render: scroll moves the viewport without changing height', () => {
  const t = tx.createTranscript();
  for (let i = 0; i < 60; i++) tx.pushLocal(t, 'user', `line ${i}`);
  const bottom = render.composeView(t, { cols: 80, rows: 20 });
  const scrolled = render.composeView(t, { cols: 80, rows: 20, scroll: 25 });
  assert.strictEqual(scrolled.length, 20);
  assert.notDeepStrictEqual(bottom, scrolled);
  // Scrolling up must reveal older content.
  assert.ok(scrolled.join('\n').includes('line 20') || scrolled.join('\n').includes('line 19'));
});

await ok('render: composer shows placeholder when idle and the input when typing', () => {
  const t = tx.createTranscript();
  const idle = render.composeView(t, { cols: 80, rows: 12 }).join('\n');
  assert.ok(idle.includes('ask JEXI anything'), 'placeholder shown');
  const typing = render.composeView(t, { cols: 80, rows: 12, input: 'build me a thing' }).join('\n');
  assert.ok(typing.includes('build me a thing'));
});

await ok('render: every row kind renders without throwing', () => {
  const t = tx.createTranscript();
  const events = [
    { type: 'stream', text: 'answer' }, { type: 'think', text: 'reasoning' },
    { type: 'narration', text: 'narrating' }, { type: 'plan', intent: 'code', steps: [{ title: 's1' }] },
    { type: 'tool.started', payload: { toolName: 'read_file', args: { p: 1 } } },
    { type: 'tool.completed', payload: { toolName: 'read_file', result: 'data' } },
    { type: 'tool.failed', payload: { toolName: 'read_file', error: 'err' } },
    { type: 'approval.requested', payload: { reason: 'write' } },
    { type: 'agent.spawned', payload: { agentName: 'Coder' } },
    { type: 'command', id: 'c1', cmd: 'ls' }, { type: 'command.done', id: 'c1', exit: 0, stdout: 'ok' },
    { type: 'log', agent: 'X', message: 'log line' }, { type: 'done', summary: 'fin' },
    { type: 'error', error: 'bad' },
  ];
  for (const e of events) tx.applyEvent(t, e);
  const lines = render.composeView(t, { cols: 90, rows: 40 });
  assert.strictEqual(lines.length, 40);
  const all = lines.join('\n');
  assert.ok(all.includes('answer') && all.includes('reasoning') && all.includes('read_file'));
  assert.ok(all.includes('turn completed') || all.includes('turn failed'));
});

// ── key decoding ──────────────────────────────────────────────────────────
async function collectKeys(chunks, state = { quit: false }) {
  const input = Readable.from(chunks.map((c) => Buffer.from(c, 'utf8')));
  const keys = [];
  for await (const k of app.readKeys(input, state)) keys.push(k);
  return keys;
}

await ok('keys: printable text, enter, backspace, ctrl', async () => {
  const keys = await collectKeys(['ab', '\r', 'c', '\x7f', '\x03', '\x0c']);
  assert.deepStrictEqual(keys, ['a', 'b', 'ENTER', 'c', 'BACKSPACE', 'CTRL_C', 'CTRL_L']);
});

await ok('keys: arrow and navigation sequences decode', async () => {
  const keys = await collectKeys(['\x1b[A\x1b[B\x1b[C\x1b[D', '\x1b[5~\x1b[6~', '\x1b[3~', '\x1b[H\x1b[F']);
  assert.deepStrictEqual(keys, ['UP', 'DOWN', 'RIGHT', 'LEFT', 'PGUP', 'PGDN', 'DELETE', 'HOME', 'END']);
});

await ok('keys: an escape sequence split across chunks still decodes', async () => {
  const keys = await collectKeys(['\x1b[', 'A', 'x']);
  assert.deepStrictEqual(keys, ['UP', 'x']);
});

await ok('keys: a multi-byte character split across chunks still decodes', async () => {
  const bytes = Buffer.from('日', 'utf8');
  const input = Readable.from([bytes.subarray(0, 1), bytes.subarray(1)]);
  const keys = [];
  for await (const k of app.readKeys(input, { quit: false })) keys.push(k);
  assert.deepStrictEqual(keys, ['日']);
});

await ok('keys: a pasted multi-char string yields each char', async () => {
  const keys = await collectKeys(['jexi tui']);
  assert.strictEqual(keys.join(''), 'jexi tui');
});

await ok('keys: named keys are never mistaken for typed text', () => {
  assert.ok(app.isTextKey('a') && app.isTextKey('日') && app.isTextKey(' '));
  for (const k of ['TAB', 'ESC', 'ENTER', 'UP', 'CTRL_C', 'PGDN', 'DELETE']) {
    assert.ok(!app.isTextKey(k), `${k} must not be text`);
  }
});

await ok('app: Tab and Esc never insert their names into the input', async () => {
  const api = fakeApi(() => [{ type: 'done', summary: 'x' }]);
  // Tab, Esc, then a real word, then send.
  const stdin = fakeStdin(['\t\x1bword', '\r', '\x03']);
  const stdout = fakeStdout();
  await app.runTui({ input: stdin, output: stdout, api, headless: true });
  assert.deepStrictEqual(api.calls.chat, ['word'], 'only the typed word was submitted');
});

// ── writer ────────────────────────────────────────────────────────────────
await ok('writer: enter/leave use alt screen and restore the cursor', () => {
  const chunks = [];
  const out = { write: (s) => chunks.push(s) };
  const w = app.createWriter(out);
  w.enter();
  w.frame(['a', 'b']);
  w.leave();
  const all = chunks.join('');
  assert.ok(all.includes('\x1b[?1049h'), 'alt screen on');
  assert.ok(all.includes('\x1b[?1049l'), 'alt screen off');
  assert.ok(all.includes('\x1b[?25l') && all.includes('\x1b[?25h'), 'cursor hidden then shown');
  assert.ok(all.includes('\x1b[?2026h') && all.includes('\x1b[?2026l'), 'synchronized update block');
  assert.ok(all.includes('a\x1b[K'), 'clear-to-EOL per line');
  assert.ok(all.includes('\x1b[0J'), 'clear to end of screen');
});

await ok('writer: colors survive the frame write', () => {
  const chunks = [];
  const out = { write: (s) => chunks.push(s) };
  const w = app.createWriter(out);
  w.enter();
  const painted = withColor({ COLORTERM: 'truecolor' }, () => ansi.paint('colored', 'ember'));
  w.frame([painted]);
  assert.ok(chunks.join('').includes('38;2;255;122;61'), 'ANSI preserved in frame');
});

// ── full app loop (headless, fake backend + fake stdin) ───────────────────
function fakeApi(script) {
  const calls = { chat: [], secrets: [] };
  return {
    baseUrl: 'http://127.0.0.1:9',
    calls,
    async chatStream(query, { onEvent, signal } = {}) {
      calls.chat.push(query);
      const events = script(query) || [];
      for (const e of events) {
        if (signal && signal.aborted) throw new Error('aborted');
        onEvent(e);
      }
      const terminal = events.find((e) => e.type === 'done' || e.type === 'error') || null;
      return { done: terminal, events: events.length };
    },
    async secretsAnswer(body) { calls.secrets.push(body); return { ok: true, status: 200, data: { ok: true } }; },
    async providersActive() { return { ok: true, data: { active: { configured: true, provider: 'groq', model: 'llama' } } }; },
    async health() { return { ok: true, data: { ok: true, name: 'brain', version: '1.3.0', uptime: 5 } }; },
  };
}

function fakeStdin(chunks) {
  const stream = Readable.from(chunks.map((c) => Buffer.from(c, 'utf8')));
  stream.isTTY = false;
  return stream;
}

function fakeStdout() {
  const chunks = [];
  const stream = new Writable({ write(c, _e, cb) { chunks.push(c.toString()); cb(); } });
  stream.columns = 100;
  stream.rows = 30;
  stream.isTTY = false;
  stream.chunks = chunks;
  return stream;
}

await ok('app: a full turn streams into the transcript and quits on Ctrl+C', async () => {
  const api = fakeApi(() => [
    { type: 'narration', text: 'on it' },
    { type: 'plan', intent: 'code', steps: [{ title: 'write file' }] },
    { type: 'tool_use', id: 'tu-1', tool: 'write_file', status: 'running' },
    { type: 'tool_use', id: 'tu-1', tool: 'write_file', status: 'success', duration_ms: 9, summary: 'wrote runbook.md' },
    { type: 'stream', text: 'Wrote the runbook.' },
    { type: 'done', summary: 'Wrote the runbook.', durationMs: 500, firstTokenMs: 40 },
  ]);
  const stdin = fakeStdin(['write a runbook', '\r', '\x03']);
  const stdout = fakeStdout();
  const state = await app.runTui({ input: stdin, output: stdout, api, model: 'groq/llama', workspace: '/tmp/ws', headless: true });

  assert.deepStrictEqual(api.calls.chat, ['write a runbook']);
  const kinds = state.t.rows.map((r) => r.kind);
  assert.ok(kinds.includes('user'), 'user row');
  assert.ok(kinds.includes('narration'));
  assert.ok(kinds.includes('plan'));
  assert.ok(kinds.includes('tool-result'), 'tool completed in place');
  assert.ok(kinds.includes('text'));
  assert.ok(kinds.includes('turn-end-ok'));
  assert.strictEqual(state.t.stats.tools, 1);
  assert.strictEqual(state.t.stats.turns, 1);
  assert.ok(stdout.chunks.join('').includes('Wrote the runbook.'), 'answer reached the frame');
});

await ok('app: a failing backend reports the real error, no canned answer', async () => {
  const api = fakeApi(() => { throw new Error('connect ECONNREFUSED 127.0.0.1:9'); });
  const stdin = fakeStdin(['do something', '\r', '\x03']);
  const stdout = fakeStdout();
  const state = await app.runTui({ input: stdin, output: stdout, api, headless: true });
  const failed = state.t.rows.filter((r) => r.kind === 'turn-end-fail');
  assert.strictEqual(failed.length, 1);
  assert.ok(failed[0].text.includes('ECONNREFUSED'), 'real error surfaced');
  assert.ok(stdout.chunks.join('').includes('ECONNREFUSED'));
});

await ok('app: a one-time secret ask pauses, accepts a paste, and resumes', async () => {
  let turn = 0;
  const api = fakeApi((query) => {
    turn += 1;
    if (turn === 1) return [
      { type: 'ask.secret', conv: 'c', id: 'gk-1', tool: 'github', reason: 'to push' },
      { type: 'done', summary: 'waiting for key' },
    ];
    return [{ type: 'stream', text: `resumed: ${query}` }, { type: 'done', summary: 'pushed' }];
  });
  // type the task, then paste a fake key, then quit
  const stdin = fakeStdin(['push it', '\r', 'ghp_FAKEKEY', '\r', '\x03']);
  const stdout = fakeStdout();
  const state = await app.runTui({ input: stdin, output: stdout, api, headless: true });

  assert.strictEqual(api.calls.secrets.length, 1);
  assert.strictEqual(api.calls.secrets[0].value, 'ghp_FAKEKEY');
  assert.strictEqual(api.calls.chat.length, 2, 'turn resumed after the key');
  assert.ok(api.calls.chat[1].startsWith('continue:'));
  assert.ok(!stdout.chunks.join('').includes('ghp_FAKEKEY'), 'secret never echoed to the screen');
  assert.ok(state.t.rows.some((r) => r.kind === 'text' && r.text.includes('resumed')));
});

await ok('app: /help and /clear run locally without touching the backend', async () => {
  const api = fakeApi(() => [{ type: 'done', summary: 'x' }]);
  const stdin = fakeStdin(['/help', '\r', '/clear', '\r', '\x03']);
  const stdout = fakeStdout();
  const state = await app.runTui({ input: stdin, output: stdout, api, headless: true });
  assert.strictEqual(api.calls.chat.length, 0, 'no backend call for local commands');
  assert.strictEqual(state.t.rows.length, 0, 'transcript cleared');
});

await ok('app: an unknown slash command reports honestly', async () => {
  const api = fakeApi(() => []);
  const stdin = fakeStdin(['/nope', '\r', '\x03']);
  const stdout = fakeStdout();
  const state = await app.runTui({ input: stdin, output: stdout, api, headless: true });
  assert.ok(state.t.rows.some((r) => r.text && r.text.includes('unknown command: /nope')));
});

await ok('app: a turn with no terminal event is reported, not hidden', async () => {
  const api = fakeApi(() => [{ type: 'stream', text: 'partial' }]);
  const stdin = fakeStdin(['hi', '\r', '\x03']);
  const stdout = fakeStdout();
  const state = await app.runTui({ input: stdin, output: stdout, api, headless: true });
  assert.ok(state.t.rows.some((r) => r.text && r.text.includes('without a terminal event')));
});

await ok('app: /model reads the real active provider', async () => {
  const api = fakeApi(() => []);
  const stdin = fakeStdin(['/model', '\r', '\x03']);
  const stdout = fakeStdout();
  const state = await app.runTui({ input: stdin, output: stdout, api, headless: true });
  assert.strictEqual(state.model, 'groq/llama');
});

console.log(`\njexi tui: ${passed} checks passed${process.exitCode ? ' (WITH FAILURES)' : ''}`);
