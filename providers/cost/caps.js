/**
 * JEXI OS — Cost caps — threshold engine (Phase 9 E).
 *
 * Two thresholds over a session's spend-to-budget ratio:
 *   warn (default 0.8) — soft warning, fired ONCE per session per
 *                        threshold value (no spam on every check);
 *   cap  (default 1.0) — hard cap, TERMINAL: the session cannot spend
 *                        more; record() refuses with E_SESSION_CAPPED.
 *
 * Semantics that matter (all probed in scripts/phase9-e-probe.mjs):
 * - Ratio math is threshold INCLUSIVE: ratio >= warn warns (80% warns),
 *   ratio >= cap caps (100% caps). A tiny EPSILON absorbs double noise
 *   in the division; the ledger itself is integer micro-US$ (tracker.js).
 * - The record that CROSSES the cap is accepted, not refused: the spend
 *   already happened upstream (the model call was made) — refusing to
 *   write it would falsify the ledger. The session flips terminal and
 *   every FURTHER record is refused. Defense in depth: cap fires in
 *   record() even if the caller never calls check().
 * - check() never un-caps. Cap is terminal until reset().
 * - check({ spendUsd }) evaluates a PROPOSED total (preflight) without
 *   recording it — that is the shape a provider bridge uses BEFORE a
 *   model call (projected = ledger total + estimateCost(request)).
 * - reset(sessionId?) wipes spend, warnings and the cap flag. It is the
 *   ONLY way out of a capped session, and it is irreversible.
 *
 * Budget: budgetUsd can be passed to check() (cached in the ledger,
 * last-writer-wins — budget changes are an operator action) or to
 * record(). With no budget known, check() fails E_NO_BUDGET rather than
 * guessing.
 */

import { createTracker, usdToMicros, microsToUsd } from './tracker.js';

export const DEFAULT_WARN_THRESHOLD = 0.8;
export const DEFAULT_CAP_THRESHOLD = 1.0;
const EPSILON = 1e-12; // ratio-vs-threshold double guard (ledger is integer)

export class CapsError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'CapsError';
    this.code = code;
  }
}

function assertId(value, name) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new CapsError('E_INVALID_ARG', `${name} must be a non-empty string`);
  }
}

function resolveThreshold(value, envName, fallback, label) {
  const raw = value ?? process.env[envName] ?? fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    throw new CapsError('E_INVALID_THRESHOLDS', `${label} threshold must be a finite number > 0 (got ${String(raw)}; sources: arg, env ${envName}, built-in default)`);
  }
  return n;
}

export function createCaps(options = {}) {
  const tracker = options.tracker ?? createTracker({ persistPath: process.env.JEXI_COST_LEDGER_PATH || null });
  const warnThreshold = resolveThreshold(options.warn, 'JEXI_COST_WARN_THRESHOLD', DEFAULT_WARN_THRESHOLD, 'warn');
  const capThreshold = resolveThreshold(options.cap, 'JEXI_COST_CAP_THRESHOLD', DEFAULT_CAP_THRESHOLD, 'cap');
  if (warnThreshold > capThreshold) {
    throw new CapsError('E_INVALID_THRESHOLDS', `warn threshold (${warnThreshold}) must be <= cap threshold (${capThreshold})`);
  }

  /** Pure verdict over integer micros. Inclusive boundaries. */
  function evaluate(spendMicros, budgetMicros) {
    const ratio = spendMicros / budgetMicros;
    const pct = Math.round(ratio * 10000) / 100; // 2 decimals
    if (ratio >= capThreshold - EPSILON) return { state: 'cap', pct };
    if (ratio >= warnThreshold - EPSILON) return { state: 'warn', pct };
    return { state: 'ok', pct };
  }

  /** Deterministic reason strings — no timestamps inside (timestamps live
   *  in dedicated fields), so identical ledger state yields byte-identical
   *  verdicts across processes (probe P10). */
  function canonicalReason(state, pct, spendUsd, budgetUsd) {
    if (state === 'cap') {
      return `spend ${spendUsd} USD of ${budgetUsd} USD budget (${pct}%) — hard cap ${capThreshold * 100}% reached; session terminated`;
    }
    if (state === 'warn') {
      return `spend ${spendUsd} USD of ${budgetUsd} USD budget (${pct}%) — soft threshold ${warnThreshold * 100}% crossed`;
    }
    return undefined;
  }

  function budgetMicrosFor(entry, budgetUsd) {
    if (budgetUsd != null) {
      const n = Number(budgetUsd);
      if (!Number.isFinite(n) || n <= 0) {
        throw new CapsError('E_INVALID_BUDGET', `budgetUsd must be a finite number > 0, got ${String(budgetUsd)}`);
      }
      const micros = usdToMicros(n);
      tracker.setBudget(entry.sessionId, micros); // cached, last-writer-wins
      entry.budgetMicros = micros;
      return micros;
    }
    if (entry.budgetMicros != null) return entry.budgetMicros;
    throw new CapsError('E_NO_BUDGET', `no budget known for session "${entry.sessionId}" — pass budgetUsd once (it is cached in the ledger)`);
  }

  function fireWarning(sessionId, entry, pct) {
    const key = String(warnThreshold); // one warning per session PER THRESHOLD
    if (entry.warnFired[key]) return { warnEmitted: false, warnAlreadyEmitted: true };
    const at = new Date().toISOString();
    tracker.mutate(sessionId, (e) => {
      e.warnFired[key] = at;
      e.warnings.push({ threshold: warnThreshold, pct, at });
    });
    return { warnEmitted: true, warnAlreadyEmitted: false };
  }

  function fireCap(sessionId, entry, pct) {
    if (entry.capped) return false;
    const reason = canonicalReason('cap', pct, microsToUsd(entry.totalMicros), microsToUsd(entry.budgetMicros));
    tracker.mutate(sessionId, (e) => {
      e.capped = true;
      e.cappedAt = new Date().toISOString();
      e.cappedReason = reason;
    });
    return true;
  }

  /**
   * Evaluate a session (or a PROPOSED spend via spendUsd) against its budget.
   * Contract: { state, reason?, pct, remainingUsd } + additive fields.
   */
  function check({ sessionId, providerId = null, spendUsd = null, budgetUsd } = {}) {
    assertId(sessionId, 'sessionId');
    if (providerId != null) assertId(providerId, 'providerId');
    const entry = tracker.ensureSession(sessionId);
    const budgetMicros = budgetMicrosFor(entry, budgetUsd);
    let spendMicros = entry.totalMicros;
    let preflight = false;
    if (spendUsd != null) {
      spendMicros = usdToMicros(spendUsd); // E_INVALID_SPEND on negative/non-finite
      preflight = true;
    }
    const ev = evaluate(spendMicros, budgetMicros);
    const state = entry.capped ? 'cap' : ev.state; // terminal cap wins over arithmetic
    // Warn-once evidence is a property of the PERSISTED ledger, not of this
    // verdict's branch: even when the cap supersedes the warn band, the flag
    // must still report that the threshold's warning already fired (no re-
    // spam after restart — probed cross-process in P10b).
    const warnKey = String(warnThreshold);
    let warnEmitted = false;
    let warnAlreadyEmitted = Boolean(entry.warnFired[warnKey]);
    if (state === 'warn' && !warnAlreadyEmitted) {
      const at = new Date().toISOString();
      tracker.mutate(sessionId, (e) => {
        e.warnFired[warnKey] = at;
        e.warnings.push({ threshold: warnThreshold, pct: ev.pct, at });
      });
      warnEmitted = true;
    }
    if (state === 'cap') {
      fireCap(sessionId, entry, ev.pct); // idempotent when already capped
    }
    const spendUsdNow = microsToUsd(spendMicros);
    const budgetUsdNow = microsToUsd(budgetMicros);
    const out = {
      state,
      pct: ev.pct,
      remainingUsd: microsToUsd(Math.max(0, budgetMicros - spendMicros)),
      spendUsd: spendUsdNow,
      budgetUsd: budgetUsdNow,
      sessionId,
      providerId,
      preflight,
      warnEmitted,
      warnAlreadyEmitted,
      terminated: Boolean(entry.capped),
    };
    if (state !== 'ok') out.reason = canonicalReason(state, ev.pct, spendUsdNow, budgetUsdNow);
    return out;
  }

  /** Add spend to the ledger. Returns the updated ledger entry. */
  function record({ sessionId, providerId, usd, budgetUsd } = {}) {
    assertId(sessionId, 'sessionId');
    assertId(providerId, 'providerId');
    const entry = tracker.ensureSession(sessionId);
    if (entry.capped) {
      const reason = `session "${sessionId}" is capped (terminated at ${entry.cappedAt}): ${entry.cappedReason} — further spend refused`;
      tracker.noteAttempt(sessionId, {
        at: new Date().toISOString(),
        providerId,
        usd: Number(usd),
        code: 'E_SESSION_CAPPED',
        reason,
      });
      throw new CapsError('E_SESSION_CAPPED', reason);
    }
    const delta = usdToMicros(usd); // E_INVALID_SPEND on negative/non-finite; 0 allowed (cached call)
    if (budgetUsd != null) budgetMicrosFor(entry, budgetUsd);
    tracker.addSpend(sessionId, providerId, delta);
    // Threshold self-evaluation — cap fires even if the caller never checks.
    let event;
    if (entry.budgetMicros != null) {
      const ev = evaluate(entry.totalMicros, entry.budgetMicros);
      if (ev.state === 'cap') {
        if (fireCap(sessionId, entry, ev.pct)) event = 'cap';
      } else if (ev.state === 'warn') {
        const r = fireWarning(sessionId, entry, ev.pct);
        if (r.warnEmitted) event = 'warn';
      }
    }
    const out = {
      ok: true,
      sessionId,
      providerId,
      usd: microsToUsd(delta),
      providerUsd: microsToUsd(entry.providers[providerId] ?? 0),
      sessionTotalUsd: microsToUsd(entry.totalMicros),
      entry: publicEntry(entry),
    };
    if (event) out.event = event;
    return out;
  }

  /** Clear ONE session (sessionId given) or ALL (omitted). Irreversible. */
  function reset(sessionId) {
    if (sessionId == null) {
      const cleared = tracker.clear();
      return { ok: true, scope: 'all', cleared };
    }
    assertId(sessionId, 'sessionId');
    const existed = tracker.deleteSession(sessionId);
    return { ok: true, scope: 'session', sessionId, cleared: existed ? 1 : 0 };
  }

  /** Read accessor for probes/ops — USD-derived ledger view. */
  function ledger(sessionId) {
    if (sessionId == null) {
      return tracker.listSessions().map((id) => publicEntry(tracker.getSession(id)));
    }
    const entry = tracker.getSession(sessionId);
    return entry ? publicEntry(entry) : null;
  }

  function publicEntry(entry) {
    return {
      sessionId: entry.sessionId,
      providers: Object.fromEntries(Object.entries(entry.providers).map(([pid, m]) => [pid, microsToUsd(m)])),
      totalUsd: microsToUsd(entry.totalMicros),
      budgetUsd: entry.budgetMicros == null ? null : microsToUsd(entry.budgetMicros),
      capped: Boolean(entry.capped),
      cappedAt: entry.cappedAt,
      cappedReason: entry.cappedReason,
      warnings: entry.warnings,
      attempts: entry.attempts,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
    };
  }

  return { check, record, reset, ledger, thresholds: () => ({ warn: warnThreshold, cap: capThreshold }) };
}

// Module default instance: in-memory unless JEXI_COST_LEDGER_PATH is set.
// Thresholds overridable via JEXI_COST_WARN_THRESHOLD / JEXI_COST_CAP_THRESHOLD.
export const caps = createCaps();
