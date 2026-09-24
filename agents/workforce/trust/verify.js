/**
 * JEXI OS — PHASE 13 SCOPE E — VERIFICATION PATH.
 *
 *   verify(agentId, payload, sig, expected?) -> { valid, reason? }
 *
 * Valid means BOTH the signature matches AND the payload hash matches. A
 * mismatch is attributed honestly and specifically:
 *
 *   payload altered (hash differs from the carried/expected hash)
 *     -> { valid: false, reason: 'E_PAYLOAD_MISMATCH' }
 *   signature does not verify under the agent's key
 *     -> { valid: false, reason: 'E_SIG_MISMATCH' }
 *
 * Attribution order is declared and fixed: payload first, then signature.
 * When a caller supplies `expected` ({ sig, hash } from sign()), both the
 * recomputed payload hash and the recomputed signature are compared against
 * it; without it, the payload's own carried hash anchors the check (and a
 * payload whose carried hash disagrees with its recomputed hash is already a
 * tamper verdict). Order matters for P4: tampered payload must report
 * E_PAYLOAD_MISMATCH even though the recomputed signature would also fail.
 */

import { payloadHash, expectedSig } from './signing.js';

export const REASONS = {
  SIG_MISMATCH: 'E_SIG_MISMATCH',
  PAYLOAD_MISMATCH: 'E_PAYLOAD_MISMATCH',
};

/**
 * Verify a signed payload.
 *
 * The SIGNATURE UNDER TEST is always the `sig` argument — an `expected`
 * record ({ sig, hash } from sign()) never overrides it; it only anchors the
 * payload-hash comparison. `expected.sig`, when supplied, must equal the
 * argument too.
 *
 * `valid: true` requires BOTH the signature to match and the payload hash to
 * match. The HMAC commits to the canonical payload bytes, so a signature
 * match already entails hash equality with the signed content; the explicit
 * hash check (against the expected hash or the payload's carried `hash`, when
 * present) is what makes a tampered payload report E_PAYLOAD_MISMATCH
 * specifically instead of a generic signature failure.
 */
export function verify(agentId, payload, sig, expected = null) {
  // 1. Payload integrity — declared first, so tamper is attributed to the
  // payload even when the signature would also mismatch.
  const recomputedHash = payloadHash(payload);
  const anchor = expected && expected.hash ? expected.hash : (payload && payload.hash) || null;
  if (anchor && anchor !== recomputedHash) {
    return { valid: false, reason: REASONS.PAYLOAD_MISMATCH };
  }

  // 2. Signature validity under the agent's derived key — the argument,
  // always; and if the caller anchored an expected sig, it must agree.
  const got = expectedSig(agentId, payload);
  if (!sig || String(sig) !== got) {
    return { valid: false, reason: REASONS.SIG_MISMATCH };
  }
  if (expected && expected.sig && String(expected.sig) !== String(sig)) {
    return { valid: false, reason: REASONS.SIG_MISMATCH };
  }

  return { valid: true };
}

export { REASONS as VERIFY_REASONS };
