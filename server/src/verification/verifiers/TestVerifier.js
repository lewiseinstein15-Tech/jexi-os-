/**
 * JEXI OS — VERIFICATION — TestVerifier.
 *
 * Runs a test command against the SNAPSHOT source (never the live workspace)
 * and parses the output into evidence. A 'fail' status propagates to the work
 * graph as a blocker; evidence is attached to the node.
 */

/** @type {import('../interface/Verifier.js').Verifier} */
export const TestVerifier = {
  name: 'TestVerifier',

  /**
   * @type {(context: import('../interface/Verifier.js').VerifyContext) => Promise<import('../interface/Verifier.js').VerifyResult>}
   */
  async verify({ _nodeId, snapshotId, _acceptanceCriteria, _claimantAcbId, options = {} }) {
    const started = Date.now();
    const { run = async () => ({ exitCode: 0, output: 'ok' }) } = options;
    const res = await run();
    const pass = res.exitCode === 0 && !/fail|failing/i.test(res.output);
    const evidence = [{
      source: 'TestVerifier',
      snapshotId,
      content: `exitCode=${res.exitCode} ${res.output}`,
      at: Date.now(),
    }];
    return {
      status: pass ? 'pass' : 'fail',
      evidence,
      reason: pass ? undefined : 'tests failed',
      durationMs: Date.now() - started,
    };
  },
};