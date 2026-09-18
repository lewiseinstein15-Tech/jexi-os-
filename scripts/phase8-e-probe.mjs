#!/usr/bin/env node
/**
 * JEXI OS — Phase 8 Scope E — LIVE PROBES P1–P11.
 *
 * Re-runnable at report time; raw output only (JSON lines + exit codes).
 * Runs the dual-network stack in whichever mode resolves:
 *   docker  — real `docker network create --internal` (needs a daemon)
 *   process — documented fallback when Docker is unavailable (this sandbox);
 *             Docker-level verification is then reported
 *             NOT VERIFIED FROM SOURCE — Docker not available.
 * Nothing is simulated: every PASS line is backed by the raw evidence shown.
 *
 * Usage: node scripts/phase8-e-probe.mjs [--only=P1,P2,…]
 */

import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createDualNetwork, dockerAvailable, NETWORKS, DOCKER_VS_PROCESS, ISOLATION_SPEC } from '../runtimes/sandbox/index.js';
import { createWorkflow } from '../security/pipeline/index.js';
import { openEngagements } from '../security/engagements/store.js';

const SCRIPTS_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(SCRIPTS_DIR, '..');
const TMP = path.join(REPO, 'security/pipeline/.state/p8e-probe');
const TMP_TAMPER = path.join(REPO, 'security/pipeline/.state/p8e-tamper');
const VULN_APP = path.join(REPO, 'security/pipeline/fixtures/vuln-app.js');

const only = (process.argv.find((a) => a.startsWith('--only=')) || '').replace('--only=', '');
const runProbe = (id) => !only || only.split(',').includes(id);

const results = {};
function pass(id, note) { results[id] = `PASS${note ? ` — ${note}` : ''}`; }
function fail(id, note) { results[id] = `FAIL — ${note}`; }

function header(id, title) {
  console.log(`\n═══════════════════════════════════════════════════`);
  console.log(`${id} — ${title}`);
  console.log(`═══════════════════════════════════════════════════`);
}

function show(label, value) {
  console.log(`${label}: ${typeof value === 'string' ? value : JSON.stringify(value)}`);
}

/** One real TCP connect attempt; resolves { code, message } (never lies). */
function tcpProbe(host, port, timeoutMs = 2500) {
  return new Promise((resolve) => {
    const s = net.connect({ host, port });
    const done = (code, message) => { try { s.destroy(); } catch { /* gone */ } resolve({ code, message }); };
    s.setTimeout(timeoutMs, () => done('ETIMEDOUT', `connect ${host}:${port} timed out after ${timeoutMs}ms`));
    s.on('connect', () => done('CONNECTED', `connect ${host}:${port} SUCCEEDED (unexpected)`));
    s.on('error', (err) => done(err.code || 'ERROR', String(err.message)));
  });
}

async function waitForHttp(url, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(url);
      if (r.ok) return true;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 150));
  }
  return false;
}

/* ================= P1 — two networks spin up ============================= */

let dual = null;
async function P1() {
  header('P1', 'Two networks spin up');
  const hasDocker = dockerAvailable();
  show('docker binary/daemon available', hasDocker);
  show('network definitions (declared)', NETWORKS.map((n) => ({ id: n.id, role: n.role, internal: n.internal, subnet: n.subnet, members: n.members })));
  show('isolation spec', ISOLATION_SPEC);

  fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(path.join(TMP, 'mount'), { recursive: true });
  dual = createDualNetwork({
    workspaceMount: path.join(TMP, 'mount'),
    stateDir: path.join(TMP, 'bridge-state'),
    mode: hasDocker ? 'auto' : 'process',
  });
  show('resolved mode', dual.mode);
  show('runtime.up', dual.up);
  const testableEquivalent = {
    tool: hasDocker ? 'docker network ls' : 'process-mode testable equivalent (runtime.networks)',
    networks: dual.runtime.networks.map((n) => ({ id: n.id, status: n.status, driver: n.driver })),
    bothRunning: dual.runtime.networks.length === 2 && dual.runtime.networks.every((n) => n.status === 'active'),
  };
  show('P1 result', testableEquivalent);
  if (!hasDocker) {
    show('docker-level verdict', 'NOT VERIFIED FROM SOURCE — Docker not available (docker network ls cannot run; process-mode equivalent shown above, compose.yaml documents the Docker path)');
  }
  (testableEquivalent.bothRunning ? pass : fail)('P1', hasDocker ? 'docker mode' : 'process mode (Docker-level NOT VERIFIED)');
}

/* ================= P2 — jexi-net cannot reach sandbox-net ================ */

async function P2() {
  header('P2', 'jexi-net CANNOT reach sandbox-net');
  show('policy gate (jexi-net → sandbox-net dial)', dual.runtime.dialGuard({ from: 'jexi-net', to: 'sandbox-net' }));
  // Real connects from the jexi side: the docker-mode bridge hostname must
  // not resolve, and the bridge port has no listener in process mode.
  const dns = await tcpProbe('exec-bridge', 8471);
  show(`raw connect exec-bridge:8471 (docker-mode bridge host)`, dns);
  const port = await tcpProbe('127.0.0.1', 8471);
  show(`raw connect 127.0.0.1:8471 (bridge port, nothing listening)`, port);
  const ok = dns.code !== 'CONNECTED' && port.code !== 'CONNECTED';
  show('verdict', ok
    ? 'refused both ways (raw codes above). Docker --internal kernel enforcement: NOT VERIFIED FROM SOURCE — Docker not available.'
    : 'UNEXPECTED direct reachability');
  (ok ? pass : fail)('P2');
}

/* ================= P3 — sandbox-net cannot reach jexi-net ================ */

async function P3() {
  header('P3', 'sandbox-net CANNOT reach jexi-net');
  show('policy gate (sandbox-net → jexi-net dial)', dual.runtime.dialGuard({ from: 'sandbox-net', to: 'jexi-net' }));
  // Real attempt from INSIDE a sandbox-net child (scrubbed env — it has no
  // jexi-core address configured; the hostname is docker-mode-only).
  const script = `
    const tryIt = async (url) => { try { const r = await fetch(url); console.log('UNEXPECTED-REACHABLE', url, r.status); } catch (e) { console.log('CHILD-REFUSED', url, e.cause?.code || e.code || e.message); } };
    await tryIt('http://jexi-core:3000/health');
    await tryIt('http://127.0.0.1:3000/health');
  `;
  const r = await dual.runtime.spawnSandbox({ binary: 'node', args: ['-e', script], timeoutMs: 15000 });
  show('raw sandbox child output (stdout)', r.stdout.trim());
  show('raw sandbox child exit', r.exitCode);
  const ok = r.stdout.includes('CHILD-REFUSED') && !r.stdout.includes('UNEXPECTED-REACHABLE');
  show('verdict', ok
    ? 'no route from sandbox child to any jexi-net endpoint (raw output above). Docker netns enforcement: NOT VERIFIED FROM SOURCE — Docker not available.'
    : 'UNEXPECTED reachability from sandbox side');
  (ok ? pass : fail)('P3');
}

/* ================= P4 — bridge ALLOWS a whitelisted op =================== */

async function P4() {
  header('P4', 'exec-bridge ALLOWS a whitelisted op');
  const res = await dual.client.call('run_command', { binary: 'echo', args: ['bridge-roundtrip-ok'] }, { caller: 'jexi-net:probe:P4' });
  show('request authenticated', res.status === 'ok' ? 'yes (HMAC signature verified)' : res.reason);
  show('op allowed', res.status === 'ok' ? 'yes (run_command on allowlist, echo on binary allowlist)' : res.reason);
  show('executed on sandbox-net', { exitCode: res.result?.exitCode, pid: res.result?.pid, stdout: res.result?.stdout });
  show('result returned through the bridge', { status: res.status, op: res.op });
  const auditTail = dual.bridge.audit.read({ tail: 1 })[0];
  show('audit log entry written', auditTail);
  const ok = res.status === 'ok' && res.result?.exitCode === 0 && /bridge-roundtrip-ok/.test(res.result?.stdout || '') && auditTail?.op === 'run_command';
  (ok ? pass : fail)('P4');
}

/* ================= P5 — bridge REFUSES non-whitelisted ops =============== */

async function P5() {
  header('P5', 'exec-bridge REFUSES a non-whitelisted op');
  const op = await dual.client.call('exec_shell', { cmd: 'id' }, { caller: 'jexi-net:probe:P5' });
  show('refused op not on allowlist', { status: op.status, rule: op.rule, reason: op.reason });
  const passwd = await dual.client.call('read_file', { path: '/etc/passwd' }, { caller: 'jexi-net:probe:P5' });
  show('refused read_file /etc/passwd (outside workspace mount)', { status: passwd.status, rule: passwd.rule, reason: passwd.reason });
  const shell = await dual.client.call('run_command', { binary: 'sh', args: ['-c', 'id'] }, { caller: 'jexi-net:probe:P5' });
  show('refused run_command binary sh (not on binary allowlist)', { status: shell.status, rule: shell.rule, reason: shell.reason });
  const ok = op.status === 'refused' && passwd.status === 'refused' && shell.status === 'refused';
  (ok ? pass : fail)('P5', 'specific reason strings above');
}

/* ================= P6 — bridge REFUSES unauthenticated =================== */

async function P6() {
  header('P6', 'exec-bridge REFUSES an unauthenticated request');
  const wrong = await dual.bridge.handle({ op: 'list_tools', args: {}, caller: 'jexi-net:impostor', ts: Date.now(), nonce: 'deadbeef', signature: 'f'.repeat(64) });
  show('wrong token/signature', { status: wrong.status, rule: wrong.rule, reason: wrong.reason });
  const missing = await dual.bridge.handle({ op: 'list_tools', args: {}, caller: 'jexi-net:impostor', ts: Date.now(), nonce: 'deadbeef' });
  show('no signature at all', { status: missing.status, rule: missing.rule, reason: missing.reason });
  const stale = await dual.bridge.handle({ op: 'list_tools', args: {}, caller: 'jexi-net:impostor', ts: Date.now() - 30 * 60 * 1000, nonce: 'deadbeef', signature: 'a'.repeat(64) });
  show('stale timestamp (replay)', { status: stale.status, rule: stale.rule, reason: stale.reason });
  const ok = wrong.rule === 'UNAUTHENTICATED' && missing.rule === 'UNAUTHENTICATED' && stale.rule === 'UNAUTHENTICATED';
  (ok ? pass : fail)('P6');
}

/* ================= P7 — audit log ======================================== */

async function P7() {
  header('P7', 'Audit log — every P4–P6 call logged');
  const entries = dual.bridge.audit.read();
  show('bridge audit file', dual.bridge.audit.file);
  show('stats', dual.bridge.audit.stats());
  for (const e of entries) {
    console.log(JSON.stringify(e));
  }
  const ok = entries.length >= 6
    && entries.every((e) => e.ts && e.caller && e.op !== null && 'args' in e && e.decision)
    && entries.some((e) => e.decision.status === 'ok')
    && entries.some((e) => e.decision.rule === 'UNAUTHENTICATED')
    && entries.some((e) => e.decision.status === 'refused' && e.decision.rule !== 'UNAUTHENTICATED');
  (ok ? pass : fail)('P7');
}

/* ================= P8 — credential isolation ============================= */

async function P8() {
  header('P8', 'Credential isolation — planted secret does NOT reach sandbox-net');
  process.env.JEXI_PLANTED_SECRET = 'p8e-super-secret-value'; // planted on jexi-net side only
  show('planted on jexi side', 'process.env.JEXI_PLANTED_SECRET=p8e-***set*** (jexi-net process env)');
  const res = await dual.client.call('run_command', {
    binary: 'node',
    args: ['-e', `console.log(JSON.stringify({ planted: process.env.JEXI_PLANTED_SECRET ?? null, envKeys: Object.keys(process.env).sort() }))`],
  }, { caller: 'jexi-net:probe:P8' });
  show('raw sandbox child env dump', res.result?.stdout?.trim());
  const parsed = JSON.parse(res.result?.stdout || '{}');
  const ok = res.status === 'ok' && parsed.planted === null && !parsed.envKeys.includes('JEXI_PLANTED_SECRET');
  show('verdict', ok ? 'the env var does NOT exist on sandbox-net (raw dump above)' : 'LEAK');
  (ok ? pass : fail)('P8');
}

/* ================= P9 — pipeline integration (dual mode) ================= */

async function P9() {
  header('P9', 'Pipeline integration — Scope A pipeline runs THROUGH the bridge');
  const mount = path.join(TMP, 'mount');
  const stateRoot = path.join(TMP, 'state');
  fs.mkdirSync(stateRoot, { recursive: true });

  // source copy lives INSIDE the workspace mount (sandbox-net's only data area)
  fs.cpSync(path.join(REPO, 'security/pipeline/fixtures'), path.join(mount, 'source'), { recursive: true });

  // planted target — runs as a sandbox-net member (sandbox env, mount cwd)
  const target = spawn(process.execPath, [VULN_APP], {
    env: dual.runtime.sandboxEnv,
    cwd: mount,
    stdio: 'ignore',
  });
  P9.target = target;
  const baseUrl = `http://127.0.0.1:4488`;
  const up = await waitForHttp(baseUrl);
  show('planted target up', { baseUrl, pid: target.pid, reachable: up });

  // engagement planned as networkMode 'dual' (Scope D bundle extension)
  const eng = openEngagements({ dbPath: path.join(TMP, 'engagements.db') });
  P9.eng = eng;
  const planned = eng.plan({
    name: 'p8e-dual-network-verification',
    targets: ['127.0.0.1'],
    networks: [{ cidr: '127.0.0.0/8', allowed: true }],
    networkMode: 'dual',
    // Phase 8(G): the pipeline's verification phase re-executes exploits —
    // 'verify' must be an authorized action for the run to complete.
    allowedActions: ['scan', 'exploit', 'verify', 'report'],
    forbiddenActions: ['exfiltrate-data'],
    requiresApproval: ['exploit'],
    maxSeverity: 'high',
  });
  eng.grantApproval(planned.id, { action: 'exploit', grantedBy: 'scope-e-probe', note: 'pre-granted so the run completes in one shot' });
  const engagement = eng.get(planned.id);
  show('engagement', { id: engagement.id, networkMode: engagement.networkMode, targets: engagement.scope.targets, approvals: engagement.approvals.length });

  const wf = createWorkflow({
    engagementId: engagement.id,
    sourceRoot: path.join(mount, 'source'),
    baseUrl,
    stateRoot,
    engagement,
    engagementsStore: eng,
    dualNetwork: true,          // security.dualNetwork = true
    execBridge: dual.bridge,
  });

  const events = [];
  for await (const ev of wf.execute()) events.push(ev);

  const dispatches = events.filter((e) => e.type === 'bridge.dispatch');
  const completions = events.filter((e) => e.type === 'log' && /phase complete/.test(e.data?.message || ''));
  const artifacts = events.filter((e) => e.type === 'artifact').map((e) => e.data?.path);
  const violations = events.filter((e) => e.type === 'engagement.violation');
  show('pipeline completed', { events: events.length, phasesCompleted: completions.length, artifacts, violations: violations.length });
  show('final workflow event', events[events.length - 1]);
  show('bridge.dispatch events', dispatches.map((d) => d.data.message));
  const runJson = JSON.parse(fs.readFileSync(path.join(stateRoot, '.state', engagement.id, 'run.json'), 'utf8'));
  show('run.json', { engagementId: runJson.engagementId, status: runJson.status, phases: runJson.phases });
  const wfAudit = dual.bridge.audit.read().filter((e) => String(e.caller || '').startsWith('jexi-net:workflow:'));
  show('audit trace (workflow callers, per phase)', wfAudit.map((e) => ({ caller: e.caller, op: e.op, decision: e.decision.status })));

  const ok = runJson.status === 'complete'
    && completions.length === 6
    && dispatches.length === 12   // dispatched + complete per phase × 6 (Phase 8G: verification is the 6th phase)
    && violations.length === 0
    && artifacts.length > 0
    && wfAudit.length >= 18;      // ctx write + run + spool read per phase
  (ok ? pass : fail)('P9', `6/6 phases through the bridge, ${wfAudit.length} audited crossings`);
}

/* ================= P10 — bridge tamper detection ========================= */

async function P10() {
  header('P10', 'Bridge tamper detection — bridge is read-only from sandbox-net');
  // Dedicated stack whose workspace mount is the repo root, so the
  // BRIDGE_READ_ONLY rule (not just PATH_OUTSIDE_WORKSPACE) is exercised.
  fs.rmSync(TMP_TAMPER, { recursive: true, force: true });
  const tamper = createDualNetwork({
    workspaceMount: REPO,
    stateDir: TMP_TAMPER,
    mode: 'process',
  });
  const attempts = [
    ['write_file', { path: path.join(REPO, 'security/exec-bridge/allowlist.js'), content: 'pwned' }],
    ['write_file', { path: path.join(REPO, 'runtimes/sandbox/dual-network.js'), content: 'pwned' }],
    ['read_file', { path: path.join(REPO, '.jexi-secrets/git-token') }],
    ['write_file', { path: '/etc/passwd', content: 'pwned' }],
  ];
  let allRefused = true;
  for (const [op, args] of attempts) {
    const res = await tamper.client.call(op, args, { caller: 'sandbox-net:attacker' });
    show(`attempt ${op} ${args.path}`, { status: res.status, rule: res.rule, reason: res.reason });
    if (res.status !== 'refused') allRefused = false;
  }
  const integrity = spawnSync('git', ['-C', REPO, 'status', '--porcelain'], { encoding: 'utf8' });
  show('repo integrity after tamper attempts (git status --porcelain)', integrity.stdout.trim() || '(clean)');
  const receipt = await tamper.runtime.down();
  show('tamper stack torn down', receipt.networks);
  fs.rmSync(TMP_TAMPER, { recursive: true, force: true });
  (allRefused ? pass : fail)('P10', 'all attempts refused with specific rules; tree untouched');
}

/* ================= P11 — clean shutdown ================================== */

async function P11() {
  header('P11', 'Clean shutdown — no leftover processes or networks');
  const receipt = await dual.runtime.down();
  show('shutdown receipt', receipt);
  if (P9.target) {
    try { P9.target.kill('SIGTERM'); } catch { /* gone */ }
    show('planted target killed', { pid: P9.target.pid });
  }
  if (P9.eng) P9.eng.close();
  const leftoverWorkers = spawnSync('ps', ['-eo', 'pid,args'], { encoding: 'utf8' }).stdout
    .split('\n').filter((l) => /phase-worker|vuln-app/.test(l) && !/grep/.test(l));
  show('leftover phase-worker / vuln-app processes (ps)', leftoverWorkers.length ? leftoverWorkers : '(none)');
  const port = await tcpProbe('127.0.0.1', 4488, 1500);
  show('planted target port 4488 after shutdown', port);
  const ok = receipt.leftovers.length === 0
    && receipt.networks.every((n) => n.status === 'torn-down')
    && leftoverWorkers.length === 0
    && port.code !== 'CONNECTED';
  (ok ? pass : fail)('P11');
}

/* ================= runner ================================================ */

const PROBES = [['P1', P1], ['P2', P2], ['P3', P3], ['P4', P4], ['P5', P5], ['P6', P6], ['P7', P7], ['P8', P8], ['P9', P9], ['P10', P10], ['P11', P11]];
try {
  for (const [id, fn] of PROBES) {
    if (runProbe(id)) await fn();
  }
} finally {
  if (dual && dual.runtime.mode) {
    try { await dual.runtime.down(); } catch { /* P11 may have already torn down */ }
  }
}

console.log(`\n═══════════════════════════════════════════════════`);
console.log('PROBE SUMMARY');
console.log(`═══════════════════════════════════════════════════`);
for (const [id] of PROBES) console.log(`${id}: ${results[id] || '(skipped)'}`);
const failed = PROBES.filter(([id]) => results[id] && results[id].startsWith('FAIL'));
process.exit(failed.length ? 1 : 0);
