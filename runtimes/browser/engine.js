/**
 * JEXI OS — Phase 17 Scope A — OBSCURA BROWSER ENGINE.
 *
 * Replaces the Chromium desktop runtime as the browser engine: Obscura is a
 * Rust headless engine (~30 MB RSS cold, ~70 MiB binary) that speaks the Chrome
 * DevTools Protocol, so Playwright's `chromium.connectOverCDP()` and
 * browser-use's CDP transport drive it unchanged.
 *
 *   const engine = createObscuraEngine({ stealth: true });
 *   const up = await engine.start();          // spawns `obscura serve`
 *   up.cdpUrl                                 // ws://127.0.0.1:9222
 *   await engine.stop();
 *
 * Two transports, both real:
 *   process — spawn the `obscura` binary directly (used when the binary is on
 *             disk; the default in this sandbox)
 *   docker  — `docker run -p 127.0.0.1:9222:9222 h4ckf0r0day/obscura` (the
 *             documented deployment path; loopback-published only)
 *
 * ── NO CHROMIUM FALLBACK ────────────────────────────────────────────────────
 * If Obscura is unavailable this module FAILS (ObscuraUnavailableError). It
 * never silently starts Chromium instead — a silent engine swap would make
 * every downstream memory number and behaviour claim a lie. See fallback.js.
 *
 * Ports are published to 127.0.0.1 only. Obscura's SSRF guard blocks loopback,
 * RFC1918 and link-local targets by default (DNS-rebinding safe); navigating to
 * a private address requires opting in explicitly.
 */

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { buildStealthEnv, checkIdentityConsistency, STEALTH_CAPABILITIES } from './stealth.js';
import { ObscuraUnavailableError } from './fallback.js';

export const ENGINE_VERSION = '1.0.0';
export const DEFAULT_PORT = 9222;
export const DEFAULT_HOST = '127.0.0.1';
export const DOCKER_IMAGE = 'h4ckf0r0day/obscura:latest';

/** Directories searched for the `obscura` binary, in order. */
export const DEFAULT_SEARCH_PATHS = [
  process.env.OBSCURA_BIN,
  path.join(process.env.HOME || '', 'obscura', 'obscura'),
  '/usr/local/bin/obscura',
  '/usr/bin/obscura',
  '/opt/obscura/obscura',
].filter(Boolean);

/** True when a Docker daemon answers `docker info`. */
export function dockerAvailable() {
  try {
    const r = spawnSync('docker', ['info', '--format', '{{.ServerVersion}}'], { encoding: 'utf8', timeout: 10_000 });
    return r.status === 0;
  } catch {
    return false;
  }
}

/**
 * Locate the Obscura executable. Returns null when absent — callers decide
 * whether that is fatal (engine.start does; a probe reports NOT VERIFIED).
 */
export function findObscuraBinary(searchPaths = DEFAULT_SEARCH_PATHS) {
  for (const p of searchPaths) {
    try {
      if (p && fs.existsSync(p) && fs.statSync(p).isFile()) {
        fs.accessSync(p, fs.constants.X_OK);
        return p;
      }
    } catch { /* not executable / not there — keep looking */ }
  }
  const which = spawnSync('which', ['obscura'], { encoding: 'utf8' });
  if (which.status === 0 && which.stdout.trim()) return which.stdout.trim();
  return null;
}

/** Read `obscura --version`. */
export function obscuraVersion(binary) {
  try {
    const r = spawnSync(binary, ['--version'], { encoding: 'utf8', timeout: 15_000 });
    return r.status === 0 ? String(r.stdout).trim() : null;
  } catch {
    return null;
  }
}

/** Poll `/json/version` until the CDP endpoint answers. */
export async function waitForCdp(host = DEFAULT_HOST, port = DEFAULT_PORT, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = 'not attempted';
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`http://${host}:${port}/json/version`, { signal: AbortSignal.timeout(2000) });
      if (r.ok) {
        const body = await r.json();
        return { ok: true, ...body };
      }
      lastError = `HTTP ${r.status}`;
    } catch (e) {
      lastError = e?.cause?.code || e?.code || e?.message || String(e);
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  return { ok: false, error: `CDP endpoint http://${host}:${port}/json/version did not answer within ${timeoutMs}ms — ${lastError}` };
}

/**
 * The engine. Owns one Obscura process (or container) and its CDP endpoint.
 */
export class ObscuraEngine {
  /**
   * @param {object} [o]
   * @param {'auto'|'process'|'docker'} [o.transport]
   * @param {number} [o.port]
   * @param {string} [o.host]                  bind host; loopback by default
   * @param {boolean} [o.stealth]
   * @param {string|null} [o.proxy]
   * @param {string|null} [o.userAgent]
   * @param {string|null} [o.storageDir]       persistent cookies/localStorage
   * @param {number|null} [o.profile]
   * @param {boolean} [o.rotate]
   * @param {string|null} [o.timezone]
   * @param {string|null} [o.geolocation]
   * @param {boolean} [o.allowPrivateNetwork]
   * @param {number} [o.workers]
   * @param {string[]} [o.searchPaths]
   * @param {string} [o.dockerImage]
   */
  constructor({
    transport = 'auto',
    port = DEFAULT_PORT,
    host = DEFAULT_HOST,
    stealth = true,
    proxy = null,
    userAgent = null,
    storageDir = null,
    profile = null,
    rotate = false,
    timezone = null,
    geolocation = null,
    allowPrivateNetwork = false,
    workers = 1,
    searchPaths = DEFAULT_SEARCH_PATHS,
    dockerImage = DOCKER_IMAGE,
  } = {}) {
    if (!Number.isInteger(port) || port < 0 || port > 65535) {
      throw new Error(`ObscuraEngine: port must be an integer 0-65535 — got ${JSON.stringify(port)}`);
    }
    this.requestedTransport = transport;
    this.port = port;
    this.host = host;
    this.stealth = stealth;
    this.proxy = proxy;
    this.userAgent = userAgent;
    this.storageDir = storageDir;
    this.profile = profile;
    this.rotate = rotate;
    this.timezone = timezone;
    this.geolocation = geolocation;
    this.allowPrivateNetwork = allowPrivateNetwork;
    this.workers = workers;
    this.searchPaths = searchPaths;
    this.dockerImage = dockerImage;

    this.transport = null;
    this.binary = null;
    this.version = null;
    this.child = null;
    this.container = null;
    this.cdp = null;
    this.identity = null;
  }

  /** The ws:// URL a CDP client connects to. */
  get cdpUrl() {
    return `ws://${this.host}:${this.port}`;
  }

  /**
   * Assemble the `obscura serve` argv.
   * @param {number} [port] override the configured port
   */
  buildArgs(port = this.port) {
    const args = ['serve', '--port', String(port), '--host', this.host, '--quiet'];
    if (this.stealth) args.push('--stealth');
    if (this.proxy) args.push('--proxy', this.proxy);
    if (this.userAgent) args.push('--user-agent', this.userAgent);
    if (this.storageDir) args.push('--storage-dir', this.storageDir);
    if (this.workers && this.workers !== 1) args.push('--workers', String(this.workers));
    if (this.allowPrivateNetwork) args.push('--allow-private-network');
    return args;
  }

  /** The environment the child inherits (identity vars on top of the parent's). */
  buildEnv() {
    return {
      ...process.env,
      ...buildStealthEnv({
        profile: this.profile,
        rotate: this.rotate,
        timezone: this.timezone,
        geolocation: this.geolocation,
        allowPrivateNetwork: this.allowPrivateNetwork,
      }),
    };
  }

  /** Resolve which transport to use, without starting anything. */
  resolveTransport() {
    if (this.transport) return this.transport;
    if (this.requestedTransport === 'docker') {
      if (!dockerAvailable()) {
        throw new ObscuraUnavailableError('transport "docker" was requested but no Docker daemon answers `docker info`');
      }
      this.transport = 'docker';
      return this.transport;
    }
    const binary = findObscuraBinary(this.searchPaths);
    if (this.requestedTransport === 'process') {
      if (!binary) throw new ObscuraUnavailableError('transport "process" was requested but no obscura binary was found');
      this.transport = 'process';
      return this.transport;
    }
    // auto: prefer a local binary (fastest start), else Docker, else fail loudly.
    if (binary) this.transport = 'process';
    else if (dockerAvailable()) this.transport = 'docker';
    else throw new ObscuraUnavailableError(
      `no obscura binary found (searched: ${this.searchPaths.join(', ')}) and no Docker daemon is available`
    );
    return this.transport;
  }

  /**
   * Start the engine and wait until CDP answers.
   * @returns {Promise<object>} a status snapshot — never a canned success
   */
  async start() {
    const transport = this.resolveTransport();
    const identity = checkIdentityConsistency({
      profile: this.profile,
      rotate: this.rotate,
      timezone: this.timezone,
      geolocation: this.geolocation,
      proxy: this.proxy,
    });
    this.identity = identity;

    if (transport === 'process') {
      this.binary = findObscuraBinary(this.searchPaths);
      if (!this.binary) throw new ObscuraUnavailableError('obscura binary disappeared between resolve and start');
      this.version = obscuraVersion(this.binary);
      this.child = spawn(this.binary, this.buildArgs(), {
        env: this.buildEnv(),
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: false,
      });
      this.child.unref?.();
      // Keep the pipes drained so a chatty engine cannot fill them and stall.
      this.child.stdout?.resume();
      this.child.stderr?.resume();
    } else {
      spawnSync('docker', ['rm', '-f', 'jexi-obscura'], { encoding: 'utf8', timeout: 20_000 });
      const runArgs = [
        'run', '-d', '--name', 'jexi-obscura',
        '-p', `${this.host}:${this.port}:9222`,
      ];
      for (const [k, v] of Object.entries(buildStealthEnv({
        profile: this.profile,
        rotate: this.rotate,
        timezone: this.timezone,
        geolocation: this.geolocation,
        allowPrivateNetwork: this.allowPrivateNetwork,
      }))) runArgs.push('-e', `${k}=${v}`);
      if (this.storageDir) runArgs.push('-v', `${this.storageDir}:/storage`);
      runArgs.push(this.dockerImage);
      if (this.stealth) runArgs.push('--stealth');
      const r = spawnSync('docker', runArgs, { encoding: 'utf8', timeout: 60_000 });
      if (r.status !== 0) {
        throw new ObscuraUnavailableError(`docker run failed: ${String(r.stderr || r.stdout).trim()}`);
      }
      this.container = 'jexi-obscura';
    }

    this.cdp = await waitForCdp(this.host, this.port);
    if (!this.cdp.ok) {
      const detail = this.cdp.error;
      await this.stop().catch(() => {});
      throw new ObscuraUnavailableError(detail);
    }
    return this.status();
  }

  /** Real RSS of the engine process tree, in KB. Null when the process is gone. */
  rssKb() {
    if (this.transport === 'docker' && this.container) {
      const r = spawnSync('docker', ['stats', '--no-stream', '--format', '{{.MemUsage}}', this.container], { encoding: 'utf8', timeout: 20_000 });
      if (r.status !== 0) return null;
      const m = /^([\d.]+)\s*([KMG]i?B)/i.exec(String(r.stdout).trim());
      if (!m) return null;
      const n = parseFloat(m[1]);
      const unit = m[2].toLowerCase();
      const mult = unit.startsWith('k') ? 1 : unit.startsWith('m') ? 1024 : 1024 * 1024;
      return Math.round(n * mult);
    }
    if (!this.child?.pid) return null;
    try {
      const out = spawnSync('ps', ['-eo', 'pid,ppid,rss', '--no-headers'], { encoding: 'utf8', timeout: 10_000 }).stdout;
      let total = 0;
      let found = false;
      for (const line of out.split('\n')) {
        const [pid, ppid, rss] = line.trim().split(/\s+/);
        if (Number(pid) === this.child.pid || Number(ppid) === this.child.pid) {
          total += Number(rss) || 0;
          found = true;
        }
      }
      return found ? total : null;
    } catch {
      return null;
    }
  }

  /** Status snapshot — everything reported is observed, nothing assumed. */
  status() {
    return {
      engine: 'obscura',
      engine_version: ENGINE_VERSION,
      transport: this.transport,
      binary: this.binary,
      obscura_version: this.version,
      container: this.container,
      pid: this.child?.pid ?? null,
      cdpUrl: this.cdpUrl,
      cdp: this.cdp,
      stealth: this.stealth,
      stealth_capabilities: STEALTH_CAPABILITIES,
      identity: this.identity,
      rss_kb: this.rssKb(),
      running: Boolean(this.cdp?.ok),
    };
  }

  /** Tear down the process/container. Idempotent. */
  async stop() {
    if (this.transport === 'docker' && this.container) {
      spawnSync('docker', ['rm', '-f', this.container], { encoding: 'utf8', timeout: 30_000 });
      this.container = null;
    }
    if (this.child && !this.child.killed) {
      try { this.child.kill('SIGTERM'); } catch { /* already gone */ }
      this.child = null;
    }
    this.cdp = null;
  }
}

/** Convenience factory — matches the runtime facade style used by runtimes/sandbox. */
export function createObscuraEngine(opts = {}) {
  return new ObscuraEngine(opts);
}

export default { createObscuraEngine, ObscuraEngine, findObscuraBinary, obscuraVersion, waitForCdp, dockerAvailable, ENGINE_VERSION };
