#!/usr/bin/env node
/**
 * Phase 9 — Scope D — Ephemeral Token Minting LIVE probe.
 *
 * P1  mint                   → token + expiresAt 60s out + scope + subject
 * P2  verify valid           → ok: true
 * P3  expired refused        → ttlMs 100, wait 200ms → EXPIRED
 * P4  tampered refused       → 1 payload byte flipped → TAMPERED (+ MALFORMED demo)
 * P5  key never leaves       → decode payload: only scope/subject/iat/exp/jti/su;
 *                              grep token for sk- key pattern → no match
 * P6  scope ceiling          → authorize(['read'] token,'write') → INSUFFICIENT_SCOPE;
 *                              mint with un-allowlisted scope → E_UNKNOWN_SCOPE;
 *                              verify-time scope revocation → UNKNOWN_SCOPE
 * P7  TTL ceiling            → ttlMs 1 year → E_TTL_ABOVE_CEILING (refused, not capped)
 * P8  realtime profile       → OpenAI-Realtime-compatible local mint (shape shown);
 *                              remote real-OpenAI path NOT VERIFIED — no provider key
 * P9  provider bridge seam   → file:line citations of the long-lived-key
 *                              injection point (server/src is zone-owner territory)
 * P10 determinism            → two identical mints → DIFFERENT tokens (nonce);
 *                              design choice stated
 *
 * Exit 0 iff every assertion passes. No test doubles needed: the engine,
 * expiry and tampering are fully reproducible in-process. The ONLY
 * not-reproducible-here vector is the real-OpenAI remote mint (no key).
 */

import {
  mint,
  verify,
  authorize,
  createEphemeral,
  MintRefusedError,
  MAX_TTL_MS,
  DEFAULT_SCOPES,
} from '../integrations/providers/tokens/ephemeral.js';
import { mintRealtimeSession } from '../integrations/providers/tokens/realtime.js';

const SUB = process.argv[2] || 'usage';

function header(id, title) {
  console.log(`\n========== ${id} — ${title} ==========`);
}
function fail(msg) {
  console.error(`ASSERTION FAILED: ${msg}`);
  process.exit(1);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

switch (SUB) {
  case 'p1': {
    header('P1', 'Mint a token — ephemeral.mint()');
    const before = Date.now();
    const t = mint({ scope: ['read'], ttlMs: 60_000, subject: 'test-session' });
    console.log(JSON.stringify(t, null, 2));
    if (typeof t.token !== 'string' || !t.token.startsWith('jexi_eph.v1.')) fail('token format');
    if (!(t.expiresAt > before + 59_000 && t.expiresAt <= before + 61_000)) fail('expiresAt must be ~60s out');
    if (JSON.stringify(t.scope) !== JSON.stringify(['read'])) fail('scope');
    if (t.subject !== 'test-session') fail('subject');
    break;
  }

  case 'p2': {
    header('P2', 'Verify a valid token — ephemeral.verify()');
    const t = mint({ scope: ['read'], ttlMs: 60_000, subject: 'test-session' });
    const v = verify(t.token);
    console.log(JSON.stringify(v, null, 2));
    if (v.ok !== true || v.subject !== 'test-session' || v.expiresAt !== t.expiresAt) fail('valid token must verify');
    break;
  }

  case 'p3': {
    header('P3', 'Expired token refused');
    const t = mint({ scope: ['read'], ttlMs: 100, subject: 'short-lived' });
    console.log(`minted at ttlMs=100, expiresAt=${t.expiresAt}; waiting 200ms...`);
    await sleep(200);
    const v = verify(t.token);
    console.log(JSON.stringify(v, null, 2));
    if (v.ok !== false || v.reason !== 'EXPIRED') fail('expired token must be refused with EXPIRED');
    break;
  }

  case 'p4': {
    header('P4', 'Tampered token refused (1 byte changed)');
    const t = mint({ scope: ['read'], ttlMs: 60_000, subject: 'test-session' });
    const [p0, p1, body, sig] = t.token.split('.');
    // Flip ONE byte inside the payload body (same-length base64url body, signature untouched)
    const dec = Buffer.from(body, 'base64url').toString('utf8');
    const flipped = dec.replace('"test-session"', '"tast-session"');
    if (flipped === dec) fail('tamper target string not found in payload');
    const tamperedBody = Buffer.from(flipped).toString('base64url');
    const tamperedToken = [p0, p1, tamperedBody, sig].join('.');
    console.log(`original (truncated): ${t.token.slice(0, 60)}...`);
    console.log(`tampered (truncated): ${tamperedToken.slice(0, 60)}...`);
    console.log('payload change: 1 byte ("test-session" → "tast-session"), signature untouched');
    const v = verify(tamperedToken);
    console.log(JSON.stringify(v, null, 2));
    if (v.ok !== false || v.reason !== 'TAMPERED') fail('1-byte payload flip must yield TAMPERED');
    // Adjacent honesty: structurally broken token → MALFORMED
    const m = verify('jexi_eph.v1.not-base64!!.$$');
    console.log('structurally broken token →', JSON.stringify(m));
    if (m.ok !== false || m.reason !== 'MALFORMED') fail('garbage token must yield MALFORMED');
    break;
  }

  case 'p5': {
    header('P5', 'Long-lived key never leaves — payload has only permissions');
    const t = mint({ scope: ['read', 'write'], ttlMs: 60_000, subject: 'leak-check' });
    const body = t.token.split('.')[2];
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    console.log('decoded payload:');
    console.log(JSON.stringify(payload, null, 2));
    const keys = Object.keys(payload).sort();
    const EXPECT = ['exp', 'iat', 'jti', 'scope', 'su', 'subject', 'typ', 'v'];
    console.log(`payload keys: ${JSON.stringify(keys)}`);
    console.log(`expected keys: ${JSON.stringify(EXPECT)}`);
    if (JSON.stringify(keys) !== JSON.stringify(EXPECT)) fail('payload must contain ONLY v/typ/scope/subject/iat/exp/jti/su');
    // grep the token for provider-key shapes
    const skPattern = /sk-[A-Za-z0-9_-]{16,}/;
    const hitsSk = skPattern.test(t.token);
    const hitsEnv = ['OPENAI', 'ANTHROPIC', 'API_KEY', 'Bearer'].filter((s) => t.token.includes(s));
    console.log(`grep token for /sk-[A-Za-z0-9_-]{16,}/ (OpenAI key shape) → match: ${hitsSk}`);
    console.log(`grep token for ['OPENAI','ANTHROPIC','API_KEY','Bearer'] → matches: ${JSON.stringify(hitsEnv)}`);
    if (hitsSk || hitsEnv.length > 0) fail('token must contain no provider key material');
    console.log('mint() signature accepts NO key parameter — tokens point at permissions by construction');
    break;
  }

  case 'p6': {
    header('P6', 'Scope ceiling — default deny, use-time + mint-time + revocation');
    // (a) use-time: token scoped ['read'] cannot act as 'write'
    const t = mint({ scope: ['read'], ttlMs: 60_000, subject: 'scope-test' });
    const w = authorize(t.token, 'write');
    console.log('(a) authorize(token, "write") on a [read]-scoped token:');
    console.log(JSON.stringify(w, null, 2));
    if (w.ok !== true || w.allowed !== false || w.reason !== 'INSUFFICIENT_SCOPE') fail('write must be refused with INSUFFICIENT_SCOPE');
    const r = authorize(t.token, 'read');
    console.log('(a2) authorize(token, "read") on the same token:');
    console.log(JSON.stringify({ ok: r.ok, capability: r.capability, allowed: r.allowed }, null, 2));
    if (r.allowed !== true) fail('read must be allowed for a [read]-scoped token');
    // (b) mint-time: un-allowlisted scope refused (default deny)
    console.log('(b) mint({ scope: ["admin"] }) — "admin" is NOT on the allow-list:');
    try {
      mint({ scope: ['admin'], ttlMs: 60_000, subject: 'escalator' });
      fail('mint with un-allowlisted scope must throw');
    } catch (e) {
      if (!(e instanceof MintRefusedError)) throw e;
      console.log(`thrown: ${e.name} code=${e.code}`);
      console.log(e.message);
      if (e.code !== 'E_UNKNOWN_SCOPE') fail('expected E_UNKNOWN_SCOPE');
    }
    // (c) revocation: scope removed from the allow-list → outstanding tokens die.
    // SAME HMAC key on both engines (so the signature is valid and the scope
    // check is what fires); only the allow-list differs.
    console.log('(c) verify-time revocation — same HMAC key, allow-list drops "write":');
    const fullEngine = createEphemeral({ hmacKey: 'probe-key', scopes: DEFAULT_SCOPES });
    const restrictive = createEphemeral({ hmacKey: 'probe-key', scopes: ['read'] });
    const t2 = fullEngine.mint({ scope: ['write'], ttlMs: 60_000, subject: 'revocation-test' });
    const v2 = restrictive.verify(t2.token); // signature OK → scope check fires
    console.log(JSON.stringify(v2, null, 2));
    if (v2.ok !== false || v2.reason !== 'UNKNOWN_SCOPE') fail('scope off the allow-list must verify-fail with UNKNOWN_SCOPE');
    break;
  }

  case 'p7': {
    header('P7', 'TTL ceiling — 1 year refused, ceiling enforced');
    const oneYear = 365 * 24 * 60 * 60 * 1000;
    console.log(`attempting mint({ ttlMs: ${oneYear} }) — ceiling is MAX_TTL_MS = ${MAX_TTL_MS}`);
    try {
      mint({ scope: ['read'], ttlMs: oneYear, subject: 'immortal' });
      fail('1-year TTL must be refused');
    } catch (e) {
      if (!(e instanceof MintRefusedError)) throw e;
      console.log(`thrown: ${e.name} code=${e.code}`);
      console.log(e.message);
      console.log(JSON.stringify(e.detail, null, 2));
      if (e.code !== 'E_TTL_ABOVE_CEILING') fail('expected E_TTL_ABOVE_CEILING');
    }
    // boundary: exactly the ceiling is allowed
    const t = mint({ scope: ['read'], ttlMs: MAX_TTL_MS, subject: 'ceiling-exact' });
    console.log(`boundary check — ttlMs = MAX_TTL_MS exactly → minted, expiresAt = ${t.expiresAt} (+${(t.expiresAt - Date.now())}ms)`);
    if (t.expiresAt - Date.now() > MAX_TTL_MS) fail('ceiling boundary violated');
    break;
  }

  case 'p8': {
    header('P8', 'Realtime minting profile (OpenAI Realtime-compatible)');
    const s = mintRealtimeSession({ subject: 'realtime-probe', model: 'gpt-4o-realtime-preview' });
    console.log(JSON.stringify(s, null, 2));
    // shape assertions
    if (!s.client_secret?.value?.startsWith('ek_jexi_eph.v1.')) fail('client_secret.value must be ek_-prefixed jexi token');
    if (s.client_secret.expires_at !== Math.floor(s.expiresAt / 1000)) fail('expires_at (unix s) mismatch');
    if (s.session?.model !== 'gpt-4o-realtime-preview') fail('session.model');
    if (JSON.stringify(s.scope) !== JSON.stringify(['realtime.session'])) fail('scope must be [realtime.session]');
    if (!(s.expiresAt - Date.now() > 58_000 && s.expiresAt - Date.now() <= 60_000)) fail('realtime TTL must default to ~60s');
    // the inner token verifies through the engine
    const v = verify(s.token);
    console.log('engine verify(s.token) →', JSON.stringify({ ok: v.ok, scope: v.scope, subject: v.subject }));
    if (v.ok !== true) fail('realtime token must verify through the engine');
    // remote path — honestly NOT VERIFIED in this sandbox
    const hasKey = Boolean(process.env.OPENAI_API_KEY);
    console.log(`\nremote real-OpenAI mint: OPENAI_API_KEY present = ${hasKey}`);
    if (!hasKey) {
      console.log('NOT VERIFIED — no provider key. mintRemoteRealtimeSession() is implemented (POST /v1/realtime/sessions) but NOT exercised in this sandbox; no response is faked.');
    }
    break;
  }

  case 'p10': {
    header('P10', 'Determinism — two identical mints');
    const a = mint({ scope: ['read'], ttlMs: 60_000, subject: 'same-session' });
    await sleep(2);
    const b = mint({ scope: ['read'], ttlMs: 60_000, subject: 'same-session' });
    console.log(`token A (truncated): ${a.token.slice(0, 80)}...`);
    console.log(`token B (truncated): ${b.token.slice(0, 80)}...`);
    console.log(`tokens identical: ${a.token === b.token}`);
    const ja = JSON.parse(Buffer.from(a.token.split('.')[2], 'base64url').toString('utf8'));
    const jb = JSON.parse(Buffer.from(b.token.split('.')[2], 'base64url').toString('utf8'));
    console.log(`jti A: ${ja.jti}`);
    console.log(`jti B: ${jb.jti}`);
    console.log(`jti differs: ${ja.jti !== jb.jti}`);
    console.log('DESIGN: tokens are NON-DETERMINISTIC by design — a fresh random nonce (jti) per mint.');
    console.log('  Why: (1) observers cannot link sessions by comparing tokens; (2) a leaked token is');
    console.log('  not reproducible/predictable for future mints; (3) it enables single-use consumption.');
    if (a.token === b.token) fail('identical mints must differ (nonce) — design says non-deterministic');
    if (ja.jti === jb.jti) fail('jti nonce must differ');
    break;
  }

  case 'su': {
    header('SUPPLEMENTARY', 'Single-use replay — consumed on first verify');
    const fullEngine = createEphemeral({ hmacKey: 'probe-key', scopes: DEFAULT_SCOPES });
    const t = fullEngine.mint({ scope: ['read'], ttlMs: 60_000, subject: 'single-use-probe', singleUse: true });
    console.log('mint({ singleUse: true }) →');
    console.log(JSON.stringify({ token: t.token.slice(0, 60) + '...', expiresAt: t.expiresAt, subject: t.subject }, null, 2));
    const v1 = fullEngine.verify(t.token);
    console.log('verify #1 →', JSON.stringify({ ok: v1.ok, singleUse: v1.singleUse, subject: v1.subject }));
    const v2 = fullEngine.verify(t.token); // replay
    console.log('verify #2 (REPLAY) →', JSON.stringify(v2, null, 2));
    if (v1.ok !== true || v1.singleUse !== true) fail('first use must succeed and report singleUse');
    if (v2.ok !== false || v2.reason !== 'CONSUMED') fail('replay must be refused with CONSUMED');
    // contrast: multi-use default
    const m = fullEngine.mint({ scope: ['read'], ttlMs: 60_000, subject: 'multi-use-probe' });
    const m1 = fullEngine.verify(m.token);
    const m2 = fullEngine.verify(m.token);
    console.log('multi-use default: verify #1 →', JSON.stringify({ ok: m1.ok }), '| verify #2 →', JSON.stringify({ ok: m2.ok }), '(TTL is the only defense — documented)');
    if (m1.ok !== true || m2.ok !== true) fail('multi-use tokens must verify repeatedly within TTL');
    break;
  }

  default:
    console.error('usage: node scripts/phase9-d-probe.mjs <p1|p2|p3|p4|p5|p6|p7|p8|p10|su>');
    process.exit(2);
}

console.log(`\n[probe ${SUB.toUpperCase()}] exit 0 — all assertions passed`);
