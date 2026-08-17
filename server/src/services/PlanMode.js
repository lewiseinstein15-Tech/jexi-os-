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
- Execution tools are HARD-DISABLED while plan mode is active — calls to them are
  refused by the runtime, so never rely on them.
- NEVER promise runtime artifacts while in plan mode: no preview links, no deployed
  apps, no generated files, no screenshots. Those exist only AFTER approval, during
  implementation. You may say: "After you approve, I will build it and provide a live
  preview link."
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
 * B111 — PLAN-MODE ENFORCEMENT: execution-capable tools are hard-refused
 * while plan mode is active (the prompt hint alone let the model both
 * promise preview links and call builders before approval). Read tools
 * (memory/knowledge/search) and the planning/interaction tools stay usable.
 */
export const PLAN_MODE_EXTRA_BLOCKED = new Set([
  'code-run', 'code-write', 'code-fix', 'run_code', 'preview-server',
  'create_sandbox', 'run_in_sandbox', 'build-check', 'test-automation',
  'lint-check', 'security-scan', 'run_in_background', 'link-open',
  'browser-drive', 'tab-manage', 'form-fill', 'universal-link', 'github-cli',
  'deploy', 'email-send', 'scheduler-create', 'computer-use',
]);

/**
 * Is this tool blocked by plan mode?
 * @param {string} slug tool slug
 * @param {object} args tool args (mcp/connector refinement)
 * @param {string} convId conversation id (undefined → not in a chat path)
 * @returns {boolean}
 */
export function planModeBlocked(slug, args = {}, convId) {
  if (!convId || !isPlanMode(convId)) return false;
  if (PLAN_MODE_EXTRA_BLOCKED.has(slug)) return true;
  // tier-based: exec / external / risky tools are execution-capable.
  const tier = tierOf(slug, args);
  return tier === 'exec' || tier === 'external' || tier === 'risky';
}

/** Lightweight tier lookup (mirrors ToolRuntime.toolTier for the gate). */
function tierOf(slug, args = {}) {
  if (slug === 'mcp-call') {
    const name = String(args.tool || '');
    const READ = new Set(['mcp-list', 'mcp-health', 'mcp-status']);
    return READ.has(name) ? 'read' : 'external';
  }
  if (slug === 'connector-call') {
    const method = String(args.method || 'send');
    return method === 'receive' || method === 'health' ? 'read' : 'external';
  }
  const TIERS = {
    'code-run': 'exec', 'git-status': 'exec', 'branch-manage': 'exec',
    'issue-track': 'exec', 'tab-manage': 'exec',
    'github-cli': 'external', 'browser-drive': 'external', 'form-fill': 'external',
    'mcp-call': 'external', 'connector-call': 'external',
  };
  return TIERS[slug] || 'read';
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
    note: 'Plan presented for review. Implementation starts only after the user approves — the preview link arrives with the implementation, not before.',
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
