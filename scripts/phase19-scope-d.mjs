#!/usr/bin/env node
/**
 * JEXI OS — Phase 19 Scope D — live probe (P1-P7).
 *
 * Raw output only. English only. Every PASS/FAIL line is computed from real
 * calls against surfsense/podcast. No script text is faked.
 */
import { execSync } from 'node:child_process';
import podcast from '../surfsense/podcast/index.js';
import { SurfError } from '../surfsense/connectors/_internal.js';

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

console.log('=== PHASE 19 SCOPE D PROBE ===\n');

// Same 5-doc fixture as Scope C (consistency across scopes).
const DOCS = [
  {
    id: 'rfc-2324',
    title: 'Hyper Text Coffee Pot Control Protocol (1998)',
    date: '1998-04-01',
    text: 'HTCPCP is a protocol for controlling and monitoring coffee pots. Coffee brewing needs monitoring. Coffee pot status is queryable.',
  },
  {
    id: 'rfc-791',
    title: 'Internet Protocol (1981)',
    date: '1981-09-01',
    text: 'The Internet Protocol implements datagram delivery across networks. Protocol datagram forwarding. Protocol routing tables.',
  },
  {
    id: 'rfc-3550',
    title: 'RTP: A Transport Protocol (1996)',
    date: '1996-01-01',
    text: 'RTP provides realtime delivery for audio and video. Protocol headers carry payload typing. Protocol monitoring companions exist.',
  },
  {
    id: 'alice-1865',
    title: "Alice's Adventures in Wonderland (1865)",
    date: '1865-11-18',
    text: 'Alice falls down a rabbit hole into a fantasy world. Alice meets odd characters.',
  },
  {
    id: 'gettysburg-1863',
    title: 'Gettysburg Address (1863)',
    date: '1863-11-19',
    text: 'Four score and seven years ago our fathers brought forth a new nation. The nation conceived in liberty. The nation may long endure.',
  },
];
const HOSTS = ['Nova', 'Sender'];
const MINUTES = 5;

const norm = (s) => String(s).replace(/\s+/g, ' ').trim();
const byId = new Map(DOCS.map((d) => [d.id, d]));

/** Traceability: every double-quoted span in a turn must be verbatim from a
 *  cited doc's title+text (normalized whitespace). Returns offending list. */
function untraceableSpans(script) {
  const bad = [];
  for (const seg of script.segments) {
    for (const turn of seg.turns) {
      const spans = [...turn.text.matchAll(/"([^"]+)"/g)].map((m) => norm(m[1]));
      for (const span of spans) {
        const found = turn.cites.some((c) => {
          const d = byId.get(c);
          return d ? norm(`${d.title ?? ''} ${d.text}`).includes(span) : false;
        });
        if (!found) bad.push(`${seg.name}/${turn.speaker}: "${span.slice(0, 60)}"`);
      }
    }
  }
  return bad;
}

// ---------------------------------------------------------------- P1
try {
  const script = podcast.script(DOCS, { hosts: HOSTS, minutes: MINUTES });
  const names = script.segments.map((s) => s.name);
  const allTurns = script.segments.flatMap((s) => s.turns);
  const shapeOk = allTurns.every(
    (t) =>
      Array.isArray(t.cites) &&
      typeof t.text === 'string' && t.text.length > 0 &&
      typeof t.speaker === 'string' &&
      JSON.stringify(Object.keys(t).sort()) === JSON.stringify(['cites', 'speaker', 'text'])
  );
  const citesValid = allTurns.every((t) => t.cites.every((c) => byId.has(c)));
  const mainCited = script.segments
    .filter((s) => s.name === 'main')
    .flatMap((s) => s.turns)
    .every((t) => t.cites.length > 0);
  const badSpans = untraceableSpans(script);
  const segOrderOk =
    JSON.stringify(names) === JSON.stringify(['intro', 'main', 'outro']);
  const budgetOk = script.totalTurns === 20; // round(5 * 4)

  // Bonus: 3-host rotation (SurfSense brief supports up to MAX_SPEAKERS).
  const h3 = podcast.script(DOCS, { hosts: ['Nova', 'Sender', 'Guest'], minutes: MINUTES });
  const h3Speakers = new Set(h3.segments.flatMap((s) => s.turns.map((t) => t.speaker)));
  const rotationOk = h3Speakers.size === 3;

  const citedSummary = script.segments
    .map((s) => `    ${s.name}: ${s.turns.length} turns -> ${s.turns.map((t) => `${t.speaker}${t.cites.length ? ` [${t.cites.join(',')}]` : ''}`).join(' | ')}`)
    .join('\n');

  check(
    1,
    `script(5 docs, 2 hosts, 5-min target) -> intro/main/outro, totalTurns=${script.totalTurns}, every cite a real doc id, no invented quoted facts`,
    segOrderOk && budgetOk && shapeOk && citesValid && mainCited && badSpans.length === 0 && rotationOk,
    `    segments: [${names.join(', ')}]  totalTurns: ${script.totalTurns} (target ${Math.round(MINUTES * 4)})\n` +
      `    turn shape {speaker,text,cites}: ${shapeOk} | cites valid: ${citesValid} | main turns cited: ${mainCited}\n` +
      `    untraceable quoted spans: ${badSpans.length === 0 ? 'none' : badSpans.join('; ')}\n` +
      `    3-host rotation check: ${rotationOk} (speakers seen: ${[...h3Speakers].join(', ')})\n` +
      citedSummary + '\n' +
      `    --- full script structure (JSON) ---\n` +
      JSON.stringify(script, null, 2)
        .split('\n')
        .map((l) => `    ${l}`)
        .join('\n')
  );
} catch (err) {
  failLabel(1, 'script generation', err);
}

// ---------------------------------------------------------------- P2
try {
  const script = podcast.script(DOCS, { hosts: HOSTS, minutes: MINUTES });
  const md = podcast.render(script);
  const needs = ['## Intro', '## Main', '## Outro', '**Nova:**', '**Sender:**', podcast.LABEL];
  const missing = needs.filter((n) => !md.includes(n));
  check(
    2,
    'render(script) -> markdown transcript with speaker labels, segment headers, truthfulness label',
    typeof md === 'string' && md.length > 0 && missing.length === 0,
    `    bytes: ${md.length} | missing markers: ${missing.length === 0 ? 'none' : missing.join(', ')}\n` +
      md
        .split('\n')
        .map((l) => `    ${l}`)
        .join('\n')
  );
} catch (err) {
  failLabel(2, 'render', err);
}

// ---------------------------------------------------------------- P3
try {
  const t5 = podcast.script(DOCS, { hosts: HOSTS, minutes: 5 }).totalTurns;
  const t10 = podcast.script(DOCS, { hosts: HOSTS, minutes: 10 }).totalTurns;
  const ratio = t10 / t5;
  check(
    3,
    'turn count scales with minutes: 5 min vs 10 min -> ~2x turns',
    t10 === 2 * t5 && ratio >= 1.8 && ratio <= 2.2,
    `    minutes=5 -> totalTurns=${t5}; minutes=10 -> totalTurns=${t10}; ratio=${ratio}`
  );
} catch (err) {
  failLabel(3, 'turn scaling', err);
}

// ---------------------------------------------------------------- P4
try {
  const empty = podcast.script([], { hosts: HOSTS, minutes: MINUTES });
  const rendered = podcast.render(empty);
  check(
    4,
    'empty docs -> empty script (segments [], totalTurns 0, not an error); render -> empty string',
    Array.isArray(empty.segments) && empty.segments.length === 0 && empty.totalTurns === 0 && rendered === '',
    `    script: ${JSON.stringify(empty)}\n    render: ${JSON.stringify(rendered)}`
  );
} catch (err) {
  failLabel(4, 'empty docs', err);
}

// ---------------------------------------------------------------- P5
try {
  const outcomes = [];
  let allOk = true;
  const expect = (fn, code) => {
    try {
      fn();
      outcomes.push(`NO THROW (unexpected)`);
      allOk = false;
    } catch (err) {
      const isSurf = err instanceof SurfError;
      outcomes.push(`${isSurf ? 'SurfError' : err?.name} code=${err.code} msg="${err.message}"`);
      allOk = allOk && isSurf && err.code === code;
    }
  };
  expect(() => podcast.script(DOCS, { minutes: MINUTES }), 'E_MISSING_HOSTS');
  expect(() => podcast.script(DOCS, { hosts: 'Nova', minutes: MINUTES }), 'E_MISSING_HOSTS');
  expect(() => podcast.script(DOCS, { hosts: ['Solo'], minutes: MINUTES }), 'E_TOO_FEW_HOSTS');
  expect(() => podcast.script(DOCS, { hosts: HOSTS, minutes: 0 }), 'E_INVALID_MINUTES');
  expect(() => podcast.script(DOCS, { hosts: HOSTS, minutes: -3 }), 'E_INVALID_MINUTES');
  check(
    5,
    'errors: E_MISSING_HOSTS (no hosts), E_TOO_FEW_HOSTS (1 host), E_INVALID_MINUTES (0 / negative)',
    allOk,
    '  ' + outcomes.join('\n  ')
  );
} catch (err) {
  failLabel(5, 'error codes', err);
}

// ---------------------------------------------------------------- P6
try {
  const s1 = podcast.script(DOCS, { hosts: HOSTS, minutes: MINUTES });
  const s2 = podcast.script(DOCS, { hosts: HOSTS, minutes: MINUTES });
  const sJson = JSON.stringify(s1);
  const r1 = podcast.render(s1);
  const r2 = podcast.render(s2);
  check(
    6,
    'determinism: same docs + hosts + minutes twice -> byte-identical script and render',
    sJson === JSON.stringify(s2) && r1 === r2,
    `    script bytes: ${sJson.length} byte-identical: ${sJson === JSON.stringify(s2)}\n` +
      `    render bytes: ${r1.length} byte-identical: ${r1 === r2}`
  );
} catch (err) {
  failLabel(6, 'determinism', err);
}

// ---------------------------------------------------------------- P7
try {
  const status = execSync('git status --short', { encoding: 'utf8' }).trim();
  const files = status.length === 0 ? [] : status.split('\n').map((line) => line.slice(3).trim());
  const zoneOk = files.every(
    (f) => f.startsWith('surfsense/') || /^scripts\/phase19-[^/]*\.mjs$/.test(f)
  );
  check(
    7,
    'zone check: only surfsense/** and scripts/phase19-*.mjs',
    zoneOk, // consolidation cleanup: assert only that no touched path is outside the zone; a clean committed tree passes vacuously
    '  git status --short:\n' +
      (files.length === 0 ? '    (clean)' : files.map((f) => `    ${f}`).join('\n'))
  );
} catch (err) {
  failLabel(7, 'zone check', err);
}

const passCount = results.filter((r) => r.pass).length;
console.log(`\n=== SCOPE D: ${passCount}/${results.length} PASS, exit ${passCount === results.length ? 0 : 1} ===`);
process.exit(passCount === results.length ? 0 : 1);
