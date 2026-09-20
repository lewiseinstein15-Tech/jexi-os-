#!/usr/bin/env node
// scripts/phase25-scope-g.mjs
// Phase 25 — Scope G live probe: privacy blacklist — surgical excision.
// Zero dependencies. Real fs under gitignored .jexi/ probe roots (one
// isolated store per section). Real SIGKILL in P10. Prints raw evidence
// per check. Exit 1 on any failure.

import { spawnSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

import {
  memoryFs,
  blacklist,
  BLACKLIST_CODES,
  EPISTEMIC_CODES,
  CODES,
} from '../prompt/memory-fs/index.js';

const WT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MODULE_URL = pathToFileURL(path.join(WT, 'prompt/memory-fs/index.js')).href;
const AGENT = { role: 'agent' };

let failures = 0;
function check(name, ok, evidence) {
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}`);
  console.log(`        ${evidence}`);
  if (!ok) failures += 1;
}

/** Fresh isolated store root for a section; also points process.env at it. */
function useStore(name) {
  const p = path.join(WT, '.jexi', 'probe-memfs', 'scope-g', name);
  fs.rmSync(p, { recursive: true, force: true });
  process.env.JEXI_MEMORY_FS_ROOT = p;
  return p;
}

function sha256(s) {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}

console.log('=== SCOPE G PROBE — privacy blacklist: surgical excision ===');
console.log(`node ${process.version}`);
console.log('');

// ---------------------------------------------------------------------------
// P1 — classify("user is diabetic") -> matched ["clinical"], allowed false
// ---------------------------------------------------------------------------
useStore('p1');
const p1 = blacklist.classify('user is diabetic');
console.log(`classify('user is diabetic') -> ${JSON.stringify(p1)}`);
const p1Ok = Array.isArray(p1.matched) && p1.matched.length === 1 &&
  p1.matched[0] === 'clinical' && p1.allowed === false;
check('P1 classify("user is diabetic") -> matched ["clinical"], allowed false', p1Ok,
  `matched=${JSON.stringify(p1.matched)}; allowed=${p1.allowed}; excised=${JSON.stringify(p1.excised)}`);

// ---------------------------------------------------------------------------
// P2 — classify("user is a software engineer, INTP") -> personality, allowed
// ---------------------------------------------------------------------------
const p2 = blacklist.classify('user is a software engineer, INTP');
console.log(`classify('user is a software engineer, INTP') -> ${JSON.stringify(p2)}`);
const p2Ok = p2.matched.length === 1 && p2.matched[0] === 'personality' &&
  p2.allowed === true && p2.excised.includes('user is a software engineer');
check('P2 classify("user is a software engineer, INTP") -> matched ["personality"], allowed true, excised keeps the engineer', p2Ok,
  `matched=${JSON.stringify(p2.matched)}; allowed=${p2.allowed}; excised=${JSON.stringify(p2.excised)}`);

// ---------------------------------------------------------------------------
// P3 — excise() shape: excised text, removed spans, category-only log
// ---------------------------------------------------------------------------
const p3 = blacklist.excise('user is a software engineer, INTP');
console.log(`excise('user is a software engineer, INTP') -> ${JSON.stringify(p3)}`);
const p3LogJson = JSON.stringify(p3.log);
const p3Ok = p3.excised === 'user is a software engineer' &&
  p3.removed.length === 1 && p3.removed[0].category === 'personality' &&
  Array.isArray(p3.removed[0].span) && p3.removed[0].span.length === 2 &&
  typeof p3.removed[0].span[0] === 'number' && typeof p3.removed[0].span[1] === 'number' &&
  p3.log.length === 1 && p3.log[0].category === 'personality' &&
  typeof p3.log[0].at === 'number' &&
  !p3LogJson.includes('INTP') && !p3LogJson.includes('engineer');
check('P3 excise -> excised "user is a software engineer"; removed [{category:"personality", span}]; log [{category:"personality", at}] with NO excised text in the log', p3Ok,
  `removed=${JSON.stringify(p3.removed)}; log=${p3LogJson}; log-leak-free=${!p3LogJson.includes('INTP')}`);

// ---------------------------------------------------------------------------
// P4 — write("/profile.md", ..., "user") -> disk carries ONLY the excised
//      text with [stated] prefix; "INTP" not on disk (byte-level check)
// ---------------------------------------------------------------------------
const root4 = useStore('p4');
const p4w = memoryFs.write('/profile.md', 'user is a software engineer, INTP', 'user', { session: {} });
const p4r = memoryFs.read('/profile.md', {});
const p4raw = fs.existsSync(path.join(root4, 'profile.md'))
  ? fs.readFileSync(path.join(root4, 'profile.md'), 'utf8')
  : '<absent>';
console.log(`write('/profile.md', 'user is a software engineer, INTP', 'user') -> ${JSON.stringify(p4w)}`);
console.log(`read('/profile.md') -> ${JSON.stringify(p4r)}`);
console.log(`raw disk bytes: ${JSON.stringify(p4raw)}`);
const p4Ok = p4w.written === true && p4r.exists === true &&
  p4r.content === '[stated] user is a software engineer' &&
  p4raw === '[stated] user is a software engineer' &&
  !p4raw.includes('INTP');
check('P4 write untagged user entry -> disk = excised text with [stated] prefix; "INTP" absent at the byte level', p4Ok,
  `disk=${JSON.stringify(p4raw)}; INTP on disk=${p4raw.includes('INTP')}`);

// ---------------------------------------------------------------------------
// P5 — write("/profile.md", "user is diabetic", "user") -> E_ALL_EXCISED,
//      zero disk touches (store root never created)
// ---------------------------------------------------------------------------
const root5 = useStore('p5');
const p5w = memoryFs.write('/profile.md', 'user is diabetic', 'user', { session: {} });
const p5r = memoryFs.read('/profile.md', {});
const file5 = fs.existsSync(path.join(root5, 'profile.md'));
const root5Exists = fs.existsSync(root5);
console.log(`write('/profile.md', 'user is diabetic', 'user') -> ${JSON.stringify(p5w)}`);
console.log(`read('/profile.md') -> ${JSON.stringify(p5r)}`);
console.log(`disk check: profile.md exists=${file5}; store root exists=${root5Exists}`);
const p5Ok = p5w.written === false && p5w.errorCode === BLACKLIST_CODES.ALL_EXCISED &&
  file5 === false && root5Exists === false &&
  p5r.content === null && p5r.exists === false;
check('P5 fully-excised entry -> E_ALL_EXCISED, no file write, store root never created', p5Ok,
  `errorCode=${p5w.errorCode}; zero disk touches confirmed`);

// ---------------------------------------------------------------------------
// P6 — write("SSN 123-45-6789") -> financial excised, no SSN on disk
// ---------------------------------------------------------------------------
const root6 = useStore('p6');
const p6c = blacklist.classify('SSN 123-45-6789');
const p6w = memoryFs.write('/profile.md', 'SSN 123-45-6789', 'user', { session: {} });
const file6 = fs.existsSync(path.join(root6, 'profile.md'));
const root6Exists = fs.existsSync(root6);
console.log(`classify('SSN 123-45-6789') -> ${JSON.stringify(p6c)}`);
console.log(`excise('SSN 123-45-6789')    -> ${JSON.stringify(blacklist.excise('SSN 123-45-6789'))}`);
console.log(`write('/profile.md', 'SSN 123-45-6789', 'user') -> ${JSON.stringify(p6w)}`);
console.log(`disk check: profile.md exists=${file6}; store root exists=${root6Exists}`);
const p6Ok = p6c.matched.includes('financial') && p6c.excised === '' &&
  p6w.written === false && p6w.errorCode === BLACKLIST_CODES.ALL_EXCISED &&
  file6 === false && root6Exists === false;
check('P6 SSN entry -> financial span excised, E_ALL_EXCISED, the SSN never reaches disk', p6Ok,
  `matched=${JSON.stringify(p6c.matched)}; errorCode=${p6w.errorCode}; zero disk touches confirmed`);

// ---------------------------------------------------------------------------
// P7 — excise("nothing sensitive here") -> untouched, no logs
// ---------------------------------------------------------------------------
const P7_INPUT = 'nothing sensitive here';
const p7 = blacklist.excise(P7_INPUT);
console.log(`excise('nothing sensitive here') -> ${JSON.stringify(p7)}`);
const p7Ok = p7.untouched === true && p7.removed.length === 0 && p7.log.length === 0 &&
  p7.excised === P7_INPUT;
check('P7 non-matching entry passes through byte-identical: untouched=true, no logs, no mutation', p7Ok,
  `excised === input: ${p7.excised === P7_INPUT}; removed=${p7.removed.length}; log=${p7.log.length}`);

// ---------------------------------------------------------------------------
// P8 — multi-category excision in ONE entry
// ---------------------------------------------------------------------------
const p8 = blacklist.excise('diabetic engineer with MBTI INTP');
console.log(`excise('diabetic engineer with MBTI INTP') -> ${JSON.stringify(p8)}`);
const p8Cats = p8.removed.map((r) => r.category);
const p8Ok = p8.excised === 'engineer' &&
  p8Cats.includes('clinical') && p8Cats.includes('personality') && p8Cats.length === 2 &&
  p8.removed[0].category === 'clinical' && p8.removed[1].category === 'personality';
check('P8 multi-category: clinical + personality excised in one entry -> excised "engineer"', p8Ok,
  `removed categories=${JSON.stringify(p8Cats)}; excised=${JSON.stringify(p8.excised)}`);

// ---------------------------------------------------------------------------
// P9 — integration ordering: excise -> tag -> assertWritable -> disk.
//      Proven via ctx.audit stage records + tag-on-excised byte accounting.
// ---------------------------------------------------------------------------
const root9 = useStore('p9');
const p9audit = [];
const p9w = memoryFs.write('/topics/p9.md', 'diabetic engineer with MBTI INTP', 'user', { session: {}, audit: p9audit });
const p9r = memoryFs.read('/topics/p9.md', {});
console.log(`write('/topics/p9.md', 'diabetic engineer with MBTI INTP', 'user', {audit}) -> ${JSON.stringify(p9w)}`);
console.log(`ctx.audit -> ${JSON.stringify(p9audit, null, 0)}`);
console.log(`read('/topics/p9.md') -> ${JSON.stringify(p9r)}`);
const stages = p9audit.map((a) => a.stage);
const exc = p9audit[0] || {};
const tag = p9audit[1] || {};
const TAG_PREFIX_BYTES = '[stated] '.length;
const p9Ok = p9w.written === true &&
  stages.length === 4 && stages[0] === 'excise' && stages[1] === 'tag' &&
  stages[2] === 'assert' && stages[3] === 'disk' &&
  exc.beforeBytes === 32 && exc.afterBytes === 8 && exc.beforeBytes > exc.afterBytes &&
  JSON.stringify(exc.removed) === JSON.stringify(['clinical', 'personality']) &&
  tag.onExcisedBytes === exc.afterBytes &&
  tag.bytes === exc.afterBytes + TAG_PREFIX_BYTES &&
  tag.bytes !== exc.beforeBytes + TAG_PREFIX_BYTES &&
  p9audit[2].ok === true && p9audit[3].bytes === tag.bytes &&
  p9r.content === '[stated] engineer';
check('P9 order proven: excise ran first (32->8 bytes, content shrank), tag ran on the EXCISED content (8+9=17 bytes, NOT 32+9=41), then assertWritable, then disk', p9Ok,
  `stages=${JSON.stringify(stages)}; shrink=${exc.beforeBytes}->${exc.afterBytes}; tag.bytes=${tag.bytes} (on-excised) vs ${exc.beforeBytes + TAG_PREFIX_BYTES} (would-be tag-on-original); disk=${JSON.stringify(p9r.content)}`);

// P9-negative: a fully-excised entry never reaches the tag stage.
const root9b = useStore('p9b');
const p9bAudit = [];
const p9b = memoryFs.write('/topics/p9b.md', 'user is diabetic', 'user', { session: {}, audit: p9bAudit });
const root9bExists = fs.existsSync(root9b);
console.log(`write('/topics/p9b.md', 'user is diabetic', 'user', {audit}) -> ${JSON.stringify(p9b)}`);
console.log(`ctx.audit -> ${JSON.stringify(p9bAudit)}`);
console.log(`disk check: store root exists=${root9bExists}`);
const p9bOk = p9b.written === false && p9b.errorCode === BLACKLIST_CODES.ALL_EXCISED &&
  p9bAudit.length === 1 && p9bAudit[0].stage === 'excise' &&
  p9bAudit[0].afterBytes === 0 && root9bExists === false;
check('P9-negative: fully-excised write stops AFTER excise and BEFORE tag/assert/disk (audit has exactly one excise record, zero disk touches)', p9bOk,
  `errorCode=${p9b.errorCode}; audit stages=${JSON.stringify(p9bAudit.map((a) => a.stage))}; store root created=${root9bExists}`);

// ---------------------------------------------------------------------------
// P10 — SIGKILL persistence: excised entry survives a real SIGKILL with
//       excisions intact (fresh processes on both sides)
// ---------------------------------------------------------------------------
const root10 = useStore('p10');
const childA = spawn(process.execPath, ['--input-type=module', '-e', `
const { memoryFs } = await import(${JSON.stringify(MODULE_URL)});
const r = memoryFs.write('/profile.md', 'user is a software engineer, INTP', 'user', {});
console.log('CHILD_A_WROTE ' + JSON.stringify(r));
setInterval(() => {}, 60000); // stay alive; parent will SIGKILL
`], { env: { ...process.env, JEXI_MEMORY_FS_ROOT: root10 }, stdio: ['ignore', 'pipe', 'pipe'] });

let outA = '';
await new Promise((res) => {
  const timer = setTimeout(res, 10000);
  childA.stdout.on('data', (d) => {
    outA += String(d);
    if (outA.includes('CHILD_A_WROTE')) { clearTimeout(timer); res(); }
  });
  childA.on('close', () => { clearTimeout(timer); res(); });
});
childA.kill('SIGKILL');
const closeA = await new Promise((res) => childA.on('close', (code, signal) => res({ code, signal })));
console.log(`child A stdout: ${outA.trim()}`);
console.log(`child A close: signal=${closeA.signal} code=${closeA.code}`);

const childB = spawnSync(process.execPath, ['--input-type=module', '-e', `
const { memoryFs, epistemic } = await import(${JSON.stringify(MODULE_URL)});
const r = memoryFs.read('/profile.md', {});
const d = epistemic.detectTag(r.content || '');
console.log('CHILD_B_READ ' + JSON.stringify({ read: r, detected: d }));
`], { env: { ...process.env, JEXI_MEMORY_FS_ROOT: root10 }, encoding: 'utf8' });
const outB = (childB.stdout || '').trim();
console.log(`child B (fresh process) stdout: ${outB}`);

let p10parsed = null;
try { p10parsed = JSON.parse(outB.replace('CHILD_B_READ ', '')); } catch { /* fail check below */ }
const p10Ok = closeA.signal === 'SIGKILL' && Boolean(p10parsed) &&
  p10parsed.read.exists === true &&
  p10parsed.read.content === '[stated] user is a software engineer' &&
  p10parsed.detected.tag === 'stated' &&
  p10parsed.detected.cleanContent === 'user is a software engineer' &&
  !p10parsed.read.content.includes('INTP');
check('P10 SIGKILL persistence: fresh process reads the entry back with excisions intact ("[stated] user is a software engineer", no INTP)', p10Ok,
  `writer killed via signal ${closeA.signal}; disk content=${p10parsed ? JSON.stringify(p10parsed.read.content) : '<unreadable>'}`);

// ---------------------------------------------------------------------------
// P11 — determinism: same input twice -> identical excised output
//       (in-process x2 + fresh process)
// ---------------------------------------------------------------------------
useStore('p11');
const P11_INPUT = 'diabetic engineer with MBTI INTP';
const e1 = blacklist.excise(P11_INPUT);
const e2 = blacklist.excise(P11_INPUT);
const s1 = sha256(JSON.stringify(e1));
const s2 = sha256(JSON.stringify(e2));
const child11 = spawnSync(process.execPath, ['--input-type=module', '-e', `
import crypto from 'node:crypto';
const { blacklist } = await import(${JSON.stringify(MODULE_URL)});
const a = blacklist.excise('diabetic engineer with MBTI INTP');
const b = blacklist.excise('diabetic engineer with MBTI INTP');
console.log('EXCHASH ' + crypto.createHash('sha256').update(JSON.stringify(a)).digest('hex'));
console.log('EXCSAME ' + (JSON.stringify(a) === JSON.stringify(b)));
console.log('EXCRAW ' + JSON.stringify(a));
`], { env: { ...process.env, JEXI_MEMORY_FS_ROOT: useStore('p11-child') }, encoding: 'utf8' });
const hLine = (child11.stdout || '').split('\n').find((l) => l.startsWith('EXCHASH '));
const sameLine = (child11.stdout || '').split('\n').find((l) => l.startsWith('EXCSAME '));
const rawLine = (child11.stdout || '').split('\n').find((l) => l.startsWith('EXCRAW '));
console.log(`in-process excise() #1 sha256: ${s1}`);
console.log(`in-process excise() #2 sha256: ${s2}`);
console.log(`fresh process: ${(hLine || '').trim()} ${(sameLine || '').trim()}`);
console.log(`fresh process raw: ${(rawLine || '').replace('EXCRAW ', '')}`);
const p11Ok = s1 === s2 && sameLine === 'EXCSAME true' && hLine === `EXCHASH ${s1}` &&
  e1.excised === 'engineer';
check('P11 determinism: same input twice -> byte-identical excised output (in-process x2 + fresh process)', p11Ok,
  `hashes equal: ${s1 === s2 && hLine === `EXCHASH ${s1}`}`);

// ---------------------------------------------------------------------------
// EXTRA-1 — Luhn-validated card number never reaches disk
// ---------------------------------------------------------------------------
const rootX1 = useStore('x1');
const x1w = memoryFs.write('/areas/notes.md', 'card 4111 1111 1111 1111 on file', 'user', { session: {} });
const x1r = memoryFs.read('/areas/notes.md', {});
console.log(`write('/areas/notes.md', 'card 4111 1111 1111 1111 on file', 'user') -> ${JSON.stringify(x1w)}`);
console.log(`excise('card 4111 1111 1111 1111 on file') -> ${JSON.stringify(blacklist.excise('card 4111 1111 1111 1111 on file'))}`);
console.log(`read('/areas/notes.md') -> ${JSON.stringify(x1r)}`);
const x1Ok = x1w.written === true && x1r.content === '[stated] card on file' &&
  !/\d/.test(x1r.content);
check('EXTRA-1 Luhn card check: 16-digit card number excised (financial), zero digits on disk', x1Ok,
  `disk=${JSON.stringify(x1r.content)}; digits on disk=${/\d/.test(x1r.content)}`);

// ---------------------------------------------------------------------------
// EXTRA-2 — writer role -> epistemic source mapping (untagged content)
// ---------------------------------------------------------------------------
const rootX2 = useStore('x2');
const x2a = memoryFs.write('/topics/a.md', 'user seems to prefer rust', AGENT, { session: {} });
const x2b = memoryFs.write('/topics/b.md', 'user seems to prefer rust', 'model', { session: {} });
const x2c = memoryFs.write('/topics/c.md', 'user seems to prefer rust', 'robot', { session: {} });
console.log(`write(..., {role:'agent'}) [untagged] -> ${JSON.stringify(x2a)}`);
console.log(`write(..., 'model')        [untagged] -> ${JSON.stringify(x2b)}`);
console.log(`write(..., 'robot')        [untagged] -> ${JSON.stringify(x2c)}`);
const x2Ok = x2a.written === false && x2a.errorCode === EPISTEMIC_CODES.INFERRED_NOT_WRITABLE &&
  x2b.written === false && x2b.errorCode === EPISTEMIC_CODES.INFERRED_NOT_WRITABLE &&
  x2c.written === false && x2c.errorCode === EPISTEMIC_CODES.UNKNOWN_SOURCE;
check('EXTRA-2 untagged auto-tagging by source: agent/model -> [inferred] refused E_INFERRED_NOT_WRITABLE; unknown role -> E_UNKNOWN_SOURCE', x2Ok,
  `agent=${x2a.errorCode}; model=${x2b.errorCode}; robot=${x2c.errorCode}`);

// ---------------------------------------------------------------------------
// P12 — Zone discipline: git status has ZERO non-zone entries; .jexi gitignored
// ---------------------------------------------------------------------------
const gitStatus = spawnSync('git', ['status', '--short'], { cwd: WT, encoding: 'utf8' });
const statusLines = (gitStatus.stdout || '').split('\n').filter((l) => l.trim() !== '');
console.log(`git status --short (${statusLines.length} lines):`);
for (const l of statusLines) console.log(`  ${l}`);
// Any two-char git status code (?? untracked, " M" modified, "A " added...)
// over a zone path counts as zone-internal; anything else is a violation.
const zoneRe = /^..\s+(prompt\/memory-fs(\/.*)?|scripts\/phase25-[a-z0-9-]+\.mjs)$/;
const nonZone = statusLines.filter((l) => !zoneRe.test(l));
const committed = statusLines.length === 0; // everything committed -> clean is the PASS state
const gitIgnore = spawnSync('git', ['check-ignore', '-v', '.jexi/probe-memfs/scope-g/p4/profile.md'], { cwd: WT, encoding: 'utf8' });
console.log(`git check-ignore -v .jexi probe file: ${(gitIgnore.stdout || '').trim() || '<NOT IGNORED>'}`);
const p12Ok = (committed || (statusLines.length > 0 && nonZone.length === 0)) && (gitIgnore.stdout || '').includes('.jexi/');
check('P12 zone discipline: git status has ZERO non-zone entries (zone-only pre-commit, clean post-commit); .jexi/ probe data gitignored', p12Ok,
  `mode=${committed ? 'committed-clean' : 'pre-commit-zone-only'}; entries=${statusLines.length}; non-zone entries=${nonZone.length}; ignore rule=${(gitIgnore.stdout || '').trim()}`);

// ---------------------------------------------------------------------------
console.log('');
console.log('--- SUMMARY ---');
if (failures === 0) {
  console.log('SCOPE G PROBE — ALL PASS (12/12 sections + 2 integration extras, 0 failures)');
  process.exit(0);
} else {
  console.log(`SCOPE G PROBE — FAILED (${failures} failing checks)`);
  process.exit(1);
}
