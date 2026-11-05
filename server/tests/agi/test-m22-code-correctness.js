/**
 * M22 — CODE-GENERATION CORRECTNESS & STRUCTURED OUTPUT suite.
 *
 * The M21 measurement (15-task HumanEval slice, llama3.2:3b) left three
 * residual defects. Each is guarded here deterministically (zero network, no
 * model), and each guard is a real code path — no mocks.
 *
 *   D1 — NO PYTHON SYNTAX VALIDATION. In a Python sandbox the lint layer is
 *        `inapplicable` (ESLint is a JavaScript linter) and the unit layer is
 *        `unverifiable` (an exec-style test file cannot be run by pytest), so
 *        nothing ever told the model its file did not parse. A SyntaxVerifier
 *        now compiles the changed `.py` files and layers a structural reader on
 *        top for the shapes the compiler ACCEPTS but the task rejects.
 *
 *   D2 — A STRUCTURED VERIFY DECLARATION. A caller that knows the project shape
 *        (the HumanEval harness) can declare the layer order instead of relying
 *        on the `pytest` heuristic. `parseVerifyLayers` reads the CODE_VERIFY
 *        seam; an unknown name is ignored, never invented.
 *
 *   D3 — THE INSTRUCTION NAMES THE FILE. The model sometimes writes a
 *        DIFFERENT filename in its answer than the task named (measured: the
 *        instruction said `…/HumanEval_10/solution.py`, the answer's `fs_write`
 *        ref said `longest.py`), so the write landed on the wrong file and the
 *        grader saw an unmodified stub. The instruction hint now wins when the
 *        instruction asks for a write.
 *
 * Run: node --test tests/agi/test-m22-code-correctness.js
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  analyzePythonSource,
  hasUnterminatedTripleQuote,
  isTripleQuoteWrapped,
  duplicateTopLevelDefs,
  functionBody,
  isPlaceholderBody,
} from '../../src/verification/analysis/python-structure.js';
import { SyntaxVerifier } from '../../src/verification/verifiers/SyntaxVerifier.js';
import { TestVerifier, execStyleRunner } from '../../src/verification/verifiers/TestVerifier.js';
import { runCommand } from '../../src/verification/spawn/execute.js';
import { verifyAfterEdit, DEFAULT_REAL_LAYERS, VERIFY_LAYER_ORDER } from '../../src/verification/loop/auto-verify.js';
import { parseVerifyLayers, extractEntryPoint } from '../../src/services/agent/verify-config.js';
import { recoverToolCallsFromText } from '../../src/services/agent/ToolCallRecovery.js';
import { tmuxContextBlock } from '../../src/services/TmuxContext.js';

/* ------------------------------------------------------------------ helpers */

function tmpdir(prefix) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return { d, cleanup: () => { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* gone */ } } };
}

const VALID = [
  'from typing import List',
  '',
  'def has_close_elements(numbers: List[float], threshold: float) -> bool:',
  '    """Are any two numbers closer than the threshold?"""',
  '    for i, a in enumerate(numbers):',
  '        for b in numbers[i + 1:]:',
  '            if abs(a - b) < threshold:',
  '                return True',
  '    return False',
  '',
].join('\n');

/* ── D1: the pure structural reader ─────────────────────────────────────── */

test('M22/D1: a valid implementation has no structural defect', () => {
  const r = analyzePythonSource(VALID, 'has_close_elements');
  assert.equal(r.ok, true, JSON.stringify(r.defects));
});

test('M22/D1: an unterminated docstring is detected', () => {
  const src = 'def f(x):\n    """a docstring that never closes\n    return x\n';
  assert.equal(hasUnterminatedTripleQuote(src), true);
  const r = analyzePythonSource(src, 'f');
  /* The compiler catches this one — the reader must not need to. */
  assert.equal(r.ok, true, 'the compiler, not the reader, owns the unterminated case');
});

test('M22/D1: a body wrapped in triple quotes is detected (it parses but defines nothing)', () => {
  const src = '"""\nfrom typing import List\ndef f(x):\n    return x\n"""\n';
  assert.equal(isTripleQuoteWrapped(src), true);
  const r = analyzePythonSource(src, 'f');
  assert.equal(r.ok, false);
  assert.deepEqual(r.defects, ['triple-quote-wrapped']);
});

test('M22/D1: a legitimate module docstring followed by code is NOT wrapped', () => {
  const src = '"""Module docstring."""\n\n\ndef f(x):\n    return x\n';
  assert.equal(isTripleQuoteWrapped(src), false);
  assert.equal(analyzePythonSource(src, 'f').ok, true);
});

test('M22/D1: a duplicate top-level definition is detected', () => {
  const src = 'def f(x):\n    return x\n\n\ndef f(x):\n    return x + 1\n';
  assert.deepEqual(duplicateTopLevelDefs(src), [{ name: 'f', count: 2 }]);
  const r = analyzePythonSource(src, 'f');
  assert.equal(r.ok, false);
  assert.ok(r.defects.includes('duplicate-definition'));
});

test('M22/D1: a placeholder body is detected, a real body is not', () => {
  assert.equal(isPlaceholderBody('\n    pass\n'), true);
  assert.equal(isPlaceholderBody('\n    ...\n'), true);
  assert.equal(isPlaceholderBody('\n    raise NotImplementedError\n'), true);
  assert.equal(isPlaceholderBody('\n    """doc"""\n'), true);
  assert.equal(isPlaceholderBody('\n    return x + 1\n'), false);

  const stub = 'def f(x):\n    pass\n';
  const r = analyzePythonSource(stub, 'f');
  assert.equal(r.ok, false);
  assert.ok(r.defects.includes('placeholder-body'));
});

test('M22/D1: a missing entry point is detected', () => {
  const r = analyzePythonSource('def other(x):\n    return x\n', 'f');
  assert.equal(r.ok, false);
  assert.ok(r.defects.includes('missing-entry-point'));
});

test('M22/D1: an empty file is a defect', () => {
  assert.deepEqual(analyzePythonSource('', 'f').defects, ['empty']);
});

test('M22/D1: functionBody reads a multi-line signature', () => {
  const src = 'def f(\n    a: int,\n    b: int,\n) -> int:\n    return a + b\n\n\ndef g():\n    return 0\n';
  assert.match(functionBody(src, 'f'), /return a \+ b/);
  assert.equal(functionBody(src, 'nope'), null);
});

/* ── D1: the SyntaxVerifier over real files ─────────────────────────────── */

test('M22/D1: SyntaxVerifier FAILS a file that does not compile, with the real message', async () => {
  const { d, cleanup } = tmpdir('m22-syn-');
  try {
    fs.writeFileSync(path.join(d, 'solution.py'), 'def f(x):\n    """doc\n    return x\n');
    const r = await SyntaxVerifier.verify({ snapshotId: 's', options: { cwd: d, entryPoint: 'f' } });
    assert.equal(r.status, 'fail');
    assert.match(r.reason, /syntax error/i);
    assert.match(r.evidence[0].content, /SyntaxError|unterminated/i);
  } finally { cleanup(); }
});

test('M22/D1: SyntaxVerifier PASSES a valid implementation', async () => {
  const { d, cleanup } = tmpdir('m22-syn-ok-');
  try {
    fs.writeFileSync(path.join(d, 'solution.py'), VALID);
    const r = await SyntaxVerifier.verify({ snapshotId: 's', options: { cwd: d, entryPoint: 'has_close_elements' } });
    assert.equal(r.status, 'pass', r.reason);
  } finally { cleanup(); }
});

test('M22/D1: SyntaxVerifier FAILS a wrapped body the compiler would accept', async () => {
  const { d, cleanup } = tmpdir('m22-syn-wrap-');
  try {
    fs.writeFileSync(path.join(d, 'solution.py'), '"""\ndef f(x):\n    return x\n"""\n');
    const r = await SyntaxVerifier.verify({ snapshotId: 's', options: { cwd: d, entryPoint: 'f' } });
    assert.equal(r.status, 'fail');
    assert.match(r.reason, /triple-quote-wrapped|missing-entry-point/);
  } finally { cleanup(); }
});

test('M22/D1: SyntaxVerifier checks the entry point only in the solution file', async () => {
  const { d, cleanup } = tmpdir('m22-syn-ep-');
  try {
    fs.writeFileSync(path.join(d, 'solution.py'), VALID);
    fs.writeFileSync(path.join(d, 'test_x.py'), 'from solution import has_close_elements\n\ndef test_x():\n    assert has_close_elements([1, 2], 0.5)\n');
    const r = await SyntaxVerifier.verify({ snapshotId: 's', options: { cwd: d, entryPoint: 'has_close_elements' } });
    assert.equal(r.status, 'pass', r.reason);
  } finally { cleanup(); }
});

test('M22/D1: SyntaxVerifier is INAPPLICABLE on a project with no Python', async () => {
  const { d, cleanup } = tmpdir('m22-syn-none-');
  try {
    fs.writeFileSync(path.join(d, 'package.json'), '{"name":"x"}');
    const r = await SyntaxVerifier.verify({ snapshotId: 's', options: { cwd: d } });
    assert.equal(r.status, 'inapplicable', 'a JS project is skipped, not failed');
  } finally { cleanup(); }
});

test('M22/D1: SyntaxVerifier honours the injected run seam', async () => {
  const r = await SyntaxVerifier.verify({ snapshotId: 's', options: { run: () => ({ exitCode: 1, output: 'boom' }) } });
  assert.equal(r.status, 'fail');
  assert.equal(r.evidence[0].content, 'boom');
});

/* ── D1: the layer is wired into the real verify path ───────────────────── */

test('M22/D1: syntax is the FIRST default real layer', () => {
  assert.equal(VERIFY_LAYER_ORDER[0], 'syntax');
  assert.equal(DEFAULT_REAL_LAYERS[0], 'syntax');
});

test('M22/D1: verifyAfterEdit with real:["syntax"] reports the syntax layer as the blocker', async () => {
  const { d, cleanup } = tmpdir('m22-av-syn-');
  try {
    fs.writeFileSync(path.join(d, 'solution.py'), 'def f(x):\n    """doc\n    return x\n');
    const outcome = await verifyAfterEdit(
      { nodeId: 'n', snapshotId: 's', acceptanceCriteria: 'x', claimantAcbId: 'a', entryPoint: 'f', options: { cwd: d, entryPoint: 'f' } },
      {},
      { real: ['syntax'] },
    );
    assert.equal(outcome.ok, false);
    assert.equal(outcome.context.injectedFailure.layer, 'syntax');
    assert.match(String(outcome.context.injectedFailure.reason), /syntax|structure/i);
  } finally { cleanup(); }
});

test('M22/D1: a syntax-broken file no longer passes as `unverifiable` in a Python sandbox', async () => {
  const { d, cleanup } = tmpdir('m22-av-noun-');
  try {
    fs.writeFileSync(path.join(d, 'solution.py'), 'def f(x)\n    return x\n');
    fs.writeFileSync(path.join(d, 'test_f.py'), 'from solution import f\n\ndef test_f():\n    assert f(1) == 1\n');
    const outcome = await verifyAfterEdit(
      { nodeId: 'n', snapshotId: 's', acceptanceCriteria: 'x', claimantAcbId: 'a', entryPoint: 'f', options: { cwd: d, entryPoint: 'f' } },
      {},
      { real: ['syntax', 'lint', 'unit'] },
    );
    assert.equal(outcome.ok, false);
    assert.equal(outcome.context.injectedFailure.layer, 'syntax', 'the syntax layer must block before the unverifiable unit layer');
  } finally { cleanup(); }
});

/* ── D2: the verify declaration ─────────────────────────────────────────── */

test('M22/D2: parseVerifyLayers reads a canonical list in layer order', () => {
  assert.deepEqual(parseVerifyLayers('syntax,lint,unit'), ['syntax', 'lint', 'unit']);
  assert.deepEqual(parseVerifyLayers('unit,syntax'), ['syntax', 'unit'], 'canonical order, not input order');
  assert.deepEqual(parseVerifyLayers(['syntax']), ['syntax']);
});

test('M22/D2: parseVerifyLayers ignores unknown names and empty input', () => {
  assert.deepEqual(parseVerifyLayers('syntax,bogus'), ['syntax']);
  assert.equal(parseVerifyLayers('bogus'), null, 'nothing valid means no override — the default stands');
  assert.equal(parseVerifyLayers(''), null);
  assert.equal(parseVerifyLayers(null), null);
  assert.equal(parseVerifyLayers(undefined), null);
});

test('M22/D2: extractEntryPoint reads the function the task names', () => {
  assert.equal(extractEntryPoint('Keep the exact function name (has_close_elements) and signature.'), 'has_close_elements');
  assert.equal(extractEntryPoint('Define `def separate_paren_groups(paren_string: str)`.'), 'separate_paren_groups');
  assert.equal(extractEntryPoint('Write a program that prints hello'), null);
});

/* ── D3: the instruction names the file ─────────────────────────────────── */

test('M22/D3: the instruction path wins over a wrong filename in the answer', () => {
  const offered = ['fs_read', 'fs_write', 'term_execute'];
  const text = [
    'Here is the complete implementation:',
    '```python',
    'from typing import List, Optional',
    '',
    'def longest(strings: List[str]) -> Optional[str]:',
    '    if not strings:',
    '        return None',
    '    return max(strings, key=len)',
    '```',
    'To write this to the file and run the test:',
    '```bash',
    'fs_write longest.py',
    'term_execute test_longest.py',
  ].join('\n');
  const rec = recoverToolCallsFromText(text, offered, { targetPath: '/sb/HumanEval_12/solution.py', writeInstruction: true });
  const write = rec.find((c) => c.name === 'fs_write');
  assert.ok(write, 'the write is recovered');
  assert.equal(write.arguments.path, '/sb/HumanEval_12/solution.py', 'the task-declared file wins over the answer’s wrong name');
});

test('M22/D3: with no instruction hint the answer’s own reference is still used', () => {
  const offered = ['fs_write', 'term_execute'];
  const text = 'Here is the implementation:\n```python\ndef f():\n    return 1\n```\nfs_write /w/out.py';
  const rec = recoverToolCallsFromText(text, offered, {});
  assert.equal(rec.length, 1);
  assert.equal(rec[0].arguments.path, '/w/out.py');
});

test('M22/D3: an "explain this file" turn still never writes', () => {
  const offered = ['fs_write'];
  const text = 'Here is what it does:\n```python\ndef f():\n    return 1\n```';
  assert.equal(recoverToolCallsFromText(text, offered, { targetPath: '/app/foo.py', writeInstruction: false }).length, 0);
});

/* ── D4: the tmux context must not leak a host path into the prompt ─────── */

test('M22/D4: the tmux context block never contains the raw TMUX socket path', () => {
  const env = { TMUX: '/tmp/openhands-agent-server-37/tmux-10001/openhands-ebb65f9a,105,0', TMUX_PANE: '%1' };
  const block = tmuxContextBlock(env);
  assert.ok(block.length > 0, 'inside tmux the block is rendered');
  assert.doesNotMatch(block, /openhands-agent-server/, 'the host socket path must not be in the prompt');
  assert.doesNotMatch(block, /tmux-10001/, 'no host path fragments either');
  assert.match(block, /persistent terminal/, 'it still tells the model it has a terminal home');
});

test('M22/D4: outside tmux the block stays empty', () => {
  assert.equal(tmuxContextBlock({}), '');
  assert.equal(tmuxContextBlock({ TMUX: '/tmp/x' }), '', 'a missing pane is not a tmux session');
});

/* ── D5: the exec-style runner gives a Python task a real verdict ───────── */

test('M22/D5: execStyleRunner detects the HumanEval sandbox shape', async () => {
  const { d, cleanup } = tmpdir('m22-exec-');
  try {
    fs.writeFileSync(path.join(d, 'solution.py'), 'def f(x):\n    return x\n');
    fs.writeFileSync(path.join(d, 'test_f.py'), 'def check(candidate):\n    assert candidate(1) == 1\n\ncheck(f)\n');
    const spec = execStyleRunner(d);
    assert.ok(spec, 'the sandbox shape is recognised');
    assert.equal(spec[0], process.env.PYTHON || 'python3');
    /* Names are RELATIVE so they resolve against the child's actual cwd (which
       may be a materialized snapshot tempdir, not `d`). */
    assert.deepEqual(spec.slice(-2), ['solution.py', 'test_f.py']);
    const res = await runCommand(spec, { cwd: d });
    assert.equal(res.ok, true, `the detected spec must actually run: ${res.output}`);
  } finally { cleanup(); }
});

test('M22/D5: execStyleRunner refuses a real pytest file that imports its module', () => {
  const { d, cleanup } = tmpdir('m22-exec-no-');
  try {
    fs.writeFileSync(path.join(d, 'solution.py'), 'def f(x):\n    return x\n');
    fs.writeFileSync(path.join(d, 'test_f.py'), 'from solution import f\n\ndef test_f():\n    assert f(1) == 1\n');
    assert.equal(execStyleRunner(d), null, 'a normal pytest repo is left to pytest');
  } finally { cleanup(); }
});

test('M22/D5: execStyleRunner refuses when there is no solution.py', () => {
  const { d, cleanup } = tmpdir('m22-exec-nosol-');
  try {
    fs.writeFileSync(path.join(d, 'test_f.py'), 'def check(c):\n    pass\n\ncheck(f)\n');
    assert.equal(execStyleRunner(d), null);
  } finally { cleanup(); }
});

test('M22/D5: TestVerifier PASSES a correct solution through the exec-style runner', async () => {
  const { d, cleanup } = tmpdir('m22-exec-pass-');
  try {
    fs.writeFileSync(path.join(d, 'solution.py'), 'def f(x):\n    return x + 1\n');
    fs.writeFileSync(path.join(d, 'test_f.py'), 'def check(candidate):\n    assert candidate(1) == 2\n\ncheck(f)\n');
    const r = await TestVerifier.verify({ snapshotId: 's', options: { cwd: d } });
    assert.equal(r.status, 'pass', r.reason);
  } finally { cleanup(); }
});

test('M22/D5: TestVerifier FAILS a wrong solution through the exec-style runner', async () => {
  const { d, cleanup } = tmpdir('m22-exec-fail-');
  try {
    fs.writeFileSync(path.join(d, 'solution.py'), 'def f(x):\n    return x\n');
    fs.writeFileSync(path.join(d, 'test_f.py'), 'def check(candidate):\n    assert candidate(1) == 2\n\ncheck(f)\n');
    const r = await TestVerifier.verify({ snapshotId: 's', options: { cwd: d } });
    assert.equal(r.status, 'fail', 'the official grader shape gives a real red, not `unverifiable`');
    assert.match(r.reason, /AssertionError/);
  } finally { cleanup(); }
});

test('M22/D5: a failing exec-style run no longer reads as unverifiable', async () => {
  const { d, cleanup } = tmpdir('m22-exec-noun-');
  try {
    fs.writeFileSync(path.join(d, 'solution.py'), 'def f(x):\n    return x\n');
    fs.writeFileSync(path.join(d, 'test_f.py'), 'def check(candidate):\n    assert candidate(1) == 2\n\ncheck(f)\n');
    const outcome = await verifyAfterEdit(
      { nodeId: 'n', snapshotId: 's', acceptanceCriteria: 'x', claimantAcbId: 'a', options: { cwd: d } },
      {},
      { real: ['syntax', 'unit'] },
    );
    assert.equal(outcome.ok, false);
    assert.equal(outcome.context.injectedFailure.layer, 'unit', 'a wrong solution is a unit failure, not "nothing could check it"');
  } finally { cleanup(); }
});

/* ── D6: a spawned verifier must never read stale bytecode ──────────────── */

test('M22/D6: a same-size edit in the same second is NOT served from a stale .pyc', async () => {
  const { d, cleanup } = tmpdir('m22-pyc-');
  try {
    const mod = path.join(d, 'mod.py');
    const chk = path.join(d, 'chk.py');
    fs.writeFileSync(mod, 'VALUE = 1\n');
    fs.writeFileSync(chk, 'import mod\nassert mod.VALUE == 2, "stale bytecode"\nprint("FRESH")\n');
    const py = process.env.PYTHON || 'python3';

    /* Run 1: fails, and (pre-fix) leaves __pycache__/mod.*.pyc next to mod.py. */
    const first = await runCommand([py, chk], { cwd: d });
    assert.equal(first.ok, false, 'run 1 must fail against VALUE = 1');

    /* Edit mod.py to the FIXED value — same byte length — and pin its mtime to
       the pre-edit value, so (mtime, size) is exactly what CPython caches on.
       This is the deterministic form of "same-size edit within one second". */
    const before = fs.statSync(mod).mtime;
    fs.writeFileSync(mod, 'VALUE = 2\n');
    fs.utimesSync(mod, before, before);

    /* Run 2 must see the NEW bytes. Without a private cache dir, CPython trusts
       the (mtime, size) match, loads the OLD bytecode, and this fails. */
    const second = await runCommand([py, chk], { cwd: d });
    assert.equal(second.ok, true, `stale bytecode served a false result: ${second.output}`);
    assert.match(second.output, /FRESH/);
  } finally { cleanup(); }
});
