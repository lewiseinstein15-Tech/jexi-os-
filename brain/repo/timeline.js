/**
 * JEXI OS — Phase 28 Scope A — brain repo: append-only timeline.
 *
 * The timeline is an append-only ledger: entries are added with an explicit
 * ISO `when` (default: caller-supplied now) and a stable insertion `seq`.
 * There is deliberately NO update/delete API — corrections are new entries.
 * Ordering is (when asc, seq asc): deterministic even for equal timestamps.
 */
import { SemanticaError } from '../../semantica/_internal.js';

/** Validate one entry; returns the canonical { when, entry, seq }. */
export function makeEntry({ entry, when, seq }) {
  if (typeof entry !== 'string' || entry.trim() === '') {
    throw new SemanticaError('E_INVALID_ARGUMENT', `entry must be a non-empty string, got ${JSON.stringify(entry)}`);
  }
  if (typeof when !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(when)) {
    throw new SemanticaError('E_INVALID_ARGUMENT', `when must be an ISO-8601 UTC string (…Z), got ${JSON.stringify(when)}`);
  }
  return { when, entry: entry.trim(), seq: Number.isInteger(seq) ? seq : 0 };
}

/** Canonical order: when asc, then insertion seq asc. */
export function sortTimeline(timeline) {
  return [...timeline].sort((a, b) => (a.when < b.when ? -1 : a.when > b.when ? 1 : a.seq - b.seq));
}

/**
 * Append one entry. Pure: returns a NEW timeline array (append-only —
 * existing entries are never mutated or removed). seq is assigned as
 * max(existing)+1 so insertion order survives equal timestamps.
 */
export function appendEntry(timeline, { entry, when }) {
  const seq = timeline.reduce((m, e) => Math.max(m, e.seq), -1) + 1;
  return sortTimeline([...timeline, makeEntry({ entry, when, seq })]);
}
