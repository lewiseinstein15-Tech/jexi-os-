#!/usr/bin/env node
// scripts/phase29-scope-j-probe.mjs
// Phase 29 — Scope J live probe: remote operator support (REST client SEAM,
// keyRef credential discipline, pure VNC preview, Scope B operator contract).
// Zero dependencies, zero network: every remote client is an injected
// deterministic stub. Raw output per check. Exit 1 on any failure.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  remote,
  REMOTE_CODES,
  REMOTE_CLIENT_METHODS,
  REMOTE_CONTRACT,
  assertRemoteClient,
  validateCredentials,
  buildVncPreviewUrl,
} from '../services/computer/remote/index.js';
import { ComputerError } from '../services/computer/errors.js';
import { assertOperator, OPERATOR_CAPABILITY_KEYS } from '../services/computer/operators/interface.js';
import { createDesktopOperator } from '../services/computer/operators/desktop.js';

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
// Fixtures — deterministic injected REST stub clients (the SEAM under test)
// ---------------------------------------------------------------------------
function makeStub({ connectResult, screenshotResult, executeResult } = {}) {
  const calls = { connect: 0, screenshot: 0, execute: 0 };
  const received = [];
  const stub = {
    calls,
    received,
    connect(input) {
      calls.connect += 1;
      received.push({ op: 'connect', input });
      return connectResult ? connectResult(input) : { sessionId: 'sess-9f14c2aa' };
    },
    screenshot(input) {
      calls.screenshot += 1;
      received.push({ op: 'screenshot', input });
      return screenshotResult
        ? screenshotResult(input)
        : { image: 'remote-png-bytes', width: 1280, height: 800, dpi: 96 };
    },
    execute(input) {
      calls.execute += 1;
      received.push({ op: 'execute', input });
      return executeResult ? executeResult(input) : { ok: true, result: { acted: input.action.action, at: 'remote-vm' } };
    },
  };
  return stub;
}

const CLICK = Object.freeze({ action: 'click', args: { start_box: { x: 120, y: 240 } } });
const ENDPOINT = 'https://vm.example.com';
const KEYREF_CREDS = Object.freeze({ vm: 'REMOTE_VM_TOKEN' });

console.log('=== SCOPE J PROBE — remote operator support ===');
console.log(`node ${process.version}`);
console.log(`declared codes: ${REMOTE_CODES.join(' | ')} (ComputerError; E_INVALID_ARGUMENT reused for misuse)`);
console.log(`declared contract: remote.${REMOTE_CONTRACT.join(' / ')} (+ configure/detach SEAM, Scope B operator fields)`);
console.log(`declared client surface: ${REMOTE_CLIENT_METHODS.map((m) => `${m.method}->${m.result}`).join(' ; ')}`);
console.log('keyRef discipline: env-var name or keyring:<name> refs only (Phase 27 schema.js read-only authority); credential-named fields, non-keyRef values, and endpoint userinfo are inline -> E_INLINE_KEY_REFUSED');
console.log('network: none — injected stub clients only; VNC preview is a pure builder; deterministic (no clock, no randomness)');
console.log('');

// ---------------------------------------------------------------------------
// P1 — connect with stub client -> { sessionId }. Show the connect result
//      and that credentials arrived at the client as keyRefs (unresolved).
// ---------------------------------------------------------------------------
const stubA = makeStub();
const p1cfg = remote.configure({ client: stubA });
const p1conn = remote.connect({ endpoint: ENDPOINT, credentials: KEYREF_CREDS });
const p1recv = stubA.received[0];
console.log(`P1 configure raw: ${JSON.stringify(p1cfg)}`);
console.log(`P1 connect raw: ${JSON.stringify(p1conn)}`);
console.log(`P1 stub received raw: ${JSON.stringify(p1recv)}`);
console.log(`P1 session raw: ${JSON.stringify(remote.session())}`);
const p1ok =
  JSON.stringify(p1cfg) === '{"ok":true}' &&
  JSON.stringify(p1conn) === '{"sessionId":"sess-9f14c2aa"}' &&
  stubA.calls.connect === 1 &&
  JSON.stringify(p1recv.input) === JSON.stringify({ endpoint: ENDPOINT, credentials: { vm: 'REMOTE_VM_TOKEN' } }) &&
  JSON.stringify(remote.session()) === JSON.stringify({ sessionId: 'sess-9f14c2aa', endpoint: ENDPOINT });
check(
  'P1 connect: with the injected stub, remote.connect({ endpoint, credentials }) returns { sessionId:"sess-9f14c2aa" } and the client received the endpoint plus the credentials AS KEYREFS (vm -> REMOTE_VM_TOKEN, unresolved — no secret ever exists in the module); session introspection echoes sessionId + endpoint',
  p1ok,
  `connect=${JSON.stringify(p1conn)} received=${JSON.stringify(p1recv.input)} session=${JSON.stringify(remote.session())}`
);
console.log('');

// ---------------------------------------------------------------------------
// P2 — vncPreview(sessionId) -> { url }. Show the URL shape. Confirm pure:
//      the client spy counter does not move.
// ---------------------------------------------------------------------------
const spyBefore = JSON.stringify(stubA.calls);
const p2url = remote.vncPreview();
const p2urlOther = remote.vncPreview('sess-other-42');
const p2direct = buildVncPreviewUrl({ endpoint: 'https://vm.example.com/remote/', sessionId: 'sess-sub' });
const spyAfter = JSON.stringify(stubA.calls);
console.log(`P2 vncPreview() raw: ${JSON.stringify(p2url)}`);
console.log(`P2 vncPreview('sess-other-42') raw: ${JSON.stringify(p2urlOther)}`);
console.log(`P2 builder direct (subpath endpoint) raw: ${JSON.stringify(p2direct)}`);
console.log(`P2 spy raw: client calls before=${spyBefore} after=${spyAfter}`);
const p2ok =
  JSON.stringify(p2url) === '{"url":"https://vm.example.com/vnc/sess-9f14c2aa"}' &&
  JSON.stringify(p2urlOther) === '{"url":"https://vm.example.com/vnc/sess-other-42"}' &&
  JSON.stringify(p2direct) === '{"url":"https://vm.example.com/remote/vnc/sess-sub"}' &&
  spyBefore === spyAfter;
check(
  'P2 VNC preview: vncPreview() builds <endpoint>/vnc/<sessionId> (default = current session, explicit session id also accepted; subpath endpoints compose deterministically); the builder is PURE — the injected client spy counter is byte-identical before/after (zero network calls)',
  p2ok,
  `url=${JSON.stringify(p2url)} other=${JSON.stringify(p2urlOther)} spyUnchanged=${spyBefore === spyAfter}`
);
console.log('');

// ---------------------------------------------------------------------------
// P3 — inline credential in connect config -> E_INLINE_KEY_REFUSED. Show all
//      three refusal shapes; refused connects mutate nothing (survival).
// ---------------------------------------------------------------------------
const p3field = errOf(() => remote.connect({ endpoint: ENDPOINT, credentials: { apiKey: 'sk-live-should-not-exist' } }));
const p3value = errOf(() => remote.connect({ endpoint: ENDPOINT, credentials: { vm: 'sk-live-plain-secret' } }));
const p3url = errOf(() => remote.connect({ endpoint: 'https://admin:hunter2@vm.example.com', credentials: KEYREF_CREDS }));
const p3survived = remote.session();
console.log(`P3 credential-named field raw: ${JSON.stringify(p3field)}`);
console.log(`P3 non-keyRef value raw: ${JSON.stringify(p3value)}`);
console.log(`P3 endpoint userinfo raw: ${JSON.stringify(p3url)}`);
console.log(`P3 survival raw: session after refused connects = ${JSON.stringify(p3survived)}`);
const p3ok =
  p3field !== null && p3field.code === 'E_INLINE_KEY_REFUSED' &&
  p3value !== null && p3value.code === 'E_INLINE_KEY_REFUSED' &&
  p3url !== null && p3url.code === 'E_INLINE_KEY_REFUSED' &&
  JSON.stringify(p3survived) === JSON.stringify({ sessionId: 'sess-9f14c2aa', endpoint: ENDPOINT });
check(
  'P3 inline credential refusal: a credential-named field (apiKey: "sk-live-…"), a value that is not a keyRef (vm: "sk-live-plain-secret"), and userinfo embedded in the endpoint (admin:hunter2@host) are ALL refused with E_INLINE_KEY_REFUSED per the Phase 27 keyRef discipline; every refused connect leaves the P1 session untouched',
  p3ok,
  `field=${p3field.code} value=${p3value.code} endpoint=${p3url.code} survived=${JSON.stringify(p3survived)}`
);
console.log('');

// ---------------------------------------------------------------------------
// P4 — unconfigured -> E_REMOTE_UNAVAILABLE on connect/execute/screenshot
//      (and vncPreview). Show the refusals. A client that misses the REST
//      surface is refused with E_INVALID_ARGUMENT (misuse).
// ---------------------------------------------------------------------------
const p4detach = remote.detach();
const p4connect = errOf(() => remote.connect({ endpoint: ENDPOINT, credentials: KEYREF_CREDS }));
const p4execute = errOf(() => remote.execute(CLICK));
const p4screenshot = errOf(() => remote.screenshot());
const p4vnc = errOf(() => remote.vncPreview('sess-9f14c2aa'));
console.log(`P4 detach raw: ${JSON.stringify(p4detach)}`);
console.log(`P4 connect raw: ${JSON.stringify(p4connect)}`);
console.log(`P4 execute raw: ${JSON.stringify(p4execute)}`);
console.log(`P4 screenshot raw: ${JSON.stringify(p4screenshot)}`);
console.log(`P4 vncPreview raw: ${JSON.stringify(p4vnc)}`);
const badClient = errOf(() => remote.configure({ client: {} }));
console.log(`P4 bad-client configure raw: ${JSON.stringify(badClient)}`);
const p4ok =
  JSON.stringify(p4detach) === '{"detached":true}' &&
  p4connect !== null && p4connect.code === 'E_REMOTE_UNAVAILABLE' &&
  p4execute !== null && p4execute.code === 'E_REMOTE_UNAVAILABLE' &&
  p4screenshot !== null && p4screenshot.code === 'E_REMOTE_UNAVAILABLE' &&
  p4vnc !== null && p4vnc.code === 'E_REMOTE_UNAVAILABLE' &&
  badClient !== null && badClient.code === 'E_INVALID_ARGUMENT' &&
  badClient.details !== null && JSON.stringify(badClient.details.missing) === JSON.stringify(['connect', 'screenshot', 'execute']);
check(
  'P4 unconfigured remote: after detach, connect, execute, screenshot, and vncPreview ALL refuse with E_REMOTE_UNAVAILABLE — nothing is faked in a sandbox with no remote; configuring an object that misses the REST surface (connect/screenshot/execute) is refused with E_INVALID_ARGUMENT listing the missing methods (misuse discipline)',
  p4ok,
  `connect=${p4connect.code} execute=${p4execute.code} screenshot=${p4screenshot.code} vnc=${p4vnc.code} badClient=${badClient.code} missing=${JSON.stringify(badClient.details && badClient.details.missing)}`
);
console.log('');

// ---------------------------------------------------------------------------
// P5 — remote error returned by stub -> E_REMOTE_ERROR with the code/reason
//      carried: connect throws (details), screenshot throws (details),
//      execute returns the Scope B envelope (returned-failure layering).
// ---------------------------------------------------------------------------
const stubE = makeStub({
  executeResult: () => ({ ok: false, error: { code: 'VM_NOT_RUNNING', message: 'vm is not running' } }),
  screenshotResult: () => ({ error: { code: 'SCREENSHOT_FAILED', message: 'vnc capture failed' } }),
});
remote.configure({ client: stubE });
const p5conn = remote.connect({ endpoint: ENDPOINT, credentials: KEYREF_CREDS });
const p5execEnv = remote.execute(CLICK);
const p5shot = errOf(() => remote.screenshot());
console.log(`P5 connect raw: ${JSON.stringify(p5conn)}`);
console.log(`P5 execute envelope raw: ${JSON.stringify(p5execEnv)}`);
console.log(`P5 screenshot throw raw: ${JSON.stringify(p5shot)}`);
const stubC = makeStub({ connectResult: () => ({ error: { code: 'AUTH_FAILED', message: 'bad keyRef credentials' } }) });
remote.configure({ client: stubC });
const p5connectErr = errOf(() => remote.connect({ endpoint: ENDPOINT, credentials: KEYREF_CREDS }));
const p5survived = remote.session();
console.log(`P5 connect-error throw raw: ${JSON.stringify(p5connectErr)}`);
console.log(`P5 survival raw: session after refused connect = ${JSON.stringify(p5survived)}`);
const p5ok =
  JSON.stringify(p5conn) === '{"sessionId":"sess-9f14c2aa"}' &&
  JSON.stringify(p5execEnv) === JSON.stringify({ ok: false, error: { code: 'E_REMOTE_ERROR', message: 'VM_NOT_RUNNING: vm is not running' } }) &&
  p5shot !== null && p5shot.code === 'E_REMOTE_ERROR' &&
  p5shot.details !== null && p5shot.details.code === 'SCREENSHOT_FAILED' &&
  p5shot.details.reason === 'vnc capture failed' && p5shot.details.sessionId === 'sess-9f14c2aa' &&
  p5connectErr !== null && p5connectErr.code === 'E_REMOTE_ERROR' &&
  p5connectErr.details !== null && p5connectErr.details.code === 'AUTH_FAILED' &&
  p5connectErr.details.reason === 'bad keyRef credentials' &&
  JSON.stringify(p5survived) === JSON.stringify({ sessionId: 'sess-9f14c2aa', endpoint: ENDPOINT });
check(
  'P5 remote errors: the remote\u2019s own code/reason are carried on E_REMOTE_ERROR in all three surfaces — execute RETURNS the Scope B envelope { ok:false, error:{ code:"E_REMOTE_ERROR", message:"VM_NOT_RUNNING: vm is not running" } } (returned-failure layering, the loop records one failed step); screenshot THROWS with details { code:"SCREENSHOT_FAILED", reason:"vnc capture failed", sessionId }; a refused connect (AUTH_FAILED) throws E_REMOTE_ERROR and leaves the previous session attached',
  p5ok,
  `execEnvelope=${JSON.stringify(p5execEnv.error)} shot=${p5shot.code}(${p5shot.details && p5shot.details.code}) connectErr=${p5connectErr.code}(${p5connectErr.details && p5connectErr.details.code}) survived=${p5survived.sessionId}`
);
console.log('');

// ---------------------------------------------------------------------------
// P6 — Operator contract compliance: the remote facade satisfies Scope B
//      assertOperator, carries the same capability table as the desktop
//      operator, and dispatches the same envelope shapes (misuse -> thrown
//      E_INVALID_ARGUMENT on both; results in the { ok, ... } envelope
//      family on both).
// ---------------------------------------------------------------------------
const stubG = makeStub();
remote.configure({ client: stubG });
remote.connect({ endpoint: ENDPOINT, credentials: KEYREF_CREDS });
const deskOp = createDesktopOperator();
const p6assert = remote.assert();
const p6deskAssert = deskOp.assert();
const p6capsSame = JSON.stringify(remote.capabilities) === JSON.stringify(deskOp.capabilities);
const p6keysSame = JSON.stringify(Object.keys(remote.capabilities)) === JSON.stringify([...OPERATOR_CAPABILITY_KEYS]);
const p6remoteMisuse = errOf(() => remote.execute({}));
const p6deskMisuse = errOf(() => deskOp.execute({}));
const p6remoteOk = remote.execute(CLICK);
const p6deskEnv = deskOp.execute(CLICK);
console.log(`P6 assert raw: remote.assert=${p6assert} desktop.assert=${p6deskAssert}`);
console.log(`P6 capabilities raw: remote=${JSON.stringify(remote.capabilities)} desktop=${JSON.stringify(deskOp.capabilities)} equal=${p6capsSame} keysMatchScopeB=${p6keysSame}`);
console.log(`P6 misuse raw: remote.execute({})->${p6remoteMisuse && p6remoteMisuse.code} desktop.execute({})->${p6deskMisuse && p6deskMisuse.code}`);
console.log(`P6 envelopes raw: remote.ok=${JSON.stringify(p6remoteOk)} desktop.keys=${JSON.stringify(Object.keys(p6deskEnv))} remote.keys=${JSON.stringify(Object.keys(p6remoteOk))}`);
const p6ok =
  p6assert === true && p6deskAssert === true &&
  p6capsSame && p6keysSame &&
  p6remoteMisuse !== null && p6remoteMisuse.code === 'E_INVALID_ARGUMENT' &&
  p6deskMisuse !== null && p6deskMisuse.code === 'E_INVALID_ARGUMENT' &&
  JSON.stringify(p6remoteOk) === JSON.stringify({ ok: true, result: { acted: 'click', at: 'remote-vm' } }) &&
  Array.isArray(Object.keys(p6deskEnv)) && Object.keys(p6deskEnv)[0] === 'ok' &&
  Object.keys(p6deskEnv)[1] === 'error' && Object.keys(p6remoteOk)[0] === 'ok';
check(
  'P6 Scope B compliance: assertOperator(remote) passes on the facade itself (name + capabilities + screenshot/execute/assert); the capability table is byte-equal to the desktop operator\u2019s ({screenshot,mouse,keyboard,desktop:true, mobile:false}) and its key set matches OPERATOR_CAPABILITY_KEYS; misuse ({}) throws E_INVALID_ARGUMENT on BOTH operators; results ride the same { ok, ... } envelope family (remote { ok:true, result }; desktop in this sandbox returns its no-display { ok:false, error } envelope)',
  p6ok,
  `assert=${p6assert} capsEqual=${p6capsSame} keysMatch=${p6keysSame} misuse=${p6remoteMisuse.code}/${p6deskMisuse.code} remoteEnvelope=${JSON.stringify(p6remoteOk)}`
);
console.log('');

// ---------------------------------------------------------------------------
// P7 — Determinism: same connect args + same execute action twice ->
//      byte-identical results (fresh stub per pass, fresh session).
// ---------------------------------------------------------------------------
function j7pass() {
  remote.detach();
  const stubD = makeStub();
  remote.configure({ client: stubD });
  const c = JSON.stringify(remote.connect({ endpoint: ENDPOINT, credentials: KEYREF_CREDS }));
  const e = JSON.stringify(remote.execute(CLICK));
  const s = JSON.stringify(remote.screenshot());
  return { c, e, s };
}
const passA = j7pass();
const passB = j7pass();
const p7keys = ['c', 'e', 's'];
const p7identical = p7keys.map((k) => passA[k] === passB[k]);
console.log(`P7 pass A raw: connect=${passA.c} execute=${passA.e} screenshot=${passA.s}`);
console.log(`P7 pass B raw: identical=${JSON.stringify(p7identical)} (all three byte comparisons)`);
const p7ok = p7identical.every(Boolean);
check(
  'P7 determinism: two independent passes of the same connect args and the same execute action (plus the same screenshot call) through identically-built injected stubs produce byte-identical results in all three comparisons — the remote surface is a pure function of (injected client, arguments), no clock, no randomness',
  p7ok,
  `connectSha=${sha16(passA.c)} executeSha=${sha16(passA.e)} screenshotSha=${sha16(passA.s)} identical=${JSON.stringify(p7identical)}`
);
console.log('');

// ---------------------------------------------------------------------------
// P8 — Zone check: git status shows ONLY this scope's paths
// ---------------------------------------------------------------------------
const st = spawnSync('git', ['status', '--short'], { cwd: WT, encoding: 'utf8' });
const lines = st.stdout.split('\n').filter((l) => l.trim() !== '');
console.log('P8 git status --short raw:');
console.log(st.stdout.trim());
const ALLOWED = ['computer/', 'scripts/phase29-'];
const zoneOk = lines.every((l) => {
  const status = l.slice(0, 2); // '??', ' M', 'A ', ... — in-zone entries are legitimate
  const p = l.slice(3).trim();
  return ALLOWED.some((a) => p === a || p.startsWith(a)) && status.trim().length > 0;
});
check(
  'P8 zone discipline: only computer/** + scripts/phase29-* in git status (no Scope A-I file touched; providers/profiles read-only)',
  zoneOk,
  `${lines.length} path(s): ${lines.map((l) => l.slice(3).trim()).join(' | ')}`
);
console.log('');

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log('---------------------------------------------');
console.log(`SCOPE J: ${8 - failures}/8 PASS, ${failures} FAIL`);
if (failures > 0) process.exit(1);
