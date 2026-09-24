/**
 * JEXI OS — Phase 20 Scope B — collective memory.
 *
 * The hive's shared, append-only record of what its workers produced.
 * Append-only is enforced by the API surface: there is no update and no
 * delete — new reports grow the task's entry list, never rewrite it.
 * Iteration and serialization are deterministic (insertion order).
 */
export class CollectiveMemory {
  constructor() {
    /** taskId -> [ { seq, workerId, taskId, result } ] in append order */
    this.byTask = new Map();
    this.appendSeq = 0;
    this.total = 0;
  }

  /** Append one report. Returns the stored entry. */
  append(workerId, taskId, result) {
    this.appendSeq += 1;
    this.total += 1;
    const entry = Object.freeze({
      seq: this.appendSeq,
      workerId,
      taskId,
      result,
    });
    if (!this.byTask.has(taskId)) this.byTask.set(taskId, []);
    this.byTask.get(taskId).push(entry);
    return entry;
  }

  /** Entries for one task, in append order; all entries when taskId omitted. */
  read(taskId) {
    if (taskId === undefined) {
      const all = [];
      for (const entries of this.byTask.values()) all.push(...entries);
      return all;
    }
    return [...(this.byTask.get(taskId) || [])];
  }

  size() {
    return this.total;
  }
}

export default CollectiveMemory;
