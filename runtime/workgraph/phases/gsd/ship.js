/**
 * JEXI OS — Phase 22 Scope E — GSD step: ship.
 *
 * Ported from open-gsd/gsd-core @ ccfed633551a7687ef3edb1774d6bd43ea34577b
 * (MIT), gsd-core/workflows/ship.md. Upstream's loop-host header:
 *
 *   step: ship   points: ship:pre, ship:post
 *   agent-roles: orchestrator   produces: (none)   consumes: UAT.md
 *
 * This is the loop's terminal step. Upstream's header is the notable one: it
 * is the only step that declares NO `produces`. The loop closes here — there
 * is no artifact for a sixth step to pick up, which is exactly why `ship` is
 * terminal and why a further `step()` is E_ALREADY_SHIPPED rather than an
 * advance into nothing.
 *
 * Upstream's preflight gate is the load-bearing part: ship refuses to run
 * unless verification passed. This port keeps that as an explicit readiness
 * check against the UAT artifact rather than a prose instruction, so a
 * verification that recorded issues cannot be shipped silently.
 *
 * Pure: consumes the UAT.md text the host read from disk.
 */

const STATUS_RE = /^status:\s*(.*)$/m;
const TESTS_RE = /^tests:\s*(\d+)$/m;
const RESULT_RE = /^result:\s*(.*)$/gm;

export class ShipBlocked extends Error {
  constructor(reason) {
    super(`E_SHIP_BLOCKED: ${reason}`);
    this.name = 'ShipBlocked';
    this.code = 'E_SHIP_BLOCKED';
    this.reason = reason;
  }
}

export const phase = {
  name: 'ship',
  points: ['ship:pre', 'ship:post'],
  agentRoles: ['orchestrator'],
  consumes: ['UAT.md'],
  produces: null,

  /**
   * @param {{taskId: string, seq: number}} ctx
   * @param {{'UAT.md': string}} inputs artifact text read from disk
   */
  build(ctx, inputs) {
    const uat = String(inputs['UAT.md'] || '');

    // Preflight: ship refuses to close the loop on an unverified or failing
    // UAT. Fail loudly rather than rendering a success record.
    const status = (STATUS_RE.exec(uat) || [])[1]?.trim();
    if (status !== 'complete') {
      throw new ShipBlocked(`UAT.md status is "${status ?? 'missing'}", expected "complete"`);
    }
    const failures = [...uat.matchAll(RESULT_RE)]
      .map((m) => m[1].trim())
      .filter((r) => r && r !== 'pass' && r !== 'pending');
    if (failures.length) {
      throw new ShipBlocked(`UAT.md records ${failures.length} non-passing test(s): ${failures.join(', ')}`);
    }

    const tests = (TESTS_RE.exec(uat) || [])[1] ?? '0';
    const seq = ctx.seq;

    return [
      '---',
      'artifact: null',
      `task: ${ctx.taskId}`,
      'step: ship',
      'status: shipped',
      `seq: ${seq}`,
      'consumes: [UAT.md]',
      'terminal: true',
      '---',
      '',
      `# Ship — ${ctx.taskId}`,
      '',
      `Loop closed from UAT.md at seq ${seq - 1}. ${tests} test(s) passed verification.`,
      '',
      'No artifact is produced: ship is the terminal step.',
      '',
    ].join('\n');
  },
};

export default phase;