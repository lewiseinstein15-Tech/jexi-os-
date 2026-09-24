#!/usr/bin/env node
// scripts/phase29-scope-i-probe.mjs
// Phase 29 — Scope I live probe: sandbox integration (AIO-compatible client
// SEAM, health gate, contained exec/read/write). Zero dependencies, zero
// network, zero host I/O from the module under test: every client is an
// injected deterministic stub. Raw output per check. Exit 1 on any failure.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  sandbox,
  SANDBOX_CODES,
  SANDBOX_CLIENT_METHODS,
  SANDBOX_CONTRACT,
  DEFAULT_ROOT,
  assertClient,
  checkHealth,
  resolvePath,
} from '../services/computer/sandbox/index.js';
import { ComputerError } from '../services/computer/errors.js';

const WT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let failures = 0;
function check(name, ok, evidence) {
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}`);
  console.log(`        ${evidence}`);
  if (!ok) failures += 1;
}

function errOf(fn) {
  try {
    fn();
    return null;
  } catch (e) {
    return e instanceof ComputerError
      ? { code: e.code, message: e.message, details: e.details === undefined ? null : e.details }
      : { code: `NON_COMPUTER_ERROR:${e && e.constructor && e.constructor.name}`, message: e.message, details: null };
  }
}

function sha16(s) {
  return createHash('sha256').update(s).digest('hex').slice(0, 16);
}

// ---------------------------------------------------------------------------
// Fixtures — deterministic injected stub clients (the SEAM under test)
// ---------------------------------------------------------------------------
function makeStub({ healthResult, healthThrow, execResult, jupyterResult, memory } = {}) {
  const calls = { health: 0, execBash: 0, runJupyter: 0, readFile: 0, writeFile: 0 };
  const store = new Map();
  const stub = {
    calls,
    store,
    health() {
      calls.health += 1;
      if (healthThrow) throw healthThrow;
      return healthResult !== undefined ? healthResult : { ok: true, url: 'stub://aio/workspace' };
    },
    execBash(input) {
      calls.execBash += 1;
      return execResult ? execResult(input) : { stdout: `ran:${input.cmd}`, stderr: '', exitCode: 0 };
    },
    runJupyter(input) {
      calls.runJupyter += 1;
      return jupyterResult ? jupyterResult(input) : { stdout: `nb:${input.code}`, stderr: '', exitCode: 0 };
    },
    readFile(input) {
      calls.readFile += 1;
      if (memory) {
        if (!store.has(input.path)) throw new Error(`stub ENOENT: ${input.path}`);
        return { content: store.get(input.path) };
      }
      return { content: `content-of:${input.path}` };
    },
    writeFile(input) {
      calls.writeFile += 1;
      if (memory) {
        store.set(input.path, input.content);
        return { ok: true };
      }
      return { ok: true };
    },
  };
  return stub;
}

console.log('=== SCOPE I PROBE — sandbox integration ===');
console.log(`node ${process.version}`);
console.log(`declared codes: ${SANDBOX_CODES.join(' | ')} (ComputerError; E_INVALID_ARGUMENT reused for misuse)`);
console.log(`declared contract: sandbox.${SANDBOX_CONTRACT.join(' / ')} (+ jupyter extra)`);
console.log(`declared client surface: ${SANDBOX_CLIENT_METHODS.map((m) => `${m.method}->${m.result}`).join(' ; ')}`);
console.log(`default root: ${DEFAULT_ROOT}`);
console.log('network: none — injected stub clients only; no child_process/fs under computer/sandbox/**; deterministic (no clock, no randomness)');
console.log('');

// ---------------------------------------------------------------------------
// P1 — sandbox environment with no AIO service: available() is
//      { available: false } and every operation refuses with
//      E_SANDBOX_UNAVAILABLE. Show both.
// ---------------------------------------------------------------------------
const p1avail = sandbox.available();
const p1execNoArgs = errOf(() => sandbox.exec());
const p1exec = errOf(() => sandbox.exec({ cmd: 'echo hi' }));
const p1read = errOf(() => sandbox.read({ path: 'a.txt' }));
const p1write = errOf(() => sandbox.write({ path: 'a.txt', content: 'x' }));
const p1jupyter = errOf(() => sandbox.jupyter({ code: '1+1' }));
console.log(`P1 available() raw: ${JSON.stringify(p1avail)}`);
console.log(`P1 exec() no-args raw: ${JSON.stringify(p1execNoArgs)}`);
console.log(`P1 exec({cmd}) raw: ${JSON.stringify(p1exec)}`);
console.log(`P1 read/write/jupyter codes: ${p1read.code} | ${p1write.code} | ${p1jupyter.code}`);
const p1ok =
  JSON.stringify(p1avail) === '{"available":false}' &&
  p1execNoArgs !== null && p1execNoArgs.code === 'E_SANDBOX_UNAVAILABLE' &&
  p1exec !== null && p1exec.code === 'E_SANDBOX_UNAVAILABLE' &&
  p1read !== null && p1read.code === 'E_SANDBOX_UNAVAILABLE' &&
  p1write !== null && p1write.code === 'E_SANDBOX_UNAVAILABLE' &&
  p1jupyter !== null && p1jupyter.code === 'E_SANDBOX_UNAVAILABLE';
check(
  'P1 unconfigured sandbox: with no injected AIO client available() is exactly { available: false } (no url), and exec (with and without args), read, write, jupyter ALL refuse with E_SANDBOX_UNAVAILABLE — never fake execution output',
  p1ok,
  `available=${JSON.stringify(p1avail)} execNoArgs=${p1execNoArgs.code} exec=${p1exec.code} read=${p1read.code} write=${p1write.code} jupyter=${p1jupyter.code}`
);
console.log('');

// ---------------------------------------------------------------------------
// P2 — injected stub client: configure passes the health gate, available()
//      reports the url, exec returns the stubbed { stdout, stderr, exitCode }
//      verbatim. Show the stub return. Plus the declared refusal path:
//      non-zero exit + refusal reason -> E_SANDBOX_EXEC_FAILED.
// ---------------------------------------------------------------------------
const stubA = makeStub();
const p2cfg = sandbox.configure({ client: stubA, url: 'stub://aio' });
const p2avail = sandbox.available();
const p2exec = sandbox.exec({ cmd: 'echo hello-aio' });
console.log(`P2 configure raw: ${JSON.stringify(p2cfg)}`);
console.log(`P2 available() raw: ${JSON.stringify(p2avail)}`);
console.log(`P2 exec stub return raw: ${JSON.stringify(p2exec)}`);
console.log(`P2 stub dispatch raw: execBash calls=${stubA.calls.execBash} received=${JSON.stringify({ cmd: 'echo hello-aio' })}`);
const stubR = makeStub({
  execResult: () => ({ stdout: '', stderr: '', exitCode: 126, refusal: 'command blocked by sandbox policy' }),
});
sandbox.configure({ client: stubR, url: 'stub://refusal' });
const p2ref = errOf(() => sandbox.exec({ cmd: 'rm -rf /' }));
console.log(`P2 refusal raw: ${JSON.stringify(p2ref)}`);
const back = sandbox.configure({ client: stubA, url: 'stub://aio' }); // restore (REPLACE semantics)
const p2ok =
  p2cfg.ok === true && p2cfg.url === 'stub://aio' && p2cfg.root === DEFAULT_ROOT && p2cfg.healthChecked === true &&
  JSON.stringify(p2avail) === '{"available":true,"url":"stub://aio"}' &&
  JSON.stringify(p2exec) === JSON.stringify({ stdout: 'ran:echo hello-aio', stderr: '', exitCode: 0 }) &&
  stubA.calls.execBash === 1 &&
  p2ref !== null && p2ref.code === 'E_SANDBOX_EXEC_FAILED' &&
  p2ref.details !== null && p2ref.details.exitCode === 126 &&
  p2ref.details.refusal === 'command blocked by sandbox policy' &&
  back.ok === true;
check(
  'P2 injected stub: configure({ client }) passes the health gate and available() reports { available: true, url }; exec returns the stubbed { stdout, stderr, exitCode } VERBATIM (ran:echo hello-aio, exit 0, stub dispatched exactly once with the raw cmd); a stub refusal (exit 126 + reason) throws E_SANDBOX_EXEC_FAILED carrying exitCode and refusal in details; re-configure replaces the client',
  p2ok,
  `exec=${JSON.stringify(p2exec)} refusal=${p2ref.code} exit=${p2ref.details && p2ref.details.exitCode} restored=${back.url}`
);
console.log('');

// ---------------------------------------------------------------------------
// P3 — health check: failing client -> E_SANDBOX_UNHEALTHY with the reason;
//      a health() that throws -> same code with the thrown message; refused
//      init leaves the previous client attached (survival); the declared
//      skipHealthCheck bypass attaches without ever calling health().
// ---------------------------------------------------------------------------
const stubDown = makeStub({ healthResult: { ok: false, reason: 'aio daemon not listening on 127.0.0.1:41900' } });
const p3returned = errOf(() => sandbox.configure({ client: stubDown, url: 'stub://down' }));
const stubThrow = makeStub({ healthThrow: new Error('connection refused') });
const p3thrown = errOf(() => sandbox.configure({ client: stubThrow, url: 'stub://throw' }));
const p3survived = sandbox.available();
console.log(`P3 returned-failure raw: ${JSON.stringify(p3returned)}`);
console.log(`P3 thrown-failure raw: ${JSON.stringify(p3thrown)}`);
console.log(`P3 survival raw: available after refused init = ${JSON.stringify(p3survived)}`);
const stubSkip = makeStub({ healthResult: { ok: false, reason: 'would fail if asked' } });
const p3skip = sandbox.configure({ client: stubSkip, url: 'stub://skip', skipHealthCheck: true });
const p3skipAvail = sandbox.available();
console.log(`P3 skip-flag raw: configure=${JSON.stringify(p3skip)} available=${JSON.stringify(p3skipAvail)} healthCalls=${stubSkip.calls.health}`);
const restoreA = sandbox.configure({ client: stubA, url: 'stub://aio' });
const p3ok =
  p3returned !== null && p3returned.code === 'E_SANDBOX_UNHEALTHY' &&
  p3returned.details !== null && p3returned.details.reason === 'aio daemon not listening on 127.0.0.1:41900' &&
  p3thrown !== null && p3thrown.code === 'E_SANDBOX_UNHEALTHY' &&
  p3thrown.details !== null && p3thrown.details.reason === 'health() threw: connection refused' &&
  JSON.stringify(p3survived) === '{"available":true,"url":"stub://aio"}' &&
  p3skip.ok === true && p3skip.healthChecked === false && stubSkip.calls.health === 0 &&
  restoreA.ok === true;
check(
  'P3 health gate: a client reporting { ok:false, reason } and a client whose health() throws both refuse init with E_SANDBOX_UNHEALTHY carrying the exact reason in details; both refusals leave the previous client attached (available still stub://aio — refused init mutates nothing); skipHealthCheck:true attaches without invoking health() even though the client would fail it (declared bypass, healthCalls=0)',
  p3ok,
  `returned=${p3returned.details && p3returned.details.reason} thrown=${p3thrown.details && p3thrown.details.reason} survived=${JSON.stringify(p3survived)} skipHealthCalls=${stubSkip.calls.health}`
);
console.log('');

// ---------------------------------------------------------------------------
// P4 — read/write through an injected memory-backed stub: content
//      round-trip; the client receives the RESOLVED contained path
//      (relative -> <root>/...); an absolute path inside the root is
//      allowed and addresses the same file.
// ---------------------------------------------------------------------------
const stubM = makeStub({ memory: true });
sandbox.configure({ client: stubM, url: 'stub://aio' });
const p4w = sandbox.write({ path: 'notes/a.txt', content: 'JEXI-AIO-ROUNDTRIP' });
const p4r = sandbox.read({ path: 'notes/a.txt' });
const p4storedAt = [...stubM.store.keys()].join(',');
const p4wAbs = sandbox.write({ path: '/workspace/notes/b.txt', content: 'abs-inside-ok' });
const p4rRel = sandbox.read({ path: 'notes/b.txt' });
console.log(`P4 write raw: ${JSON.stringify(p4w)}`);
console.log(`P4 read raw: ${JSON.stringify(p4r)}`);
console.log(`P4 stub-store raw: keys=${JSON.stringify([...stubM.store.keys()])} resolved=${p4storedAt}`);
console.log(`P4 absolute-inside raw: write=${JSON.stringify(p4wAbs)} readBack=${JSON.stringify(p4rRel)}`);
const p4ok =
  JSON.stringify(p4w) === '{"ok":true}' &&
  JSON.stringify(p4r) === '{"content":"JEXI-AIO-ROUNDTRIP"}' &&
  typeof p4r.content === 'string' &&
  p4storedAt === '/workspace/notes/a.txt' &&
  JSON.stringify(p4wAbs) === '{"ok":true}' &&
  JSON.stringify(p4rRel) === '{"content":"abs-inside-ok"}' &&
  stubM.store.get('/workspace/notes/b.txt') === 'abs-inside-ok';
check(
  'P4 file round-trip: write returns { ok:true }, read returns the identical content { content:"JEXI-AIO-ROUNDTRIP" }; the injected client received the normalized ABSOLUTE path /workspace/notes/a.txt (containment resolved at the seam); an absolute path inside the root (/workspace/notes/b.txt) is declared legal and reads back through the relative view',
  p4ok,
  `write=${JSON.stringify(p4w)} read=${JSON.stringify(p4r)} storedAt=${p4storedAt} absRoundTrip=${JSON.stringify(p4rRel)}`
);
console.log('');

// ---------------------------------------------------------------------------
// P5 — isolation proof: escape attempts via path traversal and absolute
//      paths outside the root are refused with E_INVALID_ARGUMENT BEFORE
//      the client is called (dispatch counter stays 0).
// ---------------------------------------------------------------------------
const stubIso = makeStub({ memory: true });
sandbox.configure({ client: stubIso, url: 'stub://aio' });
const escapes = [
  ['read', { path: '../..' }],
  ['read', { path: 'a/../../../etc/passwd' }],
  ['read', { path: '/etc/passwd' }],
  ['write', { path: '/etc/hosts', content: 'x' }],
  ['read', { path: '' }],
  ['read', { path: 42 }],
];
const escapeCodes = escapes.map(([op, args]) => errOf(() => sandbox[op](args)));
console.log(`P5 attempts raw: ${escapes.map(([op, args], i) => `${op}(${JSON.stringify(args)}) -> ${escapeCodes[i].code}`).join(' ; ')}`);
console.log(`P5 messages raw: ${escapeCodes.map((e) => e.message).join(' | ')}`);
const dispatched = stubIso.calls.execBash + stubIso.calls.runJupyter + stubIso.calls.readFile + stubIso.calls.writeFile;
console.log(`P5 dispatch counter raw: client op calls after all escape attempts = ${dispatched}`);
const directEscape = errOf(() => resolvePath('/workspace', 'x/../../y'));
console.log(`P5 resolvePath direct raw: ${JSON.stringify(directEscape)}`);
const p5ok =
  escapeCodes.every((e) => e !== null && e.code === 'E_INVALID_ARGUMENT') &&
  dispatched === 0 &&
  directEscape !== null && directEscape.code === 'E_INVALID_ARGUMENT';
check(
  'P5 isolation: traversal (../..), deep traversal (a/../../../etc/passwd), absolute paths outside the root (/etc/passwd, /etc/hosts), an empty path, and a non-string path are ALL refused with E_INVALID_ARGUMENT — and the injected client recorded ZERO file/exec dispatches, so refusal happens strictly before any call into the sandbox; the resolvePath guard itself refuses x/../../y directly',
  p5ok,
  `codes=${JSON.stringify(escapeCodes.map((e) => e.code))} dispatched=${dispatched} direct=${directEscape.code}`
);
console.log('');

// ---------------------------------------------------------------------------
// P6 — determinism: the same cmd (and the same file write/read) through the
//      same injected stub twice -> byte-identical results.
// ---------------------------------------------------------------------------
const stubD = makeStub({ memory: true });
sandbox.configure({ client: stubD, url: 'stub://aio' });
function p6pass() {
  return {
    exec: JSON.stringify(sandbox.exec({ cmd: 'uname -a; echo $((6*7))' })),
    write: JSON.stringify(sandbox.write({ path: 'det/seed.txt', content: 'DETERMINISM-SEED' })),
    read: JSON.stringify(sandbox.read({ path: 'det/seed.txt' })),
    jupyter: JSON.stringify(sandbox.jupyter({ code: 'print(6*7)' })),
  };
}
const passA = p6pass();
const passB = p6pass();
const p6keys = ['exec', 'write', 'read', 'jupyter'];
const p6identical = p6keys.map((k) => passA[k] === passB[k]);
console.log(`P6 pass A raw: exec=${passA.exec} read=${passA.read}`);
console.log(`P6 pass B raw: identical=${JSON.stringify(p6identical)} (all four byte comparisons)`);
const p6ok = p6identical.every(Boolean);
check(
  'P6 determinism: two independent passes of the same exec cmd, file write, file read, and jupyter code through the same injected stub produce byte-identical results in all four comparisons — the sandbox surface is a pure function of (injected client, arguments), no clock, no randomness',
  p6ok,
  `execSha=${sha16(passA.exec)} readSha=${sha16(passA.read)} writeSha=${sha16(passA.write)} jupyterSha=${sha16(passA.jupyter)} identical=${JSON.stringify(p6identical)}`
);
console.log('');

// ---------------------------------------------------------------------------
// P7 — Zone check: git status shows ONLY this scope's paths
// ---------------------------------------------------------------------------
const st = spawnSync('git', ['status', '--short'], { cwd: WT, encoding: 'utf8' });
const lines = st.stdout.split('\n').filter((l) => l.trim() !== '');
console.log('P7 git status --short raw:');
console.log(st.stdout.trim());
const ALLOWED = ['computer/', 'scripts/phase29-'];
const zoneOk = lines.every((l) => {
  const status = l.slice(0, 2); // '??', ' M', 'A ', ... — in-zone entries are legitimate
  const p = l.slice(3).trim();
  return ALLOWED.some((a) => p === a || p.startsWith(a)) && status.trim().length > 0;
});
check(
  'P7 zone discipline: only computer/** + scripts/phase29-* in git status (no Scope A-H file touched)',
  zoneOk,
  `${lines.length} path(s): ${lines.map((l) => l.slice(3).trim()).join(' | ')}`
);
console.log('');

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log('---------------------------------------------');
console.log(`SCOPE I: ${7 - failures}/7 PASS, ${failures} FAIL`);
if (failures > 0) process.exit(1);
