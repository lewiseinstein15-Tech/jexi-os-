/**
 * JEXI OS — Phase 8 Scope E — EXEC-BRIDGE AUDIT FACADE.
 *
 * The bridge's own audit face over the shared JSONL AuditLog
 * (runtimes/sandbox/audit.js). Every request — allowed, refused, or
 * unauthenticated — lands here with timestamp, caller, op, REDACTED args,
 * and the decision/result summary. This is the "every cross-network call
 * logged" guarantee made inspectable.
 */

import { AuditLog, redactArgs } from '../../runtimes/sandbox/audit.js';

export { AuditLog, redactArgs };

/** Open the bridge audit log at `file` (absolute JSONL path). */
export function openBridgeAudit({ file }) {
  return new AuditLog({ file, source: 'exec-bridge' });
}

/**
 * Record one handled request. `decision` = { status, rule, reason };
 * `resultSummary` = short human-readable outcome (never raw payloads).
 */
export function recordCall(auditLog, { ts, caller, op, args, authenticated, decision, resultSummary = null, latencyMs = null, direction = 'jexi-net -> sandbox-net' }) {
  return auditLog.append({
    ts,
    direction,
    caller,
    op,
    args,
    authenticated: Boolean(authenticated),
    decision,
    result: resultSummary,
    latencyMs,
  });
}

export default { openBridgeAudit, recordCall };
