/**
 * JEXI OS — Phase 6 Scope B: scheduler queue — priority.
 *
 * A stable max-priority queue: higher `priority` runs first; items with equal
 * priority run in FIFO submission order. Instances are cheap and are the
 * ready-queue primitive the scheduler uses before handing work to the runner.
 */

export class PriorityQueue {
  constructor() {
    /** @type {Array<{ priority: number, seq: number, value: any }>} */
    this.items = [];
    this.seq = 0;
  }

  get size() {
    return this.items.length;
  }

  push(value, priority = 0) {
    const p = Number.isFinite(priority) ? Number(priority) : 0;
    const entry = { priority: p, seq: this.seq++, value };
    this.items.push(entry);
    this._bubbleUp(this.items.length - 1);
    return entry;
  }

  pop() {
    if (this.items.length === 0) return undefined;
    const top = this.items[0];
    const last = this.items.pop();
    if (this.items.length > 0) {
      this.items[0] = last;
      this._sinkDown(0);
    }
    return top.value;
  }

  peek() {
    return this.items[0]?.value;
  }

  clear() {
    this.items.length = 0;
  }

  _higher(a, b) {
    if (a.priority !== b.priority) return a.priority > b.priority;
    return a.seq < b.seq; // earlier submission wins a tie
  }

  _bubbleUp(i) {
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this._higher(this.items[i], this.items[parent])) {
        [this.items[i], this.items[parent]] = [this.items[parent], this.items[i]];
        i = parent;
      } else break;
    }
  }

  _sinkDown(i) {
    const n = this.items.length;
    for (;;) {
      const left = 2 * i + 1;
      const right = 2 * i + 2;
      let best = i;
      if (left < n && this._higher(this.items[left], this.items[best])) best = left;
      if (right < n && this._higher(this.items[right], this.items[best])) best = right;
      if (best === i) break;
      [this.items[i], this.items[best]] = [this.items[best], this.items[i]];
      i = best;
    }
  }
}
