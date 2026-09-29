/**
 * Run ONE real turn and record every event to JSON.
 *
 * Real model, real tools, real sandboxed pytest, real verifier. The recording
 * is what the deck UI is then driven with, so the question, the tool calls and
 * the answer in the screenshot are the ones a model actually produced.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, '..');   // scripts live in acceptance/, repo is the parent
const MODEL = process.env.ARCEN_MODEL_NAME || 'qwen/qwen3.8-27b';
const KEY = process.env.GROQ_API_KEY || process.env.ARCEN_MODEL_API_KEY || '';
const BASE = String(process.env.ARCEN_MODEL_BASE_URL || 'https://api.groq.com/openai/v1').replace(/\/+$/, '');
const OUT = process.argv[2] || path.join(SRC, 'live-evidence', 'real-turn.json');

const QUESTION = process.argv[3] ||
  'The pytest suite in this project is failing. Read the failing test, read the module it imports, make the minimal edit to fix the module, then re-run the test suite to confirm it is green.';

const { executeTool } = await import(path.join(SRC, 'src/services/ToolRuntime.js'));
const { registerTestingTools } = await import(path.join(SRC, 'src/tools/domains/testing/index.js'));
const { captureSnapshot } = await import(path.join(SRC, 'src/verification/index.js'));
const { TestVerifier } = await import(path.join(SRC, 'src/verification/verifiers/TestVerifier.js'));

const TOOLS = [
  { type: 'function', function: { name: 'fs_read', description: 'Read a file from the project and return its exact contents.',
    parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } } },
  { type: 'function', function: { name: 'fs_edit', description: 'Replace an exact substring in a file. The needle must appear exactly once.',
    parameters: { type: 'object', properties: { path: { type: 'string' }, find: { type: 'string' }, replace: { type: 'string' } }, required: ['path', 'find', 'replace'] } } },
  { type: 'function', function: { name: 'pytest_run', description: 'Run the test suite. Returns the real exit code, counts and failure text.',
    parameters: { type: 'object', properties: {} } } },
];

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jexi-turn-'));
process.env.WORKSPACE_DIR = dir;
fs.writeFileSync(path.join(dir, 'pyproject.toml'), '[tool.pytest.ini_options]\npythonpath = ["."]\n');
fs.writeFileSync(path.join(dir, 'calculator.py'), 'def add(a, b):\n    return a + b\n\ndef subtract(a, b):\n    return a + b\n');
fs.mkdirSync(path.join(dir, 'tests'));
fs.writeFileSync(path.join(dir, 'tests', 'test_calculator.py'),
  'from calculator import add, subtract\n\n\ndef test_add():\n    assert add(2, 3) == 5\n\n\ndef test_subtract():\n    assert subtract(5, 3) == 2\n');

const events = [];
let seq = 0;
const rec = (name, kind, icon, detail) => {
  events.push({ n: name, k: kind, i: icon, d: detail, ms: Date.now() });
  console.log(`  ${name}`);
};

async function callModel(messages) {
  const res = await fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
    body: JSON.stringify({ model: MODEL, messages, tools: TOOLS, tool_choice: 'auto', max_tokens: 900 }),
    signal: AbortSignal.timeout(180_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()).choices?.[0]?.message ?? {};
}

const { engines } = registerTestingTools();
const t0 = Date.now();
const before = await engines.pytest_run({}, { root: dir });
rec('turn.opened', 'plan', '◷', `<em>${esc(QUESTION)}</em>`);
rec('baseline', 'err', '✕', `pytest <em>exit ${before.exitCode}</em> · ${before.passed} passed, ${before.failed} failed · sandboxed`);

const layout = fs.readdirSync(dir, { recursive: true })
  .filter((f) => !String(f).includes('__pycache__') && !String(f).includes('.pytest_cache'));

const messages = [{ role: 'user', content: `${QUESTION}\n\nThe project files are exactly:\n${layout.map((f) => `- ${f}`).join('\n')}` }];
const used = [];
let answer = '';

for (let turn = 0; turn < 8; turn++) {
  const msg = await callModel(messages);
  if (!msg.tool_calls?.length) { answer = msg.content || ''; break; }
  messages.push({ role: 'assistant', content: msg.content || '', tool_calls: msg.tool_calls });
  for (const tc of msg.tool_calls) {
    const name = tc.function.name;
    let args = {}; try { args = JSON.parse(tc.function.arguments || '{}'); } catch { args = {}; }
    used.push(name);
    const argStr = Object.entries(args).map(([k, v]) => `${k}: ${JSON.stringify(String(v).slice(0, 46))}`).join(', ');
    rec('tool.started', 'tool', '▸', `<em>${esc(name)}</em> { ${esc(argStr)} }`);

    let content = '';
    if (name === 'fs_read') {
      const p = path.join(dir, args.path || '');
      const ok = fs.existsSync(p);
      content = ok ? fs.readFileSync(p, 'utf8') : `ERROR: no such file ${args.path}`;
      rec('tool.completed', ok ? 'ok' : 'err', ok ? '✓' : '✕', `<em>${esc(name)}</em> ${ok ? 'ok' : 'not found'} · ${content.length} bytes`);
    } else if (name === 'fs_edit') {
      const r = await executeTool({ slug: 'fs_edit', args, profile: 'coding' });
      content = JSON.stringify({ ok: r.ok, path: r.path || args.path, error: r.error });
      rec('tool.completed', r.ok ? 'ok' : 'err', r.ok ? '✓' : '✕', `<em>${esc(name)}</em> ${r.ok ? 'applied' : 'REJECTED: ' + esc(String(r.error || 'no match'))}`);
    } else if (name === 'pytest_run') {
      const out = await engines.pytest_run({}, { root: dir });
      content = `status=${out.status} exitCode=${out.exitCode} passed=${out.passed} failed=${out.failed}\n${(out.output || '').slice(-900)}`;
      rec('tool.completed', out.status === 'pass' ? 'ok' : 'err', out.status === 'pass' ? '✓' : '✕',
        `<em>pytest_run</em> status <em>${out.status}</em> · exit <em>${out.exitCode}</em> · ${out.passed} passed, ${out.failed} failed`);
    } else {
      content = `ERROR: no tool named '${name}'`;
      rec('tool.completed', 'err', '✕', `<em>${esc(name)}</em> not offered`);
    }
    messages.push({ role: 'tool', tool_call_id: tc.id, content });
  }
}

const after = await engines.pytest_run({}, { root: dir });
rec('verification.run', 'hook', '◆', `independent pytest → spawn real process · exit <em>${after.exitCode}</em>`);

let vstatus = 'n/a', vexit = 'n/a';
try {
  const snap = captureSnapshot({
    files: Object.fromEntries(
      fs.readdirSync(dir, { recursive: true })
        .filter((f) => { try { return fs.statSync(path.join(dir, f)).isFile(); } catch { return false; } })
        .filter((f) => !String(f).includes('__pycache__') && !String(f).includes('.pytest_cache'))
        .map((f) => [String(f).replace(/\\/g, '/'), fs.readFileSync(path.join(dir, f), 'utf8')]),
    ),
  });
  const v = await TestVerifier.verify({
    nodeId: 'turn', snapshotId: snap.id || 's1', snapshot: snap,
    acceptanceCriteria: 'all tests pass', claimantAcbId: 'agent', options: { cwd: dir },
  });
  vstatus = v.status; vexit = v.evidence?.[0]?.meta?.spawn?.exitCode ?? 'n/a';
  rec('verification.result', vstatus === 'pass' ? 'ok' : 'err', vstatus === 'pass' ? '✓' : '✕',
    `TestVerifier <em>${vstatus}</em> · exit <em>${vexit}</em> · sandboxed, materialized snapshot`);
} catch (e) {
  rec('verification.result', 'err', '✕', `TestVerifier error: ${esc(e.message)}`);
}

const secs = ((Date.now() - t0) / 1000).toFixed(1);
rec('turn.completed', 'ok', '✓',
  `turn completed · ${used.length} tools · 0 blocked · ${secs}s · pytest exit <em>${after.exitCode}</em> · verifier <em>${vstatus}</em>`);

function esc(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify({
  model: MODEL, provider: PROVIDER_NAME(), question: QUESTION, answer,
  tools: used, before: { exitCode: before.exitCode, passed: before.passed, failed: before.failed },
  after: { exitCode: after.exitCode, passed: after.passed, failed: after.failed },
  verifier: { status: vstatus, exitCode: vexit },
  events,
}, null, 2));

console.log(`\nrecorded ${events.length} events -> ${OUT}`);
console.log(`tools: ${used.join(' -> ')}`);
console.log(`pytest ${before.exitCode} -> ${after.exitCode} | verifier ${vstatus}`);

fs.rmSync(dir, { recursive: true, force: true });
function PROVIDER_NAME() { return process.env.ARCEN_MODEL_PROVIDER || 'groq'; }
