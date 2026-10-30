/**
 * M9 — SUBAGENT ISOLATION CONTRACT (adversarial, model-independent).
 *
 * Proves the boundary between a child agent's private execution transcript and
 * everything a parent can observe: the returned result object, the summary, the
 * artifacts, the error string, and every streamed event.
 *
 * Determinism: the child is driven through the runtime's own deterministic
 * seams (`__mockAnswer`, `__scriptedToolCalls`, an aborted signal). The ONE
 * test that involves a "provider" points it at a loopback OpenAI-compatible
 * server, so no external network and no live model are used.
 *
 * Honest contract under test (see src/services/SubagentIsolation.js):
 *   - the summary is ALWAYS bounded by MAX_PARENT_SUMMARY_CHARS, whatever a
 *     provider returns;
 *   - artifacts come ONLY from the child's explicit `report` tool — transcript
 *     lines are never lifted;
 *   - the raw transcript, reasoning, and token deltas never cross;
 *   - a marker the child placed near the HEAD of its report may appear inside
 *     the bounded summary (a lossy reduction the child authored). Markers
 *     beyond the cap must appear NOWHERE.
 */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Isolate settings/memory so a stray settings.unified cannot steer the
// loopback-provider test (the suite must be machine-independent).
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'm9-iso-'));
process.env.JEXI_TEST_HARNESS = '1';

import {
  MAX_PARENT_SUMMARY_CHARS,
  MAX_ARTIFACT_CHARS,
  MAX_ERROR_CHARS,
  sanitizeStatus,
  deterministicSummary,
  boundSummary,
  extractApprovedArtifacts,
  sanitizeError,
  sanitizeChildEvent,
} from '../../src/services/SubagentIsolation.js';
import { runIsolatedSubagent, runSubagents } from '../../src/services/SubagentRuntime.js';

/* ── suite-wide hermetic provider ────────────────────────────────────────────
 * Any test whose child transcript exceeds the summary cap triggers the runtime's
 * summarizer. Point the unified provider at a loopback OpenAI-compatible server
 * for the WHOLE suite so that call never leaves the machine (no guard refusals,
 * no dependence on a configured remote provider, no dependence on machine
 * settings). Individual tests may override the env and restore it.
 */
let loopback = null;
const savedProviderEnv = {};
const PROVIDER_KEYS = ['JEXI_MODEL_PROVIDER', 'JEXI_MODEL_BASE_URL', 'JEXI_MODEL_NAME', 'JEXI_MODEL_API_KEY'];

before(async () => {
  loopback = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }));
    });
  });
  await new Promise((r) => loopback.listen(0, '127.0.0.1', r));
  for (const k of PROVIDER_KEYS) savedProviderEnv[k] = process.env[k];
  process.env.JEXI_MODEL_PROVIDER = 'custom';
  process.env.JEXI_MODEL_BASE_URL = `http://127.0.0.1:${loopback.address().port}/v1`;
  process.env.JEXI_MODEL_NAME = 'loopback-summarizer';
  process.env.JEXI_MODEL_API_KEY = 'test-key';
});

after(async () => {
  for (const k of PROVIDER_KEYS) {
    if (savedProviderEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedProviderEnv[k];
  }
  if (loopback) await new Promise((r) => loopback.close(r));
});

const HEAD = 'HEAD-MARKER-8f3a';
const MIDDLE = 'MIDDLE-MARKER-8f3a';
const CODE = 'CODE-MARKER-8f3a';
const TAIL = 'TAIL-MARKER-8f3a';
const BEYOND = [MIDDLE, CODE, TAIL]; // all placed past MAX_PARENT_SUMMARY_CHARS

/** Transcript with markers at the head, in a code block, mid-way, and at the tail. */
function transcriptWithMarkers() {
  return [
    `# Report ${HEAD}`,
    'ordinary prose '.repeat(30),           // ~450 chars → HEAD stays inside the cap, the rest does not
    '```js',
    `const leaked = "${CODE}";`,
    '```',
    `Middle note: ${MIDDLE}`,
    'x'.repeat(9000),
    `Tail note: ${TAIL}`,
  ].join('\n');
}

const collect = () => {
  const events = [];
  return { events, sendEvent: (t, d) => events.push({ t, d }) };
};
const blob = (v) => JSON.stringify(v ?? null);
const hasBeyond = (v) => BEYOND.some((m) => blob(v).includes(m));

/* ── 1. the boundary primitives (deterministic, no runtime) ─────────────── */

test('boundSummary: deterministic cap holds regardless of model text', () => {
  const t = transcriptWithMarkers();
  assert.ok(deterministicSummary(t).length <= MAX_PARENT_SUMMARY_CHARS, 'deterministic summary is capped');
  // A model that ignores the instruction and returns 10x the transcript is
  // still capped — the boundary does not trust model output.
  const hostile = boundSummary({ transcript: t, modelText: 'y'.repeat(50000) });
  assert.equal(hostile.length, MAX_PARENT_SUMMARY_CHARS, 'hostile model text is capped to the hard limit');
  // Empty / whitespace / malformed model output falls back deterministically.
  for (const bad of ['', '   ', null, undefined, 0, false]) {
    assert.ok(boundSummary({ transcript: t, modelText: bad }).length <= MAX_PARENT_SUMMARY_CHARS);
  }
});

test('extractApprovedArtifacts: only explicit reports pass; transcript lines are never lifted', () => {
  assert.deepEqual(extractApprovedArtifacts([]), []);
  assert.deepEqual(extractApprovedArtifacts(null), []);
  assert.deepEqual(extractApprovedArtifacts([{ text: '' }, { text: '   ' }]), []);
  const approved = extractApprovedArtifacts([{ text: 'final deliverable' }, { text: 'x'.repeat(5000) }]);
  assert.equal(approved[0], 'final deliverable');
  assert.ok(approved[1].length <= MAX_ARTIFACT_CHARS);
  // A transcript-shaped blob is NOT an artifact unless the child reported it.
  assert.ok(!hasBeyond(extractApprovedArtifacts(transcriptWithMarkers())));
});

test('sanitizeStatus / sanitizeError: validated vocab, bounded single-line errors', () => {
  assert.equal(sanitizeStatus('PASS'), 'PASS');
  assert.equal(sanitizeStatus('done'), 'PASS');
  assert.equal(sanitizeStatus('failed'), 'FAIL');
  assert.equal(sanitizeStatus('cancelled'), 'cancelled');
  assert.equal(sanitizeStatus('totally-unknown'), 'FAIL', 'unknown degrades to FAIL, never a silent pass');
  assert.equal(sanitizeStatus(''), 'FAIL');

  const err = sanitizeError(new Error(`${TAIL}\n`.repeat(200)));
  assert.ok(err.length <= MAX_ERROR_CHARS, 'error is bounded');
  assert.ok(!err.includes('\n'), 'error is single-line');
});

test('sanitizeChildEvent: transcript-bearing events are dropped; lifecycle events are allowlisted', () => {
  for (const t of ['stream', 'think', 'agent.done', 'agent.log', 'log', 'tool.result', 'tool.call']) {
    assert.equal(sanitizeChildEvent(t, { text: TAIL }), null, `${t} must not cross the boundary`);
  }
  // A permitted event is rebuilt from a fixed field allowlist, so a hostile
  // payload cannot smuggle transcript text through an unexpected key.
  const projected = sanitizeChildEvent('subagent.progress', { name: 'child', toolCalls: 3, smuggled: TAIL, text: TAIL });
  assert.deepEqual(Object.keys(projected).sort(), ['name', 'toolCalls']);
  assert.ok(!hasBeyond(projected));
  assert.equal(sanitizeChildEvent('totally.unknown', { x: 1 }), null, 'default-deny');
});

/* ── 2. the original defect (fails pre-M9, passes post-M9) ──────────────── */

test('REGRESSION: markers beyond the cap cannot leak via artifacts (pre-M9 keyArtifacts lifted them)', async () => {
  const res = await runIsolatedSubagent({
    name: 'child', query: 'q', sendEvent: () => {}, opts: { __mockAnswer: transcriptWithMarkers() },
  });
  assert.deepEqual(res.artifacts, [], 'no report was delivered, so there are no approved artifacts');
  assert.ok(!hasBeyond(res), 'no beyond-cap marker appears anywhere in the parent-visible result');
});

test('REGRESSION: an over-long model summary cannot exceed the hard cap (provider-dependent leak)', async () => {
  // Pre-M9, the LLM branch returned model text sliced to MAX*2 (700 chars), and
  // a model that echoes its prompt leaked transcript content. Post-M9 the
  // result is capped deterministically no matter what the provider returns.
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const prompt = JSON.parse(body || '{}').messages?.find((m) => m.role === 'user')?.content || '';
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: prompt } }] })); // echo the prompt
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const saved = {};
  for (const k of ['JEXI_MODEL_PROVIDER', 'JEXI_MODEL_BASE_URL', 'JEXI_MODEL_NAME', 'JEXI_MODEL_API_KEY']) saved[k] = process.env[k];
  process.env.JEXI_MODEL_PROVIDER = 'custom';
  process.env.JEXI_MODEL_BASE_URL = `http://127.0.0.1:${port}/v1`;
  process.env.JEXI_MODEL_NAME = 'echo-summarizer';
  process.env.JEXI_MODEL_API_KEY = 'test-key';
  try {
    const res = await runIsolatedSubagent({
      name: 'child', query: 'q', sendEvent: () => {}, opts: { __mockAnswer: transcriptWithMarkers() },
    });
    assert.ok(res.summary.length <= MAX_PARENT_SUMMARY_CHARS, `summary must be <= ${MAX_PARENT_SUMMARY_CHARS} (was ${res.summary.length})`);
    assert.ok(!hasBeyond(res), 'a hostile summarizer cannot widen the boundary');
  } finally {
    await new Promise((r) => server.close(r));
    for (const k of Object.keys(saved)) {
      if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
    }
  }
});

test('REGRESSION: the child event path forwards no transcript, reasoning, or raw answer', async () => {
  // Pre-M9, runIsolatedSubagent forwarded the child's raw sendEvent, so
  // `agent.done` carried the whole transcript to the parent.
  const { events, sendEvent } = collect();
  await runIsolatedSubagent({ name: 'child', query: 'q', sendEvent, opts: { __mockAnswer: transcriptWithMarkers() } });
  const types = events.map((e) => e.t);
  assert.ok(!types.includes('agent.done'), 'the child final answer must not be forwarded');
  assert.ok(!types.includes('stream') && !types.includes('think'), 'token deltas / reasoning must not be forwarded');
  assert.ok(!hasBeyond(events), 'no forwarded event may contain a beyond-cap transcript marker');
  // subagent.done may carry the bounded summary preview, but nothing else.
  const done = events.find((e) => e.t === 'subagent.done');
  assert.ok(done && String(done.d.preview).length <= 120, 'the preview is a bounded summary slice');
  assert.ok(types.includes('subagent.start'));
});

/* ── 3. boundary holds across status / failure / timeout paths ──────────── */

test('cancelled child: no summary, no artifacts, no leak', async () => {
  const { events, sendEvent } = collect();
  const res = await runIsolatedSubagent({
    name: 'child', query: 'q', sendEvent,
    opts: { signal: { aborted: true }, __scriptedToolCalls: [{ name: 'report', args: { output: TAIL } }] },
  });
  assert.equal(res.status, 'cancelled');
  assert.equal(res.summary, '');
  assert.deepEqual(res.artifacts, [], 'a cancelled child delivers no artifacts');
  assert.ok(!hasBeyond(res) && !hasBeyond(events));
});

test('child with an empty answer reports FAIL, not a silent pass', async () => {
  const res = await runIsolatedSubagent({ name: 'child', query: 'q', sendEvent: () => {}, opts: { __mockAnswer: '' } });
  assert.equal(res.status, 'FAIL');
  assert.ok(!hasBeyond(res));
});

test('a throwing child is caught: bounded sanitized error, no transcript', async () => {
  // A signal whose `aborted` getter throws forces the runtime's catch path.
  // A bounded error message IS permitted to cross (necessary error info), but
  // the raw transcript must not: the marker is 4000 chars deep, past the cap.
  const boom = { get aborted() { throw new Error(`${'z'.repeat(4000)} ${TAIL}`); } };
  const { events, sendEvent } = collect();
  const res = await runIsolatedSubagent({ name: 'child', query: 'q', sendEvent, opts: { signal: boom } });
  assert.equal(res.status, 'FAIL');
  assert.ok(typeof res.error === 'string' && res.error.length <= MAX_ERROR_CHARS, 'error is bounded');
  assert.ok(!res.error.includes('z'.repeat(400)), 'the long error body is truncated below the 4000-char input');
  assert.ok(!hasBeyond(res) && !hasBeyond(events), 'no transcript content crosses via the error path');
});

/* ── 4. approved artifacts survive; unapproved do not ───────────────────── */

test('an explicitly reported artifact is preserved and bounded; the transcript is not', async () => {
  const approvedText = 'APPROVED DELIVERABLE: the answer the child chose to hand over';
  const res = await runIsolatedSubagent({
    name: 'child', query: 'q', sendEvent: () => {},
    opts: { __scriptedToolCalls: [{ name: 'report', args: { output: approvedText } }] },
  });
  assert.ok(res.artifacts.includes(approvedText), 'the explicit report crosses the boundary intact');
  assert.ok(!hasBeyond(res.artifacts), 'nothing else is lifted from the transcript');
});

test('unapproved transcript content never appears as an artifact', async () => {
  const res = await runIsolatedSubagent({ name: 'child', query: 'q', sendEvent: () => {}, opts: { __mockAnswer: transcriptWithMarkers() } });
  assert.deepEqual(res.artifacts, []);
});

/* ── 5. long transcripts + every parent-visible return path ─────────────── */

test('very long transcripts stay bounded in every parent-visible field', async () => {
  const huge = `# H ${HEAD}\n` + ('lorem ipsum '.repeat(40000)) + `\n${TAIL}`;
  const { events, sendEvent } = collect();
  const res = await runIsolatedSubagent({ name: 'child', query: 'q', sendEvent, opts: { __mockAnswer: huge } });
  assert.ok(res.summary.length <= MAX_PARENT_SUMMARY_CHARS);
  assert.ok(!hasBeyond(res) && !hasBeyond(events), 'the tail marker never crosses');
  assert.ok(blob(res).length < huge.length / 10, 'parent-visible result is a reduction, not a copy');
});

test('runSubagents: isolated aggregate carries no raw transcript; normal task unchanged', async () => {
  const { events, sendEvent } = collect();
  const out = await runSubagents({
    sendEvent,
    opts: { __mockAnswer: transcriptWithMarkers() },
    tasks: [
      { name: 'forked', query: 'a', context: 'fork' },
      { name: 'normal', query: 'b' },
    ],
  });
  const forked = out.subagents.find((r) => r.name === 'forked');
  const normal = out.subagents.find((r) => r.name === 'normal');
  assert.equal(forked.isolated, true);
  assert.ok(!('answer' in forked), 'isolated result exposes no raw answer field');
  assert.ok(forked.summary.length <= MAX_PARENT_SUMMARY_CHARS);
  assert.ok(!hasBeyond(forked), 'isolated parent-visible data is clean beyond the bounded summary');
  // The non-isolated path is untouched by M9 (it is not an isolation boundary).
  assert.equal(typeof normal.answer, 'string');
  assert.ok(events.some((e) => e.t === 'subagent.aggregate'));
});

test('a blocked (contract-refused) task still returns a bounded, leak-free record', async () => {
  const out = await runSubagents({ sendEvent: () => {}, tasks: [{ name: 'bad', query: 'q', agentDef: 'definitely-not-a-real-agent' }] });
  const bad = out.subagents[0];
  assert.equal(bad.status, 'failed');
  assert.ok(typeof bad.error === 'string' && bad.error.length < 300);
  assert.ok(!hasBeyond(bad));
});

test('property: for many marker positions, the cap holds and nothing beyond it leaks', async () => {
  // Deterministic pseudo-random positions (no RNG dependency).
  let seed = 1234567;
  const next = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let i = 0; i < 12; i += 1) {
    const before = 400 + Math.floor(next() * 20000); // always beyond the cap
    const after = Math.floor(next() * 20000);
    const m = `PROP-${i}-8f3a`;
    const t = 'a'.repeat(before) + m + 'b'.repeat(after);
    const { events, sendEvent } = collect();
    const res = await runIsolatedSubagent({ name: `p${i}`, query: 'q', sendEvent, opts: { __mockAnswer: t } });
    assert.ok(res.summary.length <= MAX_PARENT_SUMMARY_CHARS, `cap holds at position ${i}`);
    assert.ok(!blob(res).includes(m), `beyond-cap marker must not cross (position ${i})`);
    assert.ok(!blob(events).includes(m), `no event leak at position ${i}`);
    assert.deepEqual(res.artifacts, [], `no artifact leak at position ${i}`);
  }
});
