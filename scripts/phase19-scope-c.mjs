#!/usr/bin/env node
/**
 * JEXI OS — Phase 19 Scope C — live probe (P1-P6).
 *
 * Raw output only. English only. Every PASS/FAIL line is computed from real
 * calls against surfsense/output. No rendered text is faked.
 */
import { execSync } from 'node:child_process';
import output from '../surfsense/output/index.js';
import search from '../surfsense/search/index.js';
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

console.log('=== PHASE 19 SCOPE C PROBE ===\n');

// Shared 5-doc fixture: real public works, ISO dates, tuned topics so the
// thematic grouping (protocol x2) and the faq dedupe are observable.
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
const QUERY = 'protocol history';

// ---------------------------------------------------------------- P1
try {
  const names = output.formats();
  const detail = `    [${names.join(', ')}]  (count: ${names.length})`;
  check(
    1,
    `output.formats() -> 12 names`,
    Array.isArray(names) && names.length === 12 && new Set(names).size === 12 && names.every((n) => typeof n === 'string'),
    detail
  );
} catch (err) {
  failLabel(1, 'formats()', err);
}

// ---------------------------------------------------------------- P2
try {
  let allOk = true;
  const blocks = [];
  for (const f of output.formats()) {
    const rendered = output.render(DOCS, { format: f, query: QUERY });
    const nonEmpty = typeof rendered === 'string' && rendered.length > 0;
    allOk = allOk && nonEmpty;
    blocks.push(
      `--- ${f} (len ${rendered.length}) ---\n` +
        rendered
          .split('\n')
          .map((l) => `    ${l}`)
          .join('\n')
    );
  }
  // Cross-scope integration: Scope B ranked docs flow straight into render.
  const ranked = search.hybrid(QUERY, DOCS);
  const viaSearch = output.render(ranked, { format: 'summary', query: QUERY });
  const integrationOk = typeof viaSearch === 'string' && viaSearch.length > 0;
  allOk = allOk && integrationOk;
  check(
    2,
    'each of the 12 formats renders non-empty output on the same 5-doc fixture',
    allOk,
    blocks.join('\n') +
      `\n    --- integration: search.hybrid('${QUERY}') -> output.render(format='summary') ---\n` +
      viaSearch
        .split('\n')
        .map((l) => `    ${l}`)
        .join('\n')
  );
} catch (err) {
  failLabel(2, 'render x12', err);
}

// ---------------------------------------------------------------- P3
try {
  const withQuery = output.formats().map((f) => output.render([], { format: f, query: QUERY }));
  const noQuery = output.formats().map((f) => output.render([], { format: f }));
  const allEmpty =
    withQuery.every((r) => r === '') && noQuery.every((r) => r === '');
  check(
    3,
    'empty docs -> empty output (not error) for every format, with and without query',
    allEmpty,
    `    with query:    ${output.formats().map((f, i) => `${f}=${JSON.stringify(withQuery[i])}`).join(', ')}\n` +
      `    without query: ${output.formats().map((f, i) => `${f}=${JSON.stringify(noQuery[i])}`).join(', ')}`
  );
} catch (err) {
  failLabel(3, 'empty input', err);
}

// ---------------------------------------------------------------- P4
try {
  const outcomes = [];
  let allOk = true;

  // E_UNKNOWN_FORMAT via render() and via assert()
  try {
    output.render(DOCS, { format: 'poem', query: QUERY });
    outcomes.push('render(format=poem): NO THROW (unexpected)');
    allOk = false;
  } catch (err) {
    const isSurf = err instanceof SurfError;
    outcomes.push(`render(format=poem): ${isSurf ? 'SurfError' : err?.name} code=${err.code} msg="${err.message}"`);
    allOk = allOk && isSurf && err.code === 'E_UNKNOWN_FORMAT';
  }
  try {
    output.assert('poem');
    outcomes.push('assert(poem): NO THROW (unexpected)');
    allOk = false;
  } catch (err) {
    const isSurf = err instanceof SurfError;
    outcomes.push(`assert(poem): ${isSurf ? 'SurfError' : err?.name} code=${err.code}`);
    allOk = allOk && isSurf && err.code === 'E_UNKNOWN_FORMAT';
  }
  const assertPass = output.assert('timeline') === 'timeline';
  outcomes.push(`assert(timeline): returned '${output.assert('timeline')}' (no throw)`);
  allOk = allOk && assertPass;

  // E_MISSING_FIELD: timeline with a doc that has no date
  const partiallyUndated = [
    { id: 'dated', title: 'Dated Record', date: '1996-01-01', text: 'This record carries a date.' },
    { id: 'undated', title: 'Undated Record', text: 'This record carries no date.' },
  ];
  try {
    output.render(partiallyUndated, { format: 'timeline', query: QUERY });
    outcomes.push('timeline(undated doc): NO THROW (unexpected)');
    allOk = false;
  } catch (err) {
    const isSurf = err instanceof SurfError;
    const namesField = err.message.includes('"date"');
    outcomes.push(`timeline(undated doc): ${isSurf ? 'SurfError' : err?.name} code=${err.code} field named: ${namesField} msg="${err.message}"`);
    allOk = allOk && isSurf && err.code === 'E_MISSING_FIELD' && namesField;
  }
  // Same required-field contract holds for chronological
  try {
    output.render(partiallyUndated, { format: 'chronological', query: QUERY });
    outcomes.push('chronological(undated doc): NO THROW (unexpected)');
    allOk = false;
  } catch (err) {
    const isSurf = err instanceof SurfError;
    outcomes.push(`chronological(undated doc): code=${err.code}`);
    allOk = allOk && isSurf && err.code === 'E_MISSING_FIELD';
  }

  check(
    4,
    'errors: E_UNKNOWN_FORMAT (unknown name) and E_MISSING_FIELD (timeline, missing "date")',
    allOk,
    '  ' + outcomes.join('\n  ')
  );
} catch (err) {
  failLabel(4, 'error codes', err);
}

// ---------------------------------------------------------------- P5
try {
  const pairs = output.formats().map((f) => {
    const a = output.render(DOCS, { format: f, query: QUERY });
    const b = output.render(DOCS, { format: f, query: QUERY });
    return { f, a, b, identical: a === b };
  });
  const allIdentical = pairs.every((p) => p.identical);
  check(
    5,
    'determinism: each of the 12 formats rendered twice -> byte-identical output',
    allIdentical,
    pairs.map((p) => `    ${p.f.padEnd(20)} bytes=${p.a.length} byte-identical=${p.identical}`).join('\n')
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
      (files.length === 0 ? '    (clean)' : files.map((f) => `    ${f}`).join('\n'))
  );
} catch (err) {
  failLabel(6, 'zone check', err);
}

const passCount = results.filter((r) => r.pass).length;
console.log(`\n=== SCOPE C: ${passCount}/${results.length} PASS, exit ${passCount === results.length ? 0 : 1} ===`);
process.exit(passCount === results.length ? 0 : 1);
