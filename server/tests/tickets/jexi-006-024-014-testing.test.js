/**
 * JEXI-006 (pytest is a first-class path) · JEXI-024 (a pass needs tests > 0,
 * not just exit code 0) · JEXI-014 (the assertion survives truncation).
 *
 * These run a REAL pytest against a REAL fixture project on disk.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { registerTestingTools, detectProjectKind, parsePytestReport } from '../../src/tools/domains/testing/index.js';

const { engines, unreg } = registerTestingTools();

const project = fs.mkdtempSync(path.join(os.tmpdir(), 'jexi-py-'));
fs.mkdirSync(path.join(project, 'tests'), { recursive: true });
fs.writeFileSync(path.join(project, 'pyproject.toml'), '[tool.pytest.ini_options]\ntestpaths = ["tests"]\npythonpath = ["."]\n');
fs.writeFileSync(path.join(project, 'calculator.py'), 'def add(a, b):\n    return a + b\n\ndef subtract(a, b):\n    return a + b\n');
fs.writeFileSync(path.join(project, 'tests', 'test_calculator.py'), [
  'from calculator import add, subtract',
  '',
  'def test_add():',
  '    assert add(2, 3) == 5',
  '',
  'def test_subtract():',
  '    assert subtract(5, 3) == 2',
  '',
].join('\n'));

test.after(() => { unreg(); fs.rmSync(project, { recursive: true, force: true }); });

/* ── detection ────────────────────────────────────────────────── */

test('JEXI-006: a pyproject + tests/ project is detected as pytest', () => {
  assert.equal(detectProjectKind(project), 'pytest');
});

test('JEXI-006: a package.json project is still detected as node', () => {
  const node = fs.mkdtempSync(path.join(os.tmpdir(), 'jexi-node-'));
  fs.writeFileSync(path.join(node, 'package.json'), JSON.stringify({ scripts: { test: 'node --test' } }));
  test.after(() => fs.rmSync(node, { recursive: true, force: true }));
  assert.equal(detectProjectKind(node), 'node');
});

test('JEXI-006: an empty directory is honestly "no test project"', () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'jexi-empty-'));
  test.after(() => fs.rmSync(empty, { recursive: true, force: true }));
  assert.equal(detectProjectKind(empty), null);
});

/* ── the headline acceptance: failing pytest, then fixed ──────── */

test('JEXI-006: a failing pytest returns a structured fail + the failure list', async () => {
  const r = await engines.pytest_run({}, { root: project });

  assert.equal(r.framework, 'pytest');
  assert.equal(r.status, 'fail', 'the planted bug must be reported as a failure');
  assert.equal(r.ok, false);
  assert.equal(r.failed, 1);
  assert.equal(r.passed, 1);
  assert.equal(r.tests, 2);
  assert.equal(r.exitCode, 1);

  assert.ok(r.failures.length >= 1, 'there must be a per-failure list');
  const f = r.failures.find((x) => x.test.includes('test_subtract'));
  assert.ok(f, 'the failing test must be named: ' + JSON.stringify(r.failures));
  assert.equal(f.kind, 'failed');
});

test('JEXI-014: the failing assertion line survives into the tool result', async () => {
  const r = await engines.pytest_run({}, { root: project });
  assert.ok(r.assertionLines.length > 0, 'expected assertion lines');
  assert.ok(
    r.assertionLines.some((l) => /assert 8 == 2|assert .*== 2/.test(l)),
    'the actual assertion must be visible, got: ' + JSON.stringify(r.assertionLines),
  );
  assert.ok(r.output.includes('test_subtract'), 'the failing test id must be in the output fed to the model');
});

test('JEXI-006: after the fix the SAME tool returns pass with tests > 0', async () => {
  fs.writeFileSync(path.join(project, 'calculator.py'), 'def add(a, b):\n    return a + b\n\ndef subtract(a, b):\n    return a - b\n');
  const r = await engines.pytest_run({}, { root: project });

  assert.equal(r.status, 'pass');
  assert.equal(r.ok, true);
  assert.equal(r.failed, 0);
  assert.equal(r.passed, 2);
  assert.equal(r.tests, 2, 'a pass must name how many tests actually ran');
  assert.equal(r.exitCode, 0);
});

test('JEXI-006: test_run auto-detects and routes to pytest for this project', async () => {
  const r = await engines.test_run({}, { root: project });
  assert.equal(r.framework, 'pytest', 'pytest must be preferred for a Python project');
  assert.equal(r.status, 'pass');
  assert.equal(r.tests, 2);
});

/* ── JEXI-024: exit code 0 is not enough ─────────────────────── */

test('JEXI-024: a suite that collects nothing is an ERROR, not a pass', () => {
  const r = parsePytestReport('no tests ran in 0.01s\n', 5);
  assert.equal(r.status, 'error');
  assert.equal(r.tests, 0);
});

test('JEXI-024: exit 0 with zero tests parsed is never "pass"', () => {
  assert.equal(parsePytestReport('', 0).status, 'error');
  assert.equal(parsePytestReport('collected 0 items\n', 0).status, 'error');
});

test('JEXI-024: a collection error is an error, not a pass', async () => {
  const broken = fs.mkdtempSync(path.join(os.tmpdir(), 'jexi-broken-'));
  fs.mkdirSync(path.join(broken, 'tests'));
  fs.writeFileSync(path.join(broken, 'tests', 'test_x.py'), 'import a_module_that_does_not_exist\n');
  test.after(() => fs.rmSync(broken, { recursive: true, force: true }));

  const r = await engines.pytest_run({}, { root: broken });
  assert.notEqual(r.status, 'pass', 'an import error must never read as a pass');
  assert.ok(['error', 'fail'].includes(r.status));
});

test('JEXI-024: a real run of an empty suite is reported as error with tests=0', async () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'jexi-nosuite-'));
  fs.writeFileSync(path.join(empty, 'pyproject.toml'), '[tool.pytest.ini_options]\n');
  test.after(() => fs.rmSync(empty, { recursive: true, force: true }));
  const r = await engines.pytest_run({}, { root: empty });
  assert.equal(r.status, 'error');
  assert.equal(r.tests, 0);
});

/* ── JEXI-014: long output keeps the tail (where tracebacks live) ── */

test('JEXI-014: elided output keeps the head AND the failure tail', async () => {
  const noisy = fs.mkdtempSync(path.join(os.tmpdir(), 'jexi-noisy-'));
  fs.mkdirSync(path.join(noisy, 'tests'));
  // a test whose failure is at the very END of a very long run
  fs.writeFileSync(path.join(noisy, 'tests', 'test_loud.py'), [
    'def test_a(): assert True',
    ...Array.from({ length: 400 }, (_, i) => `def test_pad_${i}():\n    assert True  # padding ${'x'.repeat(200)}`),
    'def test_z_last():',
    '    assert 1 == 2, "THE_SIGNAL_MARKER"',
  ].join('\n\n'));
  test.after(() => fs.rmSync(noisy, { recursive: true, force: true }));

  const r = await engines.pytest_run({}, { root: noisy });
  assert.equal(r.status, 'fail');
  assert.ok(r.output.includes('THE_SIGNAL_MARKER'), 'the failure detail must survive the truncation');
  assert.ok(r.output.length <= 8000, `output must stay bounded, got ${r.output.length}`);
});

/* ── a false green is the worst possible outcome ──────────────── */

test('a run NEVER reports pass on source that is still broken (stale .pyc)', async () => {
  // Regression: CPython validates a .pyc by SOURCE MTIME at one-second
  // granularity. Edit-then-rerun inside the same second made Python import
  // the previous bytecode, so the "broken" run reported `pass`. This loop
  // reproduces the exact edit→test→edit→test cycle that triggered it.
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'jexi-pyc-'));
  fs.writeFileSync(path.join(d, 'pyproject.toml'), '[tool.pytest.ini_options]\npythonpath = ["."]\n');
  fs.mkdirSync(path.join(d, 'tests'));
  fs.writeFileSync(path.join(d, 'tests', 'test_m.py'), 'from m import f\ndef test_f():\n    assert f() == 2\n');
  test.after(() => fs.rmSync(d, { recursive: true, force: true }));

  const broken = 'def f():\n    return 1\n';
  const fixed = 'def f():\n    return 2\n';

  for (let i = 0; i < 6; i++) {
    fs.writeFileSync(path.join(d, 'm.py'), broken);
    const bad = await engines.pytest_run({}, { root: d });
    fs.writeFileSync(path.join(d, 'm.py'), fixed);
    const good = await engines.pytest_run({}, { root: d });
    assert.equal(bad.status, 'fail', `cycle ${i}: the broken source must be reported as a FAILURE`);
    assert.equal(good.status, 'pass', `cycle ${i}: the fixed source must be reported as a PASS`);
    assert.equal(bad.failed, 1, `cycle ${i}: exactly one test should have failed`);
  }
});
