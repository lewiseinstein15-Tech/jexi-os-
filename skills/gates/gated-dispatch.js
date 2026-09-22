/**
 * JEXI OS — HARD GATES — THE DISPATCH INTEGRATION POINT.
 *
 * gatedDispatch(action, ctx) is the single seam an agent dispatch path
 * calls INSTEAD of executing an action directly. Wiring map:
 *
 *   before an agent writes production code → tdd-gate          (ctx.actionKind === 'production')
 *   before an agent starts planning        → brainstorming-gate (ctx.stage === 'plan')
 *   before an agent writes code post-plan  → planning-gate      (ctx.stage === 'code')
 *   before a merge/push                    → review-gate        (ctx.action === 'push'|'merge')
 *
 * Control flow: every gate whose when(ctx) holds is checked in canonical
 * order; the FIRST {allowed:false} verdict halts dispatch — the action's
 * run() is never invoked — and the block is recorded in the audit log.
 * Only an all-allow verdict reaches action.run(ctx).
 */
import { GATES } from './index.js';
import { appendAudit } from './state.js';
import { registerExecutorGate } from '../../server/src/wiring/phase31-registries.js';

// W13 wiring (Phase 31 Scope 5 — approved extension): expose gatedDispatch to
// the server executor path. Exactly one import + one register call — the
// blocking dispatch above is untouched, and default-deny stays an owner call.
// The wiring module composes this dispatcher in AUDIT-ONLY mode in front of
// the shipped tool executor (see makeGatedExecutor).
registerExecutorGate(gatedDispatch);

export async function gatedDispatch(action, ctx = {}) {
  if (!action || typeof action.run !== 'function' || !action.name) {
    throw new TypeError('gatedDispatch: action must be { name, run(ctx) }');
  }
  for (const gate of GATES) {
    if (!gate.when(ctx)) continue;
    const verdict = await gate.check(ctx);
    if (!verdict.allowed) {
      // BLOCKED — the downstream action is never invoked.
      return {
        blocked: true,
        gate: gate.id,
        allowed: false,
        reason: verdict.reason ?? 'gate denial',
        missing: verdict.missing ?? [],
        hint: verdict.hint ?? null,
        actionRan: false,
      };
    }
  }
  const result = await action.run(ctx);
  appendAudit({ gate: null, action: action.name, blocked: false, actionRan: true });
  return { blocked: false, allowed: true, actionRan: true, result };
}

export default gatedDispatch;
