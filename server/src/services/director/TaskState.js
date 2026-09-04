/**
 * B208 — TASK STATE: the lifecycle of one unit of work under the Director.
 *
 * Every meaningful task gets a durable record with the full state machine,
 * its plan, assignments, events, artifacts, verification, recoveries and
 * result — so a task can be inspected, replayed and audited after the fact
 * (and a reconnecting browser can restore what happened).
 *
 * States:
 *   QUEUED → INTERPRETING → PLANNING → ASSIGNING → RUNNING → VERIFYING
 *          → COMPLETED | FAILED | BLOCKED
 *   RECOVERING / REPLANNING are entered from RUNNING/VERIFYING and return there.
 *   PAUSED/CANCELLED are terminal-for-now states set externally.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TASKS_DIR = path.join(HERE, '..', '..', '..', 'data', 'director-tasks');

const TRANSITIONS = {
  QUEUED: ['INTERPRETING', 'CANCELLED'],
  INTERPRETING: ['PLANNING', 'FAILED', 'BLOCKED', 'CANCELLED'],
  PLANNING: ['ASSIGNING', 'FAILED', 'BLOCKED', 'CANCELLED'],
  ASSIGNING: ['RUNNING', 'FAILED', 'BLOCKED', 'CANCELLED'],
  RUNNING: ['VERIFYING', 'RECOVERING', 'REPLANNING', 'COMPLETED', 'FAILED', 'PAUSED', 'BLOCKED', 'CANCELLED'], // B209 — a blocking NEEDS question pauses mid-run
  RECOVERING: ['RUNNING', 'VERIFYING', 'REPLANNING', 'FAILED', 'CANCELLED'],
  REPLANNING: ['PLANNING', 'RUNNING', 'ASSIGNING', 'FAILED', 'CANCELLED'],
  VERIFYING: ['COMPLETED', 'RECOVERING', 'REPLANNING', 'FAILED', 'CANCELLED'],
  PAUSED: ['RUNNING', 'CANCELLED'],
  BLOCKED: ['PLANNING', 'RUNNING', 'CANCELLED'], // B209 — the user's answer resumes the work
  COMPLETED: [],
  FAILED: [],
  CANCELLED: [],
};

let __seq = 0;
const nextId = () => `dt-${Date.now().toString(36)}-${String(++__seq).padStart(3, '0')}`;

export class DirectorTask {
  constructor({ conversationId, rawQuery, effectiveQuery, contextBlock }) {
    this.id = nextId();
    this.conversationId = String(conversationId || 'default');
    this.rawQuery = String(rawQuery || '').slice(0, 4000);
    this.effectiveQuery = String(effectiveQuery || rawQuery || '').slice(0, 8000);
    this.contextBlock = String(contextBlock || '').slice(0, 4000);
    this.state = 'QUEUED';
    this.workspaceId = null;       // B211 B4 — shared mission workspace (defaults to this task's own id)
    this.createdAt = new Date().toISOString();
    this.updatedAt = this.createdAt;
    this.objective = null;          // refined objective (interpreter output)
    this.refinement = null;         // full interpretation record
    this.assumptions = [];
    this.constraints = [];
    this.successCriteria = [];
    this.structuredObjective = null; // B215 — provenance-tagged objective state (ObjectiveInterpreter)
    this.plan = null;               // { subtasks: [...], leadEmployeeId, parallel }
    this.assignments = [];          // { subtaskId, employeeId, role, status, attempts }
    this.leadEmployeeId = null;
    this.events = [];               // canonical event log (bounded)
    this.artifacts = [];            // first-class produced artifacts
    this.verification = null;       // { verdict, score, problems, rounds }
    this.recoveries = [];           // { at, subtaskId, from, action, reason, ok }
    this.result = null;             // final deliverable record
    this.error = null;
    this._persist();
  }

  /** Legal-state-transition enforcement (illegal transitions throw — bugs must be loud in tests). */
  setState(next, why = '') {
    const allowed = TRANSITIONS[this.state] || [];
    if (!allowed.includes(next)) {
      throw new Error(`TaskState: illegal transition ${this.state} → ${next}${why ? ` (${why})` : ''}`);
    }
    this.state = next;
    this.updatedAt = new Date().toISOString();
    this._persist();
    return this;
  }

  /** Record a canonical event (bounded; the full stream also lives in the mail/log). */
  addEvent(evt) {
    this.events.push(evt);
    if (this.events.length > 600) this.events.splice(0, this.events.length - 600);
    this._persist();
  }

  addArtifact(artifact) {
    this.artifacts.push(artifact);
    if (this.artifacts.length > 80) this.artifacts.splice(0, this.artifacts.length - 80);
    this._persist();
  }

  recordRecovery(rec) { this.recoveries.push({ at: new Date().toISOString(), ...rec }); this._persist(); }

  get isTerminal() { return ['COMPLETED', 'FAILED', 'CANCELLED'].includes(this.state); }

  _persist() {
    try {
      fs.mkdirSync(TASKS_DIR, { recursive: true });
      // B209 — every task gets its OWN record (multiple tasks per
      // conversation are all replayable, not just the latest)
      fs.writeFileSync(path.join(TASKS_DIR, `${this.id}.json`), JSON.stringify(this));
      // conversation index: recent task ids, newest first, bounded
      const idxPath = path.join(TASKS_DIR, `${indexName(this.conversationId)}.index.json`);
      let ids = [];
      try { ids = JSON.parse(fs.readFileSync(idxPath, 'utf-8')) || []; } catch { /* fresh index */ }
      ids = [this.id, ...ids.filter((x) => x !== this.id)].slice(0, 50);
      fs.writeFileSync(idxPath, JSON.stringify(ids));
    } catch { /* persistence is best-effort; the live run never blocks on disk */ }
  }
}

function indexName(conversationId) {
  return String(conversationId).replace(/[^a-z0-9-]/gi, '_').slice(0, 64);
}

/** Replay support: the conversation's LATEST task record (browser reconnect). */
export function loadTask(conversationId) {
  try {
    const idx = JSON.parse(fs.readFileSync(path.join(TASKS_DIR, `${indexName(conversationId)}.index.json`), 'utf-8')) || [];
    return idx.length ? loadTaskById(idx[0]) : null;
  } catch { return null; }
}

/** B209 — any specific task, by id (multiple tasks per conversation). */
export function loadTaskById(taskId) {
  try {
    const safe = String(taskId).replace(/[^a-z0-9-]/gi, '_').slice(0, 80);
    return JSON.parse(fs.readFileSync(path.join(TASKS_DIR, `${safe}.json`), 'utf-8'));
  } catch { return null; }
}

/** B209 — the conversation's recent tasks (newest first). */
export function listDirectorTasks(conversationId, limit = 20) {
  try {
    const idx = JSON.parse(fs.readFileSync(path.join(TASKS_DIR, `${indexName(conversationId)}.index.json`), 'utf-8')) || [];
    return idx.slice(0, limit).map((id) => {
      const t = loadTaskById(id);
      return t ? { id: t.id, state: t.state, objective: t.objective, lead: t.leadEmployeeId, createdAt: t.createdAt, verification: t.verification?.verdict || null } : null;
    }).filter(Boolean);
  } catch { return []; }
}

/** Event factory — the canonical envelope every emitted event carries. */
export function teamEvent(task, { type, agentId, agentName, title, summary, data, severity }) {
  const last = task.events && task.events.length ? task.events[task.events.length - 1] : null;
  return {
    id: `ev-${task.id}-${String(task.events.length + 1).padStart(4, '0')}`,
    ts: new Date().toISOString(),
    parentEventId: last ? last.id : null, // B209 — events chain like the spec asks
    providerId: data && data.provider ? String(data.provider) : null, // B209 — lane on MODEL_* events
    taskId: task.id,
    conversationId: task.conversationId,
    state: task.state,
    agentId: agentId || 'jexi',
    agentName: agentName || 'JEXI',
    type: String(type || 'UNKNOWN'),
    title: String(title || '').slice(0, 120),
    summary: String(summary || '').slice(0, 400),
    data: data && typeof data === 'object' ? data : {},
    severity: ['info', 'warn', 'error'].includes(severity) ? severity : 'info',
  };
}
