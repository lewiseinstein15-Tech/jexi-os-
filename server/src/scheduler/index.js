/**
 * JEXI OS — Phase 6 Scope B: SCHEDULER (autonomy).
 *
 * JEXI schedules work, runs it unattended, and delivers results without a human
 * prompt. This engine is the real scheduler:
 *
 *   triggers/  cron (5-field), event (Observer bus), condition (polled predicate)
 *   queue/     SQLite-persistent jobs + runs, priority heap, lane fairness
 *   execution/ bounded concurrency pool (default max 3) + resource governor
 *   delivery/  Observer events + NotificationCenter + API-ready reports
 *
 * A job is a trigger plus an action. Actions are `emit` (put an event on the
 * bus) or `handler` (call a registered function). Jobs and every run persist to
 * SQLite and survive restarts; runs interrupted by a restart are honestly
 * marked `interrupted`.
 */

import path from 'node:path';
import { DATA_DIR } from '../config.js';
import { emit } from '../services/Observer.js';
import { JobStore } from './queue/store.js';
import { selectFairIndex, recordPick, fairnessSnapshot } from './queue/fairness.js';
import { ConcurrencyPool } from './execution/concurrent.js';
import { ResourceGovernor } from './execution/resource.js';
import { parseCron, nextCronDate } from './triggers/cron.js';
import { onSchedulerEvent } from './triggers/event.js';
import { makeConditionPoller } from './triggers/condition.js';
import { notifyScheduler } from './delivery/notify.js';
import { jobHistoryReport, runReport, publicJob } from './delivery/report.js';

const DEFAULT_TICK_MS = 5000;
const DEFAULT_MAX_CONCURRENT = 3;

/** Named condition predicates, so jobs stay serializable. */
const conditions = new Map();
/** Named action handlers. */
const handlers = new Map();

export function registerCondition(name, fn) {
  conditions.set(name, fn);
  return () => conditions.delete(name);
}
export function registerAction(name, fn) {
  handlers.set(name, fn);
  return () => handlers.delete(name);
}

let seq = 0;

export class SchedulerEngine {
  constructor({ dbFile = path.join(DATA_DIR, 'scheduler.db'), maxConcurrent = DEFAULT_MAX_CONCURRENT, tickMs = DEFAULT_TICK_MS } = {}) {
    this.store = new JobStore({ file: dbFile });
    this.pool = new ConcurrencyPool(maxConcurrent);
    this.governor = new ResourceGovernor();
    this.pending = []; // queued run requests awaiting a slot
    this.picks = new Map(); // lane → served count (fairness ledger)
    this.eventUnsubs = new Map(); // jobId → unsubscribe
    this.conditionPollers = new Map(); // jobId → poller
    this.tickMs = tickMs;
    this.ticker = null;
    this.running = false;
    this.hooks = { execute: null }; // action execution seam (tests/host)
  }

  // ── lifecycle ───────────────────────────────────────────────────────

  start() {
    if (this.running) return;
    this.running = true;
    const recovered = this.store.recoverInterrupted();
    if (recovered) emit('scheduler.recovered', { actor: 'scheduler', summary: `${recovered} interrupted run(s) requeued` });
    for (const job of this.store.listJobs({ limit: 500 })) {
      if (!job.enabled) continue;
      this._arm(job);
    }
    this.ticker = setInterval(() => this.tick().catch(() => {}), this.tickMs);
    if (this.ticker.unref) this.ticker.unref();
  }

  stop() {
    this.running = false;
    if (this.ticker) clearInterval(this.ticker);
    this.ticker = null;
    for (const unsub of this.eventUnsubs.values()) unsub();
    this.eventUnsubs.clear();
    for (const p of this.conditionPollers.values()) p.stop();
    this.conditionPollers.clear();
  }

  /** One scheduler pass: fire any due cron jobs. Safe to call repeatedly. */
  async tick(now = new Date()) {
    const due = [];
    for (const job of this.store.listJobs({ limit: 500 })) {
      if (!job.enabled || job.kind !== 'cron') continue;
      if (job.nextRunAt && job.nextRunAt <= now.getTime()) {
        const following = nextCronDate(job.cron, now);
        job.nextRunAt = following ? following.getTime() : null;
        this.store.saveJob(job);
        due.push(job);
      } else if (!job.nextRunAt) {
        const following = nextCronDate(job.cron, now);
        job.nextRunAt = following ? following.getTime() : null;
        this.store.saveJob(job);
      }
    }
    for (const job of due) this.enqueue(job, 'cron');
    return { fired: due.map((j) => j.id) };
  }

  // ── job CRUD ────────────────────────────────────────────────────────

  createJob(input = {}) {
    const kind = input.kind || inferKind(input);
    if (!['cron', 'event', 'condition'].includes(kind)) return { ok: false, error: `unknown trigger kind "${kind}"` };
    if (kind === 'cron') {
      try { parseCron(input.cron); } catch (e) { return { ok: false, error: e.message }; }
    }
    if (kind === 'event' && !input.event) return { ok: false, error: 'event trigger needs an event type' };
    if (kind === 'condition' && !input.condition && !input.predicate) return { ok: false, error: 'condition trigger needs a predicate name' };

    const job = {
      id: input.id || `job-${Date.now().toString(36)}-${String(++seq).padStart(3, '0')}`,
      name: input.name || '',
      kind,
      lane: input.lane || 'default',
      priority: Number.isFinite(input.priority) ? input.priority : 0,
      enabled: input.enabled !== false,
      cron: kind === 'cron' ? (input.cron || '* * * * *') : null,
      event: kind === 'event' ? input.event : null,
      condition: kind === 'condition' ? (input.condition || input.predicate) : null,
      intervalSeconds: input.intervalSeconds ?? null,
      action: input.action || { type: 'emit', event: 'scheduler.job.action' },
      lastRunAt: null,
      lastStatus: null,
      runCount: 0,
      nextRunAt: kind === 'cron' ? nextCronDate(input.cron, new Date())?.getTime() ?? null : null,
      createdAt: Date.now(),
    };
    this.store.saveJob(job);
    emit('scheduler.job.created', { actor: 'scheduler', summary: `job ${job.id} (${kind})`, data: { jobId: job.id, kind } });
    if (this.running) this._arm(job);
    return { ok: true, job: publicJob(this.store.getJob(job.id)) };
  }

  listJobs(opts) { return this.store.listJobs(opts).map(publicJob); }

  getJob(id) { const j = this.store.getJob(id); return j ? publicJob(j) : null; }

  deleteJob(id) {
    this._disarm(id);
    const ok = this.store.deleteJob(id);
    if (ok) emit('scheduler.job.deleted', { actor: 'scheduler', summary: `job ${id} deleted`, data: { jobId: id } });
    return { ok: true, deleted: !!ok };
  }

  setEnabled(id, enabled) {
    const job = this.store.getJob(id);
    if (!job) return { ok: false, error: 'job not found' };
    job.enabled = !!enabled;
    this.store.saveJob(job);
    if (job.enabled && this.running) this._arm(job); else this._disarm(id);
    return { ok: true, job: publicJob(this.store.getJob(id)) };
  }

  _arm(job) {
    if (job.kind === 'event') {
      if (this.eventUnsubs.has(job.id)) return;
      const unsub = onSchedulerEvent(job.event, (evt) => {
        const fresh = this.store.getJob(job.id);
        if (!fresh || !fresh.enabled) return;
        this.enqueue(fresh, 'event', { event: evt.type, data: evt.data });
      });
      this.eventUnsubs.set(job.id, unsub);
    } else if (job.kind === 'condition') {
      const fn = conditions.get(job.condition);
      if (typeof fn !== 'function') return; // unknown predicate → never fires
      const poller = makeConditionPoller({
        predicate: fn,
        intervalMs: (job.intervalSeconds ?? 5) * 1000,
        onFire: () => {
          const fresh = this.store.getJob(job.id);
          if (fresh && fresh.enabled) this.enqueue(fresh, 'condition');
        },
      });
      poller.start();
      this.conditionPollers.set(job.id, poller);
    }
  }

  _disarm(id) {
    const unsub = this.eventUnsubs.get(id);
    if (unsub) { unsub(); this.eventUnsubs.delete(id); }
    const p = this.conditionPollers.get(id);
    if (p) { p.stop(); this.conditionPollers.delete(id); }
  }

  // ── queue + execution ───────────────────────────────────────────────

  enqueue(job, trigger, extra = {}) {
    const run = this.store.createRun({ jobId: job.id, trigger, lane: job.lane || 'default', priority: job.priority ?? 0 });
    notifyScheduler('job.fired', { jobId: job.id, summary: `job ${job.id} fired (${trigger})`, runId: run.id, trigger });
    this.pending.push({ job, run, trigger, ...extra });
    this._dispatch();
    return run;
  }

  _dispatch() {
    while (this.pending.length > 0 && this.pool.running < this.pool.max) {
      const idx = selectFairIndex(this.pending, { picks: this.picks });
      if (idx < 0) break;
      const req = this.pending.splice(idx, 1)[0];
      recordPick(this.picks, req.job.lane || 'default');
      this._execute(req);
    }
  }

  _execute(req) {
    const { job, run, trigger } = req;
    const p = this.pool.run(async () => {
      this.governor.acquire(run.id, { jobId: job.id, kind: trigger, lane: job.lane });
      notifyScheduler('job.started', { jobId: job.id, summary: `job ${job.id} started`, runId: run.id, trigger });
      try {
        const result = await this._runAction(job, run, trigger, req);
        this.store.finishRun(run.id, { status: 'completed', result });
        const fresh = this.store.getJob(job.id);
        if (fresh) {
          fresh.lastRunAt = Date.now();
          fresh.lastStatus = 'completed';
          fresh.runCount = (fresh.runCount || 0) + 1;
          this.store.saveJob(fresh);
        }
        this.governor.release(run.id, {});
        notifyScheduler('job.completed', { jobId: job.id, summary: `job ${job.id} completed`, runId: run.id, trigger, data: result });
        return result;
      } catch (e) {
        const message = (e && e.message) || String(e);
        this.store.finishRun(run.id, { status: 'failed', error: message });
        const fresh = this.store.getJob(job.id);
        if (fresh) {
          fresh.lastRunAt = Date.now();
          fresh.lastStatus = 'failed';
          fresh.runCount = (fresh.runCount || 0) + 1;
          this.store.saveJob(fresh);
        }
        this.governor.release(run.id, { failed: true });
        notifyScheduler('job.failed', { jobId: job.id, summary: `job ${job.id} failed: ${message}`, runId: run.id, trigger, data: { error: message } });
        throw e;
      } finally {
        this._dispatch();
      }
    });
    return p.catch(() => {});
  }

  async _runAction(job, run, trigger, req = {}) {
    if (typeof this.hooks.execute === 'function') return this.hooks.execute(job, run, { trigger, ...req });
    const action = job.action || {};
    if (action.type === 'emit') {
      const type = action.event || 'scheduler.job.action';
      const evt = emit(type, {
        actor: 'scheduler',
        summary: action.summary || `scheduled job ${job.id} (${trigger})`,
        data: { jobId: job.id, runId: run.id, trigger, ...(action.data || {}) },
      });
      if (!evt) throw new Error(`emit action: invalid event type "${type}"`);
      return { emitted: type, eventId: evt.id };
    }
    if (action.type === 'handler') {
      const fn = handlers.get(action.name);
      if (typeof fn !== 'function') throw new Error(`no action handler registered: ${action.name}`);
      const out = await fn(action.payload ?? {}, { job: publicJob(job), runId: run.id, trigger });
      return out === undefined ? { handler: action.name } : out;
    }
    throw new Error(`unknown action type "${action.type}"`);
  }

  // ── introspection ───────────────────────────────────────────────────

  status() {
    return {
      running: this.running,
      tickMs: this.tickMs,
      persistent: this.store.available,
      queued: this.pending.length,
      pool: this.pool.stats(),
      resources: this.governor.snapshot(),
      fairness: fairnessSnapshot(this.picks),
      triggers: { event: this.eventUnsubs.size, condition: this.conditionPollers.size },
      conditions: [...conditions.keys()],
      handlers: [...handlers.keys()],
    };
  }

  history(opts) { return jobHistoryReport(this.store, opts); }
  runReport(runId) { return runReport(this.store, runId); }

  /** Deterministically fire one job now (manual "run now"). */
  runNow(id, trigger = 'manual') {
    const job = this.store.getJob(id);
    if (!job) return { ok: false, error: 'job not found' };
    const run = this.enqueue(job, trigger);
    return { ok: true, run };
  }
}

function inferKind(input) {
  if (input.cron) return 'cron';
  if (input.event) return 'event';
  if (input.condition || input.predicate) return 'condition';
  return '';
}

// ── singleton ──────────────────────────────────────────────────────────

let instance = null;

/** The shared scheduler engine (constructed lazily, started on demand). */
export function autonomyScheduler() {
  if (!instance) instance = new SchedulerEngine();
  return instance;
}

export function _resetSchedulerForTests() {
  if (instance) instance.stop();
  instance = null;
}
