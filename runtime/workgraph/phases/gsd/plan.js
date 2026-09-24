/**
 * JEXI OS — Phase 22 Scope E — GSD step: plan.
 *
 * Ported from open-gsd/gsd-core @ ccfed633551a7687ef3edb1774d6bd43ea34577b
 * (MIT), gsd-core/workflows/plan-phase.md. Upstream's loop-host header:
 *
 *   step: plan   points: plan:pre, plan:post
 *   agent-roles: researcher, planner, checker
 *   produces: PLAN.md   consumes: CONTEXT.md
 *
 * Upstream runs three roles in sequence: the researcher reads CONTEXT.md to
 * know WHAT to investigate, the planner reads it to know which decisions are
 * locked, the checker validates the result. This port collapses the roles into
 * one deterministic transform but keeps the artifact seam identical: CONTEXT.md
 * in, PLAN.md out.
 *
 * Pure: consumes the CONTEXT.md text the host read from disk, records that
 * artifact as its declared dependency, and emits PLAN.md.
 */

const DECISION_RE = /^- \*\*(D-\d+):\*\* (.*)$/;

/** Parse the decisions discuss emitted, so the plan can cite them by id. */
function readDecisions(contextText) {
  const out = [];
  for (const line of String(contextText || '').split('\n')) {
    const m = DECISION_RE.exec(line.trim());
    if (m) out.push({ id: m[1], text: m[2] });
  }
  return out;
}

export const phase = {
  name: 'plan',
  points: ['plan:pre', 'plan:post'],
  agentRoles: ['researcher', 'planner', 'checker'],
  consumes: ['CONTEXT.md'],
  produces: 'PLAN.md',

  /**
   * @param {{taskId: string, seq: number}} ctx
   * @param {{'CONTEXT.md': string}} inputs artifact text read from disk
   */
  build(ctx, inputs) {
    const contextText = inputs['CONTEXT.md'];
    const decisions = readDecisions(contextText);

    const tasks = decisions.map((d, i) => (
      `${i + 1}. Implement ${d.id} — ${d.text}`
    )).join('\n');

    return [
      '---',
      'artifact: PLAN.md',
      `task: ${ctx.taskId}`,
      'step: plan',
      'status: ready-for-execute',
      `seq: ${ctx.seq}`,
      'consumes: [CONTEXT.md]',
      `decisions: ${decisions.map((d) => d.id).join(', ')}`,
      '---',
      '',
      `# Plan — ${ctx.taskId}`,
      '',
      `Derived from CONTEXT.md at seq ${ctx.seq - 1}.`,
      '',
      '## Tasks',
      '',
      tasks || '(no decisions were available to plan from)',
      '',
    ].join('\n');
  },
};

export default phase;