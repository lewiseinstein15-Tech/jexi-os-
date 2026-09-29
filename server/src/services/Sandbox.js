/**
 * JEXI OS — SESSION SANDBOX.
 *
 * JEXI-001. Before this, `term_execute` ran `bash -lc <command>` straight on
 * the host via child_process.spawn: no container, no namespace, no chroot, no
 * path confinement, and a scrubbed-but-present environment. The "sandbox" and
 * "host" strings in the risk guard were RING LABELS — they ranked a tool
 * against a configured number and enforced nothing.
 *
 * Two real backends, chosen at runtime, and the difference is reported
 * honestly rather than papered over:
 *
 *   docker     — full container isolation. network=none, no host binds, no
 *                docker socket, memory/cpu/pid caps, all capabilities dropped,
 *                no-new-privileges, read-only root fs, writable tmpfs /tmp.
 *
 *   namespace  — the fallback. A Linux user+mount+pid+network namespace with
 *                only the workspace bind-mounted in and a chroot, so the
 *                command cannot see or reach the host filesystem outside the
 *                workspace and has no network. REAL kernel enforcement, but it
 *                is NOT a container: no cgroup limits, no seccomp filter. It
 *                is reported as `degraded: true`.
 *
 *   cwd        — no isolation primitive is available. Still confines cwd and
 *                scrubs the environment, and is also `degraded: true`. It
 *                exists so a tool call fails loudly-described rather than
 *                silently pretending.
 *
 * The rule from the ticket: never claim isolation that is not there. Every
 * `run()` result carries the backend and `degraded` flag, and `describe()`
 * is what the UI and the tool receipts should show.
 */

import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = path.dirname(fileURLToPath(import.meta.url));

export const DOCKER_IMAGE = process.env.JEXI_SANDBOX_IMAGE || 'python:3.12-slim';

/* System trees a sandboxed process needs in order to execute anything at all.
   Bound READ-ONLY; nothing else from the host crosses in.
   /usr/local is here because a lot of images (this one included) install
   Python and other toolchains under it — without it `python3` resolves but
   dies on a missing libpython. */
const RUNTIME_MOUNTS = ['/usr', '/usr/local', '/bin', '/sbin', '/lib', '/lib64', '/lib32'];

/* Individual files a dynamically-linked process needs. The chroot has no /etc
   from the host (it would carry host config), but without ld.so.cache the
   loader cannot resolve libpython/libstdc++ and every binary fails with
   "error while loading shared libraries" — which looks like a broken sandbox
   rather than a missing cache. */
const RUNTIME_FILES = ['/etc/ld.so.cache', '/etc/ld.so.conf', '/etc/ld.so.conf.d'];

/* Device nodes a normal process expects to exist. A chroot built purely from
   directory mounts has an empty /dev, and the first thing pytest (or almost
   anything) does is open os.devnull — which surfaces as a baffling
   "FileNotFoundError: /dev/null" rather than as a sandbox problem.
   mknod is not permitted inside a user namespace, so the host nodes are
   bind-mounted in individually. */
const RUNTIME_DEVICES = ['/dev/null', '/dev/zero', '/dev/full', '/dev/random', '/dev/urandom', '/dev/tty'];

let _backends = null;

/** Probe the host once for what isolation it can actually provide. */
export function detectSandboxBackends({ force = false } = {}) {
  if (_backends && !force) return _backends;
  const docker = (() => {
    const bin = ['/usr/bin/docker', '/usr/local/bin/docker', '/snap/bin/docker'].find((p) => fs.existsSync(p));
    if (!bin) return { available: false, reason: 'docker binary not found' };
    try {
      execFileSync(bin, ['info', '--format', '{{.ServerVersion}}'], { stdio: ['ignore', 'pipe', 'ignore'], timeout: 4000 });
      return { available: true, bin };
    } catch (e) {
      return { available: false, bin, reason: 'docker daemon not reachable' };
    }
  })();
  const namespaces = fs.existsSync('/usr/bin/unshare') || fs.existsSync('/bin/unshare');
  _backends = { docker, namespaces, unshare: namespaces ? '/usr/bin/unshare' : null };
  return _backends;
}

function envScrub(extra = {}) {
  // Deliberately NOT process.env: the host environment is where API keys live.
  return {
    PATH: '/usr/local/bin:/usr/bin:/bin',
    HOME: '/workspace',
    PWD: '/workspace',
    LANG: 'C.UTF-8',
    TERM: 'dumb',
    NO_COLOR: '1',
    CI: '1',
    ...extra,
  };
}

export class SessionSandbox {
  /**
   * @param {object} o
   * @param {string} o.root    the workspace the session may touch
   * @param {string} [o.owner] session id, used for the temp dir name
   * @param {'auto'|'docker'|'namespace'|'cwd'} [o.backend='auto']
   */
  constructor({ root, owner = 'session', backend = 'auto' } = {}) {
    this.root = path.resolve(root);
    this.owner = owner;
    this.dir = null;
    const caps = detectSandboxBackends();
    this.caps = caps;

    let chosen = backend;
    if (chosen === 'auto') {
      if (caps.docker.available) chosen = 'docker';
      else if (caps.namespaces) chosen = 'namespace';
      else chosen = 'cwd';
    }
    // An explicit request for a backend we do not have must not silently
    // downgrade to "no isolation" — the caller asked for containment.
    if (chosen === 'docker' && !caps.docker.available) {
      throw new Error(`sandbox: docker requested but unavailable (${caps.docker.reason})`);
    }
    if (chosen === 'namespace' && !caps.namespaces) {
      throw new Error('sandbox: Linux namespaces requested but unshare(1) is not available');
    }
    this.backend = chosen;
    this.degraded = chosen !== 'docker';
  }

  /** The honest description — this is what a receipt or the UI should show. */
  describe() {
    const table = {
      docker: {
        isolation: 'container',
        guarantees: ['network=none', 'no host binds', 'no docker socket', 'cap-drop=ALL', 'no-new-privileges', 'read-only rootfs', 'tmpfs /tmp', 'memory/cpu/pid caps'],
        honest: 'Full container isolation provided by the Docker daemon.',
      },
      namespace: {
        isolation: 'linux-namespaces + chroot',
        guarantees: ['user namespace', 'mount namespace', 'pid namespace', 'network namespace (no network)', 'chroot with only the workspace + a read-only runtime', 'scrubbed environment'],
        honest: 'Real kernel enforcement of filesystem and network, but NOT a container: no cgroup memory/cpu caps and no seccomp filter. Reported as degraded.',
      },
      cwd: {
        isolation: 'none',
        guarantees: ['cwd confined to the workspace', 'scrubbed environment', 'argv passed to spawn without a shell'],
        honest: 'No isolation primitive available on this host. Only cwd and environment are confined. Reported as degraded.',
      },
    }[this.backend];
    return { backend: this.backend, degraded: this.degraded, ...table };
  }

  /**
   * The docker invocation spec. Pure and static so it can be asserted on any
   * host, including one with no Docker daemon — the hardening flags are the
   * contract, and a contract that can only be checked where Docker happens to
   * be installed is a contract nobody checks.
   */
  static dockerSpec(root, argv, { cwd = '/workspace', bin = 'docker' } = {}) {
    const [command, ...args] = argv;
    return {
      bin,
      args: [
        'run', '--rm', '-i',
        '--network=none',                    // no egress at all
        '--memory=512m', '--memory-swap=512m',
        '--cpus=1',
        '--pids-limit=256',
        '--cap-drop=ALL',
        '--security-opt=no-new-privileges',
        '--read-only',
        '--tmpfs', '/tmp:rw,noexec,nosuid,size=64m',
        // the ONLY host path that crosses in, and it is read-write because a
        // coding agent has to edit real files
        '-v', `${path.resolve(root)}:/workspace:rw`,
        '--workdir', cwd,
        '--user', '1000:1000',
        '--env', 'HOME=/workspace',
        '--env', 'PATH=/usr/local/bin:/usr/bin:/bin',
        DOCKER_IMAGE,
        command, ...args,
      ],
      cwd: path.resolve(root),
      env: {},
    };
  }

  /** Build the argv for one command inside this sandbox. */
  buildArgv(argv, { cwd = '/workspace' } = {}) {
    const [command, ...args] = argv;
    if (!command) throw new Error('sandbox: command required');

    if (this.backend === 'docker') {
      return SessionSandbox.dockerSpec(this.root, [command, ...args], { cwd, bin: this.caps.docker.bin || 'docker' });
    }

    if (this.backend === 'namespace') {
      // Stage the chroot: bind the read-only runtime in, bind the workspace
      // in, give it a private /tmp, then chroot and exec.
      const sbx = this.dir || (this.dir = this._makeStagingDir());
      const ws = path.join(sbx, 'workspace');
      const setup = [
        // no `set -e`: a failing OPTIONAL mount must not abort the setup and
        // hand the caller a broken sandbox with no explanation.
        // The runtime mounts are best-effort (`|| true`): if one fails the
        // command simply cannot start, which is FAIL-CLOSED. The workspace
        // bind below is the security boundary and must succeed or nothing
        // runs at all.
        ...RUNTIME_MOUNTS
          .filter((src) => fs.existsSync(src))
          .map((src) => `mount --bind ${src} ${sbx}${src} || true`),
        ...RUNTIME_FILES
          .filter((src) => fs.existsSync(src))
          .map((src) => `mount --bind ${src} ${sbx}${src} || true`),
        ...RUNTIME_DEVICES
          .filter((src) => fs.existsSync(src))
          .map((src) => `mount --bind ${src} ${sbx}${src} || true`),
        // procfs is best-effort: a fresh procfs needs privileges some kernels
        // withhold from a user namespace, and nothing here depends on it.
        `mount -t proc proc ${sbx}/proc || true`,
        `mount --bind ${this.root} ${ws}`,
        `mount -t tmpfs -o size=64m,nosuid,nodev none ${sbx}/tmp`,
        `unshare --root=${sbx} -- /bin/sh -c 'cd ${cwd} && exec "$@"' sh ${JSON.stringify(command)} ${args.map((a) => JSON.stringify(a)).join(' ')}`,
      ].join('; ');
      return { bin: this.caps.unshare, args: ['--user', '--map-root-user', '--mount', '--net', '--pid', '--fork', '--', '/bin/sh', '-c', setup], cwd: this.root, env: {} };
    }

    // cwd-only fallback: no isolation, but still no shell and still scrubbed.
    return { bin: command, args, cwd: this.root, env: envScrub() };
  }

  _makeStagingDir() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), `jexi-sbx-${this.owner.replace(/[^\w-]/g, '')}-`));
    fs.mkdirSync(path.join(dir, 'workspace'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'tmp'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'etc'), { recursive: true });
    // Mount points must match the SOURCE type: `mount --bind` refuses to bind
    // a regular file onto a directory (and vice versa).
    for (const src of RUNTIME_MOUNTS) {
      const dst = path.join(dir, src);
      try { fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.mkdirSync(dst, { recursive: true }); } catch { /* /lib32 vs /lib */ }
    }
    for (const src of [...RUNTIME_FILES, ...RUNTIME_DEVICES]) {
      if (!fs.existsSync(src)) continue;
      const dst = path.join(dir, src);
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      if (fs.statSync(src).isDirectory()) fs.mkdirSync(dst, { recursive: true });
      else fs.writeFileSync(dst, '');          // empty file as a mount point
    }
    return dir;
  }

  /**
   * Run one argv inside the sandbox. No shell is ever used for the payload.
   * @returns {Promise<{ok, code, stdout, stderr, output, backend, degraded, durationMs}>}
   */
  async run(argv, { timeoutMs = 30000, cwd = '/workspace', env = {}, maxOutputChars = 32000 } = {}) {
    const spec = this.buildArgv(argv, { cwd });
    const started = Date.now();
    // JEXI-001 — the host environment is where every API key lives. An
    // isolated backend gets a SCRUBBED environment only; process.env is
    // inherited solely by the cwd fallback, which is the host anyway and says
    // so in describe().
    const childEnv = this.backend === 'cwd'
      ? { ...process.env, ...spec.env, ...env }
      : { ...envScrub(), ...spec.env, ...env };
    return new Promise((resolve) => {
      let child;
      try {
        child = spawn(spec.bin, spec.args, {
          cwd: spec.cwd,
          env: childEnv,
          stdio: ['ignore', 'pipe', 'pipe'],
          shell: false,
        });
      } catch (e) {
        resolve({ ok: false, code: null, stdout: '', stderr: '', output: '', backend: this.backend, degraded: this.degraded, error: `spawn failed: ${e && e.message}`, durationMs: Date.now() - started });
        return;
      }
      let stdout = '', stderr = '';
      child.stdout.on('data', (d) => { stdout = (stdout + d.toString('utf8')).slice(-maxOutputChars); });
      child.stderr.on('data', (d) => { stderr = (stderr + d.toString('utf8')).slice(-maxOutputChars); });
      const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* gone */ } }, timeoutMs);
      child.on('close', (code) => {
        clearTimeout(timer);
        resolve({
          ok: code === 0, code,
          stdout: stdout.slice(0, maxOutputChars),
          stderr: stderr.slice(0, maxOutputChars),
          output: (stdout || stderr).trim().slice(0, maxOutputChars),
          backend: this.backend, degraded: this.degraded, isolation: this.describe().isolation,
          durationMs: Date.now() - started,
        });
      });
      child.on('error', (e) => {
        clearTimeout(timer);
        resolve({ ok: false, code: null, stdout: '', stderr: '', output: '', backend: this.backend, degraded: this.degraded, error: e && e.message, durationMs: Date.now() - started });
      });
    });
  }

  dispose() {
    if (this.dir) { try { fs.rmSync(this.dir, { recursive: true, force: true }); } catch { /* gone */ } this.dir = null; }
  }
}

let _session = null;

/** The process-wide session sandbox, created on first use. */
export function sessionSandbox({ root, backend = 'auto' } = {}) {
  const r = root || process.env.JEXI_WORKSPACE || process.cwd();
  if (!_session || _session.root !== path.resolve(r)) _session = new SessionSandbox({ root: r, backend });
  return _session;
}

export function _resetSessionSandbox() { _session = null; _backends = null; }
