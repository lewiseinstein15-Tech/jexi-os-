/**
 * JEXI OS — tools — risk guard.
 *
 * Runtime ring + side-effect enforcement. A tool may run only when its ring
 * is within the active sandbox ring and (for high-risk tools) the side
 * effects are acknowledged by a confirm callback.
 */

const RING_LEVELS = new Map([
  ['sandbox', 0],   // ephemeral, no host state
  ['container', 1], // host-adjacent but isolated
  ['host', 2],      // can touch host filesystem/network
  ['privileged', 3],// kernel / credentials
]);

export function ringRank(r) {
  return RING_LEVELS.get(r) ?? (typeof r === 'number' ? r : 0);
}

/**
 * @param {object} opts { sandboxRing, confirm?: (sideEffects, tool) => Promise<boolean>|boolean }
 */
export function makeRiskGuard({ sandboxRing = 'container', confirm = null } = {}) {
  return {
    sandboxRing,
    check(def, args = {}) {
      const toolRing = ringRank(def?.runtimeRing ?? 2);
      const allowedRing = ringRank(sandboxRing);
      if (toolRing > allowedRing) {
        return { allowed: false, reason: `risk: tool "${def?.name}" requires runtime ring ${def?.runtimeRing} (${toolRing}), sandbox allows ${sandboxRing} (${allowedRing})` };
      }
      const sideEffects = def?.sideEffects ?? [];
      if (def?.riskLevel === 'high' || def?.riskLevel === 'critical') {
        if (sideEffects.length === 0) {
          return { allowed: false, reason: `risk: high/critical tool "${def?.name}" must declare sideEffects` };
        }
        if (confirm && (typeof confirm === 'function')) {
          const ok = confirm(sideEffects, def);
          if (!ok) return { allowed: false, reason: `risk: side effects for "${def?.name}" not approved: ${sideEffects.join(', ')}` };
        }
      }
      return { allowed: true };
    },
  };
}