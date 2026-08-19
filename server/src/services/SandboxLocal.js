/**
 * B135 — SANDBOX LOCAL (DeepSeek Harness `packages/sandbox/sandbox-local` +
 * `e2b` mirror).
 *
 * Local sandbox backend for JEXI's deployments:
 *   - probes confinement once at boot (Linux bwrap → Landlock chain), and
 *     FAILS CLOSED: when no OS confinement is usable the provider reports
 *     `enforcement: 'in-process'` instead of pretending commands are
 *     OS-wrapped;
 *   - the in-process fence is JEXI's real gate: SandboxMode per-session
 *     policy (read-only | workspace-write | danger-full-access) enforced by
 *     ToolRuntime tier checks + plan-mode gates — the same fail-closed rule
 *     set dsh applies at its seam;
 *   - provisions a PRIVATE per-session temp directory (dsh
 *     `workspaceWriteSid`/`tempWriteSid` analog): every conversation gets its
 *     own writable scratch root, revoked when the session's temp budget is
 *     reaped (age cap);
 *   - reports enforcement facts (`enforcement`, `wrappers`) so consumers and
 *     /api/sandbox can distinguish bwrap-wrapped runs from in-process gates.
 */

import { spawnSync } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { DATA_DIR, WORKSPACE_DIR } from '../config.js';
import { effectiveSandboxMode, sandboxDenial } from './SandboxMode.js'; // B142 — per-session mode for bash-sandbox facts

const TEMP_ROOT = path.join(DATA_DIR, 'sandbox-tmp');
const TEMP_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24h
const TEMP_MAX_COUNT = 64;

/* ------------------------------------------------------------------ */
/* Confinement probe (once per server lifetime)                        */
/* ------------------------------------------------------------------ */

let probeResult = null;

/** Probe the local confinement chain once; fail-closed when unusable. */
export function probeConfinement() {
  if (probeResult) return probeResult;
  const facts = { platform: process.platform, wrappers: [], enforcement: 'in-process', notes: [] };

  if (process.platform === 'linux') {
    for (const runner of ['bwrap']) {
      const check = spawnSync('which', [runner], { encoding: 'utf8' });
      if (check.status === 0) {
        // Verify it can actually start (some containers ship a stub).
        const smoke = spawnSync(runner, ['--version'], { encoding: 'utf8', timeout: 5000 });
        if (smoke.status === 0) {
          facts.wrappers.push({ name: runner, usable: true, version: String(smoke.stdout || smoke.stderr || '').trim().slice(0, 80) });
        } else {
          facts.wrappers.push({ name: runner, usable: false, note: 'present but does not start in this container' });
        }
      }
    }
    if (facts.wrappers.some((w) => w.usable)) facts.enforcement = 'bwrap';
    else facts.notes.push('no usable OS sandbox runner — enforcement is the in-process ToolRuntime/SandboxMode fence (fail-closed)');
  } else {
    facts.notes.push(`no OS confinement probed on ${process.platform} — enforcement is the in-process fence`);
  }

  probeResult = { ...facts, probedAt: Date.now() };
  return probeResult;
}

/** Build bwrap wrap arguments for a file-effect policy (dsh profiles mirror). */
export function bwrapProfileArgs(policy) {
  const args = ['--ro-bind', '/', '/', '--dev', '/dev', '--proc', '/proc', '--die-with-parent'];
  if (policy && policy.mode === 'workspace-write') {
    args.push('--tmpfs', '/tmp', '--bind', policy.workspaceRoot, policy.workspaceRoot);
  }
  return args;
}

/**
 * Confine a command argv under the policy. Fail-closed: when no usable OS
 * runner exists, returns { confined: false, enforcement: 'in-process' } —
 * callers must apply the in-process fence (sandboxDenial) instead.
 */
export function confine(argv, policy = { mode: 'read-only' }) {
  const facts = probeConfinement();
  if (facts.enforcement !== 'bwrap' || !Array.isArray(argv) || argv.length === 0) {
    return { confined: false, enforcement: facts.enforcement, argv };
  }
  const wrapped = ['bwrap', ...bwrapProfileArgs(policy), '--', ...argv];
  return { confined: true, enforcement: 'bwrap', argv: wrapped };
}

/* ------------------------------------------------------------------ */
/* Per-session private temp directories (dsh tempWriteSid analog)      */
/* ------------------------------------------------------------------ */

/** The private temp dir for one conversation (created on first use). */
export function sandboxTempDir(convId) {
  const id = String(convId || 'default').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 48);
  const dir = path.join(TEMP_ROOT, `sess-${id}`);
  try {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    reapOldTempDirs();
    return { ok: true, dir };
  } catch (e) {
    return { ok: false, error: (e && e.message) || String(e) };
  }
}

/** Revoke a session's private temp dir. */
export function revokeSandboxTempDir(convId) {
  const id = String(convId || 'default').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 48);
  const dir = path.join(TEMP_ROOT, `sess-${id}`);
  try {
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
    return { ok: true, dir };
  } catch (e) {
    return { ok: false, error: (e && e.message) || String(e) };
  }
}

/** Reap stale private temp dirs (age cap + count cap). */
export function reapOldTempDirs() {
  try {
    if (!fs.existsSync(TEMP_ROOT)) return;
    const entries = fs.readdirSync(TEMP_ROOT, { withFileTypes: true }).filter((e) => e.isDirectory());
    const now = Date.now();
    for (const e of entries) {
      try {
        const stat = fs.statSync(path.join(TEMP_ROOT, e.name));
        if (now - stat.mtimeMs > TEMP_MAX_AGE_MS) fs.rmSync(path.join(TEMP_ROOT, e.name), { recursive: true, force: true });
      } catch { /* noop */ }
    }
    const remaining = fs.readdirSync(TEMP_ROOT, { withFileTypes: true }).filter((e) => e.isDirectory()).sort((a, b) => {
      try { return fs.statSync(path.join(TEMP_ROOT, a.name)).mtimeMs - fs.statSync(path.join(TEMP_ROOT, b.name)).mtimeMs; } catch { return 0; }
    });
    while (remaining.length > TEMP_MAX_COUNT) {
      const victim = remaining.shift();
      try { fs.rmSync(path.join(TEMP_ROOT, victim.name), { recursive: true, force: true }); } catch { /* noop */ }
    }
  } catch { /* noop */ }
}

/** Full sandbox facts for /api/sandbox. */
export function sandboxFacts(convId = null) {
  const facts = probeConfinement();
  const tempDirs = (() => {
    try {
      if (!fs.existsSync(TEMP_ROOT)) return [];
      return fs.readdirSync(TEMP_ROOT, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => ({ session: e.name, ageMs: (() => { try { return Date.now() - fs.statSync(path.join(TEMP_ROOT, e.name)).mtimeMs; } catch { return -1; } })() }));
    } catch { return []; }
  })();
  return {
    ...facts,
    tempRoot: TEMP_ROOT,
    tempDirs,
    currentSessionTemp: convId ? (sandboxTempDir(convId).dir || null) : null,
  };
}

/** Private scratch for one tool call (unused name kept for API symmetry). */
export function freshScratchName() {
  return `scratch-${crypto.randomUUID().slice(0, 12)}`;
}

/* ------------------------------------------------------------------ */
/* B142 — bash-sandbox (dsh shell/bash-sandbox mirror) + e2b facts    */
/* ------------------------------------------------------------------ */

/**
 * Resolve the per-call sandbox policy for one session and report the facts
 * the tool layer attaches to results (dsh SandboxBashExecutor):
 *   { mode, enforcement, denied: {blocked, reason}? }
 * denyForTier uses SandboxMode's sandboxDenial so read-only/workspace-write
 * modes gate exec-tier runs exactly like every other tool.
 */
export function sandboxPolicyFor({ mode, tier = 'exec', convId = null }) {
  const m = mode || effectiveSandboxMode(convId || 'default');
  const denial = sandboxDenial(m, tier);
  const facts = probeConfinement();
  const policy = {
    mode: m,
    enforcement: denial ? 'denied' : facts.enforcement,
    workspaceRoot: WORKSPACE_DIR || process.cwd(),
  };
  if (denial) policy.denied = denial;
  return policy;
}

/** e2b-style sandbox-as-a-service status facts (dsh e2b mirror). */
export function e2bStatus() {
  const facts = probeConfinement();
  const remoteUrl = process.env.E2B_URL || null;
  return {
    ok: true,
    service: 'e2b-compatible',
    mode: 'local',
    remoteConfigured: !!remoteUrl,
    remoteUrl: remoteUrl ? String(remoteUrl).replace(/\/+$/, '') : null,
    enforcement: facts.enforcement,
    wrappers: facts.wrappers,
    notes: facts.notes,
    tempRoot: TEMP_ROOT,
  };
}
