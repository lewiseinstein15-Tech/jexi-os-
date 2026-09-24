# EPHEMERAL TOKENS (Phase 9 D)

Long-lived provider keys never leave the server. Sessions get short-TTL
tokens minted on demand. Every use is verified; expired or tampered tokens
are refused.

## Modules

| File          | Role |
|---------------|------|
| `ephemeral.js` | minting + verification engine (`mint`, `verify`, `authorize`, `createEphemeral` factory) |
| `realtime.js`  | OpenAI Realtime-compatible minting profile (local profile + real-OpenAI path) |

## Contract

```js
import { mint, verify, authorize } from 'providers/tokens/ephemeral.js';

mint({ scope: ['read'], ttlMs: 60_000, subject: 'session-123' })
// → { token, expiresAt (unix ms), scope, subject }

verify(token)
// → { ok: true, scope, subject, expiresAt, singleUse, issuedAt }
// → { ok: false, reason: EXPIRED | TAMPERED | UNKNOWN_SCOPE | MALFORMED | CONSUMED,
//      scope: null, subject: null, expiresAt: null }

authorize(token, 'write')
// → verify() shape + { capability, allowed, reason?: INSUFFICIENT_SCOPE }
```

## Token format (decision: HMAC-signed JSON + random nonce)

```
jexi_eph.v1.<b64url(payload JSON)>.<b64url(HMAC-SHA256(payload, key))>
payload = { v, typ, scope[], subject, iat, exp, jti, su }
```

- **Why HMAC over opaque+lookup:** stateless verification (survives
  restarts when the key is pinned via `JEXI_EPHEMERAL_HMAC_KEY`), TAMPERED
  is a distinct refusal from EXPIRED (signature check), no token store to
  purge. The random `jti` nonce makes every mint unique — two identical
  mints never collide — kills replay-correlation, and enables optional
  single-use consumption.
- **Determinism (P10):** tokens are NON-DETERMINISTIC by design. Same
  scope/subject/ttl → different tokens (fresh `jti` per mint). Rationale:
  determinism would let observers link sessions by comparing tokens and
  would make a leaked token indistinguishable from every future mint.
  HMAC provides integrity, not determinism.

## Rules

- **Long-lived key: NEVER serialized into a token.** `mint()` takes no
  key parameter at all — tokens point at permissions, not secrets. The
  payload carries only scope/subject/timestamps/nonce.
- **TTL:** default 300,000 ms (5 min); hard ceiling `MAX_TTL_MS` =
  3,600,000 ms (1 h). Minting above the ceiling is REFUSED
  (`E_TTL_ABOVE_CEILING`), never silently capped. Configurable per call,
  capped globally.
- **Scope:** explicit allow-list (`DEFAULT_SCOPES = ['read', 'write',
  'realtime.session']`). DEFAULT DENY — an unknown scope cannot be minted
  (`E_UNKNOWN_SCOPE`). Scopes are re-checked at VERIFY time: removing a
  scope from the allow-list revokes every outstanding token carrying it
  (`UNKNOWN_SCOPE`) — that is the revocation path.
- **Replay:** tokens are MULTI-USE by default; TTL is the only defense.
  `mint({ singleUse: true })` marks the token consumable-once; the first
  successful `verify()` consumes it (`CONSUMED` on replay). The consume
  registry is process-local memory — for cross-restart single-use, wire a
  durable store via `createEphemeral()` (zone-owner task).

## Key management

Resolution order: explicit `createEphemeral({ hmacKey })` → env
`JEXI_EPHEMERAL_HMAC_KEY` → per-process random key. The random fallback
means all outstanding tokens die on restart — acceptable for a ≤1 h TTL
ceiling. Keys are never logged, never serialized, never derived from
provider keys.

## Threat model

| Event | Consequence | Mitigation |
|-------|-------------|------------|
| Token leaks | Bearer token usable from anywhere, but ONLY within its TTL, ONLY for its scope | Short TTL (60s–5min typical), narrow scope, single-use option; no secret material inside — leak exposes capabilities, not credentials |
| Server HMAC key leaks | Attacker can mint arbitrary tokens until rotation | Key lives in env/explicit injection only, never serialized; rotation = replace `JEXI_EPHEMERAL_HMAC_KEY` → ALL outstanding tokens immediately fail verify (TAMPERED); ≤1 h exposure window by construction |
| Token tampered in flight | Signature mismatch | HMAC-SHA256 over the exact payload bytes, constant-time compare → `TAMPERED` |
| Scope escalation attempted | Use-time check fails | `authorize(token, capability)` requires the capability ∈ token scope → `INSUFFICIENT_SCOPE` |
| TTL escalation attempted | Mint refused | Hard 1 h ceiling at mint → `E_TTL_ABOVE_CEILING` |
| Stale scope claims | Verify-time allow-list re-check | Scope off the list → `UNKNOWN_SCOPE` (revocation) |
| Single-use replay | Second verify fails | `jti` consumed in memory → `CONSUMED` |

## Realtime profile (`realtime.js`)

- `mintRealtimeSession({ subject, ttlMs = 60_000, model, voice })` — local
  OpenAI-Realtime-compatible shape:
  `{ client_secret: { value: 'ek_<jexi_eph token>', expires_at (unix s) },
  session: { model, expires_at }, token, expiresAt, scope, subject }`.
  `ek_` prefix mirrors OpenAI's ephemeral-key convention; the inner token
  verifies with `ephemeral.verify()`.
- `mintRemoteRealtimeSession({ apiKey, model })` — real OpenAI
  `POST /v1/realtime/sessions`; the CALLER supplies the bridge-owned key.
  NOT VERIFIED in the Phase 9 D sandbox (no provider key available); no
  response was faked.
