/**
 * JEXI OS — HARD GATE — brainstorming.
 *
 * BLOCKS the planning stage until a brainstorming record exists: at least
 * one settled decision with a stated rejected alternative (JEXI Architect
 * rule: an ADR without alternatives is a press release).
 *
 * ctx.brainstorming = {
 *   completedAt: ISO-string,
 *   decisions: [{ decision, rejectedAlternative, why }]   // >= 1 required
 * }
 */
import { appendAudit } from './state.js';

export default {
  id: 'brainstorming-gate',

  when: (ctx) => ctx?.stage === 'plan',

  async check(ctx) {
    const b = ctx?.brainstorming;
    if (!b || typeof b !== 'object') {
      return deny('no brainstorming record', ['brainstorming'],
        'Run the brainstorming phase first: enumerate options for the shape of the change, settle at least one decision WITH its rejected alternative, then pass brainstorming.decisions.');
    }
    if (!Array.isArray(b.decisions) || b.decisions.length < 1) {
      return deny('brainstorming record has no settled decisions', ['brainstorming.decisions'],
        'Settle at least one decision: { decision, rejectedAlternative, why }.');
    }
    const incomplete = b.decisions.filter((d) => !d?.decision || !d?.rejectedAlternative);
    if (incomplete.length === b.decisions.length) {
      return deny('every "decision" is missing its rejected alternative', ['brainstorming.decisions[].rejectedAlternative'],
        'A decision without a rejected alternative is a press release. Record what you did NOT choose and why for at least one decision.');
    }
    return allow(`brainstorming settled (${b.decisions.length} decision(s), ${b.decisions.length - incomplete.length} with rejected alternatives)`);
  },
};

function allow(evidence) {
  appendAudit({ gate: 'brainstorming-gate', blocked: false, evidence });
  return { allowed: true, reason: evidence };
}

function deny(reason, missing, hint) {
  appendAudit({ gate: 'brainstorming-gate', blocked: true, reason, missing });
  return { allowed: false, reason, missing, hint };
}
