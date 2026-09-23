/**
 * JEXI OS — benchmarks/_meta/cost.js
 *
 * Hard cost cap — per-run ceiling enforcement for the unified layer.
 *
 * Policy (fail-fast, refuse-don't-clamp):
 *   charge(amount) throws E_COST_CAP_EXCEEDED when the charge would
 *   take `used` past the cap. The charge is REFUSED — `used` stays at
 *   its pre-charge value — so the caller (meta.run) can abort the run
 *   cleanly and mark the mid-flight task plus every remaining task
 *   NOT_RUN without phantom spend. Charging exactly to the cap is
 *   allowed (remaining 0); the next positive charge is refused.
 *
 *   assert() re-checks the invariant used <= cap — a defense for
 *   direct holders of the controller.
 *
 * snapshot() exposes { used, cap, remaining, currency } for envelope
 * fields costUsed / costCap and for scope-17 progress reporting.
 *
 * No I/O here: the controller is pure accounting. Errors ride
 * SemanticaError with stable codes.
 */

import { SemanticaError } from '../../semantica/_internal.js';

export function createCost({ cap, currency } = {}) {
  if (typeof cap !== 'number' || !Number.isFinite(cap) || cap < 0) {
    throw new SemanticaError('E_INVALID_ARGUMENT', `meta.cost: cap must be a finite non-negative number, got ${JSON.stringify(cap)}`);
  }
  const cur = currency ?? 'USD';
  if (typeof cur !== 'string' || cur.trim() === '') {
    throw new SemanticaError('E_INVALID_ARGUMENT', `meta.cost: currency must be a non-empty string, got ${JSON.stringify(cur)}`);
  }

  let used = 0;

  const snapshot = () => ({ used, cap, remaining: cap - used, currency: cur });

  return {
    charge(amount) {
      if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0) {
        throw new SemanticaError('E_INVALID_ARGUMENT', `meta.cost.charge: amount must be a finite non-negative number, got ${JSON.stringify(amount)}`);
      }
      if (used + amount > cap) {
        throw new SemanticaError(
          'E_COST_CAP_EXCEEDED',
          `meta.cost: charge ${amount} ${cur} would take used to ${used + amount}, over the hard per-run cap ${cap} ${cur} ` +
          `(charge refused, used stays ${used} ${cur} — the run aborts cleanly and unrun tasks are marked NOT_RUN)`,
        );
      }
      used += amount;
      return { used, cap, remaining: cap - used, currency: cur };
    },

    assert() {
      if (used > cap) {
        throw new SemanticaError('E_COST_CAP_EXCEEDED', `meta.cost: used ${used} ${cur} is over the hard cap ${cap} ${cur}`);
      }
    },

    snapshot,
  };
}
