#!/usr/bin/env node
/**
 * ZONE-OWNER ITEM 4 LIVE PROBE — provenance label at the broker ok:true return.
 * Run from repo root:  node scripts/zone-owner-item4-probe.mjs
 * Proves:
 *   1. a registered URL fetched through the broker returns a `provenance`
 *      field with label 'observed' (frozen, full Phase 9 G shape)
 *   2. byte-parity with events/provenance/label.js#wrapBroker (the seam proof)
 *      on every field except the per-call timestamp
 *   3. refused fetches (unregistered host, upstream 500, redirect) carry
 *      provenance: null — no data, no label
 *   4. best-effort REAL network fetch through the default pinned transport
 *      (honest NOT VERIFIED if the sandbox has no egress to the host)
 */
import { createBroker } from '../intelligence/trust-pipeline/broker.js';
import { wrapBroker } from '../events/provenance/label.js';

let fails = 0; let checks = 0; let notVerified = 0;
const check = (label, cond, detail = '') => {
  checks++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!cond) fails++;
};

const doubleOk = (payload) => async () => new Response(JSON.stringify(payload), {
  status: 200,
  headers: { 'content-type': 'application/json' },
});

const REGISTERED = 'https://api.adsb.lol/v2/lol/lat/51.4775/lon/-0.4614/dist/25';

// ---- 1. successful fetch through the broker carries provenance
{
  const broker = createBroker({ fetchImpl: doubleOk({ ac: 42, ts: 1750000000 }) });
  const res = await broker.fetch(REGISTERED);
  const p = res.provenance;
  console.log('ok:true result provenance:', JSON.stringify(p));
  check('registered URL fetch → ok:true WITH provenance field', res.ok === true && p !== null && typeof p === 'object',
    `ok=${res.ok} hasProvenance=${p !== null && p !== undefined}`);
  check("label = 'observed' (from the registration's declared provenance)", p?.label === 'observed', `label=${p?.label}`);
  check('source = registration provider, method = broker fetch, notes cite the registration',
    p?.source === 'adsb.lol' && p?.method === 'trust-pipeline broker fetch' && /registration adsb-lol/.test(p?.notes || ''),
    `source=${p?.source} notes=${p?.notes}`);
  check('provenance object is FROZEN (no silent label upgrades)', Object.isFrozen(p) === true);
  check('timestamp is ISO-parseable', typeof p?.timestamp === 'string' && !Number.isNaN(Date.parse(p?.timestamp)), `ts=${p?.timestamp}`);
  check('body still intact (text/json unaffected by the insert)', res.json().ac === 42 && res.bytes > 0, `bytes=${res.bytes}`);

  // ---- 2. parity with wrapBroker (the documented drop-in seam proof)
  const wrapped = wrapBroker(createBroker({ fetchImpl: doubleOk({ ac: 42, ts: 1750000000 }) }));
  const wres = await wrapped.fetch(REGISTERED);
  const strip = (o) => JSON.stringify({ ...o, timestamp: '<TS>' });
  check('insert is wrapBroker-PARITY (identical provenance modulo timestamp)',
    strip(p) === strip(wres.provenance),
    `direct=${strip(p)} wrapped=${strip(wres.provenance)}`);
}

// ---- 3. refusals carry provenance: null
{
  const broker = createBroker({ fetchImpl: doubleOk({ unused: true }) });
  const refused = await broker.fetch('https://evil.example.com/steal');
  check('unregistered host → ok:false, provenance: null', refused.ok === false && refused.provenance === null,
    `code=${refused.error?.code} provenance=${refused.provenance}`);

  const b500 = createBroker({ fetchImpl: async () => new Response('nope', { status: 500 }) });
  const up = await b500.fetch(REGISTERED);
  check('upstream 500 → ok:false, provenance: null', up.ok === false && up.provenance === null,
    `code=${up.error?.code} provenance=${up.provenance}`);

  const b302 = createBroker({ fetchImpl: async () => new Response(null, { status: 302, headers: { location: 'https://evil.example/' } }) });
  const red = await b302.fetch(REGISTERED);
  check('redirect → ok:false, provenance: null', red.ok === false && red.provenance === null,
    `code=${red.error?.code} provenance=${red.provenance}`);
}

// ---- 4. best-effort REAL network fetch through the default pinned transport
{
  // CelesTrak GP element set: keyless, registered, reliable. (adsb.lol's
  // anonymous tier returned non-2xx in this sandbox — transport reached it,
  // upstream refused; celestrak is the honest real-network target.)
  const REAL = 'https://celestrak.org/NORAD/elements/gp.php?GROUP=stations&FORMAT=json';
  const broker = createBroker({ timeoutMs: 20000, maxBytes: 5_000_000 });
  try {
    const res = await broker.fetch(REAL);
    if (res.ok) {
      check('REAL network fetch (default SSRF-pinned transport, celestrak.org) → ok:true, provenance observed',
        res.provenance?.label === 'observed' && res.provenance?.source === 'CelesTrak' && res.status === 200 && res.bytes > 0,
        `status=${res.status} bytes=${res.bytes} provenance=${JSON.stringify(res.provenance)}`);
    } else {
      notVerified++;
      console.log(`NOT VERIFIED  real network fetch — upstream/network refused in sandbox: ${res.error?.code} (${res.error?.message})`);
    }
  } catch (e) {
    notVerified++;
    console.log(`NOT VERIFIED  real network fetch — ${e?.name}: ${String(e?.message).slice(0, 120)}`);
  }
}

console.log(`\n===== PROBE TALLY: ${checks} checked, ${checks - fails} pass, ${fails} fail, ${notVerified} not-verified =====`);
process.exit(fails === 0 ? 0 : 1);
