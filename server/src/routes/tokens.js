/**
 * JEXI OS — ZONE-OWNER ITEM 6 (Phase 9 D): ephemeral-token HTTP surface.
 *
 *   POST /api/tokens/mint   { scope, ttlMs?, subject?, singleUse? }
 *                           → { ok, token, expiresAt, scope, subject }
 *   GET  /api/tokens/verify?token=…
 *                           → { ok, reason?, scope, subject, expiresAt }
 *
 * Thin JSON adapter over providers/tokens/ephemeral.js — NO new token logic
 * here (surface.js convention). The engine enforces every ceiling: scope
 * allow-list (default deny), TTL ≤ 1h hard cap, HMAC signature, TAMPERED vs
 * EXPIRED as distinct refusals. Mint refusals (MintRefusedError) surface as
 * 400 with the engine's stable code; verify is an in-band checker (HTTP 200,
 * ok:false + reason) because a refused token is the ANSWER, not an error.
 *
 * Key management is the engine's documented order: JEXI_EPHEMERAL_HMAC_KEY
 * (pinned across restarts) → per-process random (outstanding tokens die on
 * restart — acceptable for TTL ≤ 1h tokens, documented in ephemeral.js).
 *
 * Mounted from index.js via mountTokens(app).
 */
import { createEphemeral, MintRefusedError, MAX_TTL_MS, DEFAULT_TTL_MS, DEFAULT_SCOPES } from '../../../providers/tokens/ephemeral.js';

function ok(res, body) { res.json({ ok: true, ...body }); }
function fail(res, e, code = 500) { res.status(code).json({ ok: false, error: String(e?.message || e).slice(0, 300) }); }

export function mountTokens(app, { engine = createEphemeral() } = {}) {
  /** POST /api/tokens/mint — body: { scope: string[]|string, ttlMs?, subject?, singleUse? } */
  app.post('/api/tokens/mint', (req, res) => {
    try {
      const { scope, ttlMs, subject, singleUse } = req.body || {};
      const out = engine.mint({
        // accept 'read' or ['read','write'] — the engine validates strictly
        scope: typeof scope === 'string' && scope.length > 0 ? [scope] : scope,
        ...(ttlMs !== undefined && ttlMs !== null ? { ttlMs: Number(ttlMs) } : {}),
        ...(subject !== undefined ? { subject } : {}),
        ...(singleUse !== undefined ? { singleUse: Boolean(singleUse) } : {}),
      });
      ok(res, out); // { token, expiresAt, scope, subject }
    } catch (e) {
      if (e instanceof MintRefusedError) {
        return res.status(400).json({ ok: false, code: e.code, error: e.message, detail: e.detail });
      }
      fail(res, e);
    }
  });

  /** GET /api/tokens/verify?token=… — in-band verdict, never a raw 4xx/5xx for a bad token. */
  app.get('/api/tokens/verify', (req, res) => {
    try {
      const v = engine.verify(typeof req.query.token === 'string' ? req.query.token : '');
      if (v.ok) {
        return res.json({ ok: true, scope: v.scope, subject: v.subject, expiresAt: v.expiresAt, singleUse: v.singleUse, issuedAt: v.issuedAt });
      }
      res.json({ ok: false, reason: v.reason, scope: null, subject: null, expiresAt: null });
    } catch (e) { fail(res, e); }
  });

  /** GET /api/tokens/policy — the ceilings this surface enforces (no secrets). */
  app.get('/api/tokens/policy', (req, res) => {
    ok(res, { maxTtlMs: MAX_TTL_MS, defaultTtlMs: DEFAULT_TTL_MS, scopes: DEFAULT_SCOPES, format: 'jexi_eph.v1.<b64url payload>.<b64url HMAC-SHA256>' });
  });
}
