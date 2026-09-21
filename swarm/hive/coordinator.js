/**
 * JEXI OS — Phase 20 Scope B — the hive coordinator (queen + workers).
 *
 *   hive.create(config)            -> { queenId, workers[] }
 *   hive.assign(workerId, task)    -> { taskId, workerId, status }
 *   hive.reassign(taskId, toWorker)-> re-dispatch of a REPORTED task;
 *                                    reassigning an in-flight task is
 *                                    refused with E_TASK_IN_FLIGHT
 *   hive.report(workerId, taskId, result) -> updated task state
 *   hive.memory()                  -> collective memory read
 *   hive.queen()                   -> current queen record
 *
 * Exactly one queen per hive. Tasks live in a per-hive registry with a
 * deterministic `task-NNN` sequence. Workers are ordered by id everywhere,
 * so the same config always yields the same hive.
 */
import { SwarmError } from '../topologies/_internal.js';
import CollectiveMemory from './collective_memory.js';
import { createQueen } from './queen.js';
import { createWorker } from './worker.js';

export class Hive {
  constructor() {
    this.created = false;
    this.queenRecord = null;
    /** workerId -> worker record, insertion order = id-sorted */
    this.workers = new Map();
    /** taskId -> { taskId, workerId, label, status, reassignments } */
    this.tasks = new Map();
    this.taskSeq = 0;
    this.memoryLog = new CollectiveMemory();
  }

  /**
   * Create the hive. config = { queen: {type, id?}, workers: [{type, id?}] }.
   * Workers without an explicit id get `worker-1..N` in config order; the
   * roster is then sorted by id, which fixes every later iteration order.
   */
  create(config = {}) {
    if (this.created) {
      throw new SwarmError('E_HIVE_ALREADY_CREATED', `this hive already has a queen ("${this.queenRecord.id}"); one queen per hive`);
    }
    const queen = createQueen(config.queen);
    const raw = Array.isArray(config.workers) ? config.workers : [];
    const filled = raw.map((w, i) => ({
      type: w.type,
      id: w.id !== undefined ? w.id : `worker-${i + 1}`,
    }));
    const ids = new Set();
    for (const w of filled) {
      if (ids.has(w.id)) {
        throw new SwarmError('E_DUPLICATE_WORKER', `worker id "${w.id}" appears more than once in the config`);
      }
      ids.add(w.id);
    }
    filled.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

    this.queenRecord = queen;
    for (const w of filled) this.workers.set(w.id, createWorker(w));
    this.created = true;
    return { queenId: queen.id, workers: [...this.workers.keys()] };
  }

  _assertCreated() {
    if (!this.created) {
      throw new SwarmError('E_NO_HIVE', 'the hive has not been created yet — call create() first');
    }
  }

  _assertWorker(workerId) {
    if (!this.workers.has(workerId)) {
      throw new SwarmError('E_UNKNOWN_WORKER', `no worker "${String(workerId)}" in this hive; workers: ${[...this.workers.keys()].join(', ') || '(none)'}`);
    }
  }

  /**
   * Dispatch a task to a worker. `task` is a label string or
   * { id?, label }. A caller-provided id that is already in-flight
   * refuses with E_TASK_IN_FLIGHT; a reported id refuses with
   * E_DUPLICATE_TASK (re-dispatch goes through reassign()).
   */
  assign(workerId, task) {
    this._assertCreated();
    this._assertWorker(workerId);
    const label = typeof task === 'string' ? task : (task && task.label);
    if (typeof label !== 'string' || label.trim() === '') {
      throw new SwarmError('E_INVALID_TASK', `task must be a label string or { label }, got ${JSON.stringify(task)}`);
    }
    let taskId;
    if (task && typeof task === 'object' && task.id !== undefined) {
      if (typeof task.id !== 'string' || task.id.trim() === '') {
        throw new SwarmError('E_INVALID_TASK', `task.id must be a non-empty string, got ${JSON.stringify(task.id)}`);
      }
      taskId = task.id;
    } else {
      this.taskSeq += 1;
      taskId = `task-${String(this.taskSeq).padStart(3, '0')}`;
    }
    if (this.tasks.has(taskId)) {
      const existing = this.tasks.get(taskId);
      if (existing.status === 'in-flight') {
        throw new SwarmError('E_TASK_IN_FLIGHT', `task "${taskId}" is already in flight on worker "${existing.workerId}"`);
      }
      throw new SwarmError('E_DUPLICATE_TASK', `task "${taskId}" already exists and was reported; use reassign() to re-dispatch it`);
    }
    const record = { taskId, workerId, label, status: 'in-flight', reassignments: 0 };
    this.tasks.set(taskId, record);
    return { taskId, workerId, label, status: record.status };
  }

  /**
   * Queen-level re-dispatch of a REPORTED task to another worker.
   * Reassigning a task that is still in-flight refuses with
   * E_TASK_IN_FLIGHT — one worker owns an in-flight task, period.
   */
  reassign(taskId, toWorkerId) {
    this._assertCreated();
    const record = this.tasks.get(taskId);
    if (!record) {
      throw new SwarmError('E_UNKNOWN_TASK', `no task "${String(taskId)}" in this hive`);
    }
    this._assertWorker(toWorkerId);
    if (record.status === 'in-flight') {
      throw new SwarmError('E_TASK_IN_FLIGHT', `task "${taskId}" is in flight on worker "${record.workerId}" and cannot be reassigned until it reports`);
    }
    record.workerId = toWorkerId;
    record.status = 'in-flight';
    record.reassignments += 1;
    return { taskId, workerId: record.workerId, label: record.label, status: record.status, reassignments: record.reassignments };
  }

  /** A worker reports a result for its task. Appends to collective memory. */
  report(workerId, taskId, result) {
    this._assertCreated();
    this._assertWorker(workerId);
    const record = this.tasks.get(taskId);
    if (!record) {
      throw new SwarmError('E_UNKNOWN_TASK', `no task "${String(taskId)}" in this hive`);
    }
    if (record.workerId !== workerId) {
      throw new SwarmError('E_NOT_ASSIGNED', `task "${taskId}" is assigned to "${record.workerId}", not "${workerId}"`);
    }
    if (record.status !== 'in-flight') {
      throw new SwarmError('E_TASK_NOT_IN_FLIGHT', `task "${taskId}" already reported; reassign() it to run again`);
    }
    this.memoryLog.append(workerId, taskId, result);
    record.status = 'reported';
    return {
      taskId,
      workerId,
      status: record.status,
      reportCount: this.memoryLog.read(taskId).length,
    };
  }

  /** Collective memory read: every appended entry in append order. */
  memory() {
    this._assertCreated();
    return this.memoryLog.read();
  }

  /** The current queen record. */
  queen() {
    this._assertCreated();
    return this.queenRecord;
  }

  /** Full deterministic snapshot (for probes and byte-equality checks). */
  state() {
    this._assertCreated();
    return {
      queen: this.queenRecord,
      workers: [...this.workers.values()],
      tasks: [...this.tasks.values()],
      memory: this.memoryLog.read(),
    };
  }
}

export default Hive;
