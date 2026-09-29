/**
 * JEXI-007 (materialize by default) · JEXI-024 (a pass needs parsed output
 * and tests > 0) · JEXI-025 (autoVerify default layers are lint + unit).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { verifyCwd, materializeSnapshot, cleanupSandbox } from '../../src/verification/spawn/sandbox.js';
import { TestVerifier } from '../../src/verification/verifiers/TestVerifier.js';
import { verifyAfterEdit, DEFAULT_REAL_LAYERS } from '../../src/verification/loop/auto-verify.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jexi-verify-'));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

/* ── JEXI-007 ────────────────────────────────────────────────── */

test('JEXI-007: a snapshot with files is materialized BY DEFAULT', () => {
  const snapshot = { files: { 'a.py': 'print(1)\n' } };
  const r = verifyCwd(snapshot, { cwd: tmp });

  assert.ok(r.sandbox, 'must run in a tempdir, not the caller cwd');
  assert.notEqual(r.cwd, tmp, 'must NOT run in the live workspace');
  assert.equal(r.materialized, true);
  assert.equal(fs.readFileSync(path.join(r.cwd, 'a.py'), 'utf8'), 'print(1)\n');
  cleanupSandbox(r.sandbox);
});

test('JEXI-007: the claimant cannot change what the verifier reads', async () => {
  // The snapshot froze "2". The claimant then edits the LIVE file to "999".
  const live = path.join(tmp, 'calc.py');
  fs.writeFileSync(live, 'def add(a, b):\n    return a + b\n');
  const snapshot = { files: { 'calc.py': fs.readFileSync(live, 'utf8') } };

  fs.writeFileSync(live, 'def add(a, b):\n    return 999\n');   // claimant mutates after snapshot

  const { cwd, sandbox } = verifyCwd(snapshot, { cwd: tmp });
  const inSandbox = fs.readFileSync(path.join(cwd, 'calc.py'), 'utf8');
  assert.ok(inSandbox.includes('return a + b'), 'verifier must see the FROZEN bytes');
  assert.ok(!inSandbox.includes('999'), 'the claimant mutation must not reach the verifier');
  assert.equal(fs.readFileSync(live, 'utf8').includes('999'), true, 'live file really did change');
  cleanupSandbox(sandbox);
});

test('JEXI-007: live cwd is an explicit, documented opt-out', () => {
  const snapshot = { files: { 'a.py': 'x' } };
  const r = verifyCwd(snapshot, { cwd: tmp, materialize: false });
  assert.equal(r.sandbox, null);
  assert.equal(r.cwd, tmp);
  assert.equal(r.materialized, false);
  assert.match(r.reason, /opt-out/);
});

test('JEXI-007: an empty snapshot falls back to cwd (nothing to freeze)', () => {
  const r = verifyCwd({ files: {} }, { cwd: tmp });
  assert.equal(r.sandbox, null);
  assert.equal(r.cwd, tmp);
});

test('JEXI-007: TestVerifier evidence records sandboxed:true by default', async () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'jexi-tv-'));
  fs.writeFileSync(path.join(project, 'pyproject.toml'), '[tool.pytest.ini_options]\npythonpath = ["."]\n');
  fs.writeFileSync(path.join(project, 'calc.py'), 'def add(a, b):\n    return a + b\n');
  fs.mkdirSync(path.join(project, 'tests'));
  fs.writeFileSync(path.join(project, 'tests', 'test_calc.py'), 'from calc import add\ndef test_add():\n    assert add(1,1) == 2\n');
  test.after(() => fs.rmSync(project, { recursive: true, force: true }));

  // The snapshot is what gets materialized, so it must carry the whole
  // project — a snapshot of just pyproject.toml correctly verifies nothing.
  const files = {};
  for (const rel of ['pyproject.toml', 'calc.py', 'tests/test_calc.py']) {
    files[rel] = fs.readFileSync(path.join(project, rel), 'utf8');
  }
  const snapshot = { files };
  const r = await TestVerifier.verify({
    snapshotId: 'snap-1', snapshot,
    options: { cwd: project, testCommand: ['pytest', '-q', '--no-header', '-rfE'] },
  });

  assert.equal(r.status, 'pass');
  const meta = r.evidence[0].meta;
  assert.equal(meta.sandboxed, true, 'evidence must record that it was sandboxed');
  assert.equal(meta.materialized, true);
  assert.equal(meta.framework, 'pytest');
  assert.equal(meta.counts.passed, 1, 'the parsed count must be in the evidence');
  assert.equal(meta.counts.tests, 1);
});

/* ── JEXI-024 ────────────────────────────────────────────────── */

test('JEXI-024: exit code 0 with ZERO tests is an error, not a pass', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jexi-empty-suite-'));
  test.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  // a command that exits 0 and reports nothing
  fs.writeFileSync(path.join(dir, 'green.js'), 'console.log("all good, trust me"); process.exit(0);');

  const r = await TestVerifier.verify({
    snapshotId: 'snap-empty', snapshot: null,
    options: { cwd: dir, command: 'node', args: ['green.js'], materialize: false },
  });

  assert.equal(r.status, 'error', 'a suite that ran nothing must not verify as green');
  assert.match(r.reason, /0 tests collected/);
});

test('JEXI-024: allowEmpty:true is the documented escape hatch for a repo with no tests', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jexi-empty-suite2-'));
  test.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'green.js'), 'process.exit(0);');

  const r = await TestVerifier.verify({
    snapshotId: 'snap-allow', snapshot: null,
    options: { cwd: dir, command: 'node', args: ['green.js'], materialize: false, allowEmpty: true },
  });
  assert.equal(r.status, 'pass');
});

test('JEXI-024: a genuinely failing pytest run is a fail with the failing test named', async () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'jexi-fail-'));
  fs.writeFileSync(path.join(project, 'pyproject.toml'), '[tool.pytest.ini_options]\npythonpath = ["."]\n');
  fs.writeFileSync(path.join(project, 'calc.py'), 'def add(a, b):\n    return a - b\n');
  fs.mkdirSync(path.join(project, 'tests'));
  fs.writeFileSync(path.join(project, 'tests', 'test_calc.py'), 'from calc import add\ndef test_add():\n    assert add(1,1) == 2\n');
  test.after(() => fs.rmSync(project, { recursive: true, force: true }));

  const r = await TestVerifier.verify({
    snapshotId: 'snap-fail', snapshot: null,
    options: { cwd: project, testCommand: ['pytest', '-q', '--no-header', '-rfE'], materialize: false },
  });

  assert.equal(r.status, 'fail');
  assert.equal(r.evidence[0].meta.counts.failed, 1);
  assert.ok(/assert|add/.test(r.reason || ''), 'reason must carry the signal, got: ' + r.reason);
});

/* ── JEXI-025 ────────────────────────────────────────────────── */

test('JEXI-025: the default real layers are lint AND unit, not lint alone', () => {
  assert.deepEqual(DEFAULT_REAL_LAYERS, ['lint', 'unit']);
});

test('JEXI-025: with no injected layers the real lint AND unit layers both run', async () => {
  // The old default was ['lint'] only, so an edit that broke every test in
  // the suite still came back ok:true. lint catches syntax, not behaviour.
  // A clean cwd + a trivially-passing lint, so the loop actually REACHES the
  // unit layer. (Against the jexi repo itself real lint reports 101
  // pre-existing diagnostics and fail-fast stops first — which is correct
  // behaviour, but it would not exercise the layer we care about here.)
  const clean = fs.mkdtempSync(path.join(os.tmpdir(), 'jexi-lintclean-'));
  test.after(() => fs.rmSync(clean, { recursive: true, force: true }));

  const r = await verifyAfterEdit(
    { snapshotId: 's1', snapshot: { files: {} }, options: { cwd: clean, lintCommand: ['node', '-e', 'process.exit(0)'] } },
    {},
  );
  const layers = r.results.map((x) => x.layer);
  assert.ok(layers.includes('lint'), 'lint must run: ' + JSON.stringify(layers));
  assert.ok(layers.includes('unit'), 'the unit layer must run too: ' + JSON.stringify(layers));
  assert.ok(!r.ok, 'a unit layer with nothing to test must not report verified');
  assert.ok(r.context.injectedFailure, 'and the failure must be injectable into the next turn');
});

test('JEXI-025: injected layers still suppress the real ones (test seam preserved)', async () => {
  const r = await verifyAfterEdit({ snapshotId: 's1b', snapshot: { files: {} } }, { lint: () => ({ exitCode: 0, output: '' }) });
  assert.deepEqual(r.results.map((x) => x.layer), ['lint']);
  assert.equal(r.ok, true);
});

test('JEXI-025: a failing unit layer produces injectedFailure, not a silent ok', async () => {
  const r = await verifyAfterEdit({ snapshotId: 's2', snapshot: { files: {} } }, { lint: () => ({ exitCode: 0, output: '' }), unit: () => ({ exitCode: 1, output: '3 failed' }) });
  assert.equal(r.ok, false);
  assert.equal(r.context.verified, false);
  assert.ok(r.context.injectedFailure, 'a failed verify must be injectable back into the turn');
  assert.equal(r.context.injectedFailure.layer, 'unit');
});

test('JEXI-025: callers can still opt into lint-only explicitly', async () => {
  const r = await verifyAfterEdit({ snapshotId: 's3', snapshot: { files: {} } }, { lint: () => ({ exitCode: 0, output: '' }) }, { real: ['lint'] });
  assert.ok(r.results.every((x) => x.layer === 'lint'), 'explicit real:["lint"] must not add unit');
});
