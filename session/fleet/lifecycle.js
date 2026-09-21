/**
 * JEXI OS — Phase 27 Scope A — session lifecycle: spawn / attach / kill / reap.
 *
 * Sessions are detached child processes (`/bin/sh -c <cmd>`, detached, stdio
 * piped straight into a per-session log file — the openclaude Shell.ts
 * pattern). The manager keeps no in-memory roster: every fact lives on disk,
 * so a new manager instance on the same root recovers the full fleet.
 *
 * Exit handling follows the openclaude LocalShellTask rules:
 *   - kill only from `running` (killShellTasks.ts guards `status !== 'running'`)
 *   - `killRequested` wins over the natural exit result ("killed" precedence)
 *   - an exit observed with no exit code (external signal / vanished) is `stale`
 *
 * Errors: E_UNKNOWN_SESSION, E_INVALID_TRANSITION, E_INVALID_SESSION_ID,
 * E_SESSION_EXISTS, E_LOG_UNAVAILABLE.
 */
import { spawn as nodeSpawn } from 'node:child_process';
import { PassThrough } from 'node:stream';
import crypto from 'node:crypto';
import { FleetError, assertSessionId, fs, path } from './_internal.js';
import { Roster } from './roster.js';
import { StateStore, RUNNING, isTerminal } from './state.js';

const SIGTERM_GRACE_MS = 1500;
const SIGKILL_GRACE_MS = 800;
const FOLLOW_POLL_MS = 50;

export class Fleet {
  constructor(root, { now = () => new Date().toISOString() } = {}) {
    this.root = root;
    this.roster = new Roster(root);
    this.state = new StateStore(this.roster.rosterDir);
    this.#now = now;
    this.#seq = 0;
    this.#children = new Map(); // sessionId -> ChildProcess (while manager alive)
  }

  #now;
  #seq;
  #children;

  // ---------------------------------------------------------------- spawn

  /**
   * spawn(cmd, { cwd, env, id }) -> { sessionId, pid }
   *
   * Detached background session. The child outlives this manager (unref);
   * stdout/stderr append to `<root>/logs/<sessionId>.log`. An explicit `id`
   * makes the sessionId deterministic for callers that need it.
   */
  spawn(cmd, { cwd, env, id } = {}) {
    if (typeof cmd !== 'string' || cmd.length === 0) {
      throw new FleetError('E_INVALID_CMD', 'cmd must be a non-empty string');
    }
    const sessionId = id ?? this.#nextId();
    if (this.roster.exists(sessionId)) {
      throw new FleetError('E_SESSION_EXISTS', `session "${sessionId}" already exists in roster`);
    }
    const startedAt = this.#now();
    this.roster.create({ sessionId, cmd, pid: null, startedAt });

    const logFd = fs.openSync(this.roster.logPath(sessionId), 'a');
    let child;
    try {
      child = nodeSpawn('/bin/sh', ['-c', cmd], {
        cwd: cwd || process.cwd(),
        env: { ...process.env, ...env },
        stdio: ['ignore', logFd, logFd],
        detached: true,
      });
    } finally {
      fs.closeSync(logFd);
    }
    if (typeof child.pid !== 'number') {
      // spawn failure: record the failure honestly instead of faking a pid
      this.state.transition(sessionId, 'failed', { exitCode: null, signal: 'spawn-error', endedAt: this.#now() });
      throw new FleetError('E_SPAWN_FAILED', `failed to spawn session "${sessionId}"`);
    }
    this.roster.update(sessionId, { pid: child.pid });
    child.unref(); // detached: the child must not keep (or die with) this manager
    child.once('exit', (code, signal) => this.#onExit(sessionId, code, signal));
    this.#children.set(sessionId, child);
    return { sessionId, pid: child.pid };
  }

  #nextId() {
    this.#seq += 1;
    return `bg-${Date.now().toString(36)}-${this.#seq.toString(36)}-${crypto.randomBytes(2).toString('hex')}`;
  }

  /** Exit event -> terminal state (idempotent; first writer wins). */
  #onExit(sessionId, code, signal) {
    const record = this.roster.list().find((r) => r.sessionId === sessionId);
    if (!record || record.state !== RUNNING) return; // reap/kill already settled it
    let to;
    let details;
    if (record.killRequested) {
      to = 'killed';
      details = { exitCode: code, signal, endedAt: this.#now() };
    } else if (signal) {
      // died by signal we did not request: no exit outcome was observed
      to = 'stale';
      details = { exitCode: null, signal, endedAt: this.#now() };
    } else if (code === 0) {
      to = 'exited';
      details = { exitCode: 0, signal: null, endedAt: this.#now() };
    } else {
      to = 'failed';
      details = { exitCode: code, signal: null, endedAt: this.#now() };
    }
    try {
      this.state.transition(sessionId, to, details);
    } catch (err) {
      if (err && err.code === 'E_INVALID_TRANSITION') return; // raced; terminal already
      throw err;
    }
    this.#children.delete(sessionId);
  }

  // ----------------------------------------------------------------- list

  /** fleet.list() -> [{ sessionId, pid, state, startedAt }] sorted by sessionId */
  list() {
    return this.roster.list().map((r) => ({
      sessionId: r.sessionId,
      pid: r.pid,
      state: r.state,
      startedAt: r.startedAt,
    }));
  }

  // ----------------------------------------------------------------- logs

  /**
   * fleet.logs(sessionId, { follow }) -> stream (file-backed).
   *
   * Non-follow: streams the log content captured so far, then ends.
   * Follow: keeps polling the file for appends (real tail) and ends once the
   * session reaches a terminal state and the file is drained to EOF.
   */
  logs(sessionId, { follow = false } = {}) {
    const record = this.roster.get(sessionId);
    const logPath = this.roster.logPath(sessionId);
    if (typeof record.pid === 'number' && !fs.existsSync(logPath)) {
      throw new FleetError('E_LOG_UNAVAILABLE', `log file missing for session "${sessionId}"`);
    }
    const out = new PassThrough();
    let offset = 0;
    const pump = () => {
      let size = 0;
      try {
        size = fs.statSync(logPath).size;
      } catch {
        return size;
      }
      if (size > offset) {
        const chunk = Buffer.alloc(size - offset);
        const fd = fs.openSync(logPath, 'r');
        try {
          fs.readSync(fd, chunk, 0, chunk.length, offset);
        } finally {
          fs.closeSync(fd);
        }
        offset = size;
        out.write(chunk);
      }
      return size;
    };

    if (!follow) {
      pump();
      process.nextTick(() => out.end());
      return out;
    }

    const timer = setInterval(() => {
      let recordNow;
      try {
        recordNow = this.roster.get(sessionId);
      } catch {
        recordNow = null;
      }
      const size = pump();
      if (out.destroyed) {
        clearInterval(timer);
        return;
      }
      if (recordNow && isTerminal(recordNow.state) && offset >= size) {
        clearInterval(timer);
        out.end();
      }
    }, FOLLOW_POLL_MS);
    timer.unref();
    out.on('close', () => clearInterval(timer));
    return out;
  }

  // ----------------------------------------------------------------- kill

  /**
   * fleet.kill(sessionId) -> { killed, state }
   *
   * Marks killRequested BEFORE signaling so the "killed" state takes
   * precedence over a racing natural exit. Kill only from `running`.
   */
  async kill(sessionId) {
    assertSessionId(sessionId);
    const record = this.roster.get(sessionId);
    if (record.state !== RUNNING) {
      throw new FleetError('E_INVALID_TRANSITION', `cannot kill session "${sessionId}" in terminal state "${record.state}"`);
    }
    this.roster.update(sessionId, { killRequested: true });

    // detached: true made the child a process-group leader (setsid), so a
    // negative pid signals the WHOLE group — the shell and any workload it
    // started (openclaude Shell.ts tree-kill pattern; a bare SIGTERM to the
    // shell would orphan the command it ran).
    const group = -record.pid;

    let alive = true;
    try {
      process.kill(group, 'SIGTERM');
    } catch (err) {
      if (err.code === 'ESRCH') {
        alive = false;
      } else {
        throw err;
      }
    }

    if (!alive) {
      // vanished before we could signal: no exit outcome was observed
      this.state.transition(sessionId, 'stale', { signal: 'ESRCH', endedAt: this.#now() });
      return { killed: false, state: 'stale' };
    }

    const settled = await this.#waitTerminal(sessionId, SIGTERM_GRACE_MS);
    if (!settled) {
      try {
        process.kill(group, 'SIGKILL');
      } catch {
        /* already gone; waitTerminal below settles or reap will mark stale */
      }
      await this.#waitTerminal(sessionId, SIGKILL_GRACE_MS);
    }
    const final = this.roster.get(sessionId);
    return { killed: final.state === 'killed', state: final.state };
  }

  #waitTerminal(sessionId, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    return new Promise((resolve) => {
      const tick = () => {
        const record = this.roster.list().find((r) => r.sessionId === sessionId);
        if (record && isTerminal(record.state)) return resolve(true);
        if (Date.now() >= deadline) return resolve(false);
        // ref'd on purpose: an in-flight kill() must keep the event loop alive
        setTimeout(tick, 25);
      };
      tick();
    });
  }

  // --------------------------------------------------------------- attach

  /**
   * fleet.attach(sessionId) -> session handle
   *   { sessionId, pid, cmd, startedAt, state(), refresh(), logs({follow}) }
   */
  attach(sessionId) {
    assertSessionId(sessionId);
    const record = this.roster.get(sessionId);
    const fleet = this;
    return {
      sessionId: record.sessionId,
      pid: record.pid,
      cmd: record.cmd,
      startedAt: record.startedAt,
      state() {
        return fleet.roster.get(sessionId).state;
      },
      refresh() {
        return fleet.roster.get(sessionId);
      },
      logs(opts = {}) {
        return fleet.logs(sessionId, opts);
      },
    };
  }

  // ----------------------------------------------------------------- reap

  /**
   * fleet.reap() -> [{ sessionId, from, to }]
   *
   * Detects sessions whose process disappeared without an observed exit and
   * transitions them running -> stale. Returns the transitions applied
   * (sorted by sessionId).
   */
  /**
   * Real liveness probe. On Linux, a freshly killed child that Node has not
   * reaped yet is a ZOMBIE: it still answers kill(pid, 0) but is dead for
   * fleet purposes. Read /proc/<pid>/stat and treat state Z as gone; fall
   * back to signal-0 probing where /proc is unavailable (non-Linux).
   */
  #processAlive(pid) {
    try {
      const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
      const state = stat.slice(stat.lastIndexOf(')') + 2).trim().split(/\s+/)[0];
      return state !== 'Z';
    } catch (err) {
      if (err && err.code === 'ENOENT') return false;
      try {
        process.kill(pid, 0);
        return true;
      } catch (err2) {
        if (err2.code === 'ESRCH') return false;
        if (err2.code === 'EPERM') return true;
        throw err2;
      }
    }
  }

  reap() {
    const transitions = [];
    for (const record of this.roster.list()) {
      if (record.state !== RUNNING) continue;
      const alive = typeof record.pid === 'number' && this.#processAlive(record.pid);
      if (alive) continue;
      const t = this.state.transition(record.sessionId, 'stale', {
        signal: 'vanished',
        endedAt: this.#now(),
      });
      transitions.push({ sessionId: t.sessionId, from: t.from, to: t.to });
    }
    return transitions;
  }
}
