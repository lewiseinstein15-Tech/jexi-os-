import fs from 'fs';
import path from 'path';
import { planner } from './Planner.js';
import { orchestrator } from './Orchestrator.js';
import { recordError } from './SelfMonitor.js';
import { AGENT_ROSTER, SKILL_REGISTRY } from './AgentRoster.js';
import { DATA_DIR } from '../config.js';

/**
 * TaskManager — roadmap stage 8: background tasks + `task.*` event vocabulary.
 *
 * Chat (/api/chat) runs tasks synchronously inside the HTTP request and holds
 * the connection until the mission ends. Background tasks decouple that: a task
 * is created with POST /api/tasks, executes in-process via the SAME
 * Planner → Orchestrator pipeline, and every event is recorded + streamed to
 * subscribers over NDJSON (GET /api/tasks/:id/events).
 *
 * Event vocabulary (all carry `id` + `at`):
 *   task.created    { query }                    — task accepted
 *   task.started    {}                           — orchestrator pipeline began
 *   task.plan       { intent, steps, roster, domainNames, skillsLine }
 *   task.log        { agent, message }           — pipeline stream
 *   task.website    { site }                     — a page JEXI visited
 *   task.done       { success, summary, statistics, sources, files }
 *   task.failed     { error }
 *   task.cancelled  {}                           — user requested halt
 *   task.heartbeat  {}                           — keep-alive on subscriber streams
 *
 * Tasks persist (summary + capped events) to DATA_DIR/tasks.json so the list
 * survives restarts; tasks still running when the process died are marked
 * `interrupted` (honest — never resurrected mid-flight).
 */

const TERMINAL = new Set(['done', 'failed', 'cancelled', 'interrupted']);
const MAX_EVENTS = 600;        // events kept per task (memory + disk cap)
const MAX_TASKS = 50;          // oldest terminal tasks pruned beyond this
const SAVE_DELAY_MS = 500;     // debounce writes (a running task emits fast)
const HEARTBEAT_MS = 10000;    // matches the chat stream's keep-alive

const TASKS_FILE = path.join(DATA_DIR, 'tasks.json');

// Cancellation signal thrown from inside the event wrapper so Orchestrator's
// own catch (which converts errors into results.success=false) turns it into
// a normal terminal state instead of an unhandled rejection.
const TASK_CANCELLED = 'TASK_CANCELLED';

class TaskManager {
  constructor() {
    /** @type {Map<string, object>} */
    this.tasks = new Map();
    /** @type {Map<string, Set<import('express').Response>>} */
    this.subscribers = new Map();
    this._saveTimer = null;
    this._load();
    this._pruneTimer = setInterval(() => this._prune(), 60_000);
    if (this._pruneTimer.unref) this._pruneTimer.unref();
  }

  // ---------- persistence ----------

  _load() {
    try {
      if (!fs.existsSync(TASKS_FILE)) return;
      const raw = JSON.parse(fs.readFileSync(TASKS_FILE, 'utf-8'));
      for (const t of raw || []) {
        if (!t || !t.id) continue;
        // A task that was mid-flight when the process died cannot be resumed
        // safely — mark it honestly instead of leaving it spinning.
        if (t.status === 'queued' || t.status === 'running') {
          t.status = 'interrupted';
          t.events = t.events || [];
          t.events.push({ type: 'task.log', at: Date.now(), id: t.id, agent: 'System', message: '⚠ Server restarted while this mission was running — marked interrupted. Re-run to continue.' });
        }
        this.tasks.set(t.id, t);
      }
    } catch (e) {
      // First boot or a corrupt file — start clean.
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
      const trimmed = [...this.tasks.values()].map((t) => ({
        ...t,
        events: (t.events || []).slice(-MAX_EVENTS),
      }));
      fs.writeFileSync(TASKS_FILE, JSON.stringify(trimmed, null, 2));
    } catch (e) {
      // Persistence is best-effort — never crash a running task over a disk error.
    }
  }

  _prune() {
    const terminal = [...this.tasks.values()].filter((t) => TERMINAL.has(t.status));
    if (terminal.length <= MAX_TASKS) return;
    terminal
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
      .slice(MAX_TASKS)
      .forEach((t) => this.tasks.delete(t.id));
    this._save();
  }

  // ---------- event plumbing ----------

  _emit(task, ev) {
    const line = { id: task.id, ...ev };
    if (!line.at) line.at = Date.now();
    task.events = task.events || [];
    task.events.push(line);
    if (task.events.length > MAX_EVENTS) task.events.splice(0, task.events.length - MAX_EVENTS);
    this._broadcast(task, line);
    return line;
  }

  _broadcast(task, ev) {
    const set = this.subscribers.get(task.id);
    if (!set || set.size === 0) return;
    const line = JSON.stringify(ev) + '\n';
    for (const res of [...set]) {
      try { res.write(line); } catch (e) { set.delete(res); }
    }
    if (TERMINAL.has(task.status)) this._closeStreams(task);
  }

  _closeStreams(task) {
    const set = this.subscribers.get(task.id);
    if (!set) return;
    for (const res of [...set]) {
      try { res.end(); } catch (e) {}
    }
    this.subscribers.delete(task.id);
  }

  /**
   * Attach an NDJSON subscriber to a task. Replays the full event history first
   * (so a client can always rebuild state from the stream alone), then pushes
   * live events. The stream ends when the task reaches a terminal state.
   */
  subscribe(id, res) {
    const task = this.tasks.get(id);
    if (!task) return;
    for (const ev of task.events) {
      try { res.write(JSON.stringify(ev) + '\n'); } catch (e) { return; }
    }
    const set = this.subscribers.get(id) || new Set();
    set.add(res);
    this.subscribers.set(id, set);
    const hb = setInterval(() => {
      try { res.write('{"type":"task.heartbeat"}\n'); } catch (e) { clearInterval(hb); }
    }, HEARTBEAT_MS);
    res.on('close', () => {
      clearInterval(hb);
      const s = this.subscribers.get(id);
      if (s) { s.delete(res); if (s.size === 0) this.subscribers.delete(id); }
    });
    if (TERMINAL.has(task.status)) {
      setImmediate(() => { try { res.end(); } catch (e) {} });
    }
  }

  // ---------- public API ----------

  createTask(query, image = null) {
    const id = `tk_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
    const task = {
      id,
      query: String(query || '').trim(),
      image: image || null,
      intent: null,
      status: 'queued',
      createdAt: Date.now(),
      startedAt: null,
      finishedAt: null,
      steps: [],
      roster: [],
      domainNames: [],
      skillsLine: '',
      events: [],
      summary: '',
      sources: [],
      files: [],
      statistics: null,
      error: null,
      cancelRequested: false,
    };
    this.tasks.set(id, task);
    this._emit(task, { type: 'task.created', query: task.query });
    this._saveSoon();
    // Fire-and-forget: the mission runs in the background, never blocking the
    // request that created it.
    this._run(task).catch((e) => {
      recordError('task', (e && e.message) || String(e));
    });
    return task;
  }

  async _run(task) {
    try {
      task.status = 'running';
      task.startedAt = Date.now();
      this._emit(task, { type: 'task.started' });
      this._saveSoon();

      // Every event emitted by the pipeline is recorded + broadcast. The one
      // exception: when a cancel was requested, the next emission throws —
      // Orchestrator's own catch turns it into a clean results object, and we
      // finalize the task as cancelled below.
      const sendEvent = (type, data) => {
        if (this._isCancelled(task)) {
          const err = new Error(TASK_CANCELLED);
          err.jexiCancel = true;
          throw err;
        }
        const name = { log: 'task.log', website: 'task.website', plan: 'task.plan' }[type] || type;
        this._emit(task, { type: name, ...data });
      };

      let plan;
      try {
        plan = await planner.analyzeIntent(task.query, { image: task.image || undefined });
      } catch (e) {
        plan = { intent: 'default', steps: [], tasks: [], roster: [], domains: [], domainNames: [], skillsLine: '', reasoning: 'Planner failed — falling back to the default path.' };
      }

      if (this._isCancelled(task)) {
        task.status = 'cancelled';
        task.finishedAt = Date.now();
        this._emit(task, { type: 'task.cancelled' });
        return;
      }

      sendEvent('log', { agent: 'Planner', message: `Intent: ${plan.intent} — ${plan.reasoning || ''}` });
      sendEvent('plan', {
        intent: plan.intent,
        steps: plan.steps || [],
        roster: plan.roster || [],
        domains: plan.domains || [],
        domainNames: plan.domainNames || [],
        skillsLine: plan.skillsLine || '',
        rosterCatalogSize: AGENT_ROSTER.length,
        skillCatalogSize: SKILL_REGISTRY.length,
      });

      const results = await orchestrator.executePlan(plan, task.query, sendEvent, { image: task.image || undefined });

      if (this._isCancelled(task)) {
        task.status = 'cancelled';
        task.finishedAt = Date.now();
        this._emit(task, { type: 'task.cancelled' });
        return;
      }

      if (results && results.success !== false) {
        task.status = 'done';
        task.intent = plan.intent;
        task.summary = (results.summary && String(results.summary)) || '';
        task.sources = results.sources || [];
        task.files = results.files || [];
        task.statistics = results.statistics || null;
        task.finishedAt = Date.now();
        this._emit(task, {
          type: 'task.done',
          success: true,
          summary: task.summary,
          statistics: task.statistics,
          sources: task.sources,
          files: task.files,
        });
      } else {
        task.status = 'failed';
        task.error = (results && results.error) || 'The mission failed without an error message.';
        task.summary = (results && results.summary) || '';
        task.finishedAt = Date.now();
        this._emit(task, { type: 'task.failed', error: task.error });
      }
    } catch (e) {
      recordError('task', (e && e.message) || String(e));
      if (this._isCancelled(task)) {
        task.status = 'cancelled';
      } else {
        task.status = 'failed';
        task.error = (e && e.message) || String(e);
      }
      task.finishedAt = Date.now();
      this._emit(task, { type: task.status === 'cancelled' ? 'task.cancelled' : 'task.failed', error: task.error });
    } finally {
      this._save();
      this._closeStreams(task);
    }
  }

  cancel(id) {
    const task = this.tasks.get(id);
    if (!task) return null;
    if (task.status === 'queued' || task.status === 'running') {
      task.cancelRequested = true;
      this._emit(task, { type: 'task.log', agent: 'System', message: '⏹ Cancel requested — halting after the current step…' });
      this._saveSoon();
    }
    return task;
  }

  remove(id) {
    const task = this.tasks.get(id);
    if (!task) return false;
    this._closeStreams(task);
    this.tasks.delete(id);
    this._save();
    return true;
  }

  get(id) {
    return this.tasks.get(id) || null;
  }

  list() {
    return [...this.tasks.values()].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  }

  /** Trimmed view for API responses. `withEvents` includes the event log. */
  publicTask(task, withEvents = false) {
    if (!task) return null;
    const pub = {
      id: task.id,
      query: task.query,
      image: task.image,
      intent: task.intent,
      status: task.status,
      createdAt: task.createdAt,
      startedAt: task.startedAt,
      finishedAt: task.finishedAt,
      steps: task.steps || [],
      roster: task.roster || [],
      domainNames: task.domainNames || [],
      skillsLine: task.skillsLine || '',
      summary: task.summary || '',
      sources: task.sources || [],
      files: task.files || [],
      statistics: task.statistics || null,
      error: task.error || null,
    };
    if (withEvents) pub.events = task.events || [];
    else pub.eventCount = (task.events || []).length;
    return pub;
  }

  /** Resolve when the task reaches a terminal state (or the timeout elapses). */
  waitFor(id, timeoutMs = 90_000) {
    return new Promise((resolve) => {
      const t = this.tasks.get(id);
      if (!t || TERMINAL.has(t.status)) return resolve(t || null);
      const started = Date.now();
      // Deliberately NOT unref'd: waitFor is used by tests/scripts that have no
      // other handles — an unref'd interval would let Node exit before a fast
      // (fully-synchronous) task reaches its terminal state.
      const iv = setInterval(() => {
        const cur = this.tasks.get(id);
        if (!cur || TERMINAL.has(cur.status) || Date.now() - started > timeoutMs) {
          clearInterval(iv);
          resolve(cur || null);
        }
      }, 250);
    });
  }

  _isCancelled(task) {
    return task.cancelRequested === true || task.status === 'cancelled';
  }
}

export const taskManager = new TaskManager();
