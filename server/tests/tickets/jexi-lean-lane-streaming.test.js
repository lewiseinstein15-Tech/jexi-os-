/**
 * The lean lane must STREAM.
 *
 * The lean lane is the path a simple question actually takes, and it used to
 * call the provider with no streaming callback. The user therefore saw a blank
 * panel for the whole model call and then a snap to the finished text — the
 * symptom of "live streaming doesn't work" on the most common question there
 * is. The regression was invisible because the only way to observe the call
 * was with a live provider; `runLeanAnswer` now takes a `generate` seam.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { runLeanAnswer } from '../../src/services/JexiKernel.js';

test('STREAM: the lean lane forwards every delta as a `stream` event', async () => {
  const events = [];
  const r = await runLeanAnswer({
    query: 'why?',
    sendEvent: (type, data) => events.push({ type, data }),
    generate: async (_p, _s, _img, opts) => {
      // a real streaming provider delivers many small deltas
      for (const d of ['A ', 'passing ', 'suite ', 'means ', 'the code ', 'meets ', 'the spec.']) {
        opts.onToken(d);
      }
      return 'A passing suite means the code meets the spec.';
    },
  });

  const stream = events.filter((e) => e.type === 'stream');
  assert.equal(stream.length, 7, 'every delta must be forwarded, not just the last one');
  assert.equal(stream.map((e) => e.data.text).join(''), 'A passing suite means the code meets the spec.');
  assert.equal(r.handled, true);
  assert.equal(r.streamed, true);
  assert.equal(r.answer, 'A passing suite means the code meets the spec.');
});

test('STREAM: the lean lane still answers when a provider streams but returns nothing', async () => {
  const events = [];
  const r = await runLeanAnswer({
    query: 'why?',
    sendEvent: (type, data) => events.push({ type, data }),
    generate: async (_p, _s, _img, opts) => { opts.onToken('the answer arrived only as deltas'); return ''; },
  });
  assert.equal(r.handled, true, 'a streamed answer must not be thrown away as empty');
  assert.equal(r.answer, 'the answer arrived only as deltas');
});

test('STREAM: the lean lane still works on a provider that does not stream', async () => {
  const events = [];
  const r = await runLeanAnswer({
    query: 'why?',
    sendEvent: (type, data) => events.push({ type, data }),
    generate: async () => 'a complete answer in one piece',
  });
  assert.equal(r.handled, true);
  assert.equal(r.answer, 'a complete answer in one piece');
  assert.equal(events.filter((e) => e.type === 'stream').length, 0, 'no deltas means no stream events');
});

test('STREAM: an empty delta is never forwarded as an event', async () => {
  const events = [];
  await runLeanAnswer({
    query: 'why?',
    sendEvent: (type, data) => events.push({ type, data }),
    generate: async (_p, _s, _i, opts) => { opts.onToken(''); opts.onToken(null); opts.onToken('x'); return 'x'; },
  });
  assert.equal(events.filter((e) => e.type === 'stream').length, 1);
});

test('STREAM: a throwing sendEvent cannot break the answer', async () => {
  const r = await runLeanAnswer({
    query: 'why?',
    sendEvent: () => { throw new Error('client hung up'); },
    generate: async (_p, _s, _i, opts) => { opts.onToken('still fine'); return 'still fine'; },
  });
  assert.equal(r.handled, true, 'a closed client connection must not lose the answer');
  assert.equal(r.answer, 'still fine');
});

test('STREAM: the lean lane passes an onToken callback at all', async () => {
  // The regression in one assertion: opts.onToken was simply absent, so no
  // streaming was possible no matter what the provider supported.
  let sawOnToken = false;
  await runLeanAnswer({
    query: 'why?',
    sendEvent: () => {},
    generate: async (_p, _s, _i, opts) => { sawOnToken = typeof opts.onToken === 'function'; return 'ok'; },
  });
  assert.equal(sawOnToken, true);
});
