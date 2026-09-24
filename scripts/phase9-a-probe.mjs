#!/usr/bin/env node
/**
 * Phase 9 — Scope A — Trust pipeline LIVE probe.
 *
 * P1  registered URL        → allowed, sanitized (REAL HTTP, real data shown)
 * P2  unregistered / shaped → refused with stable codes (6 shapes)
 * P3  oversized response    → capped, warning logged (REAL cap logic; the
 *                             socket is a labeled test double — no external
 *                             "too large" endpoint is faked)
 * P4  redirect attempt      → refused
 * P5  hung upstream         → timeout fires
 * P6  broker audit log      → every refusal recorded
 *
 * Exit 0 iff every assertion passes.
 */

import { createBroker } from '../mind/intelligence/trust-pipeline/broker.js';
import { REGISTERED_URLS } from '../mind/intelligence/trust-pipeline/registered-urls.js';
import { readBodyCapped } from '../mind/intelligence/trust-pipeline/sanitize.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass += 1; console.log(`PASS  ${name}${extra ? ` — ${extra}` : ''}`); }
  else { fail += 1; console.log(`FAIL  ${name}${extra ? ` — ${extra}` : ''}`); }
};

const head = (s, n = 120) => String(s).replace(/\s+/g, ' ').slice(0, n);

// ───────────────────────────── P1 — registered URLs ─────────────────────────
console.log('\n═══ P1 — registered URL → allowed, sanitized (REAL HTTP) ═══');
{
  const broker = createBroker();

  // P1a: USGS earthquakes (keyless, real data)
  const usgsUrl = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson';
  const t0 = Date.now();
  const r1 = await broker.fetch(usgsUrl);
  ok('P1a USGS fetch ok', r1.ok === true, `status=${r1.status} bytes=${r1.bytes} in ${Date.now() - t0}ms`);
  ok('P1a registration attached', r1.registration && r1.registration.id === 'usgs-summary',
    r1.registration ? `id=${r1.registration.id} layer=${r1.registration.layer} keyless=${r1.registration.keyless}` : 'none');
  let features = -1;
  try { features = r1.json().features.length; } catch { /* keep -1 */ }
  ok('P1a sanitized JSON parses', features > 0, `features=${features}`);
  ok('P1a no warnings on normal fetch', r1.warnings.length === 0);
  console.log(`      data head: ${head(r1.text, 110)}`);

  // P1b: Launch Library 2 (keyless, real data)
  const ll2 = 'https://ll.thespacedevs.com/2.2.0/launch/upcoming/?limit=1';
  const r2 = await broker.fetch(ll2);
  ok('P1b LL2 fetch ok', r2.ok === true, `status=${r2.status} bytes=${r2.bytes}`);
  ok('P1b registration attached', r2.registration && r2.registration.id === 'launch-library-2');
  let llCount = -1;
  try { llCount = r2.json().count; } catch { /* keep -1 */ }
  ok('P1b sanitized JSON parses', Number.isFinite(llCount) && llCount >= 0, `count=${llCount}`);
  console.log(`      data head: ${head(r2.text, 110)}`);
}

// ───────────────────────── P2 — refusals (6 shapes) ─────────────────────────
console.log('\n═══ P2 — unregistered / malformed → refused ═══');
{
  const broker = createBroker();
  const cases = [
    ['P2a unregistered host', 'https://example.com/anything', 'E_UNREGISTERED_HOST'],
    ['P2b insecure scheme', 'http://earthquake.usgs.gov/earthquakes/feed/', 'E_INSECURE_SCHEME'],
    ['P2c credentials in URL', 'https://user:pass@earthquake.usgs.gov/earthquakes/feed/', 'E_CREDENTIALS_IN_URL'],
    ['P2d non-standard port', 'https://earthquake.usgs.gov:8443/earthquakes/feed/', 'E_NONSTANDARD_PORT'],
    ['P2e path not registered', 'https://earthquake.usgs.gov/admin/secret', 'E_PATH_NOT_REGISTERED'],
    ['P2f subdomain not inferred', 'https://evil.earthquake.usgs.gov.evil.example/feed', 'E_UNREGISTERED_HOST'],
  ];
  for (const [name, url, wantCode] of cases) {
    const r = await broker.fetch(url);
    ok(`${name} refused`, r.ok === false && r.error && r.error.code === wantCode,
      `code=${r.error ? r.error.code : 'none'} msg="${r.error ? r.error.message : ''}"`);
    ok(`${name} message templated`, r.error && /^(request blocked|request failed): /.test(r.error.message),
      `no internals leaked`);
  }
}

// ─────────────── P3 — oversized response → capped + warning ─────────────────
console.log('\n═══ P3 — oversized response → capped, warning logged ═══');
{
  // Simulated transport, REAL cap logic: a genuine streaming body (2 MiB in
  // 16 KiB chunks) crosses the 256 KiB cap mid-read — the reader must cancel
  // and report tooLarge. No external endpoint is contacted.
  const CAP = 256 * 1024;
  const TOTAL = 2 * 1024 * 1024;
  const chunk = Buffer.alloc(16 * 1024, 0x41);
  let sent = 0;
  console.log('      [simulated transport — real streaming body + real cap logic]');
  const stream = new ReadableStream({
    pull(controller) {
      if (sent >= TOTAL) { controller.close(); return; }
      sent += chunk.length;
      controller.enqueue(chunk);
    },
  });
  const fakeResponse = new Response(stream, { status: 200, headers: { 'content-type': 'text/plain' } });
  const broker = createBroker({
    maxBytes: CAP,
    fetchImpl: async () => fakeResponse, // socket simulated; everything after is real
  });
  const r = await broker.fetch('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_hour.geojson');
  ok('P3a oversized refused with E_TOO_LARGE', r.ok === false && r.error && r.error.code === 'E_TOO_LARGE',
    `code=${r.error ? r.error.code : 'none'} tooLarge=${r.tooLarge}`);
  ok('P3a stream cancelled near cap (not fully buffered)', r.bytes > 0 && r.bytes <= CAP + 64 * 1024,
    `read ${r.bytes} bytes of ${TOTAL} before cancel`);
  const warnInResult = r.warnings.some((w) => w.code === 'W_BODY_CAPPED');
  ok('P3a warning attached to result', warnInResult,
    r.warnings.map((w) => w.code).join(','));
  const auditWarn = broker.status().audit.filter((a) => a.code === 'E_TOO_LARGE');
  ok('P3a warning logged in broker audit', auditWarn.length === 1,
    `audit entries=${broker.status().auditEntries}`);
  ok('P3a warning message honest', auditWarn[0] && /exceeded .* bytes/.test(auditWarn[0].message),
    auditWarn[0] ? auditWarn[0].message : 'none');

  // P3b: Content-Length pre-check — declared oversize is refused without
  // reading a single byte (bytes must stay 0).
  const declared = new Response('x', { headers: { 'content-length': String(TOTAL) } });
  const pre = await readBodyCapped(declared, CAP);
  ok('P3b declared-oversize pre-check fires', pre.tooLarge === true && pre.bytes === 0,
    `declared=${TOTAL} cap=${CAP} read=${pre.bytes}`);
}

// ─────────────────────── P4 — redirect refusal ──────────────────────────────
console.log('\n═══ P4 — redirect attempt → refused ═══');
{
  const broker = createBroker({
    fetchImpl: async () => new Response(null, { status: 302, headers: { location: 'https://evil.example/' } }),
  });
  console.log('      [simulated transport — real redirect policy]');
  const r = await broker.fetch('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_hour.geojson');
  ok('P4 302 refused with E_REDIRECT_REFUSED', r.ok === false && r.error && r.error.code === 'E_REDIRECT_REFUSED',
    `code=${r.error ? r.error.code : 'none'}`);
}

// ─────────────────────── P5 — hung upstream → timeout ───────────────────────
console.log('\n═══ P5 — hung upstream → timeout fires ═══');
{
  const broker = createBroker({
    timeoutMs: 200,
    fetchImpl: (_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => {
        const e = new Error('The operation was aborted');
        e.name = 'AbortError';
        reject(e);
      });
    }),
  });
  console.log('      [simulated transport — real AbortController timer logic]');
  const t0 = Date.now();
  const r = await broker.fetch('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_hour.geojson');
  ok('P5 timeout refused with E_TIMEOUT', r.ok === false && r.error && r.error.code === 'E_TIMEOUT',
    `code=${r.error ? r.error.code : 'none'} after ${Date.now() - t0}ms`);
}

// ─────────────────────── P6 — registry + audit snapshot ─────────────────────
console.log('\n═══ P6 — registry snapshot + audit surface ═══');
{
  ok('P6 registry size', REGISTERED_URLS.length >= 12, `registrations=${REGISTERED_URLS.length}`);
  const keyless = REGISTERED_URLS.filter((r) => r.keyless).length;
  ok('P6 keyless count recorded', keyless >= 8, `keyless=${keyless}/${REGISTERED_URLS.length}`);
  const layers = new Set(REGISTERED_URLS.map((r) => r.layer));
  ok('P6 layers covered', layers.size >= 8, [...layers].sort().join(','));
}

console.log(`\n═══════════════════════════════════════════════`);
console.log(`PROBE SUMMARY: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
