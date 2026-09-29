/**
 * JEXI-005 / JEXI-022 — path confinement.
 *
 * Proves the OLD check was exploitable and the NEW one is not, using the
 * exact strings the ticket names.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { resolveWithin, isWithin, PathEscapeError, safeResolveWithin } from '../../src/tools/security/path-confinement.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jexi-005-'));

test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

/** The check as it shipped, kept here so the regression is demonstrable. */
function oldCheck(root, p) {
  const full = path.resolve(root, p);
  return full.startsWith(path.resolve(root)); // <-- no separator boundary
}

test('JEXI-005 evidence: the old startsWith check accepted a sibling tree', () => {
  const root = path.join(tmp, 'a');
  fs.mkdirSync(root, { recursive: true });
  const sibling = path.join(tmp, 'ab');
  fs.mkdirSync(sibling, { recursive: true });

  assert.equal(oldCheck(root, '../ab/secret.txt'), true,
    'old check must be shown to be wrong — otherwise this ticket proves nothing');
  assert.equal(isWithin(root, sibling), false);
  assert.throws(() => resolveWithin(root, '../ab/secret.txt'), PathEscapeError);
});

test('JEXI-022: root /tmp/a vs /tmp/ab is denied', () => {
  const root = path.join(tmp, 'a');
  assert.equal(isWithin(root, root), true, 'the root itself is inside the root');
  assert.equal(isWithin(root, path.join(tmp, 'ab')), false);
  assert.throws(() => resolveWithin(root, path.join(tmp, 'ab')), /escapes root/);
});

test('JEXI-022: ../ escape is denied', () => {
  const root = path.join(tmp, 'a');
  for (const attack of ['..', '../', '../a/../../etc/passwd', 'a/../../outside.txt', './../../x']) {
    assert.equal(safeResolveWithin(root, attack), false, `must refuse ${attack}`);
  }
});

test('JEXI-022: legitimate paths under root are allowed', () => {
  const root = path.join(tmp, 'a');
  fs.mkdirSync(path.join(root, 'src', 'deep'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'deep', 'f.txt'), 'hi');

  for (const good of ['.', 'f.txt', 'src/deep/f.txt', './src/deep/f.txt', 'src/../src/f.txt']) {
    const out = resolveWithin(root, good);
    assert.ok(isWithin(root, out), `${good} should resolve inside root`);
  }
  assert.equal(fs.readFileSync(resolveWithin(root, 'src/deep/f.txt'), 'utf8'), 'hi');
});

test('JEXI-022: symlink escape is denied', () => {
  const root = path.join(tmp, 'a');
  const outside = path.join(tmp, 'outside');
  fs.mkdirSync(root, { recursive: true });
  fs.mkdirSync(outside, { recursive: true });
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'TOP SECRET');
  fs.symlinkSync(outside, path.join(root, 'escape'), 'dir');

  // the naive string check lets this through — that is the whole bug class
  assert.equal(oldCheck(root, 'escape/secret.txt'), true);
  assert.throws(() => resolveWithin(root, 'escape/secret.txt'), PathEscapeError);
  assert.equal(safeResolveWithin(root, 'escape/secret.txt'), false);
});

test('JEXI-022: a symlink that stays inside root is still allowed', () => {
  const root = path.join(tmp, 'a');
  fs.mkdirSync(path.join(root, 'real'), { recursive: true });
  fs.writeFileSync(path.join(root, 'real', 'f.txt'), 'ok');
  fs.symlinkSync(path.join(root, 'real'), path.join(root, 'link'), 'dir');
  assert.equal(fs.readFileSync(resolveWithin(root, 'link/f.txt'), 'utf8'), 'ok');
});

test('a path that does not exist yet is still validatable (edit needs this)', () => {
  const root = path.join(tmp, 'a');
  fs.mkdirSync(root, { recursive: true });
  const out = resolveWithin(root, 'new/dir/created-on-write.txt');
  assert.equal(isWithin(root, out), true);
  assert.equal(fs.existsSync(out), false, 'resolve must not create it');
});

test('NUL byte in a path is refused as a truncation attempt', () => {
  const root = path.join(tmp, 'a');
  assert.throws(() => resolveWithin(root, 'a.txt\0.png'), PathEscapeError);
});

test('mustExist is enforced when asked', () => {
  const root = path.join(tmp, 'a');
  fs.mkdirSync(root, { recursive: true });
  assert.throws(() => resolveWithin(root, 'nope.txt', { mustExist: true }), /ENOENT/);
  fs.writeFileSync(path.join(root, 'yep.txt'), '');
  assert.doesNotThrow(() => resolveWithin(root, 'yep.txt', { mustExist: true }));
});
