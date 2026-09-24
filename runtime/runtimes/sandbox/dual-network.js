/**
 * JEXI OS — Phase 8 Scope E — DUAL-NETWORK RUNTIME.
 *
 * Brings up the two isolation domains and owns the sandbox-side execution:
 *
 *   DOCKER mode  — real `docker network create --internal …` for both
 *                  networks (networks[].dockerCreateArgs), containers per
 *                  compose.yaml. Requires a Docker daemon; refuses loudly
 *                  (DockerUnavailableError) rather than faking anything.
 *
 *   PROCESS mode — this sandbox (no Docker): isolation domain = child
 *                  process with (a) a SCRUBBED environment — credentials do
 *                  NOT propagate (probe P8), (b) a dedicated workspace
 *                  mount as cwd — the only fs the child sees as "its" area,
 *                  (c) the dial guard — cross-network dials are refused by
 *                  policy with a specific reason (probes P2/P3).
 *                  Same policy surface as docker mode, weaker enforcement
 *                  plane. DOCKER_VS_PROCESS documents the delta honestly.
 */

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { NETWORKS, JEXI_NET, SANDBOX_NET, validateNetworkId, isCrossNetwork, DOCKER_VS_PROCESS } from './networks.js';
import { AuditLog } from './audit.js';
import { ALLOWED_BINARIES } from '../../../security/exec-bridge/allowlist.js';

export const RUNTIME_VERSION = '1.0.0';

/** Thrown by docker mode when no daemon is reachable — never silently degraded. */
export class DockerUnavailableError extends Error {
  constructor(detail) {
    super(`DockerUnavailableError: Docker daemon not available — ${detail}. The dual-network runtime refuses to fake Docker; use mode 'process' (documented, weaker enforcement) or provision a daemon.`);
    this.name = 'DockerUnavailableError';
    this.code = 'E_DOCKER_UNAVAILABLE';
  }
}

/** True only when a Docker daemon answers `docker info`. */
export function dockerAvailable() {
  try {
    const r = spawnSync('docker', ['info', '--format', '{{.ServerVersion}}'], { encoding: 'utf8', timeout: 10_000 });
    return r.status === 0;
  } catch {
    return false;
  }
}

export class DualNetworkRuntime {
  /**
   * @param {object} o
   * @param {'auto'|'docker'|'process'} [o.mode]
   * @param {string}  o.workspaceMount absolute dir sandbox-net may use as cwd/fs
   * @param {string}  o.stateDir       absolute dir for runtime state (env, audit)
   */
  constructor({ mode = 'auto', workspaceMount, stateDir } = {}) {
    if (!workspaceMount || !path.isAbsolute(workspaceMount)) {
      throw new Error(`DualNetworkRuntime: absolute workspaceMount required — got ${JSON.stringify(workspaceMount)}`);
    }
    if (!stateDir || !path.isAbsolute(stateDir)) {
      throw new Error(`DualNetworkRuntime: absolute stateDir required — got ${JSON.stringify(stateDir)}`);
    }
    this.requestedMode = mode;
    this.workspaceMount = path.resolve(workspaceMount);
    this.stateDir = path.resolve(stateDir);
    this.mode = null;
    this.networks = [];
    this.sandboxEnv = null;
    this.sandboxHome = null;
    this.children = new Map(); // pid → { child, meta }
    this.audit = null;
    this.bridge = null;       // attached by the facade (createDualNetwork)
    this.up = null;           // status snapshot from bringUp()
  }

  /** Resolve the effective mode ('auto' probes Docker once). */
  resolveMode() {
    if (this.mode) return this.mode;
    if (this.requestedMode === 'docker') {
      if (!dockerAvailable()) throw new DockerUnavailableError('mode explicitly requested docker');
      this.mode = 'docker';
    } else if (this.requestedMode === 'process') {
      this.mode = 'process';
    } else {
      this.mode = dockerAvailable() ? 'docker' : 'process';
    }
    return this.mode;
  }

  /**
   * Bring up both networks.
   * Docker mode: `docker network create --internal …` ×2 — REAL calls, and
   * if they fail the error is raw (no simulation). Process mode: policy
   * domains + scrubbed env, all state under stateDir.
   */
  bringUp() {
    const mode = this.resolveMode();
    fs.mkdirSync(this.workspaceMount, { recursive: true });
    fs.mkdirSync(this.stateDir, { recursive: true });
    this.audit = this.audit || new AuditLog({ file: path.join(this.stateDir, 'runtime-audit.jsonl'), source: 'dual-network-runtime' });

    if (mode === 'docker') {
      for (const net of NETWORKS) {
        const r = spawnSync('docker', net.dockerCreateArgs, { encoding: 'utf8', timeout: 30_000 });
        if (r.status !== 0 && !/already exists/i.test(String(r.stderr || ''))) {
          throw new Error(`docker network create failed for ${net.id}: ${String(r.stderr || r.stdout || 'no output').trim()}`);
        }
      }
    }

    this.sandboxHome = path.join(this.stateDir, 'sandbox-home');
    fs.mkdirSync(this.sandboxHome, { recursive: true });
    this.sandboxEnv = this.buildSandboxEnv();
    this.networks = NETWORKS.map((n) => ({
      id: n.id,
      role: n.role,
      subnet: n.subnet,
      internal: n.internal,
      status: 'active',
      driver: mode === 'docker' ? 'docker (--internal)' : 'process-isolation (Docker unavailable)',
      members: [...n.members],
    }));

    this.up = {
      mode,
      networks: this.networks,
      onlyPath: 'exec-bridge',
      workspaceMount: this.workspaceMount,
      stateDir: this.stateDir,
      dockerNote: mode === 'docker' ? null : 'NOT VERIFIED FROM SOURCE — Docker not available in this sandbox; process-level isolation in effect (see DOCKER_VS_PROCESS)',
    };
    return this.up;
  }

  /**
   * The scrubbed sandbox-net environment. ONLY the listed keys propagate —
   * every credential, token, API key, and jexi-net endpoint is absent by
   * construction (probe P8 proves it against a planted secret).
   */
  buildSandboxEnv() {
    const env = {
      PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin',
      HOME: this.sandboxHome,
      TMPDIR: path.join(this.stateDir, 'sandbox-tmp'),
      LANG: process.env.LANG || 'C.UTF-8',
      SANDBOX_NET: SANDBOX_NET,
      JEXI_NETWORK_MODE: this.mode || 'process',
      JEXI_SANDBOX_WORKSPACE: this.workspaceMount,
    };
    fs.mkdirSync(env.TMPDIR, { recursive: true });
    return env;
  }

  /** The host env keys that do NOT cross into sandbox-net (evidence helper for P8). */
  withheldEnvKeys() {
    return Object.keys(process.env).filter((k) => !(k in this.buildSandboxEnv()));
  }

  /**
   * Dial guard — the routing policy plane.
   * Cross-network dials are refused with a specific reason; same-network
   * dials are allowed (the caller still performs a real connect).
   */
  dialGuard({ from, to }) {
    validateNetworkId(from);
    validateNetworkId(to);
    if (isCrossNetwork(from, to)) {
      return {
        allowed: false,
        rule: 'NO_ROUTE',
        reason: `no route between ${from} and ${to} — zero shared routes, no DNS, no port exposure; the only path is the exec-bridge`,
      };
    }
    return { allowed: true, rule: null, reason: `same network (${from})` };
  }

  /**
   * Spawn one sandbox-net child (process mode): scrubbed env, workspace
   * cwd, no shell. Tracked for clean shutdown (probe P11).
   */
  spawnSandbox({ binary, args = [], timeoutMs = 120_000, onSpawn = null }) {
    if (this.mode === 'docker') throw new Error('spawnSandbox is the process-mode executor; docker mode executes in containers');
    if (!ALLOWED_BINARIES.includes(binary)) {
      return Promise.resolve({ exitCode: 126, stdout: '', stderr: `binary ${binary} not on allowlist`, timedOut: false });
    }
    return new Promise((resolve) => {
      const child = spawn(binary, args.map(String), {
        cwd: this.workspaceMount,
        env: this.sandboxEnv,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const meta = { pid: child.pid, binary, args: args.map(String), startedAt: new Date().toISOString() };
      this.children.set(child.pid, { child, meta, onSpawn });
      if (onSpawn) onSpawn(meta);
      let stdout = '';
      let stderr = '';
      const timer = setTimeout(() => {
        try { child.kill('SIGKILL'); } catch { /* already gone */ }
        meta.timedOut = true;
      }, timeoutMs);
      child.stdout.on('data', (d) => { stdout += d; });
      child.stderr.on('data', (d) => { stderr += d; });
      child.on('close', (code, signal) => {
        clearTimeout(timer);
        this.children.delete(child.pid);
        resolve({
          exitCode: code === null ? (signal ? 128 + 15 : -1) : code,
          stdout,
          stderr,
          timedOut: Boolean(meta.timedOut),
          pid: child.pid,
          signal: signal || null,
        });
      });
      child.on('error', (err) => {
        clearTimeout(timer);
        this.children.delete(child.pid);
        resolve({ exitCode: 127, stdout, stderr: String(err && err.message ? err.message : err), timedOut: false, pid: child.pid, signal: null });
      });
    });
  }

  /** Live child pids (probe P11 — must be empty after down()). */
  livePids() {
    return [...this.children.keys()];
  }

  /** List the runtime state in a probe-friendly shape. */
  status() {
    return {
      version: RUNTIME_VERSION,
      requestedMode: this.requestedMode,
      mode: this.mode,
      up: this.up,
      networks: this.networks,
      liveChildren: this.livePids(),
      audit: this.audit ? this.audit.stats() : null,
      workspaceMount: this.workspaceMount,
      stateDir: this.stateDir,
      dockerDelta: DOCKER_VS_PROCESS,
    };
  }

  /**
   * Tear down both networks (probe P11). Process mode: SIGTERM → grace →
   * SIGKILL every tracked child; docker mode: docker network rm ×2 (real).
   * Returns the shutdown receipt.
   */
  async down({ graceMs = 500 } = {}) {
    const killed = [];
    for (const [pid, { child }] of this.children) {
      try { child.kill('SIGTERM'); } catch { /* already gone */ }
      killed.push(pid);
    }
    const deadline = Date.now() + graceMs;
    while (this.children.size && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50));
    }
    for (const [pid, { child }] of this.children) {
      try { child.kill('SIGKILL'); } catch { /* already gone */ }
    }
    this.children.clear();

    if (this.mode === 'docker') {
      for (const net of NETWORKS) {
        const r = spawnSync('docker', ['network', 'rm', net.id], { encoding: 'utf8', timeout: 30_000 });
        if (r.status !== 0 && !/no such network/i.test(String(r.stderr || ''))) {
          throw new Error(`docker network rm failed for ${net.id}: ${String(r.stderr || r.stdout || 'no output').trim()}`);
        }
      }
    }

    this.networks = this.networks.map((n) => ({ ...n, status: 'torn-down' }));
    const receipt = {
      mode: this.mode,
      killedPids: killed,
      leftovers: this.livePids(),
      networks: this.networks.map((n) => ({ id: n.id, status: n.status })),
      auditEntries: this.audit ? this.audit.count() : 0,
      jexiNet: JEXI_NET,
      sandboxNet: SANDBOX_NET,
    };
    return receipt;
  }
}

export default DualNetworkRuntime;
