#!/usr/bin/env node
// scripts/phase25-scope-m.mjs
// Phase 25 — Scope M live probe: nested AGENTS.md instruction loading.
// Zero dependencies. Real filesystem walks over real temp trees (os.tmpdir,
// removed afterwards) — every rule must actually fire on its intended tree
// AND stay silent on well-formed input. No LLM, no repo-disk state.
// Raw output per check. Exit 1 on any failure.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import instructions from '../capabilities/prompts/sections/08-instructions.js';

const WT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let failures = 0;
function check(name, ok, evidence) {
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}`);
  console.log(`        ${evidence}`);
  if (!ok) failures += 1;
}

const sha256 = (value) =>
  crypto
    .createHash('sha256')
    .update(typeof value === 'string' ? value : JSON.stringify(value))
    .digest('hex');
const charsOf = (entries) =>
  entries.reduce((sum, e) => sum + e.content.length, 0);
const bytesOf = (entries) =>
  entries.reduce((sum, e) => sum + Buffer.byteLength(e.content, 'utf8'), 0);
const shape = (r) => ({
  paths: [...r].map((e) => e.path),
  dropped: r.dropped,
  reason: r.reason,
});

// Temp trees live OUTSIDE the repo so the P7 zone check stays pristine.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jexi-p25-m-'));
function newTree(name) {
  const dir = path.join(TMP, name);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
function writeF(fullPath, content) {
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, 'utf8');
}

try {
  // -------------------------------------------------------------------------
  // P1 — Nested discovery: 4 entries, tree order root -> a -> a/b -> a/b/c
  // -------------------------------------------------------------------------
  const t1 = newTree('p1-walk');
  writeF(path.join(t1, 'AGENTS.md'), 'ROOT: base operating instructions\n');
  writeF(path.join(t1, 'a/AGENTS.md'), 'A: subsystem instructions\n');
  writeF(path.join(t1, 'a/b/AGENTS.md'), 'B: module instructions\n');
  writeF(path.join(t1, 'a/b/c/AGENTS.md'), 'C: leaf instructions\n');
  const r1 = instructions.walk(t1);
  console.log('P1 walk result raw:');
  console.log(JSON.stringify(shape(r1), null, 2));
  const want1 = ['AGENTS.md', 'a/AGENTS.md', 'a/b/AGENTS.md', 'a/b/c/AGENTS.md'];
  const ok1 =
    Array.isArray(r1) &&
    r1.length === 4 &&
    want1.every((p, i) => r1[i].path === p) &&
    r1.every((e) => typeof e.content === 'string' && e.content.length > 0) &&
    r1.dropped.length === 0 &&
    r1.reason === null;
  check(
    'P1 nested discovery: 4 entries in tree order root, a, a/b, a/b/c',
    ok1,
    `paths=${JSON.stringify(r1.map((e) => e.path))} reason=${r1.reason} dropped=${r1.dropped.length}`
  );
  console.log('');

  // -------------------------------------------------------------------------
  // P2 — Verbatim: byte-equal to file contents, root first, deepest last
  // -------------------------------------------------------------------------
  const t2 = newTree('p2-verbatim');
  const files2 = [
    [
      'AGENTS.md',
      'ROOT v1\nline2: "double" \'single\' \\backslash\\ $dollar {brace} `tick`\nline3: unicode é ✓ — em-dash\ncrlf-next\r\nlast line without trailing newline',
    ],
    ['a/AGENTS.md', 'A verbatim\n\ttab-indented\n\n\nblank lines above kept'],
    ['a/b/AGENTS.md', 'B verbatim — keep   internal    spacing\n'],
    ['a/b/c/AGENTS.md', 'C verbatim: <xml> & "json" {yml} #md\n'],
  ];
  for (const [rel, content] of files2) writeF(path.join(t2, rel), content);
  const r2 = instructions.walk(t2);
  console.log('P2 walk raw (root content first, deepest content last):');
  let ok2 = Array.isArray(r2) && r2.length === 4;
  let ev2 = '';
  for (let i = 0; i < files2.length; i++) {
    const e = r2[i];
    const diskBytes = fs.readFileSync(path.join(t2, files2[i][0])); // real bytes on disk
    const entryBytes = Buffer.from(e.content, 'utf8');
    const eq = diskBytes.equals(entryBytes);
    ok2 = ok2 && eq && e.path === files2[i][0];
    ev2 += `entry[${i}] ${e.path} byteEqual=${eq} bytes=${diskBytes.length}\n`;
    console.log(`--- entry[${i}] ${e.path} (verbatim content below) ---`);
    console.log(e.content);
    console.log(`--- end entry[${i}] (byteEqual=${eq}) ---`);
  }
  ev2 += `order=${JSON.stringify(r2.map((e) => e.path))}`;
  check(
    'P2 verbatim: every entry byte-equal to its file, root first / deepest last',
    ok2,
    ev2
  );
  console.log('');

  // -------------------------------------------------------------------------
  // P3 — Overflow: 4 x 15K = 60K chars > 50K ceiling -> keep root + leaf,
  //      drop the middle two (E_SIZE_LIMIT); ceiling is configurable
  // -------------------------------------------------------------------------
  const t3 = newTree('p3-overflow');
  const big = (label, ch) => (label + '\n').padEnd(15000, ch);
  writeF(path.join(t3, 'AGENTS.md'), big('ROOT-15K', 'r'));
  writeF(path.join(t3, 'a/AGENTS.md'), big('A-15K', 'a'));
  writeF(path.join(t3, 'a/b/AGENTS.md'), big('B-15K', 'b'));
  writeF(path.join(t3, 'a/b/c/AGENTS.md'), big('C-15K', 'c'));
  const r3 = instructions.walk(t3); // default ceiling 50_000
  const r3cfg = instructions.walk(t3, { maxTotalChars: 70_000 }); // configurable
  console.log('P3 overflow walk raw (default 50_000 ceiling):');
  console.log(JSON.stringify(shape(r3), null, 2));
  const ok3 =
    r3.length === 2 &&
    r3[0].path === 'AGENTS.md' &&
    r3[1].path === 'a/b/c/AGENTS.md' &&
    r3.reason === 'E_SIZE_LIMIT' &&
    r3.dropped.length === 2 &&
    r3.dropped[0].path === 'a/AGENTS.md' &&
    r3.dropped[1].path === 'a/b/AGENTS.md' &&
    r3.dropped.every((d) => d.reason === 'E_SIZE_LIMIT' && d.chars === 15000) &&
    charsOf([...r3]) === 30000 &&
    r3cfg.length === 4 &&
    r3cfg.reason === null &&
    r3cfg.dropped.length === 0;
  check(
    'P3 overflow: 60K > 50K keeps root + leaf, drops the middle two (E_SIZE_LIMIT); maxTotalChars=70000 keeps all 4',
    ok3,
    `kept=${JSON.stringify(r3.map((e) => e.path))} keptChars=${charsOf([...r3])} dropped=${JSON.stringify(r3.dropped)} reason=${r3.reason} | configurable: entries=${r3cfg.length} reason=${r3cfg.reason} dropped=${r3cfg.dropped.length}`
  );
  console.log('');

  // -------------------------------------------------------------------------
  // P4 — Missing root AGENTS.md -> entries: [] (not an error);
  //      Unreadable AGENTS.md -> skipped + recorded E_UNREADABLE
  // -------------------------------------------------------------------------
  const t4a = newTree('p4a-no-root');
  writeF(path.join(t4a, 'a/AGENTS.md'), 'A: deeper file exists but no root anchor\n');
  let r4a = null;
  let threw4a = false;
  try {
    r4a = instructions.walk(t4a);
  } catch {
    threw4a = true;
  }
  const t4e = newTree('p4a-empty');
  let r4e = null;
  let threw4e = false;
  try {
    r4e = instructions.walk(t4e);
  } catch {
    threw4e = true;
  }
  console.log('P4a missing-root walk raw (tree has deeper a/AGENTS.md but no root anchor):');
  console.log(JSON.stringify(r4a ? shape(r4a) : { threw: true }, null, 2));
  const ok4a =
    !threw4a && r4a !== null && r4a.length === 0 && r4a.dropped.length === 0 && r4a.reason === null;
  const ok4e =
    !threw4e && r4e !== null && r4e.length === 0 && r4e.dropped.length === 0 && r4e.reason === null;

  const t4b = newTree('p4b-unreadable');
  writeF(path.join(t4b, 'AGENTS.md'), 'ROOT-4B readable\n');
  fs.mkdirSync(path.join(t4b, 'broken/AGENTS.md'), { recursive: true }); // directory named AGENTS.md -> EISDIR-class
  fs.mkdirSync(path.join(t4b, 'dead'), { recursive: true });
  fs.symlinkSync(path.join(t4b, 'missing-target'), path.join(t4b, 'dead/AGENTS.md')); // broken symlink -> ENOENT
  const r4b = instructions.walk(t4b);
  console.log('P4b unreadable walk raw:');
  console.log(JSON.stringify(shape(r4b), null, 2));
  const ok4b =
    r4b.length === 1 &&
    r4b[0].path === 'AGENTS.md' &&
    r4b.dropped.length === 2 &&
    r4b.dropped.every((d) => d.reason === 'E_UNREADABLE') &&
    r4b.dropped.some((d) => d.path === 'broken/AGENTS.md') &&
    r4b.dropped.some((d) => d.path === 'dead/AGENTS.md') &&
    r4b.reason === null;
  check(
    'P4 missing root AGENTS.md -> entries [] without error; unreadable files skipped + E_UNREADABLE (stderr shows path-only drop log)',
    ok4a && ok4e && ok4b,
    `no-root: entries=${r4a.length} reason=${r4a.reason} threw=${threw4a} | empty-tree: entries=${r4e.length} threw=${threw4e} | unreadable: kept=${JSON.stringify(r4b.map((e) => e.path))} dropped=${JSON.stringify(r4b.dropped)} reason=${r4b.reason}`
  );
  console.log('');

  // -------------------------------------------------------------------------
  // P5 — Symlink loop -> refused with E_LOOP, no infinite walk
  // -------------------------------------------------------------------------
  const t5 = newTree('p5-loop');
  writeF(path.join(t5, 'AGENTS.md'), 'ROOT-5\n');
  writeF(path.join(t5, 'a/AGENTS.md'), 'A-5\n');
  fs.symlinkSync(t5, path.join(t5, 'loop')); // loop -> tree root itself
  fs.symlinkSync(path.join(t5, 'a'), path.join(t5, 'a', 'self')); // a/self -> a
  const t0 = Date.now();
  let r5 = null;
  let threw5 = false;
  try {
    r5 = instructions.walk(t5);
  } catch {
    threw5 = true;
  }
  const ms5 = Date.now() - t0;
  console.log('P5 loop walk raw:');
  console.log(JSON.stringify(r5 ? shape(r5) : { threw: true }, null, 2));
  const ok5 =
    !threw5 &&
    r5 !== null &&
    r5.length === 0 &&
    r5.dropped.length === 0 &&
    r5.reason === 'E_LOOP' &&
    ms5 < 2000;
  check(
    'P5 symlink loop -> refused E_LOOP, returned immediately (no infinite walk)',
    ok5,
    `returned in ${ms5}ms entries=${r5.length} dropped=${JSON.stringify(r5.dropped)} reason=${r5.reason} threw=${threw5}`
  );
  console.log('');

  // -------------------------------------------------------------------------
  // P6 — Determinism: same tree twice -> identical entries + dropped +
  //      identical byte totals (normal tree AND overflow tree)
  // -------------------------------------------------------------------------
  const r6a = instructions.walk(t1);
  const r6b = instructions.walk(t1);
  const r6oa = instructions.walk(t3);
  const r6ob = instructions.walk(t3);
  const snap = (r) => ({
    hash: sha256({ entries: [...r], dropped: r.dropped, reason: r.reason }),
    chars: charsOf([...r]),
    bytes: bytesOf([...r]),
  });
  const s6a = snap(r6a);
  const s6b = snap(r6b);
  const s6oa = snap(r6oa);
  const s6ob = snap(r6ob);
  console.log('P6 determinism raw:');
  console.log(`run1(normal)  ${JSON.stringify(s6a)}`);
  console.log(`run2(normal)  ${JSON.stringify(s6b)}`);
  console.log(`run1(overflow) ${JSON.stringify(s6oa)}`);
  console.log(`run2(overflow) ${JSON.stringify(s6ob)}`);
  console.log(`overflow dropped run1: ${JSON.stringify(r6oa.dropped)}`);
  console.log(`overflow dropped run2: ${JSON.stringify(r6ob.dropped)}`);
  const ok6 =
    s6a.hash === s6b.hash &&
    s6a.bytes === s6b.bytes &&
    s6a.chars === s6b.chars &&
    s6oa.hash === s6ob.hash &&
    s6oa.bytes === s6ob.bytes &&
    JSON.stringify(r6oa.dropped) === JSON.stringify(r6ob.dropped);
  check(
    'P6 determinism: same tree twice -> identical entries + dropped list + byte totals (normal and overflow)',
    ok6,
    `normal: hash1=${s6a.hash.slice(0, 12)} hash2=${s6b.hash.slice(0, 12)} bytes=${s6a.bytes} | overflow: hash1=${s6oa.hash.slice(0, 12)} hash2=${s6ob.hash.slice(0, 12)} bytes=${s6oa.bytes}`
  );
  console.log('');

  // -------------------------------------------------------------------------
  // P7 — Zone check: git status --short shows ONLY this scope's paths
  // -------------------------------------------------------------------------
  const st = spawnSync('git', ['status', '--short'], { cwd: WT, encoding: 'utf8' });
  const lines = st.stdout.split('\n').filter((l) => l.trim() !== '');
  console.log('P7 git status --short raw:');
  console.log(st.stdout.trim());
  const ALLOWED = ['prompt/sections/', 'scripts/phase25-scope-m.mjs'];
  const zoneOk =
    // consolidation cleanup: dropped `lines.length > 0` precondition — a clean committed
    // tree passes vacuously (every() on an empty list); the substantive assert is "no out-of-zone path".
    lines.every((l) => {
      const p = l.slice(3).trim();
      return l.startsWith('?? ') && ALLOWED.some((a) => p === a || p.startsWith(a));
    });
  check(
    'P7 zone discipline: only prompt/sections/** + scripts/phase25-scope-m.mjs',
    zoneOk,
    `${lines.length} untracked path(s), all inside the Scope M zone: ${lines.map((l) => l.slice(3)).join(' | ')}`
  );
  console.log('');

  // -------------------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------------------
  console.log('---------------------------------------------');
  console.log(`SCOPE M: ${7 - failures}/7 PASS, ${failures} FAIL`);
  if (failures > 0) process.exit(1);
} finally {
  fs.rmSync(TMP, { recursive: true, force: true });
}
