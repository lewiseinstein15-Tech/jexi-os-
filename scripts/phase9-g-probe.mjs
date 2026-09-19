#!/usr/bin/env node
/**
 * JEXI OS — Phase 9 Scope G probe — data provenance labels (P1–P11).
 *
 * One subcommand per probe case. Every case is SELF-CONTAINED so runs
 * are deterministic and order-free. Raw output only; exit 1 on any
 * failed assertion.
 *
 * Transport honesty: P1–P8/P10 fetch USGS data directly (the thing under
 * test is the LABEL ENGINE, not the transport). P9 exercises the REAL
 * Scope A trust-pipeline broker end-to-end (the integration is the thing
 * under test) through the Scope B SSRF shield default transport.
 *
 * Runtime artifacts (p11 store file) live in scratch/ — never committed.
 */

import { createBroker } from '../intelligence/trust-pipeline/broker.js';
import * as label from '../events/provenance/label.js';
import { MIXED_SIMULATED_OBSERVED_FLAG } from '../events/provenance/schema.js';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BROKER_JS = join(ROOT, 'intelligence', 'trust-pipeline', 'broker.js');
const LABEL_JS = join(ROOT, 'events', 'provenance', 'label.js');
const LAYERS_DIR = join(ROOT, 'intelligence', 'layers');
const STORE_PATH = join(ROOT, 'scratch', 'phase9-g-store.json');

const USGS_FDSN = (n) =>
  `https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&limit=${n}`;
const USGS_ALL_DAY =
  'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson';
const LL2_UPCOMING = 'https://ll.thespacedevs.com/2.2.0/launch/upcoming/?limit=1';

const USGS_SOURCE = 'USGS (earthquake.usgs.gov)';

let pass = 0;
let fail = 0;

function ok(cond, label_) {
  if (cond) { pass += 1; console.log(`PASS: ${label_}`); } else { fail += 1; console.log(`FAIL: ${label_}`); }
}
function eq(got, want, label_) {
  ok(got === want, `${label_} (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`);
}
function raw(label_, obj) {
  console.log(`--- ${label_} (raw) ---`);
  console.log(typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2));
}
function done(name) {
  console.log(`[${name}] ${pass} PASS / ${fail} FAIL`);
  process.exit(fail === 0 ? 0 : 1);
}
function errShape(e) {
  return { name: e.name, code: e.code, message: e.message };
}
function lineOf(file, needle) {
  const content = readFileSync(file, 'utf8');
  const idx = content.indexOf(needle);
  if (idx === -1) return -1;
  return content.slice(0, idx).split('\n').length;
}

/** Plain direct fetch with retries + per-attempt logging (label-engine cases). */
async function getJson(url, attempts = 2) {
  let lastErr;
  for (let i = 1; i <= attempts; i += 1) {
    try {
      const res = await fetch(url, {
        headers: {
          'user-agent': 'jexi-os-phase9-g-probe/1.0',
          accept: 'application/geo+json,application/json',
        },
        signal: AbortSignal.timeout(20000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return { url, status: res.status, json: await res.json() };
    } catch (e) {
      lastErr = e;
      console.log(`attempt ${i}/${attempts} failed for ${url}: ${e.message}`);
    }
  }
  throw lastErr;
}

/* P1 — attach 'observed' on a real USGS earthquake record. */
async function p1() {
  console.log(`[P1] fetching one real USGS earthquake record…`);
  const { json } = await getJson(USGS_FDSN(1));
  const feature = json.features[0];
  ok(Boolean(feature && feature.id), 'real USGS record fetched (feature.id present)');

  const env = label.attachObserved(feature, {
    source: USGS_SOURCE,
    method: 'direct fetch — USGS FDSN event query, format=geojson',
    notes: `event ${feature.id} from the USGS Earthquake Hazards Program feed`,
  });
  raw('P1 labeled envelope (data + full provenance)', env);

  ok(label.check(env), 'check(envelope) === true');
  eq(env.provenance.label, 'observed', 'label is observed');
  ok(typeof env.provenance.timestamp === 'string' && !Number.isNaN(Date.parse(env.provenance.timestamp)),
    'provenance.timestamp is ISO-parseable');
  ok(env.provenance.confidence === undefined, 'confidence omitted (optional for observed)');
  ok(Object.isFrozen(env.provenance), 'provenance object is frozen');
  let tamperThrew = false;
  try {
    env.provenance.label = 'simulated'; // laundering attempt
  } catch {
    tamperThrew = true;
  }
  ok(tamperThrew, 'label upgrade attempt (observed → simulated) throws — tamper-proof');
  eq(env.provenance.label, 'observed', 'label still observed after tamper attempt');
  done('P1');
}

/* P2 — attach 'estimated': interpolate a missing point from observed data. */
async function p2() {
  console.log(`[P2] fetching two real USGS earthquake records…`);
  const { json } = await getJson(USGS_FDSN(2));
  const [f1, f2] = json.features;
  ok(Array.isArray(f1?.geometry?.coordinates) && f1.geometry.coordinates.length === 3,
    'event 1 has real coordinates [lon, lat, depthKm]');
  ok(Array.isArray(f2?.geometry?.coordinates) && f2.geometry.coordinates.length === 3,
    'event 2 has real coordinates [lon, lat, depthKm]');

  const obs1 = label.attachObserved(f1, { source: USGS_SOURCE, method: 'direct fetch — USGS FDSN event query' });
  const obs2 = label.attachObserved(f2, { source: USGS_SOURCE, method: 'direct fetch — USGS FDSN event query' });
  raw('P2 observed inputs', [obs1.provenance, obs2.provenance,
    { id: f1.id, coordinates: f1.geometry.coordinates }, { id: f2.id, coordinates: f2.geometry.coordinates }]);

  const [lon1, lat1, d1] = obs1.data.geometry.coordinates;
  const [lon2, lat2, d2] = obs2.data.geometry.coordinates;
  const midpoint = {
    type: 'Feature',
    geometry: {
      type: 'Point',
      coordinates: [(lon1 + lon2) / 2, (lat1 + lat2) / 2, (d1 + d2) / 2],
    },
    properties: {
      interpolatedBetween: [obs1.data.id, obs2.data.id],
    },
  };
  const env = label.attachEstimated(midpoint, {
    source: USGS_SOURCE,
    method: 'linear midpoint interpolation between two observed epicenters',
    confidence: 0.55,
    notes: `interpolated between observed events ${obs1.data.id} and ${obs2.data.id}; no such measurement exists — derived only`,
  });
  raw('P2 estimated envelope', env);

  eq(env.provenance.label, 'estimated', 'label is estimated');
  ok(typeof env.provenance.confidence === 'number' && env.provenance.confidence >= 0 && env.provenance.confidence <= 1,
    'confidence present and in [0.0, 1.0]');
  eq(env.provenance.confidence, 0.55, 'confidence is 0.55');
  done('P2');
}

/* P3 — attach 'simulated' on a test fixture. */
async function p3() {
  const fixture = { station: 'TEST-FIXTURE-01', temperatureC: 21.5, humidityPct: 48 };
  const env = label.attachSimulated(fixture, {
    source: 'jexi test fixture',
    method: 'unit-test fixture — synthetic values generated in-probe',
    notes: 'synthetic data — not a real measurement',
  });
  raw('P3 simulated envelope', env);

  eq(env.provenance.label, 'simulated', 'label is simulated');
  eq(env.provenance.confidence, undefined, 'confidence omitted (optional for simulated)');
  ok(env.provenance.notes.includes('not a real measurement'), 'notes disclaim reality');
  ok(label.check(env), 'check(envelope) === true');
  done('P3');
}

/* P4 — attach 'reconstructed': partial data + a stale timestamp. */
async function p4() {
  console.log(`[P4] fetching one real USGS earthquake record…`);
  const { json } = await getJson(USGS_FDSN(1));
  const feature = json.features[0];
  ok(Boolean(feature && feature.id), 'real USGS record fetched');

  // Model partial + stale ingestion: keep id + magnitude, DROP coordinates,
  // place and event time; carry a stale last-observed timestamp in the data.
  const staleObservedAt = new Date(Date.now() - 6 * 3600 * 1000).toISOString();
  const partial = {
    id: feature.id,
    mag: feature.properties.mag,
    staleObservedAt,
  };
  const env = label.attachReconstructed(partial, {
    source: USGS_SOURCE,
    method: 'rebuilt from partial record — coordinates/place/time dropped, stale snapshot assumed',
    confidence: 0.4,
    notes: `RECONSTRUCTED ESTIMATE — built by discarding fields from a real observed record ` +
      `to model partial + stale ingestion; position and time are best-effort, last observed ${staleObservedAt}`,
  });
  raw('P4 reconstructed envelope', env);

  eq(env.provenance.label, 'reconstructed', 'label is reconstructed');
  ok(env.provenance.confidence === 0.4, 'confidence present (required for reconstructed)');
  ok(env.provenance.notes.includes('RECONSTRUCTED ESTIMATE'), 'notes carry the GEV reconstruction reason');
  ok(!Object.prototype.hasOwnProperty.call(env.data, 'geometry'), 'data is genuinely partial (no geometry)');
  done('P4');
}

/* P5 — labels travel through transformations. */
async function p5() {
  console.log(`[P5] fetching three real USGS earthquake records…`);
  const { json } = await getJson(USGS_FDSN(3));
  const env0 = label.attachObserved(json.features[0], {
    source: USGS_SOURCE,
    method: 'direct fetch — USGS FDSN event query',
  });
  ok(label.check(env0), 'observed point labeled at ingress');

  // Naive transform: builds a NEW object and silently DROPS provenance.
  const naive = {
    mag: env0.data.properties.mag,
    place: env0.data.properties.place,
  };
  ok(label.check(naive) === false, 'naive transform strips the label (check === false)');

  // Labeled transform: travel() carries the label FROM THE SOURCE, verbatim.
  const projected = label.travel(env0, {
    mag: env0.data.properties.mag,
    place: env0.data.properties.place,
  });
  raw('P5 projected point after travel()', projected);
  const before = JSON.stringify(env0.provenance);
  const after = JSON.stringify(projected.provenance);
  raw('P5 provenance before transform', before);
  raw('P5 provenance after transform', after);
  eq(before, after, 'provenance byte-identical through the query transform');

  // Array pipeline: filter + travel per element, then the egress gate passes.
  const pipeline = json.features
    .filter((f) => f.properties.mag !== null)
    .map((f) => {
      const point = label.attachObserved(f, { source: USGS_SOURCE, method: 'direct fetch — USGS FDSN event query' });
      return label.travel(point, { id: f.id, mag: f.properties.mag });
    });
  const checked = label.assertAll(pipeline);
  eq(checked, pipeline.length, `egress gate passes the whole transformed pipeline (${pipeline.length} points)`);
  ok(pipeline.every((p) => p.provenance.label === 'observed'), 'every pipeline element retains observed');
  done('P5');
}

/* P6 — mixed sets are flagged explicitly. */
async function p6() {
  console.log(`[P6] fetching three real USGS earthquake records…`);
  const { json } = await getJson(USGS_FDSN(3));
  const observed = json.features.map((f) =>
    label.attachObserved(f, { source: USGS_SOURCE, method: 'direct fetch — USGS FDSN event query' }));
  eq(observed.length, 3, 'three observed envelopes built');

  const sim = label.attachSimulated(
    { station: 'TEST-FIXTURE-01', temperatureC: 21.5 },
    { source: 'jexi test fixture', method: 'unit-test fixture — synthetic values', notes: 'synthetic data — not a real measurement' },
  );

  const flaggedSet = label.finalizeSet([...observed, sim]);
  raw('P6 finalizeSet(3 observed + 1 simulated)', {
    provenanceSummary: flaggedSet.provenanceSummary,
    mixed: flaggedSet.mixed,
    conflict: flaggedSet.conflict,
    flag: flaggedSet.flag,
    flagDetail: flaggedSet.flagDetail,
  });

  eq(flaggedSet.mixed, true, 'mixed is true');
  eq(flaggedSet.conflict, true, 'conflict is true');
  eq(flaggedSet.flag, MIXED_SIMULATED_OBSERVED_FLAG, `flag is ${MIXED_SIMULATED_OBSERVED_FLAG}`);
  eq(flaggedSet.provenanceSummary.counts.observed, 3, 'counts.observed is 3');
  eq(flaggedSet.provenanceSummary.counts.simulated, 1, 'counts.simulated is 1');
  ok(String(flaggedSet.flagDetail).includes('simulated'), 'flagDetail names the hazard explicitly');

  // Contrast: a uniform observed set returns with no flag.
  const uniformSet = label.finalizeSet(observed);
  raw('P6 finalizeSet(3 observed, uniform) — contrast', {
    provenanceSummary: uniformSet.provenanceSummary,
    mixed: uniformSet.mixed,
    flag: uniformSet.flag,
  });
  eq(uniformSet.mixed, false, 'uniform set: mixed is false');
  eq(uniformSet.flag, undefined, 'uniform set: no flag');
  done('P6');
}

/* P7 — 'estimated' without confidence is refused. */
async function p7() {
  const fixture = { station: 'TEST-FIXTURE-01', temperatureC: 21.5 };
  let caught = null;
  try {
    label.attach(fixture, {
      label: 'estimated',
      source: USGS_SOURCE,
      method: 'interpolation attempt without confidence',
    });
  } catch (e) {
    caught = e;
  }
  raw('P7 refusal', caught ? errShape(caught) : { error: 'NOT THROWN' });

  ok(caught !== null, 'attach refused (threw)');
  eq(caught?.name, 'ProvenanceError', 'error is a ProvenanceError');
  eq(caught?.code, 'E_CONFIDENCE_REQUIRED', 'code is E_CONFIDENCE_REQUIRED');
  ok(String(caught?.message).includes("'estimated'"), 'message names the label that demanded confidence');

  // Control: the same attach WITH confidence succeeds.
  const control = label.attachEstimated(fixture, {
    source: USGS_SOURCE, method: 'interpolation with confidence declared', confidence: 0.7,
  });
  raw('P7 control (confidence provided)', control.provenance);
  eq(control.provenance.label, 'estimated', 'control: estimated accepted once confidence is present');
  done('P7');
}

/* P8 — assertAll throws naming the offending point. */
async function p8() {
  const s1 = label.attachSimulated({ station: 'TEST-FIXTURE-01' }, { source: 'jexi test fixture', method: 'unit-test fixture' });
  const s2 = label.attachSimulated({ station: 'TEST-FIXTURE-02' }, { source: 'jexi test fixture', method: 'unit-test fixture' });
  const unlabeled = { event: 'unlabeled-raw-reading', mag: 4.2 }; // NO provenance

  // Control: labeled-only set passes.
  eq(label.assertAll([s1, s2]), 2, 'control: labeled-only set passes assertAll');

  let caught = null;
  try {
    label.assertAll([s1, s2, unlabeled]);
  } catch (e) {
    caught = e;
  }
  raw('P8 refusal', caught ? errShape(caught) : { error: 'NOT THROWN' });

  ok(caught !== null, 'assertAll threw on the mixed set');
  eq(caught?.code, 'E_MISSING_PROVENANCE', 'code is E_MISSING_PROVENANCE');
  ok(String(caught?.message).includes('index 2'), 'error NAMES the offending point (index 2)');
  ok(String(caught?.message).includes('unlabeled-raw-reading'), 'error previews the offending point content');
  done('P8');
}

/* P9 — integration with the Scope A trust-pipeline broker. */
async function p9() {
  const broker = createBroker(); // default transport = Scope B SSRF shield
  const labeledBroker = label.wrapBroker(broker);

  // Registered endpoints, primary + fallback (Scope B lesson: upstream flaps).
  const candidates = [
    { url: USGS_ALL_DAY, id: 'usgs-summary', provider: 'USGS' },
    { url: LL2_UPCOMING, id: 'launch-library-2', provider: 'Launch Library 2 (The Space Devs)' },
  ];
  let okResults = [];
  for (const candidate of candidates) {
    let result = null;
    for (let attempt = 1; attempt <= 2 && !(result && result.ok); attempt += 1) {
      try {
        result = await labeledBroker.fetch(candidate.url);
      } catch (e) {
        console.log(`attempt ${attempt}/2 threw: ${e.message}`);
        result = null;
      }
    }
    if (!result) continue;
    raw(`P9 broker result ${candidate.id}`, {
      ok: result.ok,
      status: result.status,
      url: result.url,
      bytes: result.bytes,
      registration: result.registration ? { id: result.registration.id, provider: result.registration.provider, provenance: result.registration.provenance } : null,
      provenance: result.provenance || null,
      error: result.error || null,
    });
    if (result.ok) {
      okResults.push({ candidate, result });
      ok(label.check(result), `result from ${candidate.id} carries a valid provenance field`);
      eq(result.provenance.label, 'observed', `result from ${candidate.id} is labeled observed`);
      eq(result.provenance.label, result.registration.provenance,
        `label matches the registration's own declared provenance (registry-driven)`);
      eq(result.provenance.source, result.registration.provider, `source is the registration provider`);
      ok(String(result.provenance.notes).includes(candidate.id), 'notes cite the registration id');
    }
  }
  ok(okResults.length >= 1, 'at least one real broker fetch succeeded end-to-end');

  // Failure control: refused fetch produces NO data and therefore NO label.
  const refused = await labeledBroker.fetch('https://example.com/');
  raw('P9 refused fetch (unregistered host)', {
    ok: refused.ok, error: refused.error, provenance: refused.provenance ?? null,
  });
  eq(refused.ok, false, 'unregistered host refused by the trust pipeline');
  // ZONE-OWNER ITEM 4: broker.js now assigns the label in-zone; refusals carry
  // an explicit `provenance: null` (no data, no label) instead of the old
  // wrapper-era `undefined`.
  eq(refused.provenance, null, 'refused fetch carries NO provenance (provenance: null — no data, no label)');

  // Per-record inheritance: a record extracted from a labeled result.
  if (okResults.length > 0) {
    const { result } = okResults[0];
    const body = result.json();
    const records = Array.isArray(body?.features) ? body.features : Array.isArray(body?.results) ? body.results : null;
    if (records && records[0]) {
      const recordEnv = label.attachObserved(records[0], {
        source: result.provenance.source,
        method: 'extracted from trust-pipeline fetch result (inherits broker provenance source)',
        notes: `record 0 of registration ${result.registration.id}`,
      });
      raw('P9 per-record envelope (first record)', {
        provenance: recordEnv.provenance,
        dataPreview: JSON.stringify(recordEnv.data).slice(0, 300),
      });
      eq(recordEnv.provenance.label, 'observed', 'per-record label is observed');
      eq(recordEnv.provenance.source, result.provenance.source, 'record source === broker result source');
    }
  }

  // Integration point citations, verified at runtime (drift → FAIL).
  const okLine = lineOf(BROKER_JS, 'ok: true,');
  const wrapLine = lineOf(LABEL_JS, 'export function wrapBroker');
  ok(okLine > 0, `broker.js success-return seam found (intelligence/trust-pipeline/broker.js:${okLine})`);
  ok(wrapLine > 0, `wrapBroker seam found (events/provenance/label.js:${wrapLine})`);
  console.log(`--- P9 integration point (raw) ---`);
  console.log(`success results are built at intelligence/trust-pipeline/broker.js:${okLine} (the ok:true return; ` +
    `fetchThroughBroker starts at broker.js:74); failed results exit at :86/:121/:135/:162/:170 and carry no label.`);
  console.log(`Composition proof shipped in-zone at events/provenance/label.js:${wrapLine} (wrapBroker).`);
  console.log(`ZONE-OWNER TASK: insert the one-line provenance assignment into the ok:true return at ` +
    `broker.js:${okLine} (intelligence/trust-pipeline/** is Scope A's zone — NOT touched by Scope G).`);

  const layersExist = existsSync(LAYERS_DIR);
  console.log(`--- P9 layers status (raw) ---`);
  console.log(`intelligence/layers/ exists: ${layersExist}`);
  if (!layersExist) {
    console.log(`intelligence/layers/ does not exist yet (Scope I future work) — per-layer label ` +
      `declaration rule is documented in events/provenance/README.md; nothing to wire today (honest disclosure).`);
  }
  done('P9');
}

/* P10 — determinism: same inputs → same provenance shape. */
async function p10() {
  const fixture = { station: 'TEST-FIXTURE-01', temperatureC: 21.5 };
  const opts = { source: 'jexi test fixture', method: 'determinism probe', confidence: 0.9, notes: 'shape check' };
  const envA = label.attach(fixture, { ...opts, label: 'estimated' });
  const envB = label.attach(fixture, { ...opts, label: 'estimated' });
  raw('P10 provenance A', envA.provenance);
  raw('P10 provenance B', envB.provenance);

  const keysA = JSON.stringify(Object.keys(envA.provenance));
  const keysB = JSON.stringify(Object.keys(envB.provenance));
  eq(keysA, keysB, 'same key sequence (fixed build order)');

  const mask = (prov) => JSON.stringify({ ...prov, timestamp: '<ts>' });
  eq(mask(envA.provenance), mask(envB.provenance),
    'byte-identical with timestamps masked — same inputs → same provenance object shape');
  ok(Object.keys(envA.provenance)[0] === 'label' && Object.keys(envA.provenance)[1] === 'source' &&
    Object.keys(envA.provenance)[2] === 'method' && Object.keys(envA.provenance)[3] === 'confidence',
    'key order is the documented fixed order (label, source, method, confidence, …)');
  done('P10');
}

/* P11 — store/query round-trip: the label survives a real disk round-trip. */
async function p11() {
  console.log(`[P11] fetching one real USGS earthquake record…`);
  const { json } = await getJson(USGS_FDSN(1));
  const env = label.attachObserved(json.features[0], {
    source: USGS_SOURCE,
    method: 'direct fetch — USGS FDSN event query',
    notes: `event ${json.features[0].id}`,
  });

  mkdirSync(join(ROOT, 'scratch'), { recursive: true });
  const storedAt = new Date().toISOString();
  writeFileSync(STORE_PATH, JSON.stringify({ storedAt, envelope: env }, null, 2), 'utf8');
  raw('P11 stored document (disk)', { storedAt, path: 'scratch/phase9-g-store.json', bytes: readFileSync(STORE_PATH, 'utf8').length });

  // Query it back from disk (serialization boundary crossed).
  const doc = JSON.parse(readFileSync(STORE_PATH, 'utf8'));
  const back = doc.envelope;
  raw('P11 queried-back provenance', back.provenance);

  ok(label.check(back), 'label intact after store/query round-trip (check === true)');
  eq(JSON.stringify(back.provenance), JSON.stringify(env.provenance), 'provenance byte-identical after round-trip');
  eq(back.provenance.label, 'observed', 'label still observed');
  eq(doc.storedAt, storedAt, 'storage document metadata intact');
  rmSync(STORE_PATH, { force: true });
  done('P11');
}

const cases = { p1, p2, p3, p4, p5, p6, p7, p8, p9, p10, p11 };
const fn = cases[process.argv[2]];
if (!fn) {
  console.log('usage: node scripts/phase9-g-probe.mjs <p1|p2|p3|p4|p5|p6|p7|p8|p9|p10|p11>');
  process.exit(1);
}
await fn();
