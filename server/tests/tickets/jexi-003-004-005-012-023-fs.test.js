/**
 * JEXI-003 (fs_edit) · JEXI-004 (glob/grep were stubs) · JEXI-005/022
 * (confinement) · JEXI-012 (ring metadata vs reality) · JEXI-023 (append/delete)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { registerFilesystemTools } from '../../src/tools/domains/filesystem/index.js';
import { listTools, getTool } from '../../src/tools/registry/ToolRegistry.js';

/* Registering twice would throw on duplicate names; one shared set is enough. */
const { engines, unreg } = registerFilesystemTools();
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jexi-fs-'));
test.after(() => { unreg(); fs.rmSync(root, { recursive: true, force: true }); });

const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

/* ── JEXI-003 ─────────────────────────────────────────────────── */

test('JEXI-003: fs_edit changes one line and leaves the rest byte-identical', async () => {
  const before = 'def add(a, b):\n    return a - b\n';
  fs.writeFileSync(path.join(root, 'calc.py'), before);

  const r = await engines.fs_edit({ path: 'calc.py', find: 'return a - b', replace: 'return a + b' }, { root });

  assert.equal(r.ok, true);
  assert.equal(r.replacements, 1);
  assert.equal(r.occurrences_found, 1);
  assert.equal(r.bytes_changed, 0, "'-' -> '+' is the same length; the receipt must be byte-accurate");
  assert.equal(read('calc.py'), 'def add(a, b):\n    return a + b\n');
});

test('JEXI-003: a missing needle errors and writes NOTHING', async () => {
  const original = 'alpha\nbeta\n';
  fs.writeFileSync(path.join(root, 'm.txt'), original);
  await assert.rejects(
    () => engines.fs_edit({ path: 'm.txt', find: 'GAMMA', replace: 'x' }, { root }),
    /needle not found .*0 occurrences/,
  );
  assert.equal(read('m.txt'), original, 'file must be untouched');
});

test('JEXI-003: an ambiguous needle is refused, not guessed', async () => {
  fs.writeFileSync(path.join(root, 'dup.txt'), 'x=1\nx=1\nx=1\n');
  await assert.rejects(
    () => engines.fs_edit({ path: 'dup.txt', find: 'x=1', replace: 'x=2' }, { root }),
    /ambiguous — the needle occurs 3 times/,
  );
  assert.equal(read('dup.txt'), 'x=1\nx=1\nx=1\n', 'ambiguous edit must not write');
});

test('JEXI-003: count=1 disambiguates and replaces exactly one', async () => {
  const r = await engines.fs_edit({ path: 'dup.txt', find: 'x=1', replace: 'x=9', count: 1 }, { root });
  assert.equal(r.replacements, 1);
  assert.equal(r.occurrences_found, 3);
  assert.equal(read('dup.txt'), 'x=9\nx=1\nx=1\n');
});

test('JEXI-003: count above the real occurrences is refused, file untouched', async () => {
  const before = read('dup.txt');
  await assert.rejects(() => engines.fs_edit({ path: 'dup.txt', find: 'x=1', replace: 'z', count: 9 }, { root }), /cannot replace 9/);
  assert.equal(read('dup.txt'), before);
});

test('JEXI-003: an empty needle is rejected (would match everywhere)', async () => {
  await assert.rejects(() => engines.fs_edit({ path: 'dup.txt', find: '', replace: 'z' }, { root }), /must not be empty/);
});

test('JEXI-003: editing a missing file reports ENOENT, not a silent create', async () => {
  await assert.rejects(() => engines.fs_edit({ path: 'nope.txt', find: 'a', replace: 'b' }, { root }), /ENOENT/);
});

test('JEXI-003: fs_edit is registered as a real tool with a schema', () => {
  const def = getTool('fs_edit');
  assert.ok(def, 'fs_edit must be in the registry');
  assert.deepEqual(def.parameters.required, ['path', 'find', 'replace']);
  assert.ok(engines.fs_edit, 'and it must have a real engine');
});

/* ── JEXI-004 ─────────────────────────────────────────────────── */

test('JEXI-004: fs_glob is a real engine, not a stub that throws', async () => {
  fs.mkdirSync(path.join(root, 'src', 'deep'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'a.ts'), 'export const a=1');
  fs.writeFileSync(path.join(root, 'src', 'deep', 'b.ts'), 'export const b=2');
  fs.writeFileSync(path.join(root, 'src', 'deep', 'c.js'), 'x');

  const r = await engines.fs_glob({ pattern: 'src/**/*.ts' }, { root });
  assert.equal(r.ok, true);
  assert.equal(r.count, 2, 'got: ' + JSON.stringify(r.files));
  assert.ok(r.files.includes('src/a.ts'));
  assert.ok(r.files.includes('src/deep/b.ts'));
  assert.ok(!r.files.includes('src/deep/c.js'));
});

test('JEXI-004: fs_grep returns file, line and text', async () => {
  fs.writeFileSync(path.join(root, 'src', 'a.ts'), 'const needle = 1\nother\n  needle again\n');
  const r = await engines.fs_grep({ root: '.', pattern: 'needle', glob: '**/*.ts' }, { root });
  assert.equal(r.ok, true);
  assert.equal(r.count, 2);
  assert.equal(r.matches[0].file, 'src/a.ts');
  assert.equal(r.matches[0].line, 1);
  assert.equal(r.matches[0].text, 'const needle = 1');
  assert.equal(r.matches[1].line, 3);
});

test('JEXI-004: grep honours maxMatches and rejects a bad regex', async () => {
  const many = await engines.fs_grep({ pattern: 'needle', glob: '**/*.ts', maxMatches: 1 }, { root });
  assert.equal(many.count, 1);
  await assert.rejects(() => engines.fs_grep({ pattern: '([unclosed' }, { root }), /invalid regex/);
});

test('JEXI-004: node_modules and .git are not walked by default', async () => {
  fs.mkdirSync(path.join(root, 'node_modules', 'pkg'), { recursive: true });
  fs.writeFileSync(path.join(root, 'node_modules', 'pkg', 'index.js'), 'needle');
  const r = await engines.fs_grep({ pattern: 'needle' }, { root });
  assert.ok(!r.matches.some((m) => m.file.includes('node_modules')), 'ignored dirs must not be scanned');
});

/* ── JEXI-005 / 022 through the real engines ──────────────────── */

test('JEXI-005: every fs engine refuses a sibling-directory escape', async () => {
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'jexi-outside-'));
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'TOP SECRET');
  test.after(() => fs.rmSync(outside, { recursive: true, force: true }));

  for (const [tool, args] of [
    ['fs_read', { path: '../' + path.basename(outside) + '/secret.txt' }],
    ['fs_write', { path: '../' + path.basename(outside) + '/pwn.txt', content: 'x' }],
    ['fs_edit', { path: '../' + path.basename(outside) + '/secret.txt', find: 'TOP', replace: 'X' }],
    ['fs_append', { path: '../' + path.basename(outside) + '/pwn2.txt', content: 'x' }],
    ['fs_delete', { path: '../' + path.basename(outside) + '/secret.txt' }],
    ['fs_ls', { path: '../' + path.basename(outside) }],
    ['fs_glob', { pattern: '*', root: '../' + path.basename(outside) }],
    ['fs_grep', { pattern: 'TOP', root: '../' + path.basename(outside) }],
  ]) {
    await assert.rejects(() => engines[tool](args, { root }), /escapes root/, `${tool} must refuse`);
  }
  assert.equal(fs.readFileSync(path.join(outside, 'secret.txt'), 'utf8'), 'TOP SECRET', 'nothing outside was touched');
});

test('JEXI-005: symlink escape is refused through the real engines', async () => {
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'jexi-outside-'));
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'TOP SECRET');
  fs.symlinkSync(outside, path.join(root, 'link'), 'dir');
  test.after(() => fs.rmSync(outside, { recursive: true, force: true }));

  await assert.rejects(() => engines.fs_read({ path: 'link/secret.txt' }, { root }), /symlink/);
  await assert.rejects(() => engines.fs_grep({ pattern: 'TOP', root: 'link' }, { root }), /symlink/);
});

/* ── JEXI-012 ─────────────────────────────────────────────────── */

test('JEXI-012: no tool that writes host state claims ring 0 ("no host state")', () => {
  const fsTools = listTools().filter((t) => t.name.startsWith('fs_'));
  assert.ok(fsTools.length >= 7, 'expected the full fs surface, got ' + fsTools.map((t) => t.name).join(','));
  for (const t of fsTools) {
    const writes = (t.sideEffects || []).some((s) => s === 'write' || s === 'delete');
    if (writes) {
      assert.ok(t.runtimeRing >= 1, `${t.name} writes host state but declares ring ${t.runtimeRing}`);
    }
  }
});

test('JEXI-012: every declared fs tool actually has an engine (no dead tools)', () => {
  for (const t of listTools().filter((x) => x.name.startsWith('fs_'))) {
    assert.equal(typeof engines[t.name], 'function', `${t.name} is registered with no engine`);
  }
});

/* ── JEXI-023 ─────────────────────────────────────────────────── */

test('JEXI-023: fs_append creates then appends', async () => {
  const a = await engines.fs_append({ path: 'log.txt', content: 'one\n' }, { root });
  assert.equal(a.ok, true);
  assert.equal(a.created, true);
  const b = await engines.fs_append({ path: 'log.txt', content: 'two\n' }, { root });
  assert.equal(b.created, false);
  assert.equal(read('log.txt'), 'one\ntwo\n');
});

test('JEXI-023: fs_delete removes a file, and refuses a non-empty dir without recursive', async () => {
  await engines.fs_write({ path: 'gone.txt', content: 'x' }, { root });
  const d = await engines.fs_delete({ path: 'gone.txt' }, { root });
  assert.equal(d.deleted, true);
  assert.equal(fs.existsSync(path.join(root, 'gone.txt')), false);

  await assert.rejects(() => engines.fs_delete({ path: 'src', recursive: false }, { root }), /not empty/);
  const ok = await engines.fs_delete({ path: 'src', recursive: true }, { root });
  assert.equal(ok.type, 'directory');
  assert.equal(fs.existsSync(path.join(root, 'src')), false);
});

test('JEXI-023: fs_delete refuses the workspace root and honours confirm()', async () => {
  await assert.rejects(() => engines.fs_delete({ path: '.' }, { root }), /refusing to delete the workspace root/);

  await engines.fs_write({ path: 'keep.txt', content: 'x' }, { root });
  const refused = await engines.fs_delete({ path: 'keep.txt' }, { root, confirm: async () => false });
  assert.equal(refused.refused, true);
  assert.equal(fs.existsSync(path.join(root, 'keep.txt')), true, 'a refused delete must not delete');

  const approved = await engines.fs_delete({ path: 'keep.txt' }, { root, confirm: async () => true });
  assert.equal(approved.deleted, true);
});
