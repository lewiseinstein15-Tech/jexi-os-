/**
 * JEXI OS — VERIFICATION — LintVerifier.
 *
 * Runs a lint command (syntax/diagnostics) on the snapshot source. Purely
 * syntactic; cheap; runs FIRST in the multi-layer loop. Any diagnostic line
 * (warning count, "error", "no-undef", etc.) becomes evidence.
 */

/** @type {import('../interface/Verifier.js').Verifier} */
export const LintVerifier = {
  name: 'LintVerifier',

  /**
   * @type {(context: import('../interface/Verifier.js').VerifyContext) => Promise<import('../interface/Verifier.js').VerifyResult>}
   */
  async verify({ _nodeId, snapshotId, _acceptanceCriteria, _claimantAcbId, options = {} }) {
    const started = Date.now();
    const { run = async () => ({ exitCode: 0, output: '' }) } = options;
    const res = await run();
    const diagnostics = (res.output.match(/error|warning|no-undef|semi|unused-vars/gi) || []).length;
    const pass = res.exitCode === 0 && diagnostics === 0;
    const evidence = [{
      source: 'LintVerifier',
      snapshotId,
      content: res.output || `no diagnostics (exitCode=${res.exitCode})`,
      at: Date.now(),
    }];
    return {
      status: pass ? 'pass' : 'fail',
      evidence,
      reason: pass ? undefined : `${diagnostics} diagnostics`,
      durationMs: Date.now() - started,
    };
  },
};