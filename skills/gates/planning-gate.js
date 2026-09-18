/**
 * JEXI OS — HARD GATE — planning.
 *
 * BLOCKS any code-writing stage that is supposed to follow a plan until a
 * real plan exists. A plan is not a vibe: it needs a stated approach AND
 * >= 2 concrete steps. Opt-out is explicit: ctx.requiresPlan === false.
 *
 * ctx.plan = {
 *   id: string,             // e.g. spec/issue reference
 *   approach: string,       // one-paragraph approach
 *   steps: [string, ...]    // >= 2 concrete steps
 * }
 */
import { appendAudit } from './state.js';

export default {
  id: 'planning-gate',

  when: (ctx) => ctx?.stage === 'code' && ctx?.requiresPlan !== false,

  async check(ctx) {
    const p = ctx?.plan;
    if (!p || typeof p !== 'object') {
      return deny('no plan', ['plan'],
        'Write the plan first (approach + numbered steps), or set ctx.requiresPlan = false EXPLICITLY for trivial changes — silence is not an opt-out.');
    }
    if (!p.id || !p.approach) {
      return deny('plan missing id or approach', ['plan.id', 'plan.approach'],
        'Name the plan (spec/issue reference) and state the approach in one paragraph.');
    }
    if (!Array.isArray(p.steps) || p.steps.length < 2) {
      return deny('plan has fewer than 2 steps', ['plan.steps'],
        'A one-step plan is a guess. Break the change into at least 2 concrete, ordered steps.');
    }
    return allow(`plan '${p.id}' accepted (${p.steps.length} steps)`);
  },
};

function allow(evidence) {
  appendAudit({ gate: 'planning-gate', blocked: false, evidence });
  return { allowed: true, reason: evidence };
}

function deny(reason, missing, hint) {
  appendAudit({ gate: 'planning-gate', blocked: true, reason, missing });
  return { allowed: false, reason, missing, hint };
}
