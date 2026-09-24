/**
 * JEXI OS — PHASE 13 SCOPE E — SIGNING.
 *
 * Cryptographic signing of agent actions and votes, so a trust claim is
 * verifiable instead of asserted (the agency-agents/nexus-agents pattern:
 * trust answers "who did what").
 *
 * Declared scheme (normative; mirrored in README.md):
 *
 *   key    = HMAC-SHA256(K0, "jexi-trust-v1:" + agentId)     — per-agent, derived
 *   sig    = HMAC-SHA256(key, canonicalJSON(payload))
 *   hash   = SHA256(canonicalJSON(payload))
 *
 * K0 is the fixed scope domain key: the SHA-256 of the literal scheme name
 * "jexi-trust-v1". No credential, no secret file, no environment read — the
 * key material is DERIVED deterministically from the agentId, exactly as the
 * scope brief allows ("per-agent key derived deterministically from agentId,
 * no external key store needed for this scope"). This is an integrity sigil,
 * not a secrecy mechanism: it proves a payload was issued under an agentId
 * and has not been altered; it is not a defense against an attacker who can
 * derive keys themselves. The README says this out loud.
 *
 * canonicalJSON: object keys sorted lexically, arrays kept in order, no
 * whitespace — so the same logical payload always hashes and signs to the
 * same bytes (determinism across runs, P7).
 */

import crypto from 'crypto';

/** The scheme name; hashed once to form the derivation domain key K0. */
export const SCHEME = 'jexi-trust-v1';

const K0 = crypto.createHash('sha256').update(SCHEME).digest();

/** Stable per-scope string prepended to the agentId during key derivation. */
const KEY_CONTEXT = `${SCHEME}:`;

/** Canonical JSON: recursively sorted object keys, no whitespace. */
export function canonicalJSON(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonicalJSON).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJSON(value[k])}`).join(',')}}`;
}

/** The per-agent HMAC key, derived deterministically from the agentId. */
export function deriveKey(agentId) {
  return crypto.createHmac('sha256', K0).update(`${KEY_CONTEXT}${String(agentId)}`).digest();
}

/** SHA-256 of the canonical payload — the payload hash verify compares. */
export function payloadHash(payload) {
  return crypto.createHash('sha256').update(canonicalJSON(payload)).digest('hex');
}

/**
 * Sign a payload for an agent.
 *
 *   sign(agentId, payload) -> { sig, payload, hash, agentId, scheme }
 *
 * `sig` is the hex HMAC; `hash` is the canonical payload hash carried beside
 * the signature so verifiers can attribute a mismatch to the payload or the
 * signature (verify.js uses this).
 */
export function sign(agentId, payload) {
  if (agentId == null || String(agentId).trim() === '') {
    throw new Error('sign requires an agentId'); // callers validate agent existence; never reached in the trust facade
  }
  const hash = payloadHash(payload);
  const sig = crypto.createHmac('sha256', deriveKey(agentId)).update(canonicalJSON(payload)).digest('hex');
  return { sig, payload, hash, agentId: String(agentId), scheme: SCHEME };
}

/** Recompute the expected signature for a payload under an agent's key. */
export function expectedSig(agentId, payload) {
  return crypto.createHmac('sha256', deriveKey(agentId)).update(canonicalJSON(payload)).digest('hex');
}

export { SCHEME as DEFAULT_SCHEME, K0 as DOMAIN_KEY };
