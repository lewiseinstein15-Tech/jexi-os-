/**
 * JEXI OS — CHAT RECOVERY (M10).
 *
 * Pure helpers that decide, HONESTLY, what a persisted chat run means after a
 * process restart, and how to project an in-memory graph RunState onto disk
 * without writing functions (or unbounded internal context) into JSON.
 *
 * The state machine (see AGENTS.md "Durable chat recovery (M10)"):
 *
 *   not_started           a run was queued but never began
 *   running               in flight in the CURRENT process (a live claim)
 *   interrupted           in flight when the process died — outcome UNKNOWN
 *   awaiting_approval     parked at a human confirmation gate (never auto-granted)
 *   awaiting_verification paused pending a verification outcome
 *   completed             finished successfully (terminal)
 *   failed                finished with an error (terminal)
 *   cancelled             cancelled / timed out (terminal)
 *
 * The critical invariant lives in `isResumable` + `resumeSafety`: a step that
 * may have executed side effects before an interruption is NOT blindly
 * repeated. `resumeSafety` reports `uncertain` in that case so the caller can
 * surface explicit uncertainty and require reconciliation instead of claiming
 * exactly-once behaviour.
 */

import { BOOT_EPOCH } from './DurableStore.js';

export const RECOVERY_STATES = Object.freeze({
  NOT_STARTED: 'not_started',
  RUNNING: 'running',
  INTERRUPTED: 'interrupted',
  AWAITING_APPROVAL: 'awaiting_approval',
  AWAITING_VERIFICATION: 'awaiting_verification',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
});

const TERMINAL = new Set([RECOVERY_STATES.COMPLETED, RECOVERY_STATES.FAILED, RECOVERY_STATES.CANCELLED]);

/** True for states that can never be resumed (the run already reached an end). */
export function isTerminal(state) { return TERMINAL.has(state); }

/**
 * Classify a persisted run record.
 * @param {object} record — the durable record ({ status, checkpointState, epoch, … })
 * @param {{bootEpoch?:string, now?:number}} [ctx]
 * @returns {string} one of RECOVERY_STATES
 */
export function classifyRun(record, { bootEpoch = BOOT_EPOCH } = {}) {
  if (!record || typeof record !== 'object') return RECOVERY_STATES.NOT_STARTED;
  const status = String(record.status || '');
  if (status === 'completed') return RECOVERY_STATES.COMPLETED;
  if (status === 'failed') return RECOVERY_STATES.FAILED;
  if (status === 'cancelled') return RECOVERY_STATES.CANCELLED;
  const cp = String(record.checkpointState || '');
  if (cp === 'awaiting_approval') return RECOVERY_STATES.AWAITING_APPROVAL;
  if (cp === 'awaiting_verification') return RECOVERY_STATES.AWAITING_VERIFICATION;
  // An in-flight run whose owning process is NOT this process was interrupted.
  if (record.epoch && record.epoch !== bootEpoch) return RECOVERY_STATES.INTERRUPTED;
  if (status === 'running' || status === 'paused') return RECOVERY_STATES.RUNNING;
  return RECOVERY_STATES.NOT_STARTED;
}

/** Can this record be resumed by the caller at all? (interrupted/approval only) */
export function isResumable(record, ctx) {
  const s = classifyRun(record, ctx);
  return s === RECOVERY_STATES.AWAITING_APPROVAL
    || s === RECOVERY_STATES.AWAITING_VERIFICATION
    || s === RECOVERY_STATES.INTERRUPTED;
}

/**
 * How safe is a resume?
 *   'safe'      — the run never reached a side-effecting node (parked before it)
 *   'uncertain' — the run may have executed an action whose outcome is unknown;
 *                 the caller MUST surface uncertainty and reconcile, and must
 *                 NOT present the resume as exactly-once.
 */
export function resumeSafety(record, ctx) {
  const s = classifyRun(record, ctx);
  if (s === RECOVERY_STATES.AWAITING_APPROVAL || s === RECOVERY_STATES.AWAITING_VERIFICATION) {
    // Parked BEFORE the action ran (that is what a confirmation gate means).
    return 'safe';
  }
  if (s === RECOVERY_STATES.INTERRUPTED) return 'uncertain';
  return 'safe';
}

/**
 * Project an in-memory value onto a JSON-safe structure: drop functions,
 * symbols, undefined and cycles; stringify bigints. Never throws.
 */
export function toJsonSafe(value, { maxDepth = 12 } = {}) {
  const seen = new WeakSet();
  const walk = (v, depth) => {
    if (v === null) return null;
    const t = typeof v;
    if (t === 'function' || t === 'symbol' || t === 'undefined') return undefined;
    if (t === 'bigint') return String(v);
    if (t !== 'object') return v;
    if (depth > maxDepth) return undefined;
    if (seen.has(v)) return undefined;
    seen.add(v);
    if (Array.isArray(v)) return v.map((x) => walk(x, depth + 1)).filter((x) => x !== undefined);
    const out = {};
    for (const [k, val] of Object.entries(v)) {
      const w = walk(val, depth + 1);
      if (w !== undefined) out[k] = w;
    }
    return out;
  };
  try { return walk(value, 0); } catch { return null; }
}

/**
 * Project a graph RunState for persistence. Everything a resume needs survives
 * (plan, query, intermediateResults, currentNode, resumeNode, confirmationPayload,
 * history, status) EXCEPT:
 *   - `context.opts` callbacks (functions — dropped by toJsonSafe; the resume
 *     re-attaches fresh opts), and
 *   - `brainContext` (recomputed on resume; stripping keeps the record small).
 */
export function projectRunState(state) {
  if (!state || typeof state !== 'object') return null;
  const safe = toJsonSafe(state);
  if (!safe || typeof safe !== 'object') return null;
  delete safe.brainContext;
  if (safe.context && typeof safe.context === 'object') {
    delete safe.context.sendEvent;
    delete safe.context.results;
    if (safe.context.opts && typeof safe.context.opts === 'object') {
      const { confirm: _c, onPause: _o, signal: _s, ...rest } = safe.context.opts;
      safe.context.opts = rest;
    }
  }
  return safe;
}

/** A one-line, honest description of a recovered run for logs / the UI. */
export function recoveryNote(record, state, ctx) {
  const s = state || classifyRun(record, ctx);
  switch (s) {
    case RECOVERY_STATES.AWAITING_APPROVAL:
      return 'Parked at an approval gate — it is NOT approved; reply "yes" to proceed or "no" to cancel.';
    case RECOVERY_STATES.AWAITING_VERIFICATION:
      return 'Paused awaiting verification — verification evidence is preserved; nothing was re-run.';
    case RECOVERY_STATES.INTERRUPTED:
      return 'Interrupted mid-run by a restart. The outcome of any action that had begun is UNKNOWN — it will not be reported as done.';
    case RECOVERY_STATES.RUNNING:
      return 'A run is in flight in this process.';
    case RECOVERY_STATES.COMPLETED:
      return 'Completed — the final result was preserved.';
    case RECOVERY_STATES.FAILED:
      return 'Failed — the recorded error was preserved.';
    case RECOVERY_STATES.CANCELLED:
      return 'Cancelled — no work will resume.';
    default:
      return 'No run recorded.';
  }
}

/** The parked confirmation payload of a run record (if any). */
export function parkedApproval(record) {
  return (record && record.state && record.state.confirmationPayload)
    || (record && record.confirmationPayload)
    || null;
}

/**
 * Does an approval match the record's OWN parked target? A stale or mismatched
 * approval (a different node/action) must NOT authorize a different action.
 */
export function approvalMatches(record, expected = {}) {
  const p = parkedApproval(record);
  if (!p) return false;
  if (expected.node && p.node && p.node !== expected.node) return false;
  if (expected.action && p.action && p.action !== expected.action) return false;
  return true;
}

/**
 * Can this record be resumed by an approval for `convId`? Combines every guard:
 * the run must exist for THIS session, be non-terminal, be in a resumable state,
 * and (when the caller names a target) the parked approval must match it.
 * @returns {{ok:boolean, reason?:string, state?:string, safety?:string}}
 */
export function canResumeApproval(record, convId, ctx = {}, expected = {}) {
  if (!record || !record.state || !record.plan) return { ok: false, reason: 'no_parked_run' };
  const s = classifyRun(record, ctx);
  if (isTerminal(s)) return { ok: false, reason: 'terminal', state: s };
  if (!isResumable(record, ctx)) return { ok: false, reason: 'not_resumable', state: s };
  if ((expected.node || expected.action) && !approvalMatches(record, expected)) {
    return { ok: false, reason: 'approval_mismatch', state: s };
  }
  return { ok: true, state: s, safety: resumeSafety(record, ctx) };
}

