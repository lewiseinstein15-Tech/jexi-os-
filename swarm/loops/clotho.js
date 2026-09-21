/**
 * JEXI OS — Phase 20 Scope E — Clotho (fibers + weave).
 *
 * Ported from the ruflo clotho pattern: spin sub-tasks (fibers) from a
 * parent task, let them run independently, then weave their outputs back
 * together. Named after the Fate who spins the thread.
 *
 *   clotho.spin(task, { fibers })  -> { fiberId, subTasks[] }
 *   clotho.complete(fiberId, out)  -> mark one fiber's output
 *   clotho.fail(fiberId, reason)   -> mark one fiber failed
 *   clotho.weave(fiberIds)         -> { woven: true, contributions[] }
 *                                  | { woven: false, reason, failedFiber }
 *   clotho.status(fiberId)         -> { state }
 *
 * Fiber lifecycle: spun -> complete | failed -> woven.
 * Weave merges outputs in FIBER (spin) order — never completion order —
 * so the same operations always weave to the same bytes. One failed fiber
 * refuses the weave instead of merging partial results. Unknown id ->
 * E_UNKNOWN_FIBER; nothing to weave -> E_NO_FIBERS.
 */
import { SwarmError } from '../topologies/_internal.js';

export class Clotho {
  constructor() {
    /** fiberId -> { fiberId, seq, task, subTask, state, output?, failureReason? } */
    this.fibers = new Map();
    this.seq = 0;
  }

  /**
   * Spin fibers from a parent task. `fibers` is a count (generic sub-tasks
   * labeled `${task}#i`) or an array of sub-task labels. Deterministic ids
   * fiber-001.. in spin order.
   */
  spin(task, { fibers } = {}) {
    if (typeof task !== 'string' || task.trim() === '') {
      throw new SwarmError('E_INVALID_TASK', `task must be a non-empty string, got ${JSON.stringify(task)}`);
    }
    let labels;
    if (typeof fibers === 'number') {
      if (!Number.isInteger(fibers) || fibers < 1) {
        throw new SwarmError('E_NO_FIBERS', `fiber count must be an integer >= 1, got ${JSON.stringify(fibers)}`);
      }
      labels = Array.from({ length: fibers }, (_, i) => `${task}#${i + 1}`);
    } else if (Array.isArray(fibers)) {
      if (fibers.length === 0) {
        throw new SwarmError('E_NO_FIBERS', 'spinning needs at least 1 sub-task label');
      }
      labels = fibers;
    } else {
      throw new SwarmError('E_NO_FIBERS', `fibers must be a count or an array of labels, got ${JSON.stringify(fibers)}`);
    }
    const spun = [];
    for (const label of labels) {
      if (typeof label !== 'string' || label.trim() === '') {
        throw new SwarmError('E_INVALID_SUBTASK', `sub-task labels must be non-empty strings, got ${JSON.stringify(label)}`);
      }
      this.seq += 1;
      const fiberId = `fiber-${String(this.seq).padStart(3, '0')}`;
      this.fibers.set(fiberId, {
        fiberId,
        seq: this.seq,
        task,
        subTask: label,
        state: 'spun',
      });
      spun.push({ fiberId, subTask: label });
    }
    return { fiberId: spun[0].fiberId, subTasks: spun };
  }

  _get(fiberId) {
    const fiber = this.fibers.get(fiberId);
    if (!fiber) {
      throw new SwarmError('E_UNKNOWN_FIBER', `no fiber "${String(fiberId)}" was spun here; known: ${[...this.fibers.keys()].join(', ') || '(none)'}`);
    }
    return fiber;
  }

  /** Record one fiber's successful output. */
  complete(fiberId, output) {
    const fiber = this._get(fiberId);
    if (fiber.state !== 'spun') {
      throw new SwarmError('E_FIBER_NOT_SPUN', `fiber "${fiberId}" is ${fiber.state}, cannot complete it again`);
    }
    if (output === undefined) {
      throw new SwarmError('E_INVALID_OUTPUT', `fiber "${fiberId}" needs an output (use fail() for failures)`);
    }
    fiber.state = 'complete';
    fiber.output = output;
    return { fiberId, state: fiber.state };
  }

  /** Record one fiber's failure with a reason. */
  fail(fiberId, reason) {
    const fiber = this._get(fiberId);
    if (fiber.state !== 'spun') {
      throw new SwarmError('E_FIBER_NOT_SPUN', `fiber "${fiberId}" is ${fiber.state}, cannot fail it again`);
    }
    if (typeof reason !== 'string' || reason.trim() === '') {
      throw new SwarmError('E_INVALID_REASON', `failure reason must be a non-empty string, got ${JSON.stringify(reason)}`);
    }
    fiber.state = 'failed';
    fiber.failureReason = reason;
    return { fiberId, state: fiber.state };
  }

  /**
   * Weave the listed fibers. Selection order given by the caller; the merge
   * itself runs in FIBER (spin) order for determinism. A failed fiber
   * returns { woven: false, reason, failedFiber } — no partial merges.
   */
  weave(fiberIds) {
    if (!Array.isArray(fiberIds) || fiberIds.length === 0) {
      throw new SwarmError('E_NO_FIBERS', `weave needs at least 1 fiber id, got ${JSON.stringify(fiberIds)}`);
    }
    const selected = fiberIds.map((id) => this._get(id)); // E_UNKNOWN_FIBER on any unknown
    for (const fiber of selected) {
      if (fiber.state === 'spun') {
        throw new SwarmError('E_FIBER_INCOMPLETE', `fiber "${fiber.fiberId}" has not completed or failed yet — weave waits for every fiber`);
      }
    }
    const failed = selected.filter((f) => f.state === 'failed')
      .sort((a, b) => a.seq - b.seq)[0];
    if (failed) {
      return { woven: false, reason: failed.failureReason, failedFiber: failed.fiberId };
    }
    const contributions = [...selected]
      .sort((a, b) => a.seq - b.seq)
      .map((f) => ({ fiberId: f.fiberId, subTask: f.subTask, output: f.output }));
    for (const fiber of selected) fiber.state = 'woven';
    return { woven: true, contributions };
  }

  /** Current state of one fiber. */
  status(fiberId) {
    const fiber = this._get(fiberId);
    return { state: fiber.state, subTask: fiber.subTask };
  }
}

/** Isolated clotho (probes, tests, determinism checks). */
export function createClotho() {
  return new Clotho();
}

/** The process-level clotho singleton backing the contract API. */
const singleton = new Clotho();

export default {
  spin: (task, opts) => singleton.spin(task, opts),
  complete: (fiberId, output) => singleton.complete(fiberId, output),
  fail: (fiberId, reason) => singleton.fail(fiberId, reason),
  weave: (fiberIds) => singleton.weave(fiberIds),
  status: (fiberId) => singleton.status(fiberId),
};
