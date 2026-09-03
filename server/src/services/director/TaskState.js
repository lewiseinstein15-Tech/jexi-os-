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
  RUNNING: ['VERIFYING', 'RECOVERING', 'REPLANNING', 'COMPLETED', 'FAILED', 'PAUSED', 'CANCELLED'],
  RECOVERING: ['RUNNING', 'VERIFYING', 'REPLANNING', 'FAILED', 'CANCELLED'],
  REPLANNING: ['RUNNING', 'ASSIGNING', 'FAILED', 'CANCELLED'],
  VERIFYING: ['COMPLETED', 'RECOVERING', 'REPLANNING', 'FAILED', 'CANCELLED'],
  PAUSED: ['RUNNING', 'CANCELLED'],
  BLOCKED: ['CANCELLED'],
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
    this.createdAt = new Date().toISOString();
    this.updatedAt = this.createdAt;
    this.objective = null;          // refined objective (interpreter output)
    this.refinement = null;         // full interpretation record
    this.assumptions = [];
    this.constraints = [];
    this.successCriteria = [];
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
      const safe = String(this.conversationId).replace(/[^a-z0-9-]/gi, '_').slice(0, 64);
      fs.writeFileSync(path.join(TASKS_DIR, `${safe}.json`), JSON.stringify(this));
    } catch { /* persistence is best-effort; the live run never blocks on disk */ }
  }
}

/** Replay support: load a conversation's task record (browser reconnect). */
export function loadTask(conversationId) {
  try {
    const safe = String(conversationId).replace(/[^a-z0-9-]/gi, '_').slice(0, 64);
    const raw = fs.readFileSync(path.join(TASKS_DIR, `${safe}.json`), 'utf-8');
    return JSON.parse(raw);
  } catch { return null; }
}

/** Event factory — the canonical envelope every emitted event carries. */
export function teamEvent(task, { type, agentId, agentName, title, summary, data, severity }) {
  return {
    id: `ev-${task.id}-${String(task.events.length + 1).padStart(4, '0')}`,
    ts: new Date().toISOString(),
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
