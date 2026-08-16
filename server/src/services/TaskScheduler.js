import fs from 'fs';
import path from 'path';
import { taskManager } from './TaskManager.js';
import { notify } from './NotificationCenter.js';
import { recordError } from './SelfMonitor.js';
import { enqueueGoal, getJob } from './GoalJobQueue.js';
import { DATA_DIR } from '../config.js';
import { redisGet, redisSet, isRedisConfigured } from './RedisStore.js';

/**
 * TaskScheduler — roadmap stage 23 (recurring workflows) + Build 81/82:
 * scheduled missions AND scheduled autonomous GOALS.
 *
 * A schedule is a query plus a cadence:
 *   - everySeconds — "every 5 minutes", "hourly", …
 *   - dailyAt      — "at 08:00 every day" (server local time).
 * On each due tick the scheduler launches a REAL background run:
 *   - kind 'task'  → TaskManager mission (the /api/tasks pipeline).
 *   - kind 'goal'  → a durable GOAL JOB via GoalJobQueue (the autonomous
 *     pipeline: preflight questions, auto-approvals, restart survival,
 *     completion notification + email report — all for free).
 * If a run is still going when the next tick arrives, that tick is skipped
 * (no stacking). Schedules persist to DATA_DIR/schedules.json and survive
 * restarts; if the server was down when a schedule came due, it runs once as
 * a catch-up instead of bursting through every missed interval.
 */

const SCHEDULES_FILE = path.join(DATA_DIR, 'schedules.json');
const REDIS_KEY = 'jexi:schedules:v1';
const TICK_MS = 5000;         // how often due schedules are checked
const MAX_SCHEDULES = 40;     // safety cap
const SAVE_DELAY_MS = 300;
const RUNNING = new Set(['queued', 'running', 'need-info']);
const DAILY_RE = /^([01]?\d|2[0-3]):[0-5]\d$/;

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
        s.kind = s.kind === 'goal' ? 'goal' : 'task';
        s.autonomy = ['ask', 'full'].includes(s.autonomy) ? s.autonomy : 'ask';
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
    // Redis mirror — survives redeploys on ephemeral-disk hosts.
    try { redisSet(REDIS_KEY, JSON.stringify([...this.schedules.values()])).catch(() => {}); } catch { /* fail open */ }
  }

  // ---------- cadence helpers ----------

  /** Next run time for a schedule: dailyAt wins over everySeconds. */
  _nextRunAt(s, from = Date.now()) {
    if (s.dailyAt) {
      const [h, m] = s.dailyAt.split(':').map(Number);
      const d = new Date(from);
      d.setHours(h, m, 0, 0);
      if (d.getTime() <= from) d.setDate(d.getDate() + 1);
      return d.getTime();
    }
    return from + Math.max(1, s.everySeconds || 0) * 1000;
  }

  /**
   * Hydrate schedules from the Redis mirror (called at boot, non-blocking).
   * Used when the local file is missing (ephemeral disk after a redeploy).
   * Catch-up: a due active schedule is re-armed for a single run shortly
   * after boot (never a burst).
   */
  async hydrateFromRedis() {
    if (!isRedisConfigured()) return false;
    if (this.schedules.size > 0) return false; // file already loaded
    try {
      const raw = await redisGet(REDIS_KEY);
      if (!raw) return false;
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return false;
      let restored = 0;
      for (const s of parsed) {
        if (!s || !s.id) continue;
        if (s.status !== 'active' && s.status !== 'paused') continue;
        if (s.status === 'active' && (!s.nextRunAt || s.nextRunAt < Date.now())) {
          s.nextRunAt = Date.now() + 1000; // single catch-up run
        }
        s.kind = s.kind === 'goal' ? 'goal' : 'task';
        s.autonomy = ['ask', 'full'].includes(s.autonomy) ? s.autonomy : 'ask';
        this.schedules.set(s.id, s);
        restored += 1;
      }
      if (restored) { this._save(); console.log(`[Scheduler] ✓ Hydrated ${restored} schedule(s) from Redis.`); }
      return restored > 0;
    } catch (e) {
      console.error('[Scheduler] Redis hydrate error:', e.message);
      return false;
    }
  }

  // ---------- public API ----------

  create({ query, everySeconds, label, image, kind, autonomy, dailyAt }) {
    const q = String(query || '').trim();
    // Validate BEFORE clamping: a missing/zero cadence must be rejected, not
    // silently turned into "every 1 second".
    const rawEvery = Math.floor(Number(everySeconds));
    const every = rawEvery > 0 ? rawEvery : 0;
    const dayAt = String(dailyAt || '').trim();
    if (!q) return { error: 'No query provided' };
    if (!dayAt && every < 1) return { error: 'everySeconds must be at least 1 (or provide dailyAt)' };
    if (dayAt && !DAILY_RE.test(dayAt)) return { error: 'dailyAt must be HH:MM (24h)' };
    if (this.schedules.size >= MAX_SCHEDULES) return { error: `Schedule limit reached (${MAX_SCHEDULES}) — remove one first.` };

    const id = `sch_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const schedule = {
      id,
      query: q,
      label: String(label || '').trim(),
      image: image || null,
      kind: kind === 'goal' ? 'goal' : 'task',
      autonomy: autonomy === 'full' ? 'full' : 'ask',
      everySeconds: dayAt ? null : every,
      dailyAt: dayAt || null,
      status: 'active',
      createdAt: Date.now(),
      nextRunAt: this._nextRunAt({ dailyAt: dayAt, everySeconds: dayAt ? 0 : every }),
      lastRunAt: null,
      lastTaskId: null,
      lastJobId: null,
      lastStatus: null,
      lastSummary: null,
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
      dailyAt: s.dailyAt,
      kind: s.kind,
      autonomy: s.autonomy,
      status: s.status,
      createdAt: s.createdAt,
      nextRunAt: s.nextRunAt,
      lastRunAt: s.lastRunAt,
      lastTaskId: s.lastTaskId,
      lastJobId: s.lastJobId,
      lastStatus: s.lastStatus,
      lastSummary: s.lastSummary,
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
    s.nextRunAt = this._nextRunAt(s);
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
      if (this._isRunning(s)) continue;
      this._run(s);
    }
  }

  _isRunning(s) {
    if (s.kind === 'goal') {
      return Boolean(s.lastJobId && RUNNING.has(getJob(s.lastJobId)?.status));
    }
    return Boolean(s.lastTaskId && RUNNING.has(taskManager.get(s.lastTaskId)?.status));
  }

  /** Watch a goal job to completion and record its final status. */
  _watchGoalJob(s, jobId) {
    const started = Date.now();
    const iv = setInterval(() => {
      const j = getJob(jobId);
      const done = !j || !RUNNING.has(j.status);
      if (done || Date.now() - started > 15 * 60 * 1000) {
        clearInterval(iv);
        if (s.lastJobId === jobId && j) {
          s.lastStatus = j.status;
          s.lastSummary = (j.result && (j.result.summary || '')) || j.error || '';
        }
        this._saveSoon();
      }
    }, 5000);
    if (iv.unref) iv.unref();
  }

  _run(s) {
    try {
      if (s.kind === 'goal') {
        // Durable autonomous goal — notification + email come from the
        // GoalNotifier when it reaches a terminal state (no duplicate here).
        const { id: jobId } = enqueueGoal({
          goal: s.query,
          session: `scheduler:${s.id}`,
          autonomy: s.autonomy || 'ask',
          unattended: true, // scheduled runs: never park, always auto-approve
        });
        s.lastJobId = jobId;
        s.runCount = (s.runCount || 0) + 1;
        s.lastRunAt = Date.now();
        s.lastStatus = 'queued';
        s.error = null;
        this._watchGoalJob(s, jobId);
      } else {
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
            try {
              notify({
                title: `Scheduled mission ${t?.status || 'finished'}`,
                body: `"${String(s.query || '').slice(0, 90)}" → ${t?.status || 'done'}`,
                kind: t?.status === 'failed' ? 'warn' : 'success',
                link: '/tasks',
              });
            } catch (e) {}
            this._saveSoon();
          })
          .catch(() => {});
      }
      s.nextRunAt = this._nextRunAt(s);
    } catch (e) {
      recordError('schedule', (e && e.message) || String(e));
      s.error = (e && e.message) || String(e);
      // Retry at the normal cadence — a transient failure must not wedge a
      // schedule into a busy loop.
      s.nextRunAt = this._nextRunAt(s);
    } finally {
      this._saveSoon();
    }
  }
}

export const taskScheduler = new TaskScheduler();
