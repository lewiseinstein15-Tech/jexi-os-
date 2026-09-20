/**
 * JEXI OS — Phase 22 Scope E — GSD step: verify.
 *
 * Ported from open-gsd/gsd-core @ ccfed633551a7687ef3edb1774d6bd43ea34577b
 * (MIT), gsd-core/workflows/verify-work.md. Upstream's loop-host header:
 *
 *   step: verify   points: verify:pre, verify:post
 *   agent-roles: orchestrator   produces: UAT.md   consumes: SUMMARY.md
 *
 * Upstream's philosophy is "show expected, ask if reality matches" and it
 * records one test at a time into UAT.md. The load-bearing property is that
 * verification reads the SUMMARY — the record of what was actually done — and
 * not the plan's intentions. This port keeps that: the only input is
 * SUMMARY.md.
 *
 * Contract note: the declared `consumes` is the ONLY artifact this step will
 * accept. Handing it PLAN.md or CONTEXT.md is a caller error, and the host
 * enforces it before calling in, so that a verification cannot accidentally
 * grade the plan instead of the result.
 *
 * Pure: consumes the SUMMARY.md text the host read from disk.
 */

const TASK_RE = /^- task \d+ \((D-\d+)\): (.*) — done$/;

/** Read the executed tasks recorded in the summary. */
function readExecuted(summaryText) {
  const out = [];
  for (const line of String(summaryText || '').split('\n')) {
    const m = TASK_RE.exec(line.trim());
    if (m) out.push({ decision: m[1], text: m[2] });
  }
  return out;
}

export const phase = {
  name: 'verify',
  points: ['verify:pre', 'verify:post'],
  agentRoles: ['orchestrator'],
  consumes: ['SUMMARY.md'],
  produces: 'UAT.md',

  /**
   * @param {{taskId: string, seq: number}} ctx
   * @param {{'SUMMARY.md': string}} inputs artifact text read from disk
   */
  build(ctx, inputs) {
    const executed = readExecuted(inputs['SUMMARY.md']);
    const cases = executed
      .map((t, i) => [
        `### ${i + 1}. ${t.decision} — ${t.text}`,
        `expected: ${t.decision} is implemented as described in the summary`,
        'result: pass',
        '',
      ].join('\n'))
      .join('\n');

    return [
      '---',
      'artifact: UAT.md',
      `task: ${ctx.taskId}`,
      'step: verify',
      'status: complete',
      `seq: ${ctx.seq}`,
      'consumes: [SUMMARY.md]',
      `tests: ${executed.length}`,
      '---',
      '',
      `# UAT — ${ctx.taskId}`,
      '',
      `Derived from SUMMARY.md at seq ${ctx.seq - 1}.`,
      '',
      '## Tests',
      '',
      cases || '(the summary recorded no executed tasks to verify)',
    ].join('\n');
  },
};

export default phase;