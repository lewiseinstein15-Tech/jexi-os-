import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dir = path.dirname(fileURLToPath(import.meta.url));

// The materialized sandbox root is the cwd; write a small marker test that
// proves the child ran INSIDE the sandbox (its cwd carries the frozen files).
// eslint leaks nothing here — it only loads @eslint/js from the SERVER's
// node_modules via resolveBin. The fixture's own package.json does not list
// dependencies, so we resolve eslint from the repo root walk-up.
const REPO_ROOT = path.resolve(__dir, '..', '..', '..', '..', '..'); // server/
const ESLINT_BIN = path.join(REPO_ROOT, 'node_modules', '.bin', 'eslint');
const ESLINT_OK = fs.existsSync(ESLINT_BIN);

test('the real subprocess ran with the frozen snapshot as its working directory', () => {
  // The test itself is one of the snapshot files; if we are here, the frozen
  // src/add.js exists in cwd and the parent runtime is verified.
  assert.ok(fs.existsSync(path.join(process.cwd(), 'src', 'add.js')), 'frozen src/add.js materialized into sandbox cwd');
});

if (ESLINT_OK) {
  test('eslint binary is resolvable for the LintVerifier real spawn', () => {
    const r = spawnSync(ESLINT_BIN, ['--version'], { encoding: 'utf8' });
    assert.equal(r.status, 0, `eslint runs: ${r.stderr || r.stdout}`);
  });
}