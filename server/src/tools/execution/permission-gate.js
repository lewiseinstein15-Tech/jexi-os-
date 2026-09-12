/**
 * JEXI OS — tools — permission gate.
 *
 * Deny-by-default. A call is executed only when the active permission context
 * grants BOTH the tool name AND the risk level. Mimics the Hermes permission
 * model without importing it.
 */

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
    check(call) {
      if (allowAll) return { allowed: true };
      if (!tools.has(call.name)) {
        return { allowed: false, reason: `permission denied: tool "${call.name}" is not granted (deny-by-default)` };
      }
      return { allowed: true };
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