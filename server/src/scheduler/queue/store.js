/**
 * JEXI OS — Phase 6 Scope B: scheduler queue — persistent store.
 *
 * Durable job + run records in SQLite (node:sqlite, WAL). When node:sqlite is
 * unavailable the store reports `available: false` and falls back to an
 * in-memory Map so the scheduler still runs (honest degradation, no crash).
 *
 * Tables:
 *   jobs(id, name, kind, lane, priority, enabled, spec JSON, action JSON,
 *        last_run_at, last_status, run_count, next_run_at, created_at)
 *   runs(id, job_id, status, trigger, started_at, finished_at, result,
 *        error, lane, priority)
 */

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const SCHEMA = `
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL,
  lane TEXT NOT NULL DEFAULT 'default',
  priority INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1,
  spec TEXT NOT NULL,
  action TEXT NOT NULL,
  last_run_at INTEGER,
  last_status TEXT,
  run_count INTEGER NOT NULL DEFAULT 0,
  next_run_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  status TEXT NOT NULL,
  trigger TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  result TEXT,
  error TEXT,
  lane TEXT NOT NULL DEFAULT 'default',
  priority INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_runs_job ON runs(job_id);
CREATE INDEX IF NOT EXISTS idx_runs_started ON runs(started_at);
`;

let seq = 0;
const newId = (prefix) => `${prefix}-${Date.now().toString(36)}-${String(++seq).padStart(4, '0')}`;

export class JobStore {
  /**
   * @param {{ file?: string, memory?: boolean }} opts
   */
  constructor({ file = ':memory:', memory = false } = {}) {
    this.file = file;
    this.available = false;
    this.db = null;
    this._mem = { jobs: new Map(), runs: new Map() };
    this.memory = memory;
    if (!memory) this._open();
  }

  _open() {
    try {
      // Lazy require so a Node without node:sqlite still constructs the store.
      const { DatabaseSync } = require('node:sqlite');
      if (this.file !== ':memory:') fs.mkdirSync(path.dirname(this.file), { recursive: true });
      this.db = new DatabaseSync(this.file);
      if (this.file !== ':memory:') {
        try { this.db.exec('PRAGMA journal_mode = WAL'); } catch { /* noop */ }
      }
      this.db.exec(SCHEMA);
      this.available = true;
    } catch {
      this.db = null;
      this.available = false;
      console.warn('[scheduler] node:sqlite unavailable — persistent queue disabled (in-memory only)');
    }
  }

  close() {
    try { this.db?.close(); } catch { /* noop */ }
    this.db = null;
  }

  // ── jobs ─────────────────────────────────────────────────────────────

  saveJob(job) {
    const row = {
      id: job.id,
      name: job.name || '',
      kind: job.kind,
      lane: job.lane || 'default',
      priority: job.priority ?? 0,
      enabled: job.enabled === false ? 0 : 1,
      spec: JSON.stringify(specOf(job)),
      action: JSON.stringify(job.action ?? {}),
      last_run_at: job.lastRunAt ?? null,
      last_status: job.lastStatus ?? null,
      run_count: job.runCount ?? 0,
      next_run_at: job.nextRunAt ?? null,
      created_at: job.createdAt ?? Date.now(),
    };
    if (!this.available) {
      this._mem.jobs.set(row.id, { ...row, enabled: !!row.enabled });
      return job;
    }
    this.db.prepare(`
      INSERT INTO jobs (id,name,kind,lane,priority,enabled,spec,action,last_run_at,last_status,run_count,next_run_at,created_at)
      VALUES ($id,$name,$kind,$lane,$priority,$enabled,$spec,$action,$last_run_at,$last_status,$run_count,$next_run_at,$created_at)
      ON CONFLICT(id) DO UPDATE SET
        name=excluded.name, kind=excluded.kind, lane=excluded.lane, priority=excluded.priority,
        enabled=excluded.enabled, spec=excluded.spec, action=excluded.action,
        last_run_at=excluded.last_run_at, last_status=excluded.last_status,
        run_count=excluded.run_count, next_run_at=excluded.next_run_at
    `).run(row);
    return job;
  }

  getJob(id) {
    if (!this.available) return this._mem.jobs.get(id) || null;
    const row = this.db.prepare('SELECT * FROM jobs WHERE id = ?').get(id);
    return row ? hydrateJob(row) : null;
  }

  listJobs({ limit = 100 } = {}) {
    if (!this.available) return [...this._mem.jobs.values()].slice(0, limit).map(hydrateJob);
    return this.db.prepare('SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?').all(limit).map(hydrateJob);
  }

  deleteJob(id) {
    if (!this.available) return this._mem.jobs.delete(id);
    this.db.prepare('DELETE FROM jobs WHERE id = ?').run(id);
    return true;
  }

  // ── runs ─────────────────────────────────────────────────────────────

  createRun({ jobId, trigger, lane = 'default', priority = 0, status = 'queued' }) {
    const id = newId('run');
    const row = { id, job_id: jobId, status, trigger, started_at: Date.now(), lane, priority };
    if (!this.available) {
      this._mem.runs.set(id, row);
      return hydrateRun(row);
    }
    this.db.prepare(`
      INSERT INTO runs (id,job_id,status,trigger,started_at,lane,priority)
      VALUES ($id,$job_id,$status,$trigger,$started_at,$lane,$priority)
    `).run(row);
    return hydrateRun(row);
  }

  finishRun(id, { status, result = null, error = null }) {
    const finishedAt = Date.now();
    if (!this.available) {
      const row = this._mem.runs.get(id);
      if (!row) return null;
      Object.assign(row, { status, finished_at: finishedAt, result: result ? JSON.stringify(result) : null, error });
      return hydrateRun(row);
    }
    this.db.prepare('UPDATE runs SET status=?, finished_at=?, result=?, error=? WHERE id=?')
      .run(status, finishedAt, result ? JSON.stringify(result) : null, error, id);
    return this.getRun(id);
  }

  getRun(id) {
    if (!this.available) {
      const row = this._mem.runs.get(id);
      return row ? hydrateRun(row) : null;
    }
    const row = this.db.prepare('SELECT * FROM runs WHERE id = ?').get(id);
    return row ? hydrateRun(row) : null;
  }

  listRuns({ limit = 50, jobId = '' } = {}) {
    if (!this.available) {
      let rows = [...this._mem.runs.values()];
      if (jobId) rows = rows.filter((r) => r.job_id === jobId);
      return rows.slice(-limit).reverse().map(hydrateRun);
    }
    const rows = jobId
      ? this.db.prepare('SELECT * FROM runs WHERE job_id = ? ORDER BY started_at DESC LIMIT ?').all(jobId, limit)
      : this.db.prepare('SELECT * FROM runs ORDER BY started_at DESC LIMIT ?').all(limit);
    return rows.map(hydrateRun);
  }

  /** Requeue runs that were mid-flight when the process died. */
  recoverInterrupted() {
    if (!this.available) {
      let n = 0;
      for (const row of this._mem.runs.values()) {
        if (row.status === 'running' || row.status === 'queued') { row.status = 'interrupted'; n++; }
      }
      return n;
    }
    const r = this.db.prepare("UPDATE runs SET status='interrupted', error='process restarted' WHERE status IN ('running','queued')").run();
    return r.changes ?? 0;
  }
}

function specOf(job) {
  return {
    cron: job.cron ?? null,
    event: job.event ?? null,
    condition: job.condition ?? null,
    intervalSeconds: job.intervalSeconds ?? null,
  };
}

function hydrateJob(row) {
  const spec = safeParse(row.spec);
  return {
    id: row.id,
    name: row.name || '',
    kind: row.kind,
    lane: row.lane || 'default',
    priority: row.priority ?? 0,
    enabled: !!row.enabled,
    ...spec,
    action: safeParse(row.action) || {},
    lastRunAt: row.last_run_at ?? null,
    lastStatus: row.last_status ?? null,
    runCount: row.run_count ?? 0,
    nextRunAt: row.next_run_at ?? null,
    createdAt: row.created_at,
  };
}

function hydrateRun(row) {
  return {
    id: row.id,
    jobId: row.job_id,
    status: row.status,
    trigger: row.trigger,
    startedAt: row.started_at,
    finishedAt: row.finished_at ?? null,
    durationMs: row.finished_at ? row.finished_at - row.started_at : null,
    result: row.result ? safeParse(row.result) : null,
    error: row.error ?? null,
    lane: row.lane || 'default',
    priority: row.priority ?? 0,
  };
}

function safeParse(v) {
  if (v == null) return null;
  try { return JSON.parse(v); } catch { return null; }
}

export { newId };