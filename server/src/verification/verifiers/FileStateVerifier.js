/**
 * JEXI OS — VERIFICATION — FileStateVerifier.
 *
 * Compares the SNAPSHOT's file contents against expected values (from the
 * frozen acceptance criteria/claim). It NEVER reads the live workspace — it
 * reads only the immutable snapshot. A mismatch is a 'fail'.
 *
 * REAL BYTE COMPARE (Phase 5 Scope B): comparison is byte-for-byte (never a
 * regex or contains-cheat). On mismatch the evidence carries a real line-diff
 * (unified diff produced from the snapshot vs expected bytes) so the failure
 * output can be routed back as context.
 */

import { diffLines } from './diff.js';

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
    const diffs = [];
    for (const [p, expectedText] of Object.entries(expectedFiles)) {
      const expectedBuf = Buffer.from(String(expectedText), 'utf8');
      const actual = files[p];
      if (actual === undefined) {
        mismatches.push(`${p} missing`);
        diffs.push({ path: p, diff: `- ${expectedText}`.replace(/\n/g, '\n- ') });
        continue;
      }
      const actualBuf = Buffer.from(String(actual), 'utf8');
      const sameLength = expectedBuf.length === actualBuf.length;
      const sameBytes = sameLength && expectedBuf.equals(actualBuf);
      if (!sameBytes) {
        mismatches.push(`${p} differs`);
        diffs.push({ path: p, diff: diffLines(String(expectedText), String(actual)) });
      }
    }
    const pass = mismatches.length === 0;
    const evidence = [{
      source: 'FileStateVerifier',
      snapshotId,
      content: pass ? 'all files match expected state' : `mismatches: ${mismatches.join(', ')}`,
      at: Date.now(),
      meta: pass ? undefined : { diffs },
    }];
    return {
      status: pass ? 'pass' : 'fail',
      evidence,
      reason: pass ? undefined : mismatches.join('; '),
      durationMs: Date.now() - started,
    };
  },
};