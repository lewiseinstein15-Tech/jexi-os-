/**
 * JEXI OS — Phase 28 Scope G — op-seq ambient delta with per-session cursor.
 * No clocks. Visibility lanes are separate so a world cursor cannot consume
 * private changes before an opted-in caller asks for them.
 */
import { SemanticaError } from '../../../../services/semantica/_internal.js';

const TYPE_ORDER = Object.freeze({ page: 0, fact: 1, thread: 2 });
const clone = (value) => JSON.parse(JSON.stringify(value));
const keyOf = (change) => `${change.type}:${change.id ?? change.slug ?? change.fact ?? change.text ?? change.op_seq}`;
const compareText = (a, b) => String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
const bySeq = (a, b) => (a.op_seq - b.op_seq) ||
  ((TYPE_ORDER[a.type] ?? 9) - (TYPE_ORDER[b.type] ?? 9)) || compareText(keyOf(a), keyOf(b));

export function createDelta({ changes = [] } = {}) {
  const owned = Array.isArray(changes) ? changes : [];
  const source = typeof changes === 'function' ? changes : () => owned;
  const cursors = new Map();

  const lane = (sessionId, includePrivate) => `${sessionId}::${includePrivate === true ? 'all' : 'world'}`;

  function validateChange(change) {
    if (!change || !['page', 'fact', 'thread'].includes(change.type) ||
        !Number.isInteger(change.op_seq) || change.op_seq < 0) {
      throw new SemanticaError('E_INVALID_ARGUMENT', 'delta change requires type page|fact|thread and non-negative op_seq');
    }
    return change;
  }

  return {
    delta({ since, sessionId, includePrivate = false } = {}) {
      if (sessionId !== undefined && (typeof sessionId !== 'string' || sessionId === '')) {
        throw new SemanticaError('E_INVALID_ARGUMENT', 'ambient.delta sessionId must be a non-empty string');
      }
      if (sessionId === undefined && since === undefined) {
        throw new SemanticaError('E_INVALID_ARGUMENT', 'ambient.delta requires sessionId or explicit since op_seq');
      }
      if (since !== undefined && (!Number.isInteger(since) || since < 0)) {
        throw new SemanticaError('E_INVALID_ARGUMENT', 'ambient.delta since must be a non-negative op_seq');
      }
      const cursorKey = sessionId ? lane(sessionId, includePrivate) : null;
      const currentCursor = cursorKey ? (cursors.get(cursorKey) ?? 0) : 0;
      const start = since ?? currentCursor;
      const sorted = source().map(validateChange)
        .filter((change) => change.op_seq > start)
        .filter((change) => change.visibility !== 'private' || includePrivate === true)
        .sort(bySeq);

      // Keep the newest change for a repeated identity within this wake.
      const latest = new Map();
      for (const change of sorted) latest.set(keyOf(change), change);
      const delivered = [...latest.values()].sort(bySeq);
      if (cursorKey) {
        const maxSeq = delivered.reduce((max, change) => Math.max(max, change.op_seq), start);
        cursors.set(cursorKey, Math.max(currentCursor, maxSeq));
      }
      const project = (type) => delivered.filter((change) => change.type === type).map((change) => {
        const { type: _type, ...item } = change;
        return clone(item);
      });
      return { pages: project('page'), facts: project('fact'), threads: project('thread') };
    },

    publish(change) {
      validateChange(change);
      if (typeof changes === 'function') {
        throw new SemanticaError('E_INVALID_ARGUMENT', 'cannot publish into callback-backed delta source');
      }
      owned.push(clone(change));
      return clone(change);
    },

    cursor(sessionId, { includePrivate = false } = {}) {
      return cursors.get(lane(sessionId, includePrivate)) ?? 0;
    },
  };
}
