/**
 * JEXI OS — Phase 6 Scope B: scheduler triggers — condition.
 *
 * Polls an async predicate every N seconds and fires once when it transitions
 * from false → true (edge-triggered). Set `fireOnStart` to also fire on the
 * first true observation. The predicate is injected as a name resolved from the
 * condition registry (see ./registry.js) so jobs stay serializable.
 */

/** Build a poller. Tick is injectable for deterministic tests. */
export function makeConditionPoller({ predicate, intervalMs, fireOnStart = false, onFire, tickMs = null }) {
  const period = Math.max(250, Number(intervalMs) || 5000);
  let last = false;
  let running = false;
  let timer = null;
  let polls = 0;

  async function poll() {
    if (running) return { fired: false, reason: 'busy' };
    running = true;
    const before = last;
    try {
      last = !!(await predicate());
    } catch {
      last = false; // a throwing predicate is "not yet true" — never fire on error
    } finally {
      running = false;
    }
    polls += 1;
    const edge = last && (!before || (fireOnStart && polls === 1));
    if (edge) { try { await onFire(); } catch { /* a handler error never stops the poll */ } }
    return { fired: edge, value: last };
  }

  const effectiveTick = Number.isFinite(tickMs) && tickMs > 0 ? tickMs : period;

  return {
    start() {
      if (timer) return;
      timer = setInterval(() => { poll().catch(() => {}); }, effectiveTick);
      if (timer.unref) timer.unref();
      poll().catch(() => {});
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
    poll,
    get value() { return last; },
    get polls() { return polls; },
    get intervalMs() { return effectiveTick; },
  };
}