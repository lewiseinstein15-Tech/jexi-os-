#!/usr/bin/env node
/**
 * JEXI OS — Phase 19 Scope A — live probe (P1-P6).
 *
 * Raw output only. English only. No simulation of results: every PASS/FAIL
 * line is computed from real calls against surfsense/connectors.
 */
import { execSync } from 'node:child_process';
import registry from '../surfsense/connectors/index.js';
import { assertConnector } from '../surfsense/connectors/_connector.js';

const results = [];
function check(pid, label, pass, detail) {
  results.push({ pid, label, pass });
  console.log(`P${pid} ${pass ? 'PASS' : 'FAIL'} — ${label}`);
  if (detail !== undefined) console.log(detail);
}
function failLabel(pid, label, err) {
  results.push({ pid, label, pass: false });
  console.log(`P${pid} FAIL — ${label} (${err?.message ?? err})`);
}

console.log('=== PHASE 19 SCOPE A PROBE ===\n');

// ---------------------------------------------------------------- P1
try {
  const all = registry.list();
  const live = all.filter((c) => c.capabilities.live).length;
  const nonLive = all.length - live;
  check(
    1,
    `registry.list() -> ${all.length} connectors (live: ${live}, non-live: ${nonLive})`,
    all.length === 16,
    all
      .map(
        (c) =>
          `  ${c.name.padEnd(14)} live=${String(c.capabilities.live).padEnd(5)} auth=${c.capabilities.auth}`
      )
      .join('\n') + `\n  count: ${all.length} | live: ${live} | non-live: ${nonLive}`
  );
} catch (err) {
  failLabel(1, 'registry.list()', err);
}

// ---------------------------------------------------------------- P2
try {
  const reddit = registry.get('reddit');
  let unknownCaught = false;
  let unknownCode = null;
  try {
    registry.get('not-a-connector');
  } catch (err) {
    unknownCaught = true;
    unknownCode = err.code;
  }
  check(
    2,
    "registry.get('reddit') -> connector; registry.get('not-a-connector') -> E_UNKNOWN_CONNECTOR",
    reddit.name === 'reddit' && unknownCaught && unknownCode === 'E_UNKNOWN_CONNECTOR',
    `  reddit -> { name: ${JSON.stringify(reddit.name)}, capabilities: ${JSON.stringify(
      reddit.capabilities
    )}, fetch: ${typeof reddit.fetch} }\n` +
      `  not-a-connector -> ${unknownCode}`
  );
} catch (err) {
  failLabel(2, 'registry.get()', err);
}

// ---------------------------------------------------------------- P3
try {
  let liveUnavailableCode = null;
  try {
    await registry.fetch('reddit', 'best posts about kubernetes');
  } catch (err) {
    liveUnavailableCode = err.code;
  }
  const localResult = await registry.fetch('local-search', 'internet protocol datagram addressing', {
    limit: 3,
  });
  const provenanceOk = localResult.documents.every(
    (d) => d.source === 'local-search' && typeof d.url === 'string' && d.fetchedAt && d.text.length > 0
  );
  check(
    3,
    'live:false fetch -> E_LIVE_UNAVAILABLE; live:true fetch -> provenance documents',
    liveUnavailableCode === 'E_LIVE_UNAVAILABLE' &&
      localResult.documents.length > 0 &&
      provenanceOk,
    `  reddit fetch -> ${liveUnavailableCode}\n` +
      `  local-search fetch(query='internet protocol datagram addressing', limit=3) -> ${localResult.documents.length} documents\n` +
      localResult.documents
        .map(
          (d) =>
            `    - ${d.title} | score=${d.score} | url=${d.url} | text="${d.text.slice(0, 60)}..."`
        )
        .join('\n')
  );
} catch (err) {
  failLabel(3, 'live/unlive fetch behavior', err);
}

// ---------------------------------------------------------------- P4
try {
  const cases = [
    { name: 'missing capabilities', def: { name: 'x', capabilities: { live: true }, fetch: async () => ({ documents: [] }) } },
    { name: 'bad auth mode', def: { name: 'x', capabilities: { live: true, auth: 'magic' }, fetch: async () => ({ documents: [] }) } },
    { name: 'missing fetch', def: { name: 'x', capabilities: { live: true, auth: 'none' } } },
  ];
  const outcomes = [];
  let allIncomplete = true;
  for (const c of cases) {
    try {
      assertConnector(c.def);
      outcomes.push(`${c.name}: no throw`);
      allIncomplete = false;
    } catch (err) {
      outcomes.push(`${c.name}: ${err.code}`);
      if (err.code !== 'E_CONNECTOR_INCOMPLETE') allIncomplete = false;
    }
  }
  check(
    4,
    'connector.assert() on malformed connectors -> E_CONNECTOR_INCOMPLETE',
    allIncomplete,
    '  ' + outcomes.join('\n  ')
  );
} catch (err) {
  failLabel(4, 'assert enforcement', err);
}

// ---------------------------------------------------------------- P5
try {
  const a = JSON.stringify(registry.list());
  const b = JSON.stringify(registry.list());
  check(
    5,
    'registry.list() twice -> byte-identical',
    a === b,
    `  bytes: ${a.length} | byte-identical: ${a === b}`
  );
} catch (err) {
  failLabel(5, 'determinism', err);
}

// ---------------------------------------------------------------- P6
try {
  const status = execSync('git status --short', { encoding: 'utf8' }).trim();
  const files = status.length === 0 ? [] : status.split('\n').map((line) => line.slice(3).trim());
  const zoneOk = files.every(
    (f) => f.startsWith('surfsense/') || /^scripts\/phase19-[^/]*\.mjs$/.test(f)
  );
  check(
    6,
    'zone check: only surfsense/** and scripts/phase19-*.mjs',
    zoneOk && files.length > 0,
    '  git status --short:\n' +
      (files.length === 0
        ? '    (clean)'
        : files.map((f) => `    ${f}`).join('\n'))
  );
} catch (err) {
  failLabel(6, 'zone check', err);
}

const passCount = results.filter((r) => r.pass).length;
console.log(`\n=== SCOPE A: ${passCount}/${results.length} PASS, exit ${passCount === results.length ? 0 : 1} ===`);
process.exit(passCount === results.length ? 0 : 1);
