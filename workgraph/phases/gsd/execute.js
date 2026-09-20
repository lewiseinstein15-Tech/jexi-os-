/**
 * JEXI OS — Phase 22 Scope E — GSD step: execute.
 *
 * Ported from open-gsd/gsd-core @ ccfed633551a7687ef3edb1774d6bd43ea34577b
 * (MIT), gsd-core/workflows/execute-phase.md. Upstream's loop-host header:
 *
 *   step: execute   points: execute:pre, execute:wave:pre, execute:wave:post, execute:post
 *   agent-roles: executor, verifier
 *   produces: SUMMARY.md   consumes: PLAN.md
 *
 * Upstream's note at execute-phase.md:1461 is the ported idea:
 * "Subagents: fresh context each. No polling. No context bleed." Each plan
 * task runs in its own context and reports a SUMMARY; the parent never carries
 * task state across them.
 *
 * Pure: consumes PLAN.md text only. It deliberately does NOT read CONTEXT.md —
 * the plan is the sole channel, matching the declared `consumes: PLAN.md`.
 */

const TASK_RE = /^\d+\. Implement (D-\d+) — (.*)$/;

/** Parse the plan's task list into executable units. */
function readTasks(planText) {
  const out = [];
  for (const line of String(planText || '').split('\n')) {
    const m = TASK_RE.exec(line.trim());
    if (m) out.push({ decision: m[1], text: m[2] });
  }
  return out;
}

export const phase = {
  name: 'execute',
  points: ['execute:pre', 'execute:wave:pre', 'execute:wave:post', 'execute:post'],
  agentRoles: ['executor', 'verifier'],
  consumes: ['PLAN.md'],
  produces: 'SUMMARY.md',

  /**
   * @param {{taskId: string, seq: number}} ctx
   * @param {{'PLAN.md': string}} inputs artifact text read from disk
   */
  build(ctx, inputs) {
    const tasks = readTasks(inputs['PLAN.md']);
    const rows = tasks
      .map((t, i) => `- task ${i + 1} (${t.decision}): ${t.text} — done`)
      .join('\n');

    return [
      '---',
      'artifact: SUMMARY.md',
      `task: ${ctx.taskId}`,
      'step: execute',
      'status: ready-for-verify',
      `seq: ${ctx.seq}`,
      'consumes: [PLAN.md]',
      `tasks_executed: ${tasks.length}`,
      '---',
      '',
      `# Summary — ${ctx.taskId}`,
      '',
      `Derived from PLAN.md at seq ${ctx.seq - 1}.`,
      '',
      '## Executed',
      '',
      rows || '(the plan contained no tasks)',
      '',
    ].join('\n');
  },
};

export default phase;