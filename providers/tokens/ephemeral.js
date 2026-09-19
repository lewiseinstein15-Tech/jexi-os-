/**
 * JEXI OS — providers/tokens/ephemeral.js (Phase 9 D — Ephemeral Token Minting)
 *
 * Short-TTL capability tokens so LONG-LIVED provider keys never leave the
 * server. Sessions get tokens minted on demand; every use is verified;
 * expired or tampered tokens are refused.
 *
 * ── TOKEN FORMAT (documented decision) ──────────────────────────────────
 *   HMAC-signed JSON + random nonce:
 *
 *     jexi_eph.v1.<b64url(payload JSON)>.<b64url(HMAC-SHA256(payload, key))>
 *
 *   payload = { v, typ, scope[], subject, iat, exp, jti, su }  — and
 *   NOTHING else. Tokens point at PERMISSIONS, never at secrets: mint()
 *   takes no key parameter at all, so no provider key can be serialized
 *   into a token by construction.
 *
 *   Why HMAC over opaque+lookup: verification is stateless (works across
 *   process restarts when the key is pinned via JEXI_EPHEMERAL_HMAC_KEY),
 *   TAMPERED is a DISTINCT refusal from EXPIRED (signature check), and no
 *   token store must be purged. The random `jti` nonce makes every mint
 *   unique (two identical mints never produce the same token), kills
 *   replay-correlation, and enables optional single-use consumption.
 *
 * ── KEY MANAGEMENT ──────────────────────────────────────────────────────
 *   Server HMAC key resolution, in order:
 *     1. explicit: createEphemeral({ hmacKey })             (tests, embedding)
 *     2. env:      JEXI_EPHEMERAL_HMAC_KEY                   (pinned across restarts)
 *     3. fallback: per-process random key (crypto.randomBytes(32))
 *   If the fallback is used, all outstanding tokens die on restart —
 *   acceptable and DOCUMENTED for tokens whose TTL ceiling is 1 hour.
 *
 * ── THREAT MODEL (summary — full version in README.md) ──────────────────
 *   - token leaks  → usable ONLY within its TTL, ONLY for its scope, from
 *     anywhere (bearer). Multi-use tokens: TTL is the only defense.
 *     Single-use tokens are consumed on first successful verify.
 *   - server key leaks → attacker can mint arbitrary tokens until key
 *     rotation. Rotation = replace the env key; ALL outstanding tokens
 *     immediately fail verification (TAMPERED).
 *   - TTL ceiling  → MAX_TTL_MS = 1 hour, hard, enforced at mint.
 *   - Scope ceiling → explicit allow-list; default deny. A scope not on
 *     the allow-list cannot be minted; if it is later REMOVED from the
 *     allow-list, existing tokens bearing it fail verify (UNKNOWN_SCOPE) —
 *     that is the revocation path.
 */

import crypto from 'node:crypto';

const TOKEN_PREFIX = 'jexi_eph.v1';
const TOKEN_VERSION = 1;

/** Hard TTL ceiling: 1 hour. Enforced at mint; nothing outlives this. */
export const MAX_TTL_MS = 3_600_000;
/** Default TTL when ttlMs is omitted: 5 minutes. */
export const DEFAULT_TTL_MS = 300_000;

/**
 * Scope ceiling — the explicit allow-list of capabilities a token may
 * carry. DEFAULT DENY: anything not listed here cannot be minted, and a
 * token whose scope falls off this list fails verification (revocation).
 * Embedders extend via createEphemeral({ scopes }).
 */
export const DEFAULT_SCOPES = ['read', 'write', 'realtime.session'];

/** Refusal reasons. CONSUMED is a documented extension for single-use replay. */
export const REASONS = {
  MALFORMED: 'MALFORMED',
  TAMPERED: 'TAMPERED',
  UNKNOWN_SCOPE: 'UNKNOWN_SCOPE',
  EXPIRED: 'EXPIRED',
  CONSUMED: 'CONSUMED',
};

/** Mint-time refusals (Error subclass so callers can catch precisely). */
export class MintRefusedError extends Error {
  constructor(code, message, detail = {}) {
    super(message);
    this.name = 'MintRefusedError';
    this.code = code; // E_INVALID_SCOPE | E_UNKNOWN_SCOPE | E_INVALID_TTL | E_TTL_ABOVE_CEILING
    this.detail = detail;
  }
}

const b64url = (buf) => Buffer.from(buf).toString('base64url');

function hmac(payloadB64, key) {
  return crypto.createHmac('sha256', key).update(payloadB64).digest('base64url');
}

/** Constant-time signature compare; length mismatch → tampered. */
function sigEqual(a, b) {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

/**
 * In-memory single-use consumption registry (process-local). jti entries
 * are lazily purged once past expiry so the map cannot grow unbounded.
 */
function createConsumeStore() {
  const consumed = new Map(); // jti → exp (ms)
  return {
    tryConsume(jti, exp) {
      const nowMs = Date.now();
      for (const [k, e] of consumed) if (e <= nowMs) consumed.delete(k);
      if (consumed.has(jti)) return false;
      consumed.set(jti, exp);
      return true;
    },
  };
}

/**
 * Build an ephemeral-token engine. All options optional:
 *   hmacKey — server HMAC key (string|Buffer). Default: env, then random.
 *   scopes  — scope allow-list. Default: DEFAULT_SCOPES.
 *   now     — clock injection for tests: () => ms.
 */
export function createEphemeral({ hmacKey, scopes, now = () => Date.now() } = {}) {
  const key = hmacKey
    ?? process.env.JEXI_EPHEMERAL_HMAC_KEY
    ?? crypto.randomBytes(32).toString('base64');
  const allow = new Set(scopes ?? DEFAULT_SCOPES);
  const store = createConsumeStore();

  /** Mint a token. See module header for format + ceilings. */
  function mint({ scope, ttlMs = DEFAULT_TTL_MS, subject = '', singleUse = false } = {}) {
    // ── scope validation: explicit allow-list, default deny ──
    if (!Array.isArray(scope) || scope.length === 0 || !scope.every((s) => typeof s === 'string' && s.length > 0)) {
      throw new MintRefusedError('E_INVALID_SCOPE', 'scope must be a non-empty array of strings', { scope });
    }
    const unknown = scope.filter((s) => !allow.has(s));
    if (unknown.length > 0) {
      throw new MintRefusedError(
        'E_UNKNOWN_SCOPE',
        `scope not on the allow-list (default deny): ${unknown.join(', ')}; allowed: ${[...allow].join(', ')}`,
        { unknown, allowed: [...allow] },
      );
    }
    // ── TTL validation: positive integer ≤ hard ceiling ──
    if (!Number.isInteger(ttlMs) || ttlMs <= 0) {
      throw new MintRefusedError('E_INVALID_TTL', `ttlMs must be a positive integer, got ${JSON.stringify(ttlMs)}`, { ttlMs });
    }
    if (ttlMs > MAX_TTL_MS) {
      throw new MintRefusedError(
        'E_TTL_ABOVE_CEILING',
        `ttlMs ${ttlMs} exceeds the hard TTL ceiling of ${MAX_TTL_MS} ms (1h); tokens never outlive the ceiling`,
        { ttlMs, maxTtlMs: MAX_TTL_MS },
      );
    }
    if (typeof subject !== 'string') {
      throw new MintRefusedError('E_INVALID_SUBJECT', 'subject must be a string', { subject });
    }

    const iat = now();
    const exp = iat + ttlMs;
    // Payload: permissions + lifetime ONLY. No secret bytes can enter —
    // mint() has no key parameter.
    const payload = {
      v: TOKEN_VERSION,
      typ: 'eph',
      scope: [...scope],
      subject,
      iat,
      exp,
      jti: crypto.randomBytes(12).toString('base64url'),
      su: singleUse === true,
    };
    const body = b64url(JSON.stringify(payload));
    const sig = hmac(body, key);
    return { token: `${TOKEN_PREFIX}.${body}.${sig}`, expiresAt: exp, scope: [...scope], subject };
  }

  /** Verify a token: structure → signature → scope → expiry → consumption. */
  function verify(token) {
    const fail = (reason) => ({ ok: false, reason, scope: null, subject: null, expiresAt: null });
    if (typeof token !== 'string') return fail(REASONS.MALFORMED);
    const parts = token.split('.');
    if (parts.length !== 4 || parts[0] !== 'jexi_eph' || parts[1] !== 'v1') {
      return fail(REASONS.MALFORMED);
    }
    const [, , body, sig] = parts;
    let payload;
    try {
      payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    } catch {
      return fail(REASONS.MALFORMED);
    }
    if (
      payload?.v !== TOKEN_VERSION || payload?.typ !== 'eph'
      || !Array.isArray(payload.scope) || typeof payload.exp !== 'number'
      || typeof payload.iat !== 'number' || typeof payload.jti !== 'string'
    ) {
      return fail(REASONS.MALFORMED);
    }
    if (!sigEqual(hmac(body, key), sig)) return fail(REASONS.TAMPERED);
    // Scope re-check at VERIFY time: a scope removed from the allow-list
    // after minting revokes every outstanding token that carries it.
    const offList = payload.scope.filter((s) => !allow.has(s));
    if (offList.length > 0) return fail(REASONS.UNKNOWN_SCOPE);
    if (payload.exp <= now()) return fail(REASONS.EXPIRED);
    if (payload.su && !store.tryConsume(payload.jti, payload.exp)) {
      return fail(REASONS.CONSUMED);
    }
    return {
      ok: true,
      scope: payload.scope,
      subject: payload.subject,
      expiresAt: payload.exp,
      singleUse: payload.su === true,
      issuedAt: payload.iat,
    };
  }

  /**
   * Use-time authorization: token must verify AND carry `capability`.
   * Returns verify()'s shape plus the capability decision.
   */
  function authorize(token, capability) {
    const v = verify(token);
    if (!v.ok) return { ...v, capability, allowed: false };
    const allowed = v.scope.includes(capability);
    return {
      ...v,
      capability,
      allowed,
      reason: allowed ? undefined : 'INSUFFICIENT_SCOPE',
    };
  }

  return { mint, verify, authorize, scopes: [...allow] };
}

/**
 * Default engine — module-level instance matching the contract:
 *   import { mint, verify } from 'providers/tokens/ephemeral.js';
 */
const defaultEngine = createEphemeral();
export const mint = defaultEngine.mint;
export const verify = defaultEngine.verify;
export const authorize = defaultEngine.authorize;
