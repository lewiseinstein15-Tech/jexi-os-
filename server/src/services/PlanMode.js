/**
 * B110 — PLAN MODE (mirror of DeepSeek Harness `packages/plan/plan-mode`).
 *
 * While plan mode is active, the model plans instead of executing: the
 * system prompt carries a plan:policy section, and `exit_plan_mode`
 * presents the completed plan for user review. Implementation begins only
 * after approval; on rejection the feedback comes back and the model
 * revises. State is per-conversation and log-backed (a `plan/mode` event,
 * last one wins), exactly like DSH's plan/mode session events.
 */

import { loadConversationEvents, appendConversationEvent } from './SessionConversations.js';
import { planSet, planGet } from './PlanStore.js';

/** DSH deployment-owned plan guidance (plan:policy section). */
export const PLAN_POLICY_SECTION = `## PLAN MODE (active)

You are in PLAN MODE. Your job right now is to THINK and PLAN, not to execute:
- Analyze the request, break it into steps, decide the tools/agents each step needs.
- Do NOT call execution tools (search, write, run, build, research) yet.
- When your plan is complete, call exit_plan_mode with the full plan as markdown
  (title, steps with owner tool/agent, verification per step, open questions).
- Implementation begins ONLY after the user approves the plan. If the user sends
  changes or rejects, incorporate the feedback and present a revised plan.
- Do not paste the plan as a plain reply — exit_plan_mode is the only way to present it.`;

/** Fold plan mode from the conversation log (DSH: plan/mode last one wins). */
export function foldPlanMode(convId) {
  try {
    const events = loadConversationEvents(convId, 2000);
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i];
      if (e.kind === 'plan/mode') return !!(e.meta && e.meta.active);
    }
  } catch { /* noop */ }
  return false;
}

/** Is plan mode active for this conversation? */
export function isPlanMode(convId) {
  return foldPlanMode(convId);
}

/** Turn plan mode on/off (log-backed, DSH last-wins). */
export function setPlanMode(convId, active) {
  try {
    appendConversationEvent(convId, {
      role: 'system',
      kind: 'plan/mode',
      text: `Plan mode ${active ? 'ON' : 'OFF'}`,
      meta: { active: !!active },
    });
  } catch { /* noop */ }
  return { ok: true, active: !!active };
}

/** The prompt section appended while plan mode is active. */
export function planModePromptSection(convId) {
  return isPlanMode(convId) ? `\n${PLAN_POLICY_SECTION}\n` : '';
}

/**
 * Present a plan for review (exit_plan_mode engine). Stores the plan and
 * marks it pending review; the chat route surfaces an APPROVE/REVISE card.
 */
export function presentPlan(convId, planMarkdown) {
  const md = String(planMarkdown || '').trim();
  if (md.length < 20) return { ok: false, error: 'plan is too short to present' };
  try {
    const steps = md.split('\n').filter((l) => /^\s*[-*0-9]/.test(l)).slice(0, 24).map((l) => l.replace(/^[\s>*#-]+/, '').slice(0, 200));
    const title = String(md.split('\n')[0] || 'Plan').replace(/^#+\s*/, '').slice(0, 80);
    planSet(title, steps, { status: 'pending_review', markdown: md.slice(0, 12000), at: Date.now() });
  } catch { /* plan store is best-effort */ }
  return {
    ok: true,
    kind: 'plan-review',
    status: 'pending_review',
    plan: md.slice(0, 12000),
    note: 'Plan presented for review. Implementation starts only after the user approves.',
  };
}

/** The currently stored plan (if any). */
export function currentPlan(convId) {
  try { return planGet() || null; } catch { return null; }
}

/** Approve the presented plan (route resumes implementation). */
export function approvePlan(convId) {
  try {
    const p = planGet();
    if (p) { planSet(p.title, p.steps.map((x) => x.text), { status: 'approved', approvedAt: Date.now(), markdown: p.markdown }); }
  } catch { /* noop */ }
  return { ok: true, approved: true };
}
