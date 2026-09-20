#!/usr/bin/env node
// scripts/phase25-scope-e.mjs
// Phase 25 — Scope E live probe: memory filesystem structure + rules.
// Zero dependencies. Real fs read/write under gitignored .jexi/ probe
// roots (one isolated store per section). Real SIGKILL in P10.
// Prints raw evidence per check. Exit 1 on any failure.

import { spawnSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

import { memoryFs, tree, CODES } from '../prompt/memory-fs/index.js';

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
  const p = path.join(WT, '.jexi', 'probe-memfs', 'scope-e', name);
  fs.rmSync(p, { recursive: true, force: true });
  process.env.JEXI_MEMORY_FS_ROOT = p;
  return p;
}

console.log('=== SCOPE E PROBE — memory filesystem structure + rules ===');
console.log(`node ${process.version}`);
console.log(`default storeRoot: ${path.join(WT, '.jexi', 'memory-fs')}`);
console.log('');

// ---------------------------------------------------------------------------
// P1 — Resolve valid paths (normalization: leading slash + trailing .md optional)
// ---------------------------------------------------------------------------
useStore('p1');
const rProfile = tree.resolve('/profile.md');
const rTopic = tree.resolve('/topics/rust');
const rPeople = tree.resolve('/people/kai');
console.log(`resolve('/profile.md')  -> ${JSON.stringify(rProfile)}`);
console.log(`resolve('/topics/rust') -> ${JSON.stringify(rTopic)}`);
console.log(`resolve('/people/kai')  -> ${JSON.stringify(rPeople)}`);
const p1Ok =
  rProfile.valid === true && rProfile.kind === 'file' && rProfile.absolute === '/profile.md' && rProfile.parent === '/' &&
  rTopic.valid === true && rTopic.kind === 'file' && rTopic.absolute === '/topics/rust.md' && rTopic.parent === '/topics' &&
  rPeople.valid === true && rPeople.kind === 'file' && rPeople.absolute === '/people/kai.md' && rPeople.parent === '/people';
check('P1 resolve valid paths: /profile.md file, /topics/rust -> /topics/rust.md, /people/kai -> /people/kai.md',
  p1Ok,
  `valid/kind/absolute all correct (raw above)`);

// ---------------------------------------------------------------------------
// P2 — Write + read round-trip
// ---------------------------------------------------------------------------
const root2 = useStore('p2');
const p2w = memoryFs.write('/profile.md', 'user is a developer', AGENT, { session: {} });
const p2r = memoryFs.read('/profile.md', {});
console.log(`write('/profile.md', 'user is a developer') -> ${JSON.stringify(p2w)}`);
console.log(`read('/profile.md')                         -> ${JSON.stringify(p2r)}`);
const p2Ok = p2w.written === true && p2w.absolutePath === '/profile.md' &&
  p2r.exists === true && p2r.content === 'user is a developer';
check('P2 write + read round-trip on /profile.md', p2Ok,
  `written=true; readback identical (${p2r.content.length} chars); disk bytes=${fs.statSync(path.join(root2, 'profile.md')).size}`);

// ---------------------------------------------------------------------------
// P3 — Auto-create immediate parent (/topics/ did not exist before)
// ---------------------------------------------------------------------------
const root3 = useStore('p3');
const dirBefore = fs.existsSync(path.join(root3, 'topics'));
const p3w = memoryFs.write('/topics/rust', '# Rust\nmemory-safe systems language', AGENT, { session: {} });
const dirAfter = fs.existsSync(path.join(root3, 'topics'));
const fileAfter = fs.existsSync(path.join(root3, 'topics', 'rust.md'));
const p3r = memoryFs.read('/topics/rust.md', {});
console.log(`write('/topics/rust', '# Rust\\n...') -> ${JSON.stringify(p3w)}`);
console.log(`/topics/ dir before=${dirBefore} after=${dirAfter}; /topics/rust.md exists=${fileAfter}`);
console.log(`read('/topics/rust.md') -> ${JSON.stringify(p3r)}`);
const p3Ok = dirBefore === false && dirAfter === true && fileAfter === true &&
  p3w.written === true && p3w.absolutePath === '/topics/rust.md' &&
  p3r.exists === true && p3r.content === '# Rust\nmemory-safe systems language';
check('P3 auto-create parent: /topics/ created, /topics/rust.md written', p3Ok,
  `dir before=false after=true; immediate parent only (mkdir non-recursive in module)`);

// ---------------------------------------------------------------------------
// P4 — Read missing -> { content: null, exists: false }, NOT an error
// ---------------------------------------------------------------------------
useStore('p4');
const p4 = memoryFs.read('/topics/nonexistent', {});
console.log(`read('/topics/nonexistent') -> ${JSON.stringify(p4)}`);
const p4Ok = p4.content === null && p4.exists === false && !('errorCode' in p4);
check('P4 read missing path -> content:null, exists:false (no throw, no errorCode)', p4Ok,
  `raw: ${JSON.stringify(p4)}`);

// ---------------------------------------------------------------------------
// P5 — Path traversal refused (raw + percent-encoded forms)
// ---------------------------------------------------------------------------
const root5 = useStore('p5');
const p5a = memoryFs.write('/topics/../../../etc/passwd', 'x', AGENT, { session: {} });
const p5b = memoryFs.write('/..%2Fsystem', 'x', AGENT, { session: {} });
console.log(`write('/topics/../../../etc/passwd', 'x') -> ${JSON.stringify(p5a)}`);
console.log(`write('/..%2Fsystem', 'x')                -> ${JSON.stringify(p5b)}`);
const escaped = fs.existsSync(path.join(root5, 'etc')) || fs.existsSync(path.join(root5, 'topics'));
const p5Ok = p5a.written === false && p5a.errorCode === CODES.PATH_TRAVERSAL &&
  p5b.written === false && p5b.errorCode === CODES.PATH_TRAVERSAL && escaped === false;
check('P5 path traversal refused: ".." and %2F-encoded forms -> E_PATH_TRAVERSAL, nothing escapes store', p5Ok,
  `errorCode a=${p5a.errorCode} b=${p5b.errorCode}; store-escape check: ${escaped ? 'ESCAPED' : 'clean'}`);

// ---------------------------------------------------------------------------
// P6 — Reserved namespaces refused (case-insensitive on reserved only)
// ---------------------------------------------------------------------------
useStore('p6');
const p6a = memoryFs.write('/system/soul.md', 'x', AGENT, { session: {} });
const p6b = memoryFs.write('/SYSTEM/x.md', 'x', AGENT, { session: {} });
const p6c = memoryFs.write('/refine/state.md', 'x', AGENT, { session: {} });
console.log(`write('/system/soul.md', 'x') -> ${JSON.stringify(p6a)}`);
console.log(`write('/SYSTEM/x.md', 'x')    -> ${JSON.stringify(p6b)}`);
console.log(`write('/refine/state.md', 'x') -> ${JSON.stringify(p6c)}`);
const p6Ok = [p6a, p6b, p6c].every((x) => x.written === false && x.errorCode === CODES.RESERVED_NAMESPACE);
check('P6 reserved namespaces refused: /system, /SYSTEM, /refine -> E_RESERVED_NAMESPACE', p6Ok,
  `all three written=false with E_RESERVED_NAMESPACE (reasons cite kernel-owned / harness state)`);

// ---------------------------------------------------------------------------
// P7 — Read-before-write for UPDATE (not CREATE)
// ---------------------------------------------------------------------------
const root7 = useStore('p7');
const p7create = memoryFs.write('/areas/ops.md', 'ops v1', AGENT, { session: {} }); // CREATE, ctx empty
const p7noRead = memoryFs.write('/areas/ops.md', 'ops v2', AGENT, { session: {} });  // UPDATE, fresh ctx, no read
const p7ctx = { session: {} };
const p7read = memoryFs.read('/areas/ops.md', p7ctx);                                 // read into ctx
const p7update = memoryFs.write('/areas/ops.md', 'ops v2', AGENT, p7ctx);             // UPDATE after read
const p7verify = memoryFs.read('/areas/ops.md', {});
console.log(`CREATE  write('/areas/ops.md', 'ops v1') [fresh ctx, no read] -> ${JSON.stringify(p7create)}`);
console.log(`UPDATE  write('/areas/ops.md', 'ops v2') [fresh ctx, NO read] -> ${JSON.stringify(p7noRead)}`);
console.log(`READ    read('/areas/ops.md') into ctx -> ${JSON.stringify(p7read)}`);
console.log(`UPDATE  write('/areas/ops.md', 'ops v2') [same ctx, read done] -> ${JSON.stringify(p7update)}`);
console.log(`VERIFY  read('/areas/ops.md') -> ${JSON.stringify(p7verify)}`);
const p7Ok = p7create.written === true &&
  p7noRead.written === false && p7noRead.errorCode === CODES.READ_BEFORE_WRITE &&
  p7read.exists === true &&
  p7update.written === true &&
  p7verify.content === 'ops v2';
check('P7 read-before-write: update w/o read -> E_READ_BEFORE_WRITE; read then update -> allowed', p7Ok,
  `create ok; blocked update errorCode=${p7noRead.errorCode}; post-read update written=true; content now 'ops v2'`);

// ---------------------------------------------------------------------------
// P8 — Create does not require prior read (brand-new path, never read)
// ---------------------------------------------------------------------------
useStore('p8');
const p8 = memoryFs.write('/people/kai', 'Kai - collaborator', AGENT, { session: {} });
console.log(`write('/people/kai', 'Kai - collaborator') [never read] -> ${JSON.stringify(p8)}`);
const p8Ok = p8.written === true && p8.absolutePath === '/people/kai.md';
check('P8 CREATE without prior read -> allowed', p8Ok,
  `written=true, normalized to /people/kai.md`);

// ---------------------------------------------------------------------------
// P9 — Directory listing (deterministic code-unit sort)
// ---------------------------------------------------------------------------
useStore('p9');
memoryFs.write('/topics/rust', 'rust notes', AGENT, { session: {} });
memoryFs.write('/topics/nextjs', 'nextjs notes', AGENT, { session: {} });
const p9 = tree.list('/topics');
console.log(`list('/topics') -> ${JSON.stringify(p9, null, 0)}`);
const p9Ok = p9.length === 2 &&
  p9[0].path === '/topics/nextjs.md' && p9[1].path === '/topics/rust.md' &&
  p9.every((e) => e.kind === 'file' && e.sizeBytes > 0);
check('P9 directory listing: /topics -> [nextjs.md, rust.md] sorted, kind+sizeBytes present', p9Ok,
  `entries=${p9.length}; paths=${JSON.stringify(p9.map((e) => e.path))}; sizes=${JSON.stringify(p9.map((e) => e.sizeBytes))}`);

// ---------------------------------------------------------------------------
// P10 — Persistence across process (real SIGKILL, fresh reader)
// ---------------------------------------------------------------------------
const root10 = useStore('p10');
const childA = spawn(process.execPath, ['--input-type=module', '-e', `
const { memoryFs } = await import(${JSON.stringify(MODULE_URL)});
memoryFs.write('/profile.md', 'persist-me', { role: 'agent' }, {});
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
const { memoryFs } = await import(${JSON.stringify(MODULE_URL)});
console.log('CHILD_B_READ ' + JSON.stringify(memoryFs.read('/profile.md', {})));
`], { env: { ...process.env, JEXI_MEMORY_FS_ROOT: root10 }, encoding: 'utf8' });
const outB = (childB.stdout || '').trim();
console.log(`child B (fresh process) stdout: ${outB}`);

let p10Content = null;
try { p10Content = JSON.parse(outB.replace('CHILD_B_READ ', '')).content; } catch { /* parse fail -> fail check */ }
const p10Ok = closeA.signal === 'SIGKILL' && outA.includes('"persist-me"') &&
  p10Content === 'persist-me';
check('P10 persistence across process: SIGKILLed writer, fresh reader sees intact content', p10Ok,
  `writer killed via signal ${closeA.signal}; fresh-process readback content=${JSON.stringify(p10Content)}`);

// ---------------------------------------------------------------------------
// P11 — Determinism: identical sequence in two fresh processes -> identical bytes
// ---------------------------------------------------------------------------
const root11a = useStore('p11-r1');
const root11b = path.join(WT, '.jexi', 'probe-memfs', 'scope-e', 'p11-r2');
fs.rmSync(root11b, { recursive: true, force: true });

const SEQ_CHILD = `
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const { memoryFs, tree } = await import(${JSON.stringify(MODULE_URL)});
const ctx = { session: {} };
memoryFs.write('/profile.md', 'user is a developer', { role: 'agent' }, ctx);
memoryFs.write('/topics/rust', '# Rust\\nmemory-safe systems language', { role: 'agent' }, ctx);
memoryFs.read('/profile.md', ctx);
memoryFs.write('/profile.md', 'user is a senior developer', { role: 'agent' }, ctx);
memoryFs.write('/people/kai', 'Kai - collaborator', { role: 'agent' }, ctx);
const files = ['/profile.md', '/topics/rust.md', '/people/kai.md'];
const manifest = {};
for (const f of files) {
  manifest[f] = crypto.createHash('sha256').update(fs.readFileSync(path.join(tree.storeRoot(), f))).digest('hex');
}
console.log('MANIFEST ' + JSON.stringify(manifest));
`;

const c11a = spawnSync(process.execPath, ['--input-type=module', '-e', SEQ_CHILD],
  { env: { ...process.env, JEXI_MEMORY_FS_ROOT: root11a }, encoding: 'utf8' });
const c11b = spawnSync(process.execPath, ['--input-type=module', '-e', SEQ_CHILD],
  { env: { ...process.env, JEXI_MEMORY_FS_ROOT: root11b }, encoding: 'utf8' });
const mA = (c11a.stdout || '').split('\n').find((l) => l.startsWith('MANIFEST '));
const mB = (c11b.stdout || '').split('\n').find((l) => l.startsWith('MANIFEST '));
console.log(`run 1 (${root11a}):`);
console.log(`  ${mA ? mA.slice('MANIFEST '.length) : '<no manifest>'}`);
console.log(`run 2 (${root11b}):`);
console.log(`  ${mB ? mB.slice('MANIFEST '.length) : '<no manifest>'}`);
const p11Ok = Boolean(mA && mB) && mA === mB;
check('P11 determinism: same write sequence in two fresh processes -> byte-identical files (sha256 manifests equal)', p11Ok,
  mA && mB ? (mA === mB ? 'manifests identical' : 'manifests DIFFER') : `missing manifest(s): a=${Boolean(mA)} b=${Boolean(mB)}`);

// ---------------------------------------------------------------------------
// P12 — Zone discipline: git status shows only prompt/memory-fs/** + scripts/phase25-*.mjs
// ---------------------------------------------------------------------------
const gitStatus = spawnSync('git', ['status', '--short'], { cwd: WT, encoding: 'utf8' });
const statusLines = (gitStatus.stdout || '').split('\n').filter((l) => l.trim() !== '');
console.log(`git status --short (${statusLines.length} lines):`);
for (const l of statusLines) console.log(`  ${l}`);
const zoneRe = /^\?\?\s+(prompt\/memory-fs\/|scripts\/phase25-scope-e\.mjs)$/;
const allZoned = statusLines.every((l) => zoneRe.test(l));
const nonZone = statusLines.filter((l) => !zoneRe.test(l));
const committed = statusLines.length === 0; // everything committed -> clean is the PASS state
const gitIgnore = spawnSync('git', ['check-ignore', '-v', '.jexi/probe-memfs/scope-e/p2/profile.md'], { cwd: WT, encoding: 'utf8' });
console.log(`git check-ignore -v .jexi probe file: ${(gitIgnore.stdout || '').trim() || '<NOT IGNORED>'}`);
const p12Ok = (committed || (statusLines.length > 0 && allZoned)) && (gitIgnore.stdout || '').includes('.jexi/');
check('P12 zone discipline: git status has ZERO non-zone entries (zone-only untracked pre-commit, clean post-commit); .jexi/ probe data gitignored', p12Ok,
  `mode=${committed ? 'committed-clean' : 'pre-commit-zone-only'}; entries=${statusLines.length}; non-zone entries=${nonZone.length}; ignore rule=${(gitIgnore.stdout || '').trim()}`);

// ---------------------------------------------------------------------------
console.log('');
console.log('--- SUMMARY ---');
if (failures === 0) {
  console.log('SCOPE E PROBE — ALL PASS (12/12 sections, 0 failures)');
  process.exit(0);
} else {
  console.log(`SCOPE E PROBE — FAILED (${failures} failing checks)`);
  process.exit(1);
}
