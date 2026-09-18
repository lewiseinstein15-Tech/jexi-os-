/**
 * JEXI OS — Phase 8 Scope E — EXEC-BRIDGE AUTH (HMAC).
 *
 * Every request crossing from jexi-net into sandbox-net is signed by the
 * caller with a shared HMAC-SHA256 key and verified here with a
 * timing-safe comparison. mTLS is the Docker-deployment alternative
 * (client certs issued per network); HMAC is the default because it needs
 * no PKI and works identically in process mode.
 *
 * A request that fails verification is refused with "unauthenticated" —
 * the bridge never processes the payload further (auth happens FIRST,
 * before any allowlist or execution logic sees the request).
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const AUTH_SCHEME = 'jexi-hmac-sha256-v1';
export const DEFAULT_MAX_SKEW_MS = 5 * 60 * 1000; // replay window

/** New shared bridge key (hex). jexi-net side signs with it, bridge verifies. */
export function generateBridgeKey(bytes = 32) {
  return randomBytes(bytes).toString('hex');
}

/** The exact byte string that is signed — field order is part of the contract. */
export function canonicalRequest({ op, args, caller, ts, nonce }) {
  return JSON.stringify({ op, args, caller, ts, nonce });
}

/** Sign one request. Returns the hex signature for `request.signature`. */
export function signRequest(request, key) {
  if (!key) throw new Error('auth: bridge key required to sign');
  return createHmac('sha256', key).update(canonicalRequest(request)).digest('hex');
}

/**
 * Verify one request. Returns { ok:true } or { ok:false, reason } where
 * reason always names the failure — the probe contract expects
 * "unauthenticated" on missing/wrong credentials.
 */
export function verifyRequest(request, key, { maxSkewMs = DEFAULT_MAX_SKEW_MS, now = Date.now() } = {}) {
  if (!request || typeof request !== 'object') return { ok: false, reason: 'malformed request — unauthenticated' };
  const { op, args, caller, ts, nonce, signature } = request;
  if (typeof op !== 'string' || !op) return { ok: false, reason: 'missing op — unauthenticated' };
  if (typeof caller !== 'string' || !caller) return { ok: false, reason: 'missing caller — unauthenticated' };
  if (!Number.isFinite(ts)) return { ok: false, reason: 'missing timestamp — unauthenticated' };
  if (Math.abs(now - ts) > maxSkewMs) return { ok: false, reason: 'stale timestamp (replay?) — unauthenticated' };
  if (typeof nonce !== 'string' || !nonce) return { ok: false, reason: 'missing nonce — unauthenticated' };
  if (typeof signature !== 'string' || !signature) return { ok: false, reason: 'missing signature — unauthenticated' };
  if (!key) return { ok: false, reason: 'bridge has no key configured — unauthenticated' };

  const expected = createHmac('sha256', key).update(canonicalRequest({ op, args, caller, ts, nonce })).digest();
  const got = Buffer.from(signature, 'hex');
  if (got.length !== expected.length || !timingSafeEqual(got, expected)) {
    return { ok: false, reason: 'signature mismatch — unauthenticated' };
  }
  return { ok: true, reason: 'authenticated' };
}

/** A fresh nonce for the caller side. */
export function newNonce() {
  return randomBytes(8).toString('hex');
}

export default { AUTH_SCHEME, generateBridgeKey, canonicalRequest, signRequest, verifyRequest, newNonce };
