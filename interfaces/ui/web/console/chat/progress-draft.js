/**
 * JEXI OS — Phase 16 Scope D — Progress Drafts
 *
 * Long turns show ONE evolving message, not stacked "still working" replies.
 * Draft edits in place: headline + steps + optional tool log.
 * When turn ends, draft finalizes into answer.
 *
 * Contract:
 *  draft.create(turnId, opts) -> { turnId, createdAt, state: 'active' }
 *  draft.update(turnId, patch) -> { turnId, headline, steps, toolLog?, state }
 *  draft.finalize(turnId, finalMessage) -> { turnId, state: 'finalized', finalMessage, durationMs }
 *
 * Rules:
 *  1. Only one active draft per session at a time. Second create while active -> E_DRAFT_ACTIVE
 *  2. Throttled: default 300ms, rapid updates coalesced (last wins)
 *  3. Finalize idempotent
 *  4. Short turns discarded if finalize before minDurationMs (1500 default) and no updates and no force
 *  5. Long turns keep draft if any update past minDurationMs or force=true
 *  6. Pure object state - same patch sequence -> same state (timestamps masked)
 *  7. Missing turnId -> E_UNKNOWN_TURN
 *  8. Update on finalized -> E_DRAFT_FINALIZED
 *  9. Steps preserved in order, no dedup
 */

function fail(code, message) {
  const err = new Error(message || code);
  err.code = code;
  return err;
}

// Internal storage
const activeDrafts = new Map(); // turnId -> draft
const finalizedCache = new Map(); // turnId -> finalized result
const discardedCache = new Map(); // turnId -> discarded result

function hasActiveDraft() {
  for (const d of activeDrafts.values()) {
    if (d.state === 'active') return true;
  }
  return false;
}

function applyPatch(draft, patch) {
  if (!patch || typeof patch !== 'object') return;
  draft.hasUpdates = true;
  draft.appliedCount = (draft.appliedCount || 0) + 1;

  if (patch.headline !== undefined) {
    draft.headline = patch.headline;
  }
  if (patch.steps !== undefined) {
    // Preserve order, no dedup, caller controls content
    draft.steps = Array.isArray(patch.steps) ? [...patch.steps] : patch.steps;
  }
  if (patch.toolLog !== undefined) {
    draft.toolLog = Array.isArray(patch.toolLog) ? [...patch.toolLog] : patch.toolLog;
  }
  // Allow extra fields to be merged if needed, but keep core
}

export function create(turnId, opts = {}) {
  if (!turnId || typeof turnId !== 'string') {
    throw fail('E_UNKNOWN_TURN', 'turnId is required');
  }

  // Rule 1: only one active draft at a time
  if (hasActiveDraft()) {
    // If the same turnId is already active, still throw per spec "second create while active"
    throw fail('E_DRAFT_ACTIVE', 'An active draft already exists');
  }

  // If turnId exists in finalized cache, allow recreate? Should clear old finalized to allow new turn with same id after finalization?
  // For simplicity, if finalized cache has same turnId, delete it to allow fresh create (since finalize is idempotent, but new turn with same id after finalization should be allowed)
  if (finalizedCache.has(turnId)) {
    finalizedCache.delete(turnId);
  }
  if (discardedCache.has(turnId)) {
    discardedCache.delete(turnId);
  }
  if (activeDrafts.has(turnId)) {
    // Existing active with same id — treat as active violation
    throw fail('E_DRAFT_ACTIVE', 'Draft with this turnId already active');
  }

  const now = Date.now();
  const draft = {
    turnId,
    createdAt: now,
    createdAtIso: new Date(now).toISOString(),
    state: 'active',
    headline: opts.headline || '',
    steps: opts.steps ? [...opts.steps] : [],
    toolLog: opts.toolLog ? [...opts.toolLog] : [],
    throttleMs: typeof opts.throttleMs === 'number' ? opts.throttleMs : 300,
    minDurationMs: typeof opts.minDurationMs === 'number' ? opts.minDurationMs : 1500,
    force: !!opts.force,
    lastAppliedAt: now,
    pendingPatch: null,
    pendingTimer: null,
    hasUpdates: false,
    appliedCount: 0,
    attemptedCount: 0,
    finalizedResult: null,
  };

  activeDrafts.set(turnId, draft);

  return {
    turnId: draft.turnId,
    createdAt: draft.createdAtIso,
    state: draft.state,
  };
}

export function update(turnId, patch) {
  if (!turnId || typeof turnId !== 'string') {
    throw fail('E_UNKNOWN_TURN', 'turnId is required');
  }

  const draft = activeDrafts.get(turnId);

  if (!draft) {
    // Check if finalized — then throw E_DRAFT_FINALIZED per rule 8
    if (finalizedCache.has(turnId)) {
      throw fail('E_DRAFT_FINALIZED', `Draft ${turnId} already finalized`);
    }
    throw fail('E_UNKNOWN_TURN', `Unknown turnId: ${turnId}`);
  }

  if (draft.state === 'finalized') {
    throw fail('E_DRAFT_FINALIZED', `Draft ${turnId} already finalized`);
  }

  if (draft.state === 'discarded') {
    throw fail('E_UNKNOWN_TURN', `Draft ${turnId} discarded`);
  }

  draft.attemptedCount = (draft.attemptedCount || 0) + 1;
  const now = Date.now();

  // Throttle check: if within window, coalesce
  if (now - draft.lastAppliedAt < draft.throttleMs) {
    draft.pendingPatch = patch;

    if (draft.pendingTimer) {
      clearTimeout(draft.pendingTimer);
    }

    const delay = draft.throttleMs - (now - draft.lastAppliedAt);
    draft.pendingTimer = setTimeout(() => {
      if (draft.pendingPatch) {
        applyPatch(draft, draft.pendingPatch);
        draft.pendingPatch = null;
        draft.lastAppliedAt = Date.now();
        draft.pendingTimer = null;
      }
    }, delay);

    // Return current state without applying new patch
    return {
      turnId: draft.turnId,
      headline: draft.headline,
      steps: [...draft.steps],
      toolLog: draft.toolLog ? [...draft.toolLog] : [],
      state: draft.state,
      _throttled: true,
      _attempted: draft.attemptedCount,
      _applied: draft.appliedCount,
    };
  }

  // Outside throttle window — apply immediately
  // If there was a pending patch from earlier throttling, apply it first? No, pending should have been applied via timer.
  // But flush pending if exists to preserve order
  if (draft.pendingPatch) {
    applyPatch(draft, draft.pendingPatch);
    draft.pendingPatch = null;
    if (draft.pendingTimer) {
      clearTimeout(draft.pendingTimer);
      draft.pendingTimer = null;
    }
  }

  applyPatch(draft, patch);
  draft.lastAppliedAt = now;

  return {
    turnId: draft.turnId,
    headline: draft.headline,
    steps: [...draft.steps],
    toolLog: draft.toolLog ? [...draft.toolLog] : [],
    state: draft.state,
    _throttled: false,
    _attempted: draft.attemptedCount,
    _applied: draft.appliedCount,
  };
}

export function finalize(turnId, finalMessage) {
  if (!turnId || typeof turnId !== 'string') {
    throw fail('E_UNKNOWN_TURN', 'turnId is required');
  }

  // Idempotent: if already finalized, return cached result
  if (finalizedCache.has(turnId)) {
    return { ...finalizedCache.get(turnId) };
  }

  // If discarded previously, return discarded result (idempotent for discard as well)
  if (discardedCache.has(turnId)) {
    return { ...discardedCache.get(turnId) };
  }

  const draft = activeDrafts.get(turnId);

  if (!draft) {
    throw fail('E_UNKNOWN_TURN', `Unknown turnId: ${turnId}`);
  }

  if (draft.state === 'finalized' && draft.finalizedResult) {
    return { ...draft.finalizedResult };
  }

  // Flush any pending patch before finalizing (real timer flush)
  if (draft.pendingTimer) {
    clearTimeout(draft.pendingTimer);
    draft.pendingTimer = null;
  }
  if (draft.pendingPatch) {
    applyPatch(draft, draft.pendingPatch);
    draft.pendingPatch = null;
  }

  const now = Date.now();
  const durationMs = now - draft.createdAt;

  // Rule 4: Short turns discarded if finalize before minDurationMs and no updates and no force
  if (durationMs < draft.minDurationMs && !draft.hasUpdates && !draft.force) {
    const discardedResult = {
      turnId: draft.turnId,
      state: 'discarded',
      durationMs,
      discarded: true,
    };
    // Remove from active, cache discarded
    activeDrafts.delete(turnId);
    discardedCache.set(turnId, discardedResult);
    draft.state = 'discarded';
    return { ...discardedResult };
  }

  // Long turn: finalize
  const result = {
    turnId: draft.turnId,
    state: 'finalized',
    finalMessage: finalMessage || '',
    durationMs,
  };

  draft.state = 'finalized';
  draft.finalizedResult = result;
  activeDrafts.delete(turnId);
  finalizedCache.set(turnId, result);

  return { ...result };
}

// Helper for testing / determinism checks — returns current draft state (pure, timestamps masked in tests)
export function _getState(turnId) {
  const draft = activeDrafts.get(turnId);
  if (!draft) return null;
  return {
    turnId: draft.turnId,
    headline: draft.headline,
    steps: [...draft.steps],
    toolLog: draft.toolLog ? [...draft.toolLog] : [],
    state: draft.state,
    hasUpdates: draft.hasUpdates,
    appliedCount: draft.appliedCount,
    attemptedCount: draft.attemptedCount,
  };
}

// Reset for tests (not part of public contract, but useful for probe isolation)
export function _reset() {
  for (const d of activeDrafts.values()) {
    if (d.pendingTimer) clearTimeout(d.pendingTimer);
  }
  activeDrafts.clear();
  finalizedCache.clear();
  discardedCache.clear();
}

export const draft = {
  create,
  update,
  finalize,
  _getState,
  _reset,
};

export default draft;
