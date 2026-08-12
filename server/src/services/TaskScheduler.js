import fs from 'fs';
import path from 'path';
import { taskManager } from './TaskManager.js';
import { recordError } from './SelfMonitor.js';
import { DATA_DIR } from '../config.js';

/**
 * TaskScheduler — roadmap stage 23 (recurring workflows): scheduled missions.
 *
 * A schedule is a query plus an interval ("every 5 minutes", "daily", …). On
 * each due tick the scheduler launches a REAL background mission through
 * TaskManager — the same pipeline as the Tasks console — so every run appears
 * in /api/tasks with the full `task.*` event stream. If a run is still going
 * when the next tick arrives, that tick is skipped (no stacking).
 *
 * Schedules persist to DATA_DIR/schedules.json and survive restarts. If the
 * server was down when a schedule came due, it runs once as a catch-up instead
 * of bursting through every missed interval.
 */

const SCHEDULES_FILE = path.join(DATA_DIR, 'schedules.json');
const TICK_MS = 5000;         // how often due schedules are checked
const MAX_SCHEDULES = 40;     // safety cap
const SAVE_DELAY_MS = 300;
const RUNNING = new Set(['queued', 'running']);

class TaskScheduler {
  constructor() {
    /** @type {Map<string, object>} */
    this.schedules = new Map();
    this._saveTimer = null;
    this._load();
    this._ticker = setInterval(() => this.tick(), TICK_MS);
    if (this._ticker.unref) this._ticker.unref();
  }

  // ---------- persistence ----------

  _load() {
    try {
      if (!fs.existsSync(SCHEDULES_FILE)) return;
      const raw = JSON.parse(fs.readFileSync(SCHEDULES_FILE, 'utf-8'));
      for (const s of raw || []) {
        if (!s || !s.id) continue;
        if (s.status !== 'active' && s.status !== 'paused') continue;
        // Server was down when this came due → run once as catch-up shortly
        // after boot (never a multi-run burst).
        if (s.status === 'active' && (!s.nextRunAt || s.nextRunAt < Date.now())) {
          s.nextRunAt = Date.now() + 1000;
        }
        this.schedules.set(s.id, s);
      }
    } catch (e) {
      // First boot or corrupt file — start clean.
    }
  }

  _saveSoon() {
    if (this._saveTimer) return;
    this._saveTimer = setTimeout(() => {
      this._saveTimer = null;
      this._save();
    }, SAVE_DELAY_MS);
    if (this._saveTimer.unref) this._saveTimer.unref();
  }

  _save() {
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(SCHEDULES_FILE, JSON.stringify([...this.schedules.values()], null, 2));
    } catch (e) {
      // Best-effort — never crash a tick over a disk error.
    }
  }

  // ---------- public API ----------

  create({ query, everySeconds, label, image }) {
    const q = String(query || '').trim();
    const every = Math.max(1, Math.floor(Number(everySeconds) || 0));
    if (!q) return { error: 'No query provided' };
    if (every < 1) return { error: 'everySeconds must be at least 1' };
    if (this.schedules.size >= MAX_SCHEDULES) return { error: `Schedule limit reached (${MAX_SCHEDULES}) — remove one first.` };

    const id = `sch_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const schedule = {
      id,
      query: q,
      label: String(label || '').trim(),
      image: image || null,
      everySeconds: every,
      status: 'active',
      createdAt: Date.now(),
      nextRunAt: Date.now() + every * 1000,
      lastRunAt: null,
      lastTaskId: null,
      lastStatus: null,
      runCount: 0,
      error: null,
    };
    this.schedules.set(id, schedule);
    this._saveSoon();
    return { schedule: this.publicSchedule(schedule) };
  }

  list() {
    return [...this.schedules.values()].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  }

  get(id) {
    return this.schedules.get(id) || null;
  }

  publicSchedule(s) {
    if (!s) return null;
    return {
      id: s.id,
      query: s.query,
      label: s.label,
      everySeconds: s.everySeconds,
      status: s.status,
      createdAt: s.createdAt,
      nextRunAt: s.nextRunAt,
      lastRunAt: s.lastRunAt,
      lastTaskId: s.lastTaskId,
      lastStatus: s.lastStatus,
      runCount: s.runCount,
      error: s.error,
    };
  }

  pause(id) {
    const s = this.schedules.get(id);
    if (!s) return null;
    s.status = 'paused';
    this._saveSoon();
    return this.publicSchedule(s);
  }

  resume(id) {
    const s = this.schedules.get(id);
    if (!s) return null;
    s.status = 'active';
    // Restart the countdown from NOW (don't fire instantly on resume).
    s.nextRunAt = Date.now() + s.everySeconds * 1000;
    this._saveSoon();
    return this.publicSchedule(s);
  }

  /** Fire a run immediately, regardless of the schedule's state. */
  runNow(id) {
    const s = this.schedules.get(id);
    if (!s) return null;
    this._run(s);
    return this.publicSchedule(s);
  }

  remove(id) {
    const s = this.schedules.get(id);
    if (!s) return false;
    this.schedules.delete(id);
    this._save();
    return true;
  }

  // ---------- ticking ----------

  tick() {
    const now = Date.now();
    for (const s of this.schedules.values()) {
      if (s.status !== 'active') continue;
      if (!s.nextRunAt || s.nextRunAt > now) continue;
      // No stacking: if the previous run is still going, skip this tick —
      // the mission gets a full pipeline before the next one starts.
      if (s.lastTaskId && RUNNING.has(taskManager.get(s.lastTaskId)?.status)) continue;
      this._run(s);
    }
  }

  _run(s) {
    try {
      const task = taskManager.createTask(s.query, s.image || null);
      s.lastTaskId = task.id;
      s.runCount = (s.runCount || 0) + 1;
      s.lastRunAt = Date.now();
      s.lastStatus = 'queued';
      s.error = null;
      // Record the run's final status once it finishes (fire-and-forget).
      taskManager.waitFor(task.id, 90_000)
        .then((t) => {
          if (s.lastTaskId === task.id && t) s.lastStatus = t.status;
          this._saveSoon();
        })
        .catch(() => {});
      s.nextRunAt = Date.now() + s.everySeconds * 1000;
    } catch (e) {
      recordError('schedule', (e && e.message) || String(e));
      s.error = (e && e.message) || String(e);
      // Retry at the normal cadence — a transient failure must not wedge a
      // schedule into a busy loop.
      s.nextRunAt = Date.now() + s.everySeconds * 1000;
    } finally {
      this._saveSoon();
    }
  }
}

export const taskScheduler = new TaskScheduler();
