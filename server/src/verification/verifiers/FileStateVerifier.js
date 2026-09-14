/**
 * JEXI OS — VERIFICATION — FileStateVerifier.
 *
 * Compares the SNAPSHOT's file contents against expected values (from the
 * frozen acceptance criteria/claim). It NEVER reads the live workspace — it
 * reads only the immutable snapshot. A mismatch is a 'fail'.
 */

/** @type {import('../interface/Verifier.js').Verifier} */
export const FileStateVerifier = {
  name: 'FileStateVerifier',

  /**
   * @type {(context: import('../interface/Verifier.js').VerifyContext) => Promise<import('../interface/Verifier.js').VerifyResult>}
   */
  async verify({ _nodeId, snapshotId, snapshot, _acceptanceCriteria, _claimantAcbId, options = {} }) {
    const started = Date.now();
    const { expectedFiles = {}, files = snapshot?.files ?? {} } = options;
    const mismatches = [];
    for (const [p, expectedText] of Object.entries(expectedFiles)) {
      const actual = files[p];
      if (actual === undefined) mismatches.push(`${p} missing`);
      else if (actual !== expectedText) mismatches.push(`${p} differs`);
    }
    const pass = mismatches.length === 0;
    const evidence = [{
      source: 'FileStateVerifier',
      snapshotId,
      content: pass ? 'all files match expected state' : `mismatches: ${mismatches.join(', ')}`,
      at: Date.now(),
    }];
    return {
      status: pass ? 'pass' : 'fail',
      evidence,
      reason: pass ? undefined : mismatches.join('; '),
      durationMs: Date.now() - started,
    };
  },
};