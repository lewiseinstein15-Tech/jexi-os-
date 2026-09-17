/**
 * JEXI OS — tools — permission gate.
 *
 * Deny-by-default. A call is executed only when the active permission context
 * grants BOTH the tool name AND the risk level. Mimics the Hermes permission
 * model without importing it.
 *
 * Phase 7(B): this gate is the kernel PreToolUse hook point — hooks run
 * BEFORE the permission check (server/src/kernel/hooks/runner.js).
 */

import { runPreToolUseHook } from '../../kernel/hooks/runner.js';
import { observePreToolUse } from '../../kernel/hooks/learning-seam.js'; // Phase 7(C) — observer journal

const DEFAULT_GRANTS = {
  tools: new Set(),       // tool names
  risk: 'low',            // max risk allowed: low → medium → high → critical
};

function riskRank(level) {
  return ['low', 'medium', 'high', 'critical'].indexOf(level); // -1 if unknown
}

export function makePermissionGate({ allowedTools = [], maxRisk = 'low', allowAll = false } = {}) {
  const tools = new Set(allowedTools.map((t) => String(t)));
  return {
    allowedTools: tools,
    maxRisk,
    check(call, ctx = {}) {
      // Phase 7(B): PreToolUse hooks run BEFORE the permission check — a
      // blocking hook (nonzero exit, exitBehavior:'block') short-circuits
      // the gate and the tool call is denied with the hook's reason.
      const hook = runPreToolUseHook(call, ctx);
      observePreToolUse(call, hook, ctx); // Phase 7(C): observer records every gated call (fail-soft)
      const hookOut = hook.logs.length ? { hookLogs: hook.logs } : {};
      if (hook.blocked) {
        return { allowed: false, reason: `blocked by hook ${hook.blocked.id} (exit ${hook.blocked.code}): ${hook.blocked.reason}`, ...hookOut };
      }
      if (allowAll) return { allowed: true, ...hookOut };
      if (!tools.has(call.name)) {
        return { allowed: false, reason: `permission denied: tool "${call.name}" is not granted (deny-by-default)`, ...hookOut };
      }
      return { allowed: true, ...hookOut };
    },
    checkRisk(definition) {
      const defRisk = definition?.riskLevel ?? 'medium';
      if (riskRank(defRisk) > riskRank(maxRisk)) {
        return { allowed: false, reason: `permission denied: tool "${definition?.name}" is ${defRisk}, above allowed max ${maxRisk}` };
      }
      return { allowed: true };
    },
  };
}

export const denyByDefault = makePermissionGate(); // empty grants → everything denied