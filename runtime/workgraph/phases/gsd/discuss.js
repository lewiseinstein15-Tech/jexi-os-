/**
 * JEXI OS — Phase 22 Scope E — GSD step: discuss.
 *
 * Ported from open-gsd/gsd-core @ ccfed633551a7687ef3edb1774d6bd43ea34577b
 * (MIT), gsd-core/workflows/discuss-phase.md. Upstream's loop-host header for
 * this step declares:
 *
 *   step: discuss   points: discuss:pre, discuss:post
 *   agent-roles: orchestrator   produces: CONTEXT.md   consumes: (none)
 *
 * Upstream's job for this step: "Extract implementation decisions that
 * downstream agents need." It is the only step that turns the raw task into a
 * bounded, decided scope. The artifact is the seam — nothing else crosses.
 *
 * Pure: no filesystem access, no clock, no randomness. The host reads the
 * artifact and passes its text in; this module only renders a deterministic
 * string, so the same taskId + input always yields identical bytes.
 */

/** Deterministic decision extraction. Splits the task on ';' into decisions. */
function extractDecisions(input) {
  const parts = String(input || '')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length === 0) {
    return ['Scope is the task statement as given; no further decisions were supplied.'];
  }
  return parts;
}

export const phase = {
  name: 'discuss',
  points: ['discuss:pre', 'discuss:post'],
  agentRoles: ['orchestrator'],
  consumes: [],
  produces: 'CONTEXT.md',

  /**
   * @param {{taskId: string, input: string, seq: number}} ctx
   * @param {Record<string, string>} _inputs never populated — discuss consumes nothing
   */
  build(ctx, _inputs) {
    const decisions = extractDecisions(ctx.input);
    const body = decisions
      .map((d, i) => `- **D-${String(i + 1).padStart(2, '0')}:** ${d}`)
      .join('\n');

    return [
      '---',
      'artifact: CONTEXT.md',
      `task: ${ctx.taskId}`,
      'step: discuss',
      'status: ready-for-plan',
      `seq: ${ctx.seq}`,
      'consumes: []',
      '---',
      '',
      `# Phase Context — ${ctx.taskId}`,
      '',
      '## Phase Boundary',
      '',
      ctx.input,
      '',
      '## Implementation Decisions',
      '',
      body,
      '',
      "## Claude's Discretion",
      '',
      'Areas not captured above are left to the planner.',
      '',
    ].join('\n');
  },
};

export default phase;