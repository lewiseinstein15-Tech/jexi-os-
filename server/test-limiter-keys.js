/**
 * PROXY-AWARE LIMITER KEYS — regression suite.
 *
 * Behind Render+Cloudflare, req.ip is the edge proxy (shared by everyone).
 * Keying express-rate-limit on req.ip puts ALL clients in ONE bucket, so
 * innocent users get 429s ("backend keeps dropping"). Both Express limiters
 * must key on the true client IP: CF-Connecting-IP first, XFF-first next,
 * req.ip only as the last resort.
 */

import fs from 'fs';

let passed = 0, failedCount = 0;
const ok = (c, n) => { if (c) { passed++; console.log(`  ✅ ${n}`); } else { failedCount++; console.log(`  ❌ ${n}`); } };

const idx = fs.readFileSync('./index.js', 'utf-8');

ok(idx.includes('cf-connecting-ip'), 'client key prefers CF-Connecting-IP (unspoofable via Cloudflare)');
ok(idx.includes("x-forwarded-for") && idx.includes("split(',')[0]"), 'client key falls back to first X-Forwarded-For entry');
const keyed = (idx.match(/keyGenerator:\s*clientIpKey/g) || []).length;
ok(keyed >= 2, `both Express limiters use the proxy-aware key (found ${keyed}, need 2+)`);
ok(!/rateLimit\(\{\s*windowMs[^}]*keyGenerator(?!:\s*clientIpKey)/s.test(idx), 'no Express limiter keys on raw req.ip');

console.log(`\nLIMITER-KEYS: ${passed} passed, ${failedCount} failed.`);
process.exit(failedCount ? 1 : 0);
