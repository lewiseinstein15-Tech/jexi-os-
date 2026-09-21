/**
 * JEXI OS — Phase 20 Scope B — hive-mind entry point.
 *
 *   import hive from 'swarm/hive/index.js';
 *   hive.create({ queen: { type: 'strategist' }, workers: [...] });
 *   hive.assign('worker-1', 'map the corpus');
 *   hive.report('worker-1', 'task-001', { found: 42 });
 *   hive.memory();   // collective memory read
 *   hive.queen();    // the one queen record
 *
 * The default export is the process-level hive (exactly one queen). For
 * additional or isolated hives — tests, probes, determinism checks — use
 * the exported Hive class; every instance obeys the same contract.
 */
import { Hive } from './coordinator.js';
import CollectiveMemory from './collective_memory.js';
import { QUEEN_TYPES, createQueen, assertQueenType } from './queen.js';
import { WORKER_TYPES, createWorker, assertWorkerType } from './worker.js';

/** The process-level hive singleton. */
const singleton = new Hive();

function create(config) {
  return singleton.create(config);
}
function assign(workerId, task) {
  return singleton.assign(workerId, task);
}
function reassign(taskId, toWorkerId) {
  return singleton.reassign(taskId, toWorkerId);
}
function report(workerId, taskId, result) {
  return singleton.report(workerId, taskId, result);
}
function memory() {
  return singleton.memory();
}
function queen() {
  return singleton.queen();
}

export {
  Hive,
  CollectiveMemory,
  QUEEN_TYPES,
  WORKER_TYPES,
  createQueen,
  assertQueenType,
  createWorker,
  assertWorkerType,
  create,
  assign,
  reassign,
  report,
  memory,
  queen,
};

export default { create, assign, reassign, report, memory, queen };
