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

ok(idx.includes('x-jexi-session') && idx.includes('sess:${'), 'bucket key prefers the stable session id (survives carrier NAT)');
ok(idx.includes('cf-connecting-ip'), 'IP key prefers CF-Connecting-IP (unspoofable via Cloudflare)');
ok(idx.includes("x-forwarded-for") && idx.includes("split(',')[0]"), 'IP key falls back to first X-Forwarded-For entry');
ok(/const aiLimiter = rateLimit\(\{[^}]*keyGenerator: clientIpKey/s.test(idx), 'ai limiter (expensive chat) is IP-keyed: rotation-proof quota guard');
ok(/const generalLimiter = rateLimit\(\{[^}]*keyGenerator: clientBucketKey/s.test(idx), 'general limiter (cheap reads) is session-keyed: NAT-friendly');
ok(/const generalLimiter = rateLimit\(\{[^}]*limit: 2400/s.test(idx), 'general budget fits real poller traffic (2400/15min)');
ok(idx.includes('ipBackstop') && idx.includes("app.use('/api', ipBackstop)"), 'a loose IP-only backstop bounds floods');

console.log(`\nLIMITER-KEYS: ${passed} passed, ${failedCount} failed.`);
process.exit(failedCount ? 1 : 0);
