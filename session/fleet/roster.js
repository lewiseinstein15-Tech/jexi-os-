/**
 * JEXI OS — Phase 27 Scope A — on-disk roster of background sessions.
 *
 * One JSON file per session under `<root>/roster/<sessionId>.json`:
 *
 *   { sessionId, cmd, pid, state, startedAt, exitCode, signal,
 *     endedAt, killRequested }
 *
 * The roster is the single source of truth and lives entirely on disk, so a
 * freshly constructed Fleet on the same root sees every session a previous
 * (possibly dead) manager left behind. All enumerations are sorted by
 * sessionId for determinism. Unknown id -> E_UNKNOWN_SESSION.
 */
import { FleetError, assertSessionId, ensureDir, readJson, writeJsonAtomic, fs, path } from './_internal.js';

export class Roster {
  constructor(root) {
    this.root = root;
    this.rosterDir = path.join(root, 'roster');
    this.logsDir = path.join(root, 'logs');
    ensureDir(this.rosterDir);
    ensureDir(this.logsDir);
  }

  logPath(sessionId) {
    return path.join(this.logsDir, `${sessionId}.log`);
  }

  recordPath(sessionId) {
    return path.join(this.rosterDir, `${sessionId}.json`);
  }

  create(seed) {
    assertSessionId(seed.sessionId);
    const recordPath = this.recordPath(seed.sessionId);
    if (fs.existsSync(recordPath)) {
      throw new FleetError('E_SESSION_EXISTS', `session "${seed.sessionId}" already exists in roster`);
    }
    const record = {
      sessionId: seed.sessionId,
      cmd: seed.cmd,
      pid: seed.pid ?? null,
      state: 'running',
      startedAt: seed.startedAt,
      exitCode: null,
      signal: null,
      endedAt: null,
      killRequested: false,
    };
    writeJsonAtomic(recordPath, record);
    return record;
  }

  get(sessionId) {
    assertSessionId(sessionId);
    const record = readJson(this.recordPath(sessionId));
    if (!record) {
      throw new FleetError('E_UNKNOWN_SESSION', `unknown session "${sessionId}"`);
    }
    return record;
  }

  exists(sessionId) {
    try {
      assertSessionId(sessionId);
    } catch {
      return false;
    }
    return fs.existsSync(this.recordPath(sessionId));
  }

  update(sessionId, patch) {
    const record = this.get(sessionId);
    const next = { ...record, ...patch, sessionId: record.sessionId };
    writeJsonAtomic(this.recordPath(sessionId), next);
    return next;
  }

  /** All records, sorted by sessionId (deterministic ordering contract). */
  list() {
    const ids = fs.readdirSync(this.rosterDir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.slice(0, -'.json'.length))
      .sort();
    const out = [];
    for (const id of ids) {
      const record = readJson(this.recordPath(id));
      if (record && record.sessionId === id) out.push(record);
    }
    return out;
  }
}
