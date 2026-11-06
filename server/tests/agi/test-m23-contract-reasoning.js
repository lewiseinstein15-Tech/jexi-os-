/**
 * M23 — CONTRACT-AWARE CODING, REASONING & SELF-CORRECTION suite.
 *
 * Guards the M23 additions deterministically (zero network, no model), one test
 * per regression area the mission names:
 *   missing function names, incorrect signatures, incorrect parameters,
 *   duplicate definitions, incomplete bodies, invalid syntax, valid alternative
 *   implementations, incorrect algorithms, repair feedback quality, repair
 *   limits, false-success prevention, tool execution failures, unauthorized
 *   actions.
 *
 * Run: node --test tests/agi/test-m23-contract-reasoning.js
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  extractFunctionContract,
  extractCodeBlock,
  parseSignature,
  parseAllSignatures,
  selectTargetSignature,
  bodyIsComplete,
  renderContractBlock,
  checkAgainstContract,
  normalizeSignature,
} from '../../src/services/agent/FunctionContract.js';
import {
  diagnoseFailure,
  correctionHint,
  isRepeatedAttempt,
  FAILURE_CLASSES,
} from '../../src/services/agent/FailureDiagnosis.js';
import { runBoundedRepair, MAX_REPAIRS } from '../../../benchmarks/humaneval-live/lib/repair.mjs';

/* -------------------------------------------------------------- fixtures --*/

const HE0 = `from typing import List


def has_close_elements(numbers: List[float], threshold: float) -> bool:
    """ Check if in given list of numbers, are any two numbers closer to each other than
    given threshold.
    >>> has_close_elements([1.0, 2.0, 3.0], 0.5)
    False
    >>> has_close_elements([1.0, 2.8, 3.0, 4.0, 5.0, 2.0], 0.3)
    True
    """
`;

const HE10 = `def is_palindrome(string: str) -> bool:
    """ Test if given string is a palindrome """
    return string == string[::-1]


def make_palindrome(string: str) -> str:
    """ Find the shortest palindrome that begins with a supplied string.
    >>> make_palindrome('')
    ''
    >>> make_palindrome('cat')
    'catac'
    """
`;

/* ---------------------------------------------- A. contract extraction ----*/

test('M23/A1: extracts name, ordered params, return, doctests and imports from a Python stub', () => {
  const c = extractFunctionContract(HE0);
  assert.equal(c.name, 'has_close_elements');
  assert.equal(c.source, 'python');
  assert.equal(c.confidence, 'high');
  assert.deepEqual(c.params.map((p) => p.name), ['numbers', 'threshold']);
  assert.equal(c.returns, 'bool');
  assert.equal(c.doctests.length, 2);
  assert.deepEqual(c.imports, ['from typing import List']);
  assert.equal(c.signature, 'def has_close_elements(numbers: List[float], threshold: float) -> bool:');
});

test('M23/A2: selects the STUB being asked for, not a complete helper above it', () => {
  const c = extractFunctionContract(HE10);
  assert.equal(c.name, 'make_palindrome', 'the incomplete def is the target, not is_palindrome');
  const all = parseAllSignatures(HE10);
  assert.deepEqual(all.map((s) => s.name), ['is_palindrome', 'make_palindrome']);
  assert.equal(bodyIsComplete(all[0].body), true);
  assert.equal(bodyIsComplete(all[1].body), false);
});

test('M23/A3: an explicit entryPoint hint wins over the stub heuristic', () => {
  const c = extractFunctionContract(HE10, { entryPoint: 'is_palindrome' });
  assert.equal(c.name, 'is_palindrome');
});

test('M23/A4: extracts a signature named in PROSE, degrading honestly when none is present', () => {
  const prose = extractFunctionContract('Please write a function `slugify(text: str, max_len: int = 40) -> str` that lowercases.');
  assert.equal(prose.name, 'slugify');
  assert.equal(prose.source, 'prose');
  assert.equal(prose.confidence, 'medium');
  assert.deepEqual(prose.params.map((p) => p.name), ['text', 'max_len']);
  assert.equal(prose.params[1].default, '40');
  const none = extractFunctionContract('Write a Python function to reverse a string.');
  assert.equal(none.name, null);
  assert.equal(none.source, 'none');
  assert.equal(none.confidence, 'low');
  assert.ok(none.missing.includes('name'));
});

test('M23/A5: a fenced python block is preferred over surrounding prose', () => {
  const text = 'Here is the task.\n\n```python\ndef f(x: int) -> int:\n    """d"""\n```\n\nGood luck.';
  const c = extractFunctionContract(text);
  assert.equal(c.name, 'f');
  assert.equal(c.source, 'python');
  assert.equal(extractCodeBlock(text).includes('def f'), true);
});

test('M23/A6: parameter defaults and *args/**kwargs are parsed, not lost', () => {
  const sig = parseSignature('def f(a, b=2, *args, **kwargs):\n    pass');
  assert.deepEqual(sig.params.map((p) => p.name), ['a', 'b', 'args', 'kwargs']);
  assert.equal(sig.params[1].default, '2');
  assert.equal(sig.params[2].kind, 'varargs');
  assert.equal(sig.params[3].kind, 'kwargs');
});

test('M23/A7: renderContractBlock states name, order, return, examples and imports', () => {
  const block = renderContractBlock(extractFunctionContract(HE0));
  assert.match(block, /REQUIRED CONTRACT/);
  assert.match(block, /def has_close_elements\(numbers: List\[float\], threshold: float\) -> bool:/);
  assert.match(block, /Parameters, in order: numbers, threshold/);
  assert.match(block, /Return: bool/);
  assert.match(block, /has_close_elements\(\[1\.0, 2\.0, 3\.0\], 0\.5\)  =>  False/);
  assert.match(block, /from typing import List/);
  assert.equal(renderContractBlock({ name: null }), null, 'no name → no block');
});

/* --------------------------------------- B. generation contract checks ----*/

test('M23/B1: missing function name is a missing-entry-point violation', () => {
  const c = extractFunctionContract(HE0);
  const r = checkAgainstContract('def main():\n    return 1\n', c);
  assert.equal(r.ok, false);
  assert.equal(r.violations[0].code, 'missing-entry-point');
});

test('M23/B2: an incorrect signature is a signature-mismatch violation', () => {
  const c = extractFunctionContract(HE0);
  const r = checkAgainstContract('def has_close_elements(a, b, c):\n    return True\n', c);
  assert.equal(r.ok, false);
  assert.equal(r.violations.some((v) => v.code === 'signature-mismatch'), true);
});

test('M23/B3: incorrect parameter ORDER is caught', () => {
  const c = extractFunctionContract(HE0);
  const r = checkAgainstContract('def has_close_elements(threshold, numbers):\n    return True\n', c);
  assert.equal(r.ok, false);
  assert.equal(r.violations.some((v) => v.code === 'signature-mismatch'), true);
});

test('M23/B4: a duplicate definition of the entry point is caught', () => {
  const c = extractFunctionContract(HE0);
  const src = 'def has_close_elements(numbers, threshold):\n    return False\n\ndef has_close_elements(numbers, threshold):\n    return True\n';
  const r = checkAgainstContract(src, c);
  assert.equal(r.ok, false);
  assert.equal(r.violations.some((v) => v.code === 'duplicate-entry-point'), true);
});

test('M23/B5: an incomplete (docstring-only) body is caught', () => {
  const c = extractFunctionContract(HE0);
  const src = 'def has_close_elements(numbers, threshold):\n    """todo"""\n    pass\n';
  const r = checkAgainstContract(src, c);
  assert.equal(r.ok, false);
  assert.equal(r.violations.some((v) => v.code === 'incomplete-body'), true);
});

test('M23/B6: a VALID alternative implementation passes — no rigid format enforced', () => {
  const c = extractFunctionContract(HE0);
  const alt = 'import math\n\ndef has_close_elements(nums, thr):\n    return any(abs(a - b) < thr for i, a in enumerate(nums) for b in nums[i + 1:])\n';
  /* Different parameter NAMES are a real signature difference and are reported;
     the body itself is legitimate. */
  const sameNames = 'def has_close_elements(numbers, threshold):\n    s = sorted(numbers)\n    return any(s[i + 1] - s[i] < threshold for i in range(len(s) - 1))\n';
  assert.equal(checkAgainstContract(sameNames, c).ok, true, 'a different algorithm with the right interface is accepted');
  assert.equal(checkAgainstContract(alt, c).violations.some((v) => v.code === 'signature-mismatch'), true);
});

test('M23/B7: gold-style canonical solutions pass the contract check', () => {
  const c = extractFunctionContract(HE0);
  const gold = `${HE0}\n    numbers.sort()\n    return any(numbers[i + 1] - numbers[i] < threshold for i in range(len(numbers) - 1))\n`;
  assert.equal(checkAgainstContract(gold, c).ok, true);
});

test('M23/B8: normalizeSignature round-trips the interface', () => {
  const sig = parseSignature('def f(a: int, b: str = "x") -> bool:\n    pass');
  assert.equal(normalizeSignature(sig), 'def f(a: int, b: str = "x") -> bool:');
});

/* --------------------------------------- C. failure diagnosis taxonomy ----*/

test('M23/C1: a syntax error is classified as syntax-error, not algorithm', () => {
  const d = diagnoseFailure({ gradeOutput: 'SyntaxError: unterminated string literal (detected at line 4)', source: 'def f(:\n' });
  assert.equal(d.class, 'syntax-error');
  assert.equal(d.confidence, 'high');
});

test('M23/C2: a runtime exception is classified as runtime-exception', () => {
  const d = diagnoseFailure({ gradeOutput: 'Traceback...\nValueError: bad value\n', source: 'def f(x):\n    return int(x)\n' });
  assert.equal(d.class, 'runtime-exception');
});

test('M23/C3: a failed assertion on a complete, correctly-named function is an algorithmic failure', () => {
  const c = extractFunctionContract(HE0);
  const src = 'def has_close_elements(numbers, threshold):\n    return False\n';
  const d = diagnoseFailure({ gradeOutput: 'AssertionError: expected True', gradedPass: false, source: src, contract: c });
  assert.equal(d.class, 'assertion-failure');
  assert.equal(d.detail.algorithmic, true);
});

test('M23/C4: a missing entry point is classified before any algorithm claim', () => {
  const c = extractFunctionContract(HE0);
  const d = diagnoseFailure({ gradeOutput: 'AssertionError', source: 'def main():\n    return 1\n', contract: c });
  assert.equal(d.class, 'missing-entry-point');
});

test('M23/C5: a wrong signature is classified as signature-mismatch', () => {
  const c = extractFunctionContract(HE0);
  const d = diagnoseFailure({ gradeOutput: 'TypeError: missing arg', source: 'def has_close_elements(a):\n    return a\n', contract: c });
  assert.equal(d.class, 'signature-mismatch');
});

test('M23/C6: a timeout is classified as timeout even when a file exists', () => {
  const d = diagnoseFailure({ agentError: 'agent loop timed out after 300000ms', gradeOutput: '', source: 'def f(): pass\n' });
  assert.equal(d.class, 'timeout');
});

test('M23/C7: a tool failure is NOT confused with a syntax or algorithm problem', () => {
  const d = diagnoseFailure({ agentError: 'path escapes root', gradeOutput: 'ERROR: fs_write blocked', source: null });
  assert.equal(d.class, 'tool-failure');
});

test('M23/C8: a provider failure is an infrastructure problem, not a code problem', () => {
  const d = diagnoseFailure({ agentError: 'ECONNREFUSED 127.0.0.1:11434', source: null });
  assert.equal(d.class, 'provider-failure');
});

test('M23/C9: every diagnosis carries execution evidence and a valid class', () => {
  const cases = [
    { gradeOutput: 'SyntaxError: bad', source: 'def f(:' },
    { agentError: 'timed out' },
    { gradeOutput: 'AssertionError', source: 'def f():\n    return 1\n' },
  ];
  for (const c of cases) {
    const d = diagnoseFailure(c);
    assert.ok(FAILURE_CLASSES.includes(d.class), `${d.class} is in the taxonomy`);
    assert.ok(typeof d.evidence === 'string' && d.evidence.length > 0, 'evidence is non-empty');
  }
});

/* -------------------------------------------- D. repair feedback quality --*/

test('M23/D1: correctionHint is SPECIFIC to the failure class (no generic traceback echo)', () => {
  const c = extractFunctionContract(HE0);
  const syntax = correctionHint({ class: 'syntax-error' }, c);
  const algo = correctionHint({ class: 'assertion-failure' }, c);
  const missing = correctionHint({ class: 'missing-entry-point' }, c);
  assert.match(syntax, /does not compile/);
  assert.match(algo, /WRONG VALUE|algorithm problem/);
  assert.match(missing, /has_close_elements/);
  assert.notEqual(syntax, algo, 'different classes get different guidance');
});

test('M23/D2: isRepeatedAttempt detects a substantially identical resubmission', () => {
  const a = 'def f(x):\n    return x + 1\n';
  const b = 'def f(x):\n   return x + 1\n';   // whitespace only
  const c = 'def f(x):\n    return x + 2\n';
  assert.equal(isRepeatedAttempt(b, [a]), true);
  assert.equal(isRepeatedAttempt(c, [a]), false);
  assert.equal(isRepeatedAttempt(a, []), false);
});

test('M23/D3: a repair instruction carries the contract AND the specific hint', () => {
  const contract = extractFunctionContract(HE0);
  const hint = correctionHint({ class: 'signature-mismatch' }, contract);
  const block = renderContractBlock(contract);
  assert.match(hint, /def has_close_elements\(numbers: List\[float\], threshold: float\) -> bool:/);
  assert.match(block, /has_close_elements/);
});

/* ------------------------------------------------- E. repair limits -------*/

test('M23/E1: the repair loop is bounded at MAX_REPAIRS (2) — the limit is not raised', () => {
  assert.equal(MAX_REPAIRS, 2);
});

test('M23/E2: a repair that never passes exhausts the budget and reports honestly', async () => {
  let calls = 0;
  const loop = await runBoundedRepair({
    maxRepairs: 2,
    runAttempt: async () => { calls++; return {}; },
    grade: async () => ({ passed: false, output: 'AssertionError', error: null }),
  });
  assert.equal(calls, 3, '1 initial + 2 repairs, never more');
  assert.equal(loop.finalPass, false);
  assert.equal(loop.resolvedByRepair, false);
});

test('M23/E3: a repair that fixes a genuine failure is reported as recovered-by-repair', async () => {
  const verdicts = [false, true];
  let i = 0;
  const loop = await runBoundedRepair({
    maxRepairs: 2,
    runAttempt: async () => ({}),
    grade: async () => ({ passed: verdicts[i++], output: '', error: null }),
  });
  assert.equal(loop.finalPass, true);
  assert.equal(loop.resolvedByRepair, true);
});

/* ------------------------------------------- F. false-success prevention --*/

test('M23/F1: an agent that CLAIMS success but fails the grader is not a pass', async () => {
  const loop = await runBoundedRepair({
    maxRepairs: 0,
    runAttempt: async () => ({ answer: 'I have completed the task successfully.' }),
    grade: async () => ({ passed: false, output: 'AssertionError', error: null }),
  });
  assert.equal(loop.finalPass, false, 'a claim is not evidence');
});

test('M23/F2: a grader that cannot run is never a pass', async () => {
  const loop = await runBoundedRepair({
    maxRepairs: 1,
    runAttempt: async () => ({}),
    grade: async () => ({ passed: false, output: '', error: 'spawn python3 ENOENT' }),
  });
  assert.equal(loop.finalPass, false);
});

test('M23/F3: a timeout with a green leftover file is not a pass', async () => {
  const loop = await runBoundedRepair({
    maxRepairs: 0,
    runAttempt: async () => ({ error: 'agent loop timed out after 300000ms' }),
    grade: async () => ({ passed: true, output: 'HUMANEVAL_GRADE=PASS', error: null }),
  });
  assert.equal(loop.finalPass, false);
});

/* ------------------------------------------------ G. tool + safety --------*/

test('M23/G1: a failed tool call is diagnosed as a tool failure, not a code defect', () => {
  const d = diagnoseFailure({ agentError: 'fs_write blocked by permission profile "auto"', source: null });
  assert.equal(d.class, 'tool-failure');
});

test('M23/G2: an unauthorized-path refusal is classified as a tool failure with the refusal as evidence', () => {
  const d = diagnoseFailure({ agentError: 'path escapes root: /etc/passwd', source: null });
  assert.equal(d.class, 'tool-failure');
  assert.match(d.evidence, /escapes root/);
});

test('M23/G3: contract extraction failure is reported, never guessed', () => {
  const contract = extractFunctionContract('Just make it work.');
  const d = diagnoseFailure({ gradeOutput: '', source: 'x = 1\n', contract });
  assert.equal(d.class, 'contract-extraction-failure');
});
