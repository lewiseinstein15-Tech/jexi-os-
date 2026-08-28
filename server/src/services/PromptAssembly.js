/**
 * B119 — PROMPT ASSEMBLY (DeepSeek Harness `core/system-prompt` mirror:
 * ordered sections joined in ascending order, exactly like DSH's
 * systemPrompt.assemble()).
 *
 * Section order (DSH conventions):
 *   -100 persona/identity        (JEXI_SYSTEM_PROMPT core + identity)
 *    -90 agent instructions      (project knowledge / JEXI.md)
 *    -80 time context            (dsh time-context)
 *    -70 session references      (dsh session-reference — past sessions)
 *    -60 skill catalog           (dsh tool-skill catalog, metadata only)
 *    -50 live state              (todo list, plan status, goal status)
 *    -40 tool guidance           (code-mode SDK block)
 *    -30 preset flavor           (dsh persona/config flavor line)
 *    -20 preferences             (learned user preferences)
 *    -10 policy                  (plan-mode policy when active)
 *
 * Sections are individually selectable so callers never duplicate content
 * that their own context already provides (e.g. the SIMPLE path already
 * injects conversation context — it skips the session-references section).
 */

import { JEXI_SYSTEM_PROMPT, JEXI_NORMAL_PROMPT } from './JexiPrompt.js';
import { timeContextBlock } from './TimeContext.js';
import { buildSkillCatalog } from './SkillDiscovery.js';
import { preferencesBlock } from './PreferenceLearner.js';
import { recentSessionsBlock } from './SessionConversations.js';
import { todoList } from './TodoStore.js';
import { planGet } from './PlanStore.js';
import { PLAN_POLICY_SECTION } from './PlanMode.js';

/* ---------------- live-state sections (dsh todo/plan/goal injection) ---- */

/** DSH tool-todo: the model's visible task list renders into the prompt. */
export function todoStateBlock() {
  try {
    const todos = todoList();
    if (!todos || !todos.length) return '';
    const lines = todos.map((t) => `- [${t.done ? 'x' : ' '}] ${String(t.text || '').slice(0, 160)}`);
    return `\n## Current todo list\n${lines.join('\n')}\n`;
  } catch { return ''; }
}

/** DSH plan-mode/plan: the active plan with per-step status renders. */
export function planStateBlock() {
  try {
    const plan = planGet();
    if (!plan || !plan.steps || !plan.steps.length) return '';
    const status = plan.status ? ` (${plan.status})` : '';
    const lines = plan.steps.map((s) => `- [${s.status === 'done' ? 'x' : ' '}] ${String(s.text || '').slice(0, 200)}${s.status && s.status !== 'pending' && s.status !== 'done' ? ` — ${s.status}` : ''}`);
    return `\n## Current plan${status}\n${String(plan.title || '').slice(0, 120)}\n${lines.join('\n')}\n`;
  } catch { return ''; }
}

/** Active goal status (dsh goal: the goal loop's state renders). */
let goalEngineRef = null;
export function setGoalEngine(engine) {
  goalEngineRef = engine && typeof engine.listGoals === 'function' ? engine : null;
}

export function goalStateBlock() {
  try {
    if (!goalEngineRef) return '';
    const goals = goalEngineRef.listGoals();
    const active = (goals || []).filter((g) => g && g.status === 'active').slice(0, 3);
    if (!active.length) return '';
    const lines = active.map((g) => `- ${String(g.query || g.text || '').slice(0, 140)} (started ${new Date(g.createdAt || Date.now()).toISOString().slice(0, 16)})`);
    return `\n## Active goals (background)\n${lines.join('\n')}\n`;
  } catch { return ''; }
}

/* ---------------- assembly ------------------------------------------------- */

/**
 * Assemble the system prompt in DSH section order.
 * @param {object} o
 * @param {string} [o.convId] conversation id (session references + lifecycle)
 * @param {boolean} [o.codeMode] append the code-mode SDK block
 * @param {Array} [o.codeTools] tool defs for the SDK block
 * @param {string} [o.presetFlavor] dsh preset flavor line
 * @param {boolean} [o.planMode] plan-mode policy section
 * @param {boolean} [o.includeSkills=true] skill catalog section
 * @param {boolean} [o.includeSessionRefs=true] past-sessions section
 * @param {boolean} [o.includeState=true] todo/plan/goal sections
 * @param {string} [o.base] overrides the core section (default JEXI_SYSTEM_PROMPT)
 * @param {boolean} [o.normalMode] use the normal-mode core instead
 * @returns {Promise<string>} assembled prompt
 */
export async function assemblePrompt({
  convId = null,
  codeMode = false,
  codeTools = [],
  presetFlavor = '',
  planMode = false,
  includeSkills = true,
  includeSessionRefs = true,
  includeState = true,
  includeInstructions = true, // B136 — AGENTS.md baseline instructions section
  base = null,
  normalMode = false,
  userText = null, // B160 — raw user message; @file mentions become file references
} = {}) {
  const sections = [];

  // -100 persona + core principles (single source: the canonical system prompt).
  sections.push(base || (normalMode ? JEXI_NORMAL_PROMPT : JEXI_SYSTEM_PROMPT));

  // -90 agent instructions: project knowledge is embedded in the core prompt
  // (loadProjectKnowledge in JEXI_SYSTEM_PROMPT) — nothing extra here.

  // -80 time context (idempotent with the LLMClient fallback).
  const tz = timeContextBlock();
  if (!sections[sections.length - 1].includes('Current date and time:')) sections.push(tz);

  // -75 terminal context (B138 — dsh tmux-context): only when JEXI runs
  // inside a tmux session; empty elsewhere (never injected).
  try {
    const { tmuxContextBlock } = await import('./TmuxContext.js');
    const tmux = tmuxContextBlock();
    if (tmux) sections.push(tmux);
  } catch { /* noop */ }

  // -70 session references (past conversations).
  if (includeSessionRefs && convId) {
    const refs = recentSessionsBlock(convId, 5);
    if (refs) sections.push(refs);
  }

  // -72 file references (B160 — dsh file-reference/file-reference-local):
  // @file mentions in the user's message become guarded, bounded read-only
  // snapshots of those workspace files.
  if (userText) {
    try {
      const { parseFileReferences, renderFileReferenceSnapshot } = await import('./FileReference.js');
      const mentioned = parseFileReferences(userText);
      if (mentioned.length) {
        const snap = renderFileReferenceSnapshot(mentioned);
        if (snap.text) sections.push(snap.text);
      }
    } catch { /* file references are best-effort */ }
  }

  // -68 current conversation tail (B155 — dsh session-projection mirror):
  // the last few user/JEXI turns of THIS conversation, so autonomous runners
  // (research / coding loops) keep the thread instead of starting fresh.
  // Callers that already inject their own conversation context (SimpleTask)
  // disable session refs entirely, so nothing is ever duplicated.
  if (includeSessionRefs && convId) {
    try {
      const { projectedConversationBlock } = await import('./SessionProjection.js');
      const tail = projectedConversationBlock(convId, { maxChars: 4000 });
      if (tail) sections.push(tail);
    } catch { /* the tail must never break the prompt */ }
  }

  // -60 skill catalog (metadata only).
  if (includeSkills) {
    const skills = buildSkillCatalog(30);
    if (skills) sections.push(skills);
  }

  // -55 project instructions (B136 — dsh agent-instructions): AGENTS.md
  // baseline files become working rules; rendered once per assembly and
  // marked seen so only genuinely NEW versions re-enter the context.
  if (includeInstructions) {
    try {
      const { loadBaselineInstructionSet, renderInstructionsBlock, markInstructionsSeen } = await import('./AgentInstructions.js');
      const inst = loadBaselineInstructionSet();
      const block = renderInstructionsBlock(inst);
      if (block) {
        sections.push(block);
        markInstructionsSeen(inst);
      }
    } catch { /* the instructions section must never break the prompt */ }
  }

  // -50 live state: todo + plan + goal.
  if (includeState) {
    const todo = todoStateBlock();
    if (todo) sections.push(todo);
    const plan = planStateBlock();
    if (plan) sections.push(plan);
    const goal = goalStateBlock();
    if (goal) sections.push(goal);
  }

  // -40 tool guidance: code-mode SDK.
  if (codeMode && codeTools && codeTools.length) {
    const { renderToolsSdk } = await import('./CodeModeRuntime.js');
    sections.push(`\n${renderToolsSdk(codeTools)}\n`);
  }

  // -30 preset flavor.
  if (presetFlavor) sections.push(`\n${presetFlavor}\n`);

  // -20 preferences.
  sections.push(preferencesBlock());

  // -10 policy (plan mode).
  if (planMode) sections.push(`\n${PLAN_POLICY_SECTION}\n`);

  return sections.join('\n');
}
