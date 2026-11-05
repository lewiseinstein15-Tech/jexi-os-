/**
 * M21 — EXECUTION STRATEGY suite.
 *
 * Two measured defects from the M21 audit, each guarded deterministically
 * (zero network, no model):
 *
 *   D1 — FORCE THE FIRST TOOL CALL. A small/local model answers a coding task
 *        with the code in PROSE and the turn dies with zero tool calls (the
 *        dominant M21 baseline failure). When the caller opts in
 *        (`forceToolCall`), the FIRST round of the tool loop must be sent with
 *        `tool_choice:'required'`, and later rounds must relax back to 'auto'.
 *
 *   D2 — LANGUAGE-GATED LINT. The coding loop's real verify path ran ESLint (a
 *        JavaScript linter) against a PYTHON sandbox; it errored, short-
 *        circuited the cheaper-first loop before the unit layer, and injected a
 *        JavaScript diagnostic into the model's context (observed: the model
 *        thrashed all 16 iterations). A language-mismatched linter must report
 *        `inapplicable` and NOT stop the loop.
 *
 * Run: node --test tests/agi/test-m21-execution-strategy.js
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { generateWithToolsLoop } from '../../src/providers/runtime/LLMClient.js';
import { LintVerifier } from '../../src/verification/verifiers/LintVerifier.js';
import { verifyAfterEdit } from '../../src/verification/loop/auto-verify.js';
import { isCodingIntent } from '../../src/services/agent/CodingLoop.js';
import { detectProjectKind } from '../../src/tools/domains/testing/index.js';
import { normalizeWriteArgs, decodeFullJsonEscapes, hasStrayBackslashBeforeNewline, hasLoneBackslashLine, hasUnterminatedTripleQuote } from '../../src/services/agent/WritePayloadNormalizer.js';
import { recoverToolCallsFromText, recoverBashPseudoCommands, recoverFencedCodeWrite, extractFencedCodeBlocks, extractTargetPath, isWriteInstruction } from '../../src/services/agent/ToolCallRecovery.js';
import { looksLikeExecStylePytest } from '../../src/verification/verifiers/TestVerifier.js';

/* ------------------------------------------------------------------ helpers */

function withFetchStub(handler) {
  const realFetch = globalThis.fetch;
  const realHost = process.env.OLLAMA_HOST;
  process.env.OLLAMA_HOST = 'http://127.0.0.1:11434';
  globalThis.fetch = handler;
  return () => {
    globalThis.fetch = realFetch;
    if (realHost === undefined) delete process.env.OLLAMA_HOST;
    else process.env.OLLAMA_HOST = realHost;
  };
}

function jsonResponse(body) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

const TOOLS = [
  { type: 'function', function: { name: 'fs_write', description: 'write a file', parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] } } },
];

function tmpdir(prefix) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return { d, cleanup: () => { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* gone */ } } };
}

/* ------------------------------------------------- D1: first-round tool force */

test('M21/D1: forceToolCall sends tool_choice "required" on the FIRST round', async () => {
  const bodies = [];
  const restore = withFetchStub(async (url, init) => {
    if (String(url).includes('/chat/completions')) {
      bodies.push(JSON.parse(init?.body || '{}'));
      return jsonResponse({ choices: [{ message: { role: 'assistant', content: 'done' } }] });
    }
    return jsonResponse({});
  });
  try {
    await generateWithToolsLoop('write the file', 'coding agent', TOOLS, {
      provider: 'ollama', maxIterations: 1, forceToolCall: true,
      executeToolCalls: async () => [],
    }).catch(() => { /* body capture is the assertion */ });
  } finally { restore(); }

  assert.ok(bodies.length > 0, 'a /chat/completions request must be made');
  assert.equal(bodies[0].tool_choice, 'required', 'the first round of a forced coding turn must require a tool call');
});

test('M21/D1: without forceToolCall the first round stays "auto" (plain answers are never forced)', async () => {
  const bodies = [];
  const restore = withFetchStub(async (url, init) => {
    if (String(url).includes('/chat/completions')) {
      bodies.push(JSON.parse(init?.body || '{}'));
      return jsonResponse({ choices: [{ message: { role: 'assistant', content: 'a plain answer' } }] });
    }
    return jsonResponse({});
  });
  try {
    await generateWithToolsLoop('what is 2+2?', 'agent', TOOLS, {
      provider: 'ollama', maxIterations: 1,
      executeToolCalls: async () => [],
    }).catch(() => { /* body capture is the assertion */ });
  } finally { restore(); }

  assert.equal(bodies[0].tool_choice, 'auto', 'a non-forced turn must not require a tool call');
});

test('M21/D1: after the first round the loop relaxes back to "auto"', async () => {
  const bodies = [];
  let round = 0;
  const restore = withFetchStub(async (url, init) => {
    if (String(url).includes('/chat/completions')) {
      bodies.push(JSON.parse(init?.body || '{}'));
      round += 1;
      // Round 1: a real tool call, so the loop continues to round 2.
      if (round === 1) {
        return jsonResponse({ choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'fs_write', arguments: JSON.stringify({ path: 'a.py', content: 'x' }) } }] } }] });
      }
      // Round 2: the model answers directly.
      return jsonResponse({ choices: [{ message: { role: 'assistant', content: 'all done' } }] });
    }
    return jsonResponse({});
  });
  try {
    await generateWithToolsLoop('write a file', 'coding agent', TOOLS, {
      provider: 'ollama', maxIterations: 3, forceToolCall: true,
      executeToolCalls: async () => [{ tool_call_id: 'c1', content: 'ok' }],
    }).catch(() => { /* body capture is the assertion */ });
  } finally { restore(); }

  assert.ok(bodies.length >= 2, `expected at least 2 rounds, saw ${bodies.length}`);
  assert.equal(bodies[0].tool_choice, 'required', 'round 1 must be forced');
  assert.equal(bodies[1].tool_choice, 'auto', 'round 2 must relax to auto so the model can answer');
});

/* ------------------------------------------------------- D2: language-gated lint */

test('M21/D2: LintVerifier is INAPPLICABLE (not an error) on a Python project', async () => {
  const { d, cleanup } = tmpdir('m21-lint-py-');
  try {
    fs.mkdirSync(path.join(d, 'tests'), { recursive: true });
    fs.writeFileSync(path.join(d, 'tests', 'test_x.py'), 'def test_ok():\n    assert True\n');
    fs.writeFileSync(path.join(d, 'solution.py'), 'def f():\n    return 1\n');
    const res = await LintVerifier.verify({ nodeId: 'n', snapshotId: 's', acceptanceCriteria: 'no lint errors', claimantAcbId: 'a', options: { cwd: d } });
    assert.equal(res.status, 'inapplicable', `ESLint must not run against a Python project (got ${res.status}: ${res.reason})`);
    assert.match(res.reason, /applicable/i);
  } finally { cleanup(); }
});

test('M21/D2: an explicit lintCommand still runs verbatim (the gate only guards the implicit ESLint fallback)', async () => {
  const { d, cleanup } = tmpdir('m21-lint-explicit-');
  try {
    fs.mkdirSync(path.join(d, 'tests'), { recursive: true });
    fs.writeFileSync(path.join(d, 'tests', 'test_x.py'), 'def test_ok():\n    assert True\n');
    const res = await LintVerifier.verify({
      nodeId: 'n', snapshotId: 's', acceptanceCriteria: 'no lint errors', claimantAcbId: 'a',
      options: { cwd: d, lintCommand: [process.execPath, '-e', 'process.exit(0)'] },
    });
    assert.notEqual(res.status, 'inapplicable', 'an explicit command must not be language-gated');
    assert.equal(res.status, 'pass', `explicit no-op linter must pass (got ${res.status}: ${res.reason})`);
  } finally { cleanup(); }
});

test('M21/D2: an inapplicable lint layer does NOT stop the verify loop before the unit layer', async () => {
  const { d, cleanup } = tmpdir('m21-lint-loop-');
  try {
    fs.mkdirSync(path.join(d, 'tests'), { recursive: true });
    fs.writeFileSync(path.join(d, 'tests', 'test_x.py'), 'def test_ok():\n    assert True\n');
    const outcome = await verifyAfterEdit(
      { nodeId: 'n', snapshotId: 's', acceptanceCriteria: 'x', claimantAcbId: 'a', options: { cwd: d } },
      {},
      { real: ['lint', 'unit'] },
    );
    const lint = (outcome.results || []).find((r) => r.layer === 'lint');
    assert.ok(lint, 'the lint layer must appear in the results');
    assert.equal(lint.status, 'inapplicable', 'lint on a Python project must be inapplicable');
    assert.ok((outcome.results || []).some((r) => r.layer === 'unit'), 'the loop must CONTINUE past an inapplicable layer to the unit layer');
  } finally { cleanup(); }
});

/* --------------------------------------------- D3: the HumanEval query shape */

test('M21/D3: the HumanEval query is classified as a coding turn', () => {
  const query = [
    'Complete this Python function by writing the full implementation to the file /sandbox/solution.py.',
    '',
    '```python',
    'def truncate_number(number: float) -> float:',
    '    """Return the decimal part of a positive float."""',
    '```',
    '',
    'Use the code-write tool to write the complete file to /sandbox/solution.py. Do not reply with the code',
    'as text — the file on disk is what is graded.',
    'Keep the exact function name (truncate_number) and signature. Put any imports you need at the top of the file.',
    'The finished file must define truncate_number and be valid, self-contained Python.',
    'A test file, test_truncate_number.py, is already in the same directory. Use the code-run tool to run it and confirm it passes. Do not modify the test file.',
  ].join('\n');
  assert.equal(isCodingIntent({ intent: null }, query), true, 'the benchmark query must arm the coding path');
});

test('M21/D3: a fenced code block in the request is a coding turn', () => {
  assert.equal(isCodingIntent({}, 'What does this do?\n```python\nprint(1)\n```'), true);
});

test('M21/D3: a produce-verb + code-noun request is a coding turn', () => {
  assert.equal(isCodingIntent({}, 'Write a function that returns the maximum of a list.'), true);
});

test('M21/D3: plain questions and chit-chat are NOT coding turns (no false arming)', () => {
  for (const q of [
    'What is the capital of France?',
    'Hello, how are you today?',
    'Explain how garbage collection works in general.',
    'Write a short email to my manager about the delay.',
    'What files are in this directory?',
  ]) {
    assert.equal(isCodingIntent({ intent: null }, q), false, `must not arm the coding path for: ${q}`);
  }
});

test('M21/D2: a flat pytest sandbox (test_*.py beside the module) detects as pytest', () => {
  const { d, cleanup } = tmpdir('m21-kind-flat-');
  try {
    fs.writeFileSync(path.join(d, 'solution.py'), 'def f():\n    return 1\n');
    fs.writeFileSync(path.join(d, 'test_f.py'), 'from solution import f\n\ndef test_f():\n    assert f() == 1\n');
    assert.equal(detectProjectKind(d), 'pytest', 'a flat pytest sandbox must not detect as null/node');
  } finally { cleanup(); }
});

test('M21/D4: an auto-detected runner that collects ZERO tests is inapplicable, not a failure', async () => {
  const { d, cleanup } = tmpdir('m21-empty-detected-');
  try {
    // HumanEval's test file is a plain script (`check(f)`), not pytest-shaped:
    // pytest -q exits 5 with 0 tests collected. That must NOT be injected as a
    // failure — the model would be told to "fix" a file that was never broken.
    fs.writeFileSync(path.join(d, 'solution.py'), 'def f(x):\n    return x\n');
    fs.writeFileSync(path.join(d, 'test_f.py'), 'from solution import f\n\ndef check(candidate):\n    assert candidate(3) == 3\n\ncheck(f)\n');
    const outcome = await verifyAfterEdit(
      { nodeId: 'n', snapshotId: 's', acceptanceCriteria: 'x', claimantAcbId: 'a', options: { cwd: d } },
      {},
      { real: ['lint', 'unit'] },
    );
    assert.equal(outcome.ok, false, 'nothing verified, so this is not a success');
    assert.equal(outcome.unverifiable, true, 'it must be reported as unverifiable, not verified');
    assert.equal(outcome.context.injectedFailure, null, 'NO bogus failure may be injected (this drove the 16-iteration rewrite loop)');
  } finally { cleanup(); }
});

test('M21/D4: a real FAILING test still reports the unit layer as the blocker (not the skipped lint)', async () => {
  const { d, cleanup } = tmpdir('m21-real-fail-');
  try {
    fs.writeFileSync(path.join(d, 'solution.py'), 'def f(x):\n    return x\n');
    fs.writeFileSync(path.join(d, 'test_f.py'), 'from solution import f\n\ndef test_f():\n    assert f(3) == 4\n');
    const outcome = await verifyAfterEdit(
      { nodeId: 'n', snapshotId: 's', acceptanceCriteria: 'x', claimantAcbId: 'a', options: { cwd: d } },
      {},
      { real: ['lint', 'unit'] },
    );
    assert.equal(outcome.ok, false);
    assert.equal(outcome.context.injectedFailure.layer, 'unit', 'the real blocker is the unit layer, not the inapplicable lint layer');
    assert.match(String(outcome.context.injectedFailure.reason), /assert 3 == 4|failed/i);
  } finally { cleanup(); }
});

/* ── M21/D5: the write payload is a JSON-encoded body, not a Python file.
 *
 * Measured live (2026-11-03): 5/9 written files were a JSON STRING VALUE —
 * `"from typing import List\n\ndef f():…"` — written to disk verbatim, so
 * Python raised "unexpected character after line continuation character" and
 * nothing downstream could grade. The M19 normalizer decoded `\n` only in code
 * regions, so an escaped `\"\"\"` (a docstring delimiter) was seen as a real
 * string open and every later separator was treated as in-string.
 */

test('M21/D5: a fully JSON-escaped write body is decoded to real source', () => {
  const src = 'from typing import List\n\n\ndef f(xs):\n    """doc"""\n    return len(xs) > 0\n';
  const r = normalizeWriteArgs('fs_write', { path: 'solution.py', content: JSON.stringify(src) });
  assert.equal(r.changed, true, 'a JSON string value must be decoded');
  assert.equal(r.reason, 'decoded-json-string-escapes');
  assert.equal(r.args.content, src, 'the decode must be exact (JSON.stringify round-trips)');
  assert.ok(!r.args.content.includes('\\n'), 'no literal backslash-n survives');
  assert.ok(!r.args.content.includes('\\"'), 'no escaped quote survives');
});

test('M21/D5: a JSON-escaped body across the HumanEval prompts round-trips exactly', () => {
  const ds = JSON.parse(fs.readFileSync(new URL('../../../benchmarks/humaneval-live/dataset/humaneval-test.json', import.meta.url), 'utf8'));
  let exact = 0;
  for (const t of ds.tasks.slice(0, 40)) {
    const body = `${t.prompt}\n    return None\n`;
    const r = normalizeWriteArgs('fs_write', { path: 's.py', content: JSON.stringify(body) });
    if (r.args.content === body) exact++;
  }
  assert.equal(exact, 40, 'every JSON-encoded prompt body must decode byte-for-byte');
});

test('M21/D5: the corrupted mixed shape (stray lone backslash) is repaired and parses', () => {
  const BS = '\\';
  const corrupt = 'from typing import List\n\ndef f(x):\n    ' + BS + '\n    """' + BS + 'n    doc.' + BS + 'n    """' + BS + 'n    return x' + BS + 'n';
  assert.equal(hasStrayBackslashBeforeNewline(corrupt), true);
  const r = normalizeWriteArgs('fs_write', { path: 'solution.py', content: corrupt });
  assert.equal(r.changed, true);
  assert.equal(r.reason, 'repaired-corrupt-escapes');
  assert.ok(!r.args.content.includes('\\n'), 'literal newline escapes decoded');
  assert.ok(!hasStrayBackslashBeforeNewline(r.args.content), 'the stray line-continuation backslash is gone');
});

test('M21/D5: legitimate payloads the M19 pass preserves are still untouched', () => {
  const BS = '\\';
  // a Windows path in a string, no structural separator -> nothing to do
  assert.equal(normalizeWriteArgs('fs_write', { path: 'x.py', content: 'p = r"C:' + BS + 'new"' }).changed, false);
  // a regex and an in-string escape on a real file -> M19 code-region decode only
  const legit = 'import re\np = re.compile(r"' + BS + 'd+")\ntext = "a' + BS + 'nb"\n';
  const r = normalizeWriteArgs('fs_write', { path: 'x.py', content: legit });
  assert.equal(r.changed, false, 'a real file with in-string escapes is untouched');
  assert.equal(r.args.content, legit);
  // unknown escapes survive the full decoder
  assert.equal(decodeFullJsonEscapes('a' + BS + 'db'), 'a' + BS + 'db');
});

/* ── M21/D6: bash-style pseudo-commands (RC#1).
 *
 * The dominant prose shape measured live is a HEREDOC the model believes it is
 * running: ```bash\nfs_write <path> <<EOF\n…body…\nEOF\n```. It names the right
 * tool and carries the complete file, but the JSON recovery finds nothing.
 */

test('M21/D6: a bash heredoc pseudo-write is recovered as a real fs_write', () => {
  const BT = '`'.repeat(3);
  const text = [
    'Here is the implementation:', '',
    `${BT}bash`,
    'fs_write /sandbox/solution.py <<EOF',
    'from typing import List', '',
    'def all_prefixes(string: str) -> List[str]:',
    '    return [string[:i] for i in range(len(string) + 1)]',
    'EOF', BT, '',
    `${BT}bash`,
    'term_execute test_all_prefixes.py', BT,
  ].join('\n');
  const calls = recoverToolCallsFromText(text, ['fs_read', 'fs_write', 'fs_edit', 'term_execute', 'pytest_run']);
  assert.equal(calls.length, 2, 'the write and the run are both recovered');
  assert.equal(calls[0].name, 'fs_write');
  assert.equal(calls[0].arguments.path, '/sandbox/solution.py');
  assert.match(calls[0].arguments.content, /def all_prefixes/, 'the file body is the heredoc body');
  assert.ok(!calls[0].arguments.content.includes('EOF'), 'the delimiter is not part of the file');
  assert.equal(calls[1].name, 'term_execute');
  assert.equal(calls[1].arguments.command, 'test_all_prefixes.py');
});

test('M21/D6: recovery refuses the unsafe shapes', () => {
  const BT = '`'.repeat(3);
  const offered = ['fs_read', 'fs_write', 'fs_edit', 'term_execute', 'pytest_run'];
  // an UNTERMINATED heredoc is a truncated emission, not a complete file
  assert.equal(recoverBashPseudoCommands(`${BT}bash\nfs_write /a.py <<EOF\nfrom typing import List\n`, offered).length, 0);
  // a tool that is not in the offered menu is never disclosed
  assert.equal(recoverBashPseudoCommands(`${BT}bash\nsecret_tool /a.py <<EOF\nx\nEOF\n${BT}`, offered).length, 0);
  // plain prose with no command form
  assert.equal(recoverBashPseudoCommands('I would write the file for you.', offered).length, 0);
  // the heredoc WRITE form is only accepted for whole-file tools
  assert.equal(recoverBashPseudoCommands(`${BT}bash\nfs_edit /a.py <<EOF\nx\nEOF\n${BT}`, offered).length, 0);
});

/* ── M21/D7: the "unterminated triple-quoted string" corruption.
 *
 * Measured live (2026-11-03, HumanEval/2, /6, /11, /13): the model wrote a LONE
 * BACKSLASH where a docstring line break belongs, gluing lines together, so the
 * `"""` region never closed and Python refused to parse the file at all. A
 * correct implementation graded FAIL for a formatting artifact.
 */

test('M21/D7: a docstring line break written as a lone backslash is repaired', () => {
  const BS = '\\';
  const raw = 'import math' + BS + 'n' + BS + 'ndef truncate_number(number: float) -> float:' + BS + 'n    """ Given a positive number, it can be decomposed into'
    + BS + '    and integer part and decimals' + BS + '    (leftover part always smaller than 1).' + BS + 'n' + BS + 'n    Return the decimal part.'
    + BS + 'n    """' + BS + 'n    return number % 1.0' + BS + 'n';
  const r = normalizeWriteArgs('fs_write', { path: 'solution.py', content: raw });
  assert.equal(r.changed, true);
  assert.equal(r.reason, 'repaired-corrupt-escapes');
  assert.ok(!hasUnterminatedTripleQuote(r.args.content), 'the docstring now closes');
  assert.ok(!r.args.content.includes('\\n'), 'no literal backslash-n survives');
  assert.match(r.args.content, /def truncate_number/, 'the function survives the repair');
});

test('M21/D7: an ordinary file with a legitimate line continuation is not rewritten', () => {
  const BS = '\\';
  const legit = 'total = 1 + ' + BS + '\n    2 + 3\nprint(total)\n';
  const r = normalizeWriteArgs('fs_write', { path: 'x.py', content: legit });
  assert.equal(r.changed, false, 'a real line continuation is left alone');
  assert.equal(r.args.content, legit);
});

/* ── M21/D9: the stray-backslash line preceded by a LITERAL `\n`.
 *
 * Measured live (2026-11-04, HumanEval/5): the whole body used literal `\n`
 * escapes, and the stray-backslash line was preceded by a LITERAL escape
 * (`…List[str]:\n    \` + <real newline>), so the `(^|\n)` anchor in
 * `hasStrayBackslashBeforeNewline` missed it and the newline-dominance gate
 * sent the payload down the decode path, which left the lone backslash line
 * intact. Python then refused the file (`unexpected character after line
 * continuation`). The line shape is only visible after the escapes are
 * decoded, which is what `hasLoneBackslashLine` checks.
 */

test('M21/D9: a lone-backslash line behind a literal \\n escape is repaired', () => {
  const BS = '\\';
  const raw = 'from typing import List' + BS + 'n' + BS + 'ndef f(xs):' + BS + 'n    ' + BS + '\n'
    + '    """doc' + BS + 'n    more"""' + BS + 'n    return [x for x in xs]' + BS + 'n';
  assert.equal(hasStrayBackslashBeforeNewline(raw), false, 'the anchor misses it — this is the bug being covered');
  assert.equal(hasLoneBackslashLine(raw), true, 'decoding the escapes first recovers the line shape');
  const r = normalizeWriteArgs('fs_write', { path: 'x.py', content: raw });
  assert.equal(r.changed, true);
  assert.equal(r.reason, 'repaired-corrupt-escapes');
  assert.equal(hasLoneBackslashLine(r.args.content), false, 'the stray backslash line is gone');
  assert.match(r.args.content, /return \[x for x in xs\]/, 'the body survives');
});

test('M21/D9: an ordinary real-newline file is not flagged as a lone-backslash line', () => {
  const legit = 'def f():\n    return 1\n';
  assert.equal(hasLoneBackslashLine(legit), false);
});

/* ── M21/D8: the exec-style pytest FALSE FAILURE.
 *
 * The HumanEval sandbox ships `test_<entry>.py` as a bare script: it defines
 * `check(candidate)` and calls `check(<entry>)` with NO import of the module
 * under test. `pytest -q` imports that file, `check` runs, and `<entry>` is not
 * defined, so EVERY task reports `NameError: name '<entry>' is not defined`
 * even when solution.py defines it correctly. The official grader `exec`s the
 * solution into the test namespace first, which is why it PASSES the same
 * bytes. Injecting that NameError as a failure drove the model into a rewrite
 * loop (measured: HumanEval/13 wrote a CORRECT gcd, thrashed to the 300s cap).
 */

test('M21/D8: an exec-style test file is recognised as unverifiable, not failed', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'm21-exec-'));
  fs.writeFileSync(path.join(dir, 'solution.py'), 'def gcd(a, b):\n    while b:\n        a, b = b, a % b\n    return a\n');
  fs.writeFileSync(path.join(dir, 'test_gcd.py'), 'def check(candidate):\n    assert candidate(3, 7) == 1\n\n\ndef test_check():\n    check(gcd)\n');
  const parsed = {
    status: 'fail', failed: 1, errors: 0, tests: 1,
    failures: [{ kind: 'failed', test: 'test_gcd.py::test_check', message: "NameError: name 'gcd..." }],
  };
  assert.equal(looksLikeExecStylePytest(parsed, dir), true, 'the exec-style file cannot be checked by pytest');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('M21/D8: a real test file that imports its module is NOT excused', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'm21-exec-'));
  fs.writeFileSync(path.join(dir, 'solution.py'), 'def add(a, b):\n    return a + b\n');
  fs.writeFileSync(path.join(dir, 'test_add.py'), 'from solution import add\n\n\ndef test_missing():\n    assert undefined_thing == 1\n');
  const parsed = { status: 'fail', failed: 1, errors: 0, tests: 1, failures: [{ kind: 'failed', test: 'test_add.py::test_missing', message: "NameError: name 'undefined_thing' is not defined" }] };
  assert.equal(looksLikeExecStylePytest(parsed, dir), false, 'a real import means a genuine NameError must still block');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('M21/D8: a genuine assertion failure in an exec-style file still blocks', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'm21-exec-'));
  fs.writeFileSync(path.join(dir, 'test_x.py'), 'def check(candidate):\n    assert candidate(1) == 2\n\n\ndef test_check():\n    check(lambda x: x)\n');
  const parsed = { status: 'fail', failed: 1, errors: 0, tests: 1, failures: [{ kind: 'failed', test: 'test_x.py::test_check', message: 'assert 1 == 2' }] };
  assert.equal(looksLikeExecStylePytest(parsed, dir), false, 'a real assertion failure is not excused');
  fs.rmSync(dir, { recursive: true, force: true });
});

/* ── M21/D10: the fenced-code-block write (the "no-call" recovery gap).
 *
 * Measured live (2026-11-04, HumanEval/0, /4, /5, /12): the model answered with
 * PROSE plus a fenced ```python block holding the COMPLETE implementation and a
 * bare `fs_write <path>` reference, but emitted no native call and no JSON
 * object, so `recoverToolCallsFromText` returned nothing and the turn ended
 * unwritten. The bounded malformed retry did not fire either — it is gated on
 * `looksLikeToolAttempt`, which only detects a JSON-shaped attempt. The model
 * had the capability; the loop dropped the bytes.
 */

test('M21/D10: prose + a fenced python block + a bare fs_write path recovers the write', () => {
  const offered = ['fs_read', 'fs_write', 'term_execute'];
  const text = [
    'Here is the complete implementation of the Python function `longest` in the file solution.py:',
    '```python',
    'from typing import List, Optional',
    '',
    'def longest(strings: List[str]) -> Optional[str]:',
    '    if not strings:',
    '        return None',
    '    return max(strings, key=len)',
    '```',
    'To write this to the file and run the test, use the following commands:',
    '```bash',
    'fs_write /sandbox/solution.py',
    '```',
  ].join('\n');
  const rec = recoverToolCallsFromText(text, offered, { targetPath: '/sandbox/solution.py' });
  assert.equal(rec.length, 1, 'exactly one write is recovered');
  assert.equal(rec[0].name, 'fs_write');
  assert.equal(rec[0].arguments.path, '/sandbox/solution.py');
  assert.match(rec[0].arguments.content, /def longest/, 'the body is the fenced implementation');
  assert.ok(rec[0].arguments.content.endsWith('\n'), 'the file body ends with a newline');
});

test('M21/D10: a fenced block with no path reference uses the instruction hint only when the instruction asks for a write', () => {
  const offered = ['fs_write', 'term_execute'];
  const text = 'Here is the complete implementation:\n```python\ndef f():\n    return 1\n```';
  const r1 = recoverFencedCodeWrite(text, offered, { targetPath: '/w/solution.py', writeInstruction: true });
  assert.equal(r1.length, 1);
  assert.equal(r1[0].arguments.path, '/w/solution.py');

  const r2 = recoverFencedCodeWrite(text, offered, { targetPath: '/w/solution.py', writeInstruction: false });
  assert.equal(r2.length, 0, 'an "explain this file" turn must never overwrite the file it points at');
});

test('M21/D10: isWriteInstruction recognises a write ask and rejects a read/explain ask', () => {
  assert.equal(isWriteInstruction('Write the complete implementation to /w/solution.py'), true);
  assert.equal(isWriteInstruction('create solution.py with the function'), true);
  assert.equal(isWriteInstruction('explain what /app/foo.py does'), false);
  assert.equal(isWriteInstruction('read /app/foo.py and summarise it'), false);
});

test('M21/D10: a fenced block with no path reference and no hint recovers nothing', () => {
  const offered = ['fs_write', 'term_execute'];
  const text = 'Here is the complete implementation:\n```python\ndef f():\n    return 1\n```';
  assert.equal(recoverFencedCodeWrite(text, offered, {}).length, 0, 'no target means no write — never a guess');
});

test('M21/D10: a fenced block with no definition is not a file body', () => {
  const offered = ['fs_write', 'term_execute'];
  const text = 'Run this:\n```python\nprint("hello")\n```\nfs_write /w/solution.py';
  assert.equal(recoverFencedCodeWrite(text, offered, {}).length, 0, 'a bare statement is not a complete file');
});

test('M21/D10: fs_write is only recovered when it is actually offered', () => {
  const text = 'Here is the complete implementation:\n```python\ndef f():\n    return 1\n```\nfs_write /w/solution.py';
  assert.equal(recoverFencedCodeWrite(text, ['term_execute'], {}).length, 0, 'an unoffered tool is never disclosed');
});

test('M21/D10: extractTargetPath finds the file the instruction names', () => {
  assert.equal(extractTargetPath('Write the implementation to the file /sandbox/solution.py now'), '/sandbox/solution.py');
  assert.equal(extractTargetPath('write it to solution.py please'), 'solution.py');
  assert.equal(extractTargetPath('explain what a python function is'), null, 'a bare language word is not a path');
});

test('M21/D10: a fence the model never closed (truncated at the token cap) still recovers', () => {
  const offered = ['fs_write', 'term_execute'];
  const text = 'Here is the complete implementation:\n```python\ndef f(x):\n    return x\n';
  const rec = recoverFencedCodeWrite(text, offered, { targetPath: '/w/solution.py', writeInstruction: true });
  assert.equal(rec.length, 1, 'the missing closing fence is not a reason to drop the body');
  assert.match(rec[0].arguments.content, /def f/);
});

test('M21/D10: two recovered writes to the same path collapse to the most complete body', () => {
  const offered = ['fs_write', 'term_execute'];
  const short = 'Here is the implementation:\n```python\ndef f():\n    return 1\n```\nfs_write /w/solution.py';
  const long = 'Here is the implementation:\n```python\ndef f():\n    return 1\n```\n```python\ndef f():\n    x = 1\n    return x + 1\n```\nfs_write /w/solution.py';
  const one = recoverToolCallsFromText(short, offered, {});
  const two = recoverToolCallsFromText(long, offered, {});
  assert.equal(one.length, 1);
  assert.equal(two.length, 1, 'both emissions target the same file — writing both would pick the wrong body');
  assert.match(two[0].arguments.content, /x = 1/, 'the longer, more complete body wins');
});
