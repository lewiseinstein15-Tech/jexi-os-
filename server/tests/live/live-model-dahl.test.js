/**
 * LIVE model acceptance — the one test that uses a real model.
 *
 * Everything in tests/tickets/ drives the loop through a deterministic seam.
 * That proves the wiring; it does NOT prove a model, left to itself, will
 * read the failing test, read the module, make the edit, and re-run pytest.
 * This file removes the seam.
 *
 * The success bar is deliberately the same one the whole ticket set exists to
 * enforce: a green model answer is worthless without a real pytest exit code
 * AND independent TestVerifier evidence over the materialized snapshot.
 * If the model claims success without both, this test FAILS — which is the
 * point.
 *
 * Skips (does not silently pass) when the key or the network is absent, so a
 * green run can never be confused with a run that never happened.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SRC = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');

const MODEL = process.env.ARCEN_MODEL_NAME || 'openai/gpt-oss-120b';
const PROVIDER = process.env.ARCEN_MODEL_PROVIDER || 'groq';
const KEY = process.env.GROQ_API_KEY || process.env.ARCEN_MODEL_API_KEY || '';
const BASE = String(process.env.ARCEN_MODEL_BASE_URL || 'https://api.groq.com/openai/v1').replace(/\/+$/, '');

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'fs_read',
      description: 'Read a file from the project directory and return its exact contents.',
      parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'fs_edit',
      description: 'Replace an exact substring in a file. The needle must appear exactly once.',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string' }, find: { type: 'string' }, replace: { type: 'string' } },
        required: ['path', 'find', 'replace'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'pytest_run',
      description: 'Run the project test suite. Returns the real exit code, pass/fail counts and the failure text.',
      parameters: { type: 'object', properties: {} },
    },
  },
];

async function call(messages, { maxTokens = 800 } = {}) {
  const res = await fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
    body: JSON.stringify({ model: MODEL, messages, tools: TOOLS, tool_choice: 'auto', max_tokens: maxTokens }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) {
    const body = (await res.text()).slice(0, 200);
    throw new Error(`HTTP ${res.status}${res.status === 401 ? ' (key rejected)' : ''}: ${body}`);
  }
  return (await res.json()).choices?.[0]?.message ?? {};
}

/** A real Python project with one genuinely broken subtraction. */
function makeProject() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'jexi-live-'));
  fs.writeFileSync(path.join(d, 'pyproject.toml'), '[tool.pytest.ini_options]\npythonpath = ["."]\n');
  // The bug: `subtract` adds.
  fs.writeFileSync(path.join(d, 'calculator.py'),
    'def add(a, b):\n    return a + b\n\ndef subtract(a, b):\n    return a + b\n');
  fs.mkdirSync(path.join(d, 'tests'));
  fs.writeFileSync(path.join(d, 'tests', 'test_calculator.py'),
    'from calculator import add, subtract\n\n\ndef test_add():\n    assert add(2, 3) == 5\n\n\ndef test_subtract():\n    assert subtract(5, 3) == 2\n');
  return d;
}

const transcript = [];
const say = (...lines) => { const s = lines.join('\n'); transcript.push(s); console.log(s); };

test('LIVE: the configured model answers and can emit tool calls', async (t) => {
  if (!KEY) { t.skip('GROQ_API_KEY is not set'); return; }
  let msg;
  try {
    msg = await call([{ role: 'user', content: 'Use the fs_read tool to read calculator.py. Do not answer in prose.' }], { maxTokens: 200 });
  } catch (e) {
    t.skip(`model unreachable — ${e.message}`);
    return;
  }
  const tc = msg.tool_calls?.[0];
  assert.ok(tc, `the model must call a tool, not answer in prose: ${JSON.stringify(msg.content ?? '').slice(0, 200)}`);
  assert.equal(tc.function.name, 'fs_read');
  say(`model ${MODEL} (${PROVIDER}) responded with tool_call ${tc.function.name}(${tc.function.arguments})`);
});

test('LIVE: the model runs the whole fix loop unassisted and earns its success claim', async (t) => {
  if (!KEY) { t.skip('GROQ_API_KEY is not set'); return; }
  try {
    await call([{ role: 'user', content: 'ping' }], { maxTokens: 5 });
  } catch (e) {
    t.skip(`model unreachable — ${e.message}`);
    return;
  }

  const dir = makeProject();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const prevWs = process.env.WORKSPACE_DIR;
  process.env.WORKSPACE_DIR = dir;
  t.after(() => { if (prevWs === undefined) delete process.env.WORKSPACE_DIR; else process.env.WORKSPACE_DIR = prevWs; });

  const { registerTestingTools } = await import(`${SRC}/src/tools/domains/testing/index.js`);
  const { engines } = registerTestingTools();
  const { executeTool } = await import(`${SRC}/src/services/ToolRuntime.js`);

  // ── the failure the model is asked to fix ──────────────────────────
  const before = await engines.pytest_run({}, { root: dir });
  assert.equal(before.status, 'fail', 'the planted project must start red');
  assert.equal(before.failed, 1, 'exactly one test must be failing to begin with');
  say(`\n=== REAL pytest BEFORE ===\nexitCode=${before.exitCode}  ${before.output.split('\n').filter((l) => l.trim()).slice(-2).join(' | ')}`);

  // ── the model drives the loop itself ───────────────────────────────
  const question = 'The pytest suite in this project is failing. Read the failing test, read the module it imports, make the minimal edit to fix the module, and re-run the test suite to confirm.';
  const layout = fs.readdirSync(dir, { recursive: true }).filter((f) => !String(f).includes('__pycache__'));
  say(`\n=== QUESTION TO THE MODEL ===\n${question}`);
  say(`\nfiles in the project root: ${layout.join(', ')}`);

  let finalAnswer = '';
  const messages = [{
    role: 'user',
    // The real layout, because a model left to guess will invent paths — and
    // a wrong path is a wasted turn, not a failure of the model.
    content: `${question}\n\nThe project files are exactly:\n${layout.map((f) => `- ${f}`).join('\n')}\n\nStart by running the test suite.`,
  }];
  const used = [];
  let turns = 0;
  const MAX_TURNS = 8;

  while (turns++ < MAX_TURNS) {
    const msg = await call(messages);
    if (msg.tool_calls?.length) {
      messages.push({ role: 'assistant', content: msg.content || '', tool_calls: msg.tool_calls });
      for (const tc of msg.tool_calls) {
        const name = tc.function.name;
        let args = {};
        try { args = JSON.parse(tc.function.arguments || '{}'); } catch { args = {}; }
        used.push(name);

        let r;
        if (name === 'fs_read') {
          const p = path.join(dir, args.path || '');
          const text = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : `ERROR: no such file ${args.path}`;
          r = { content: text, isError: !fs.existsSync(p) };
          say(`  -> ${name}(${JSON.stringify(args)}) => ${r.isError ? 'ERROR not found' : JSON.stringify(text.slice(0, 90)) + '…'}`);
        } else if (name === 'fs_edit') {
          const res = await executeTool({ slug: 'fs_edit', args, profile: 'coding' });
          r = { content: JSON.stringify({ ok: res.ok, path: res.path || args.path }) };
          say(`  -> ${name}(${JSON.stringify(args).slice(0, 110)}) => ok=${res.ok}`);
        } else if (name === 'pytest_run') {
          const out = await engines.pytest_run({}, { root: dir });
          r = { content: `status=${out.status} exitCode=${out.exitCode} passed=${out.passed} failed=${out.failed}\n${(out.output || '').slice(-700)}` };
          say(`  -> ${name}({}) => status=${out.status} exitCode=${out.exitCode} passed=${out.passed} failed=${out.failed}`);
        } else {
          // A model may reach for a tool it was not offered. That is a
          // conversational event, not an exception: tell it what IS available
          // and let it correct itself, which is how it behaves with a real
          // agent loop.
          say(`  -> ${name} REJECTED (not offered) -> told the model its options`);
          r = { content: `ERROR: there is no tool named '${name}'. Available tools: fs_read(path), fs_edit(path, find, replace), pytest_run(). Use one of those.` };
        }
        messages.push({ role: 'tool', tool_call_id: tc.id, content: r.content });
      }
    } else {
      // Capture it here: the loop stops on this turn, so it never reaches the
      // messages array and cannot be found by looking backwards through it.
      finalAnswer = msg.content || '';
      messages.push({ role: 'assistant', content: finalAnswer });
      say(`\n=== MODEL ANSWER ===\n${finalAnswer}`);
      break;
    }
  }

  // ── 1. the model must have done the work with real tools ───────────
  assert.ok(used.some((n) => n === 'fs_read'), `the model never read anything: ${JSON.stringify(used)}`);
  assert.ok(used.some((n) => n === 'fs_edit'), `the model never edited anything: ${JSON.stringify(used)}`);
  assert.ok(used.some((n) => n === 'pytest_run'), `the model never ran the tests: ${JSON.stringify(used)}`);

  // ── 2. the file on disk is genuinely fixed ─────────────────────────
  const source = fs.readFileSync(path.join(dir, 'calculator.py'), 'utf8');
  assert.match(source, /def subtract[\s\S]*return a - b/, `the module was not actually fixed:\n${source}`);
  say(`\n=== MODULE AFTER ===\n${source}`);

  // ── 3. an INDEPENDENT pytest run is green, with a real exit code ───
  const after = await engines.pytest_run({}, { root: dir });
  say(`\n=== REAL pytest AFTER (independent) ===\nstatus=${after.status} exitCode=${after.exitCode} passed=${after.passed} failed=${after.failed}\n${after.output.split('\n').filter((l) => l.trim()).slice(-2).join('\n')}`);
  assert.equal(after.status, 'pass', `pytest is still failing:\n${after.output}`);
  assert.equal(after.exitCode, 0, 'a success claim needs a real zero exit code');
  assert.ok(after.passed >= 2, 'both tests must actually pass');

  // ── 4. independent verifier evidence over a materialized snapshot ──
  const { captureSnapshot } = await import(`${SRC}/src/verification/index.js`);
  const { TestVerifier } = await import(`${SRC}/src/verification/verifiers/TestVerifier.js`);
  const snap = captureSnapshot({
    files: {
      'calculator.py': source,
      'pyproject.toml': fs.readFileSync(path.join(dir, 'pyproject.toml'), 'utf8'),
      'tests/test_calculator.py': fs.readFileSync(path.join(dir, 'tests', 'test_calculator.py'), 'utf8'),
    },
  });
  const v = await TestVerifier.verify({
    nodeId: 'live', snapshotId: snap.id || 'live-1', snapshot: snap,
    acceptanceCriteria: 'all tests pass', claimantAcbId: 'agent-a',
    options: { cwd: dir },
  });
  const meta = v.evidence[0].meta;
  say(`\n=== INDEPENDENT TestVerifier ===\nstatus=${v.status} sandboxed=${meta.sandboxed} materialized=${meta.materialized} exitCode=${meta.spawn.exitCode}`);
  assert.equal(v.status, 'pass', `the verifier disagrees: ${v.reason}`);
  assert.equal(meta.spawn.exitCode, 0, 'verifier evidence must carry a real zero exit code');
  assert.equal(meta.materialized, true, 'the verifier must have run on a materialized snapshot');

  // ── the final answer is a claim; the evidence above is the receipt ─
  const last = finalAnswer;
  assert.ok(last.length > 0, 'the model must produce a final answer');
  if (!/pass|fixed|green|now passing|2 passed/i.test(last)) {
    console.log(`  NOTE: the model's answer did not assert a pass. Answer was: ${JSON.stringify(last.slice(0, 200))}`);
  }
  say(`\n=== RECEIPT ===\nmodel tool calls: ${used.join(' -> ')}\npytest exit code: ${after.exitCode}\nverifier exit code: ${meta.spawn.exitCode} (sandboxed, materialized)\nALL GREEN`);
});
