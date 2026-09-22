#!/usr/bin/env node
// scripts/phase25-scope-f.mjs
// Phase 25 — Scope F live probe: epistemological tagging ([stated] vs [inferred]).
// Zero dependencies. Real fs under gitignored .jexi/ probe roots (one isolated
// store per section). Real SIGKILL in P10. Prints raw evidence per check.
// Exit 1 on any failure.

import { spawnSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

import { memoryFs, epistemic, CODES, EPISTEMIC_CODES } from '../prompt/memory-fs/index.js';

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
  const p = path.join(WT, '.jexi', 'probe-memfs', 'scope-f', name);
  fs.rmSync(p, { recursive: true, force: true });
  process.env.JEXI_MEMORY_FS_ROOT = p;
  return p;
}

function sha256(s) {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}

console.log('=== SCOPE F PROBE — epistemological tagging ([stated] vs [inferred]) ===');
console.log(`node ${process.version}`);
console.log('');

// ---------------------------------------------------------------------------
// P1 — tag('user likes rust','user') -> [stated], writable
// ---------------------------------------------------------------------------
useStore('p1');
const p1 = epistemic.tag('user likes rust', 'user');
console.log(`tag('user likes rust','user') -> ${JSON.stringify(p1)}`);
const p1Ok = p1.tagged === '[stated] user likes rust' && p1.writable === true && p1.tag === 'stated';
check('P1 tag(user source) -> { tagged:"[stated] user likes rust", writable:true, tag:"stated" }', p1Ok,
  `tagged prefix "[stated] " + trailing space verified`);

// ---------------------------------------------------------------------------
// P2 — tag(...,'model') -> [inferred], writable:false, E_INFERRED_NOT_WRITABLE
// ---------------------------------------------------------------------------
const p2 = epistemic.tag('user probably wants a rewrite', 'model');
console.log(`tag('user probably wants a rewrite','model') -> ${JSON.stringify(p2)}`);
const p2Ok = p2.tagged === '[inferred] user probably wants a rewrite' &&
  p2.writable === false && p2.tag === 'inferred' &&
  p2.errorCode === EPISTEMIC_CODES.INFERRED_NOT_WRITABLE;
check('P2 tag(model source) -> would-be [inferred] string returned but writable:false + E_INFERRED_NOT_WRITABLE', p2Ok,
  `errorCode=${p2.errorCode}; reason withheld-write documented`);

// ---------------------------------------------------------------------------
// P3 — memoryFs.write [stated] -> written; read back confirms tag prefix
// ---------------------------------------------------------------------------
useStore('p3');
const p3w = memoryFs.write('/profile.md', '[stated] user is a developer', 'user', { session: {} });
const p3r = memoryFs.read('/profile.md', {});
console.log(`write('/profile.md', '[stated] user is a developer', 'user') -> ${JSON.stringify(p3w)}`);
console.log(`read('/profile.md') -> ${JSON.stringify(p3r)}`);
const p3Ok = p3w.written === true && p3r.exists === true &&
  p3r.content === '[stated] user is a developer' && p3r.content.startsWith('[stated] ');
check('P3 write [stated] entry -> written:true, read back confirms "[stated] " tag prefix on disk', p3Ok,
  `disk content verbatim: ${JSON.stringify(p3r.content)}`);

// ---------------------------------------------------------------------------
// P4 — memoryFs.write [inferred] -> refused, NO disk write
// ---------------------------------------------------------------------------
const root4 = useStore('p4');
const p4w = memoryFs.write('/profile.md', '[inferred] user is probably an engineer', 'model', { session: {} });
const file4 = fs.existsSync(path.join(root4, 'profile.md'));
const root4Exists = fs.existsSync(root4);
console.log(`write('/profile.md', '[inferred] user is probably an engineer', 'model') -> ${JSON.stringify(p4w)}`);
console.log(`disk check: profile.md exists=${file4}; store root exists=${root4Exists}`);
const p4Ok = p4w.written === false && p4w.errorCode === EPISTEMIC_CODES.INFERRED_NOT_WRITABLE &&
  file4 === false && root4Exists === false;
check('P4 write [inferred] -> refused E_INFERRED_NOT_WRITABLE, zero disk writes (store root never created)', p4Ok,
  `errorCode=${p4w.errorCode}; nothing touched disk`);

// ---------------------------------------------------------------------------
// P5 — untagged write under the Scope G pipeline (P25-H-01 re-target)
// The pre-G refusal (E_UNTAGGED) no longer fires: the G pipeline orders
// excise -> tag -> assertWritable, and untagged user content is auto-tagged
// [stated] from the writer's epistemic source before assertWritable runs.
// The assert now targets the PIPELINE OUTCOME: written:true, on-disk content
// carries the [stated] prefix, excision left the content intact.
// ---------------------------------------------------------------------------
const root5 = useStore('p5');
const p5w = memoryFs.write('/profile.md', 'user is a developer', 'user', { session: {} });
const file5 = fs.existsSync(path.join(root5, 'profile.md'));
const p5r = memoryFs.read('/profile.md', {});
console.log(`write('/profile.md', 'user is a developer', 'user') [no tag] -> ${JSON.stringify(p5w)}`);
console.log(`disk check: profile.md exists=${file5}; read back=${JSON.stringify(p5r)}`);
const p5Ok = p5w.written === true && file5 === true && p5r.exists === true &&
  p5r.content === '[stated] user is a developer';
check('P5 untagged user write -> G pipeline auto-tags [stated] and writes (excise -> tag -> assert -> disk; P25-H-01)', p5Ok,
  `written=${p5w.written}; disk content verbatim: ${JSON.stringify(p5r.content)}`);

// ---------------------------------------------------------------------------
// P6 — mid-text "[stated]" is NOT a tag (RULE 5)
// ---------------------------------------------------------------------------
const p6 = epistemic.detectTag('this mentions [stated] in the middle');
console.log(`detectTag('this mentions [stated] in the middle') -> ${JSON.stringify(p6)}`);
const p6Ok = p6.tag === null && p6.cleanContent === 'this mentions [stated] in the middle';
check('P6 detectTag mid-text tag -> { tag:null, cleanContent unchanged } (does NOT throw, RULE 4+5)', p6Ok,
  `tag=${p6.tag}; cleanContent identical to input`);

// ---------------------------------------------------------------------------
// P7 — double-tagging refused (RULE 6)
// ---------------------------------------------------------------------------
const p7 = epistemic.tag('[stated] [inferred] foo', 'user');
const p7b = epistemic.assertWritable('[stated] [inferred] foo');
console.log(`tag('[stated] [inferred] foo','user')            -> ${JSON.stringify(p7)}`);
console.log(`assertWritable('[stated] [inferred] foo')        -> ${JSON.stringify(p7b)}`);
const p7Ok = p7.writable === false && p7.errorCode === EPISTEMIC_CODES.DOUBLE_TAG &&
  p7b.ok === false && p7b.errorCode === EPISTEMIC_CODES.DOUBLE_TAG;
check('P7 double tag refused at both tag() and assertWritable() -> E_DOUBLE_TAG', p7Ok,
  `errorCode=${p7.errorCode}/${p7b.errorCode}`);

// ---------------------------------------------------------------------------
// P8 — system source: refused by default, allowed ONLY with systemWritable:true
// ---------------------------------------------------------------------------
const p8a = epistemic.tag('kernel config', 'system');
const p8b = epistemic.tag('kernel config', 'system', { systemWritable: true });
console.log(`tag('kernel config','system')                      -> ${JSON.stringify(p8a)}`);
console.log(`tag('kernel config','system',{systemWritable:true}) -> ${JSON.stringify(p8b)}`);
const p8Ok = p8a.writable === false && p8a.errorCode === EPISTEMIC_CODES.SYSTEM_WRITE_REFUSED &&
  p8b.writable === true && p8b.tag === 'stated' && p8b.tagged === '[stated] kernel config';
check('P8 system source gated: default E_SYSTEM_WRITE_REFUSED; explicit {systemWritable:true} -> allowed [stated]', p8Ok,
  `refused errorCode=${p8a.errorCode}; allowed tag=${p8b.tag}`);

// ---------------------------------------------------------------------------
// P9 — detectTag parses files in both tag states; reads are tag-agnostic
// ---------------------------------------------------------------------------
const root9 = useStore('p9');
const w9 = memoryFs.write('/topics/confirmed', '[stated] rust memory safety is documented', AGENT, { session: {} });
// raw fixture: an [inferred] entry CAN exist on disk (e.g. written by an
// upstream pipeline before this rule existed) — reads are allowed (RULE 4)
fs.writeFileSync(path.join(root9, 'topics', 'forecast.md'), '[inferred] rust will likely dominate systems work', 'utf8');
const r9a = memoryFs.read('/topics/confirmed', {});
const r9b = memoryFs.read('/topics/forecast', {});
const d9a = epistemic.detectTag(r9a.content);
const d9b = epistemic.detectTag(r9b.content);
console.log(`read('/topics/confirmed') -> ${JSON.stringify(r9a)}; detectTag -> ${JSON.stringify(d9a)}`);
console.log(`read('/topics/forecast')  -> ${JSON.stringify(r9b)}; detectTag -> ${JSON.stringify(d9b)}`);
const p9Ok = w9.written === true &&
  d9a.tag === 'stated' && d9a.cleanContent === 'rust memory safety is documented' &&
  r9b.exists === true && d9b.tag === 'inferred' && d9b.cleanContent === 'rust will likely dominate systems work';
check('P9 detectTag on real files: [stated] file -> stated, [inferred] fixture file -> inferred (read path tag-agnostic)', p9Ok,
  `tags: ${d9a.tag} / ${d9b.tag}; cleanContent split correct in both states`);

// ---------------------------------------------------------------------------
// P10 — [stated] entry persists across real SIGKILL, tag prefix intact
// ---------------------------------------------------------------------------
const root10 = useStore('p10');
const childA = spawn(process.execPath, ['--input-type=module', '-e', `
const { memoryFs } = await import(${JSON.stringify(MODULE_URL)});
memoryFs.write('/profile.md', '[stated] persist-me', { role: 'agent' }, {});
console.log('CHILD_A_WROTE ' + JSON.stringify(memoryFs.read('/profile.md', {}).content));
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
  p10parsed.read.content === '[stated] persist-me' &&
  p10parsed.detected.tag === 'stated' &&
  p10parsed.detected.cleanContent === 'persist-me';
check('P10 SIGKILL persistence: fresh process reads [stated] entry back with tag prefix intact', p10Ok,
  `writer killed via signal ${closeA.signal}; detected.tag=${p10parsed ? p10parsed.detected.tag : '<none>'}`);

// ---------------------------------------------------------------------------
// P11 — same tag call twice -> byte-identical output (in-process + fresh process)
// ---------------------------------------------------------------------------
useStore('p11');
const t1 = epistemic.tag('deterministic entry', 'user');
const t2 = epistemic.tag('deterministic entry', 'user');
const s1 = sha256(JSON.stringify(t1));
const s2 = sha256(JSON.stringify(t2));
const child11 = spawnSync(process.execPath, ['--input-type=module', '-e', `
import crypto from 'node:crypto';
const { epistemic } = await import(${JSON.stringify(MODULE_URL)});
const a = epistemic.tag('deterministic entry', 'user');
const b = epistemic.tag('deterministic entry', 'user');
console.log('TAGHASH ' + crypto.createHash('sha256').update(JSON.stringify(a)).digest('hex'));
console.log('TAGSAME ' + (JSON.stringify(a) === JSON.stringify(b)));
console.log('TAGRAW ' + JSON.stringify(a));
`], { env: { ...process.env, JEXI_MEMORY_FS_ROOT: useStore('p11-child') }, encoding: 'utf8' });
const hLine = (child11.stdout || '').split('\n').find((l) => l.startsWith('TAGHASH '));
const sameLine = (child11.stdout || '').split('\n').find((l) => l.startsWith('TAGSAME '));
const rawLine = (child11.stdout || '').split('\n').find((l) => l.startsWith('TAGRAW '));
console.log(`in-process tag() #1 sha256: ${s1}`);
console.log(`in-process tag() #2 sha256: ${s2}`);
console.log(`fresh process: ${(hLine || '').trim()} ${(sameLine || '').trim()}`);
console.log(`fresh process raw: ${(rawLine || '').replace('TAGRAW ', '')}`);
const p11Ok = s1 === s2 && sameLine === 'TAGSAME true' && hLine === `TAGHASH ${s1}` &&
  t1.tagged === '[stated] deterministic entry';
check('P11 determinism: same tag call twice -> byte-identical output (in-process x2 + fresh process)', p11Ok,
  `hashes equal: ${s1 === s2 && hLine === `TAGHASH ${s1}`}`);

// ---------------------------------------------------------------------------
// EXTRA — Scope E gates still active AFTER the epistemic pass (ordering proof)
// ---------------------------------------------------------------------------
const rootX1 = useStore('x1');
const x1a = memoryFs.write('/areas/ops.md', '[stated] ops baseline', AGENT, { session: {} });
const x1b = memoryFs.write('/areas/ops.md', '[stated] ops updated', AGENT, { session: {} }); // fresh ctx, no read
const x1ctx = { session: {} };
memoryFs.read('/areas/ops.md', x1ctx);
const x1c = memoryFs.write('/areas/ops.md', '[stated] ops updated', AGENT, x1ctx);
console.log(`EXTRA-1 create  -> ${JSON.stringify(x1a)}`);
console.log(`EXTRA-1 update without read -> ${JSON.stringify(x1b)}`);
console.log(`EXTRA-1 update after read   -> ${JSON.stringify(x1c)}`);
const x1Ok = x1a.written === true && x1b.written === false &&
  x1b.errorCode === CODES.READ_BEFORE_WRITE && x1c.written === true;
check('EXTRA-1 Scope E read-before-write gate still enforced for [stated] updates -> E_READ_BEFORE_WRITE then allowed', x1Ok,
  `ordering proven: epistemic pass -> Scope E RULE 6 gate fires`);

useStore('x2');
const x2 = memoryFs.write('/system/soul.md', '[stated] kernel fact', AGENT, { session: {} });
console.log(`EXTRA-2 write [stated] to /system/soul.md -> ${JSON.stringify(x2)}`);
const x2Ok = x2.written === false && x2.errorCode === CODES.RESERVED_NAMESPACE;
check('EXTRA-2 Scope E reserved-namespace gate still enforced after epistemic pass -> E_RESERVED_NAMESPACE', x2Ok,
  `epistemic ok, structural refusal intact: ${x2.errorCode}`);

// ---------------------------------------------------------------------------
// P12 — Zone discipline: git status has ZERO non-zone entries; .jexi/ gitignored
// ---------------------------------------------------------------------------
const gitStatus = spawnSync('git', ['status', '--short'], { cwd: WT, encoding: 'utf8' });
const statusLines = (gitStatus.stdout || '').split('\n').filter((l) => l.trim() !== '');
console.log(`git status --short (${statusLines.length} lines):`);
for (const l of statusLines) console.log(`  ${l}`);
// Any two-char git status code (?? untracked, " M" modified, "A " added...)
// over a zone path counts as zone-internal; anything else is a violation.
const zoneRe = /^..\s+(prompt\/memory-fs(\/.*)?|scripts\/phase25-scope-f\.mjs)$/;
const nonZone = statusLines.filter((l) => !zoneRe.test(l));
const committed = statusLines.length === 0; // everything committed -> clean is the PASS state
const gitIgnore = spawnSync('git', ['check-ignore', '-v', '.jexi/probe-memfs/scope-f/p3/profile.md'], { cwd: WT, encoding: 'utf8' });
console.log(`git check-ignore -v .jexi probe file: ${(gitIgnore.stdout || '').trim() || '<NOT IGNORED>'}`);
const p12Ok = (committed || (statusLines.length > 0 && nonZone.length === 0)) && (gitIgnore.stdout || '').includes('.jexi/');
check('P12 zone discipline: git status has ZERO non-zone entries (zone-only untracked pre-commit, clean post-commit); .jexi/ probe data gitignored', p12Ok,
  `mode=${committed ? 'committed-clean' : 'pre-commit-zone-only'}; entries=${statusLines.length}; non-zone entries=${nonZone.length}; ignore rule=${(gitIgnore.stdout || '').trim()}`);

// ---------------------------------------------------------------------------
console.log('');
console.log('--- SUMMARY ---');
if (failures === 0) {
  console.log('SCOPE F PROBE — ALL PASS (12/12 sections + 2 integration extras, 0 failures)');
  process.exit(0);
} else {
  console.log(`SCOPE F PROBE — FAILED (${failures} failing checks)`);
  process.exit(1);
}
