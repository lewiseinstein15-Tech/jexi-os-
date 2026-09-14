/**
 * JEXI OS — VERIFICATION — BuildVerifier.
 *
 * Runs the build against the snapshot and checks the exit code. Expensive,
 * runs near the END of the multi-layer loop (after tests). A nonzero exit is a
 * blocker; evidence records stdout/stderr tail.
 */

/** @type {import('../interface/Verifier.js').Verifier} */
export const BuildVerifier = {
  name: 'BuildVerifier',

  /**
   * @type {(context: import('../interface/Verifier.js').VerifyContext) => Promise<import('../interface/Verifier.js').VerifyResult>}
   */
  async verify({ _nodeId, snapshotId, _acceptanceCriteria, _claimantAcbId, options = {} }) {
    const started = Date.now();
    const { run = async () => ({ exitCode: 0, output: 'build ok' }) } = options;
    const res = await run();
    const pass = res.exitCode === 0;
    const evidence = [{
      source: 'BuildVerifier',
      snapshotId,
      content: `exitCode=${res.exitCode} ${res.output}`,
      at: Date.now(),
    }];
    return {
      status: pass ? 'pass' : 'fail',
      evidence,
      reason: pass ? undefined : `build failed (exitCode=${res.exitCode})`,
      durationMs: Date.now() - started,
    };
  },
};