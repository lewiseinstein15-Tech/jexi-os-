/**
 * JEXI OS — Phase 6 Scope B: scheduler execution — bounded concurrency.
 *
 * A tiny slot pool: `run(fn)` resolves once a slot is free, then runs `fn`,
 * keeping at most `max` jobs in flight. Default max is 3 (Hermes cap).
 */

export class ConcurrencyPool {
  constructor(max = 3) {
    this.max = Math.max(1, Number(max) || 3);
    this.active = 0;
    this.queue = [];
    this.peak = 0;
    this.completed = 0;
  }

  get running() {
    return this.active;
  }

  get waiting() {
    return this.queue.length;
  }

  /** Run `fn` when a slot frees up. Resolves/rejects with fn's result. */
  run(fn) {
    return new Promise((resolve, reject) => {
      const start = () => {
        this.active += 1;
        this.peak = Math.max(this.peak, this.active);
        Promise.resolve()
          .then(fn)
          .then(resolve, reject)
          .finally(() => {
            this.active -= 1;
            this.completed += 1;
            this._drain();
          });
      };
      if (this.active < this.max) start();
      else this.queue.push(start);
    });
  }

  _drain() {
    while (this.active < this.max && this.queue.length > 0) {
      const next = this.queue.shift();
      next();
    }
  }

  stats() {
    return { max: this.max, running: this.active, waiting: this.queue.length, peak: this.peak, completed: this.completed };
  }
}
