/**
 * JEXI live streaming — the browser bridge.
 *
 * These are the failure modes that make a streamed answer wrong in ways you
 * only notice in production: a chunk boundary landing mid-line, a bad line
 * poisoning the stream, a stream that ends with no terminal event being
 * displayed as a success, and a non-abort error masquerading as a cancel.
 *
 * The module under test is the EXACT file the browser loads
 * (public/live-stream.js), not a copy.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  LiveBridge, createNdjsonReader, mapEvent, readTerminal, TERMINAL_TYPES,
} from '../../../interfaces/deck/live-stream.js';

/* ── NDJSON chunk boundaries ───────────────────────────────────────── */

test('STREAM: a line split across chunks is reassembled, not dropped', () => {
  const r = createNdjsonReader();
  assert.deepEqual(r.push('{"type":"str'), []);        // nothing complete yet
  assert.deepEqual(r.push('eam","text":"hi"}'), []);  // still no newline
  assert.deepEqual(r.push('\n'), ['{"type":"stream","text":"hi"}']);
  assert.equal(r.rest(), '');
});

test('STREAM: several lines in one chunk all come out', () => {
  const r = createNdjsonReader();
  assert.deepEqual(r.push('{"a":1}\n{"b":2}\n'), ['{"a":1}', '{"b":2}']);
});

test('STREAM: blank lines are ignored, not emitted as empty events', () => {
  const r = createNdjsonReader();
  assert.deepEqual(r.push('{"a":1}\n\n   \n{"b":2}\n'), ['{"a":1}', '{"b":2}']);
});

test('STREAM: a trailing partial line is recoverable on flush', () => {
  const r = createNdjsonReader();
  r.push('{"a":1}\n{"b":2}');
  assert.equal(r.rest(), '{"b":2}');
  assert.deepEqual(r.flush(), ['{"b":2}']);
  assert.deepEqual(r.flush(), [], 'flush is not repeatable');
});

/* ── event mapping ─────────────────────────────────────────────────── */

test('STREAM: every terminal type is recognised', () => {
  assert.ok(TERMINAL_TYPES.has('done'));
  assert.ok(TERMINAL_TYPES.has('agent.done'));
  assert.ok(!TERMINAL_TYPES.has('stream'));
});

test('STREAM: the terminal answer is read from either wire shape', () => {
  assert.equal(readTerminal({ type: 'done', summary: 'from summary' }).answer, 'from summary');
  assert.equal(readTerminal({ type: 'agent.done', answer: 'from answer' }).answer, 'from answer');
  assert.equal(readTerminal({ type: 'stream', text: 'x' }), null);
});

test('STREAM: an unknown event type still renders — it is never dropped', () => {
  const row = mapEvent({ type: 'something.new', detail: 1 });
  assert.ok(row, 'an unmapped type must still produce a row');
  assert.equal(row.n, 'something.new');
});

test('STREAM: detail is HTML-escaped so a stream cannot inject markup', () => {
  const row = mapEvent({ type: 'log', message: '<img src=x onerror=alert(1)>' });
  assert.ok(!row.d.includes('<img'), 'raw tag leaked into innerHTML');
  assert.ok(row.d.includes('&lt;img'));
});

test('STREAM: a non-zero command exit maps to an error row', () => {
  assert.equal(mapEvent({ type: 'command.done', exit: 0 }).k, 'ok');
  assert.equal(mapEvent({ type: 'command.done', exit: 1 }).k, 'err');
});

/* ── the bridge, over a fake fetch ─────────────────────────────────── */

function fakeFetch(chunks, { status = 200, body = true } = {}) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    if (status !== 200) {
      return { ok: false, status, text: async () => 'upstream said no' };
    }
    const enc = new TextEncoder();
    return {
      ok: true, status: 200,
      body: body ? (async function* () { for (const c of chunks) yield enc.encode(c); })() : null,
    };
  };
  impl.calls = calls;
  return impl;
}

const collect = () => {
  const events = [], deltas = [], states = [];
  return {
    events, deltas, states,
    onEvent: (r) => events.push(r),
    onDelta: (t) => deltas.push(t),
    onState: (s) => states.push(s),
  };
};

test('STREAM: a full turn streams its answer and reports done', async () => {
  const c = collect();
  const f = fakeFetch([
    '{"type":"agent.plan","intent":"code","tools":[{"slug":"a"}]}\n',
    '{"type":"stream","text":"The "}\n{"type":"stream","text":"suite is green."}\n',
    '{"type":"done","summary":"The suite is green."}\n',
  ]);
  const b = new LiveBridge({ ...c, fetchImpl: f });
  const r = await b.send('fix the failing suite');

  assert.equal(r.ok, true);
  assert.equal(r.answer, 'The suite is green.');
  assert.equal(r.deltas, 2);
  assert.equal(c.deltas.join(''), 'The suite is green.');
  assert.equal(c.states.at(-1).phase, 'done');
  assert.equal(f.calls[0].init.method, 'POST');
  assert.match(f.calls[0].init.body, /fix the failing suite/);
});

test('STREAM: the answer survives a chunk boundary mid-sentence', async () => {
  const c = collect();
  // every chunk cuts a line in half
  const f = fakeFetch(['{"type":"stream","te', 'xt":"Hello wor', 'ld"}\n{"type":"done","summary":"Hello world"}\n']);
  const b = new LiveBridge({ ...c, fetchImpl: f });
  const r = await b.send('hi');
  assert.equal(r.ok, true);
  assert.equal(r.answer, 'Hello world');
});

test('STREAM: a malformed line is counted and the stream continues', async () => {
  const c = collect();
  const f = fakeFetch([
    '{ this is not json\n',
    '{"type":"done","summary":"still finished"}\n',
  ]);
  const b = new LiveBridge({ ...c, fetchImpl: f });
  const r = await b.send('hi');
  assert.equal(r.ok, true, 'one bad line must not kill the turn');
  assert.equal(r.malformed, 1);
  assert.equal(r.answer, 'still finished');
});

test('STREAM: a stream with no terminal event is NOT reported as success', async () => {
  const c = collect();
  const f = fakeFetch(['{"type":"stream","text":"partial answer"}\n']);
  const b = new LiveBridge({ ...c, fetchImpl: f });
  const r = await b.send('hi');
  assert.equal(r.ok, false);
  assert.match(r.reason, /without a terminal event/);
  assert.equal(c.states.at(-1).phase, 'error');
});

test('STREAM: a stream that ends with a trailing partial line still resolves', async () => {
  const c = collect();
  // no trailing newline on the terminal event
  const f = fakeFetch(['{"type":"done","summary":"no newline at the end"}']);
  const b = new LiveBridge({ ...c, fetchImpl: f });
  const r = await b.send('hi');
  assert.equal(r.ok, true);
  assert.equal(r.answer, 'no newline at the end');
});

test('STREAM: HTTP failure surfaces the status and the server body', async () => {
  const c = collect();
  const b = new LiveBridge({ ...c, fetchImpl: fakeFetch([], { status: 503 }) });
  const r = await b.send('hi');
  assert.equal(r.ok, false);
  assert.match(r.reason, /HTTP 503/);
  assert.match(r.detail, /upstream said no/);
});

test('STREAM: a response with no body is an error, not an empty success', async () => {
  const c = collect();
  const b = new LiveBridge({ ...c, fetchImpl: fakeFetch([], { body: false }) });
  const r = await b.send('hi');
  assert.equal(r.ok, false);
  assert.match(r.reason, /cannot stream/);
});

test('STREAM: an abort is reported as aborted, not as an error', async () => {
  const c = collect();
  const f = async (url, init) => {
    const err = new Error('The user aborted a request.');
    err.name = 'AbortError';
    throw err;
  };
  const b = new LiveBridge({ ...c, fetchImpl: f });
  const r = await b.send('hi');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'aborted');
  assert.equal(r.aborted, true);
  assert.equal(c.states.at(-1).phase, 'aborted');
});

test('STREAM: a real network failure is not mislabelled as an abort', async () => {
  const c = collect();
  const f = async () => { throw new Error('ECONNREFUSED'); };
  const b = new LiveBridge({ ...c, fetchImpl: f });
  const r = await b.send('hi');
  assert.equal(r.reason, 'ECONNREFUSED');
  assert.equal(r.aborted, false, 'an explicit false — "this was not an abort" — not a missing field');
  assert.equal(c.states.at(-1).phase, 'error');
});

test('STREAM: a second send while busy is refused instead of interleaving', async () => {
  const c = collect();
  let release;
  const gate = new Promise((res) => { release = res; });
  const enc = new TextEncoder();
  const f = async () => ({
    ok: true, status: 200,
    body: (async function* () { await gate; yield enc.encode('{"type":"done","summary":"one"}\n'); })(),
  });
  const b = new LiveBridge({ ...c, fetchImpl: f });
  const first = b.send('one');
  const second = await b.send('two');
  assert.equal(second.ok, false);
  assert.equal(second.reason, 'busy');
  release();
  await first;
  assert.equal(b.busy, false, 'busy must clear so the next turn can run');
});

test('STREAM: an empty question is refused without a request', async () => {
  const c = collect();
  const f = fakeFetch([]);
  const b = new LiveBridge({ ...c, fetchImpl: f });
  assert.equal((await b.send('   ')).reason, 'empty');
  assert.equal(f.calls.length, 0);
});

test('STREAM: state does not leak between turns', async () => {
  const c = collect();
  const enc = new TextEncoder();
  let body = '{"type":"done","summary":"first"}\n';
  const f = async () => ({ ok: true, status: 200, body: (async function* () { yield enc.encode(body); })() });
  const b = new LiveBridge({ ...c, fetchImpl: f });

  await b.send('one');
  body = '{bad\n{"type":"done","summary":"second"}\n';
  const r = await b.send('two');
  assert.equal(r.answer, 'second', 'the previous turn answer must not be prepended');
  assert.equal(r.malformed, 1, 'the malformed counter must reset per turn');
});

/* ── the per-chunk flush bug ──────────────────────────────────────────
 * A regression guard for a real defect found by driving the browser against
 * a live socket: the read loop called flush() on every chunk, and flush()
 * EMPTIES the carry buffer. A line that had only partly arrived was therefore
 * handed to the parser as if complete — JSON.parse failed, the event was
 * counted malformed, and the remainder arrived as an orphan fragment. The
 * answer lost text while the stream still looked healthy. */

test('STREAM: a partial line is never flushed early just because more chunks came', async () => {
  const c = collect();
  const f = fakeFetch([
    '{"type":"stream","text":"one "}\n{"type":"str',
    'eam","text":"two "}\n{"type":"str',
    'eam","text":"three"}\n{"type":"done","summary":"one two three"}\n',
  ]);
  const b = new LiveBridge({ ...c, fetchImpl: f });
  const r = await b.send('hi');

  assert.equal(r.ok, true);
  assert.equal(r.malformed, 0, 'a split line must not be counted as malformed');
  assert.equal(r.deltas, 3, 'all three deltas must arrive');
  assert.equal(r.answer, 'one two three');
  assert.equal(c.deltas.join(''), 'one two three');
});

test('STREAM: a genuinely malformed line is still counted exactly once', async () => {
  const c = collect();
  const f = fakeFetch([
    'garbage\n{"type":"stream","text":"a"}\n{"type":"done","summary":"a"}\n',
  ]);
  const b = new LiveBridge({ ...c, fetchImpl: f });
  const r = await b.send('hi');
  assert.equal(r.malformed, 1);
  assert.equal(r.answer, 'a');
});

test('STREAM: many small chunks still produce the whole answer', async () => {
  const c = collect();
  const payload = '{"type":"stream","text":"abcdefghij"}\n{"type":"done","summary":"abcdefghij"}\n';
  const chunks = [];
  for (let i = 0; i < payload.length; i += 3) chunks.push(payload.slice(i, i + 3));
  const f = fakeFetch(chunks);
  const b = new LiveBridge({ ...c, fetchImpl: f });
  const r = await b.send('hi');
  assert.equal(r.malformed, 0);
  assert.equal(r.answer, 'abcdefghij');
});
