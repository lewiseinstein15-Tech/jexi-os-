/**
 * JEXI OS — Phase 6 Scope B: scheduler triggers — event.
 *
 * Subscribes to the Observer bus and fires whenever a matching event type is
 * emitted (e.g. `mission.completed`, `verification.failed`). Matching supports
 * an exact type or a `prefix.*` glob.
 */

import { subscribe } from '../../services/Observer.js';

/** Compile a matcher from an exact type or `namespace.*` glob. */
export function eventMatcher(spec) {
  const s = String(spec || '').trim();
  if (!s) return () => false;
  if (s.endsWith('.*')) {
    const prefix = s.slice(0, -1); // keep the trailing dot: "mission."
    return (type) => type.startsWith(prefix);
  }
  return (type) => type === s;
}

/**
 * Subscribe to the Observer bus for one job. Returns an unsubscribe fn.
 * @param {string} spec     event type or `prefix.*`
 * @param {(evt: object) => void} onMatch
 */
export function onSchedulerEvent(spec, onMatch) {
  const match = eventMatcher(spec);
  return subscribe((evt) => {
    if (evt && match(evt.type)) onMatch(evt);
  });
}
