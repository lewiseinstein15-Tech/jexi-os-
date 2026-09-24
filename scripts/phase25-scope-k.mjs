#!/usr/bin/env node
// scripts/phase25-scope-k.mjs
// Phase 25 — Scope K live probe: prompt versioning + test framework.
// Zero dependencies. Real immutable snapshot records on real disk under the
// gitignored .jexi/ probe root (JEXI_PROMPT_VERSIONS_ROOT). Real SIGKILL in
// P10 (child process self-kills by signal; a fresh process re-reads the
// snapshot). Raw output per check. Exit 1 on any failure.

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

import { versioning, VERSIONING_CODES } from '../capabilities/prompts/versioning/index.js';
import { testing, ASSERTION_KINDS, TESTING_CODES } from '../capabilities/prompts/testing/index.js';

const WT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = fileURLToPath(import.meta.url);

let failures = 0;
function check(name, ok, evidence) {
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}`);
  console.log(`        ${evidence}`);
  if (!ok) failures += 1;
}

const STORE_BASE = path.join(WT, '.jexi', 'probe-versions', 'scope-k');
function freshStore(name) {
  const p = path.join(STORE_BASE, name);
  fs.rmSync(p, { recursive: true, force: true });
  process.env.JEXI_PROMPT_VERSIONS_ROOT = p;
  return p;
}

// Realistic built prompt: four Scope-A static sections ({id, content}).
const FIXTURE_V1 = [
  {
    id: 'identity',
    content:
      'You are JEXI, a personal operating system for knowledge work.\nYou follow the constitution and never improvise beyond it.',
  },
  {
    id: 'system-rules',
    content:
      '1. Refuse untagged writes with E_UNTAGGED.\n2. Tag user-provided content as [stated].\n3. Escalate when a rule is ambiguous instead of guessing.',
  },
  {
    id: 'doing-tasks',
    content:
      'Work section by section.\nPrefer the smallest change that satisfies the request.\nNever leave a task half-done.',
  },
  {
    id: 'actions',
    content: 'Before any write: excise, tag, assert, then commit to disk.',
  },
];
const EDITED_DOING_TASKS =
  'Work section by section.\nPrefer the smallest change that satisfies the request.\nNever leave a task half-done.\nVerify with a live probe before reporting done.';

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// ---------------------------------------------------------------------------
// Child modes for P10 (real SIGKILL persistence across processes)
// ---------------------------------------------------------------------------
function runP10Child() {
  const sections = [
    { id: 'identity', content: 'SIGKILL-PERSISTENCE-MARKER scope-k: this snapshot must survive a kill -9.' },
    { id: 'actions', content: 'Snapshot written, marker flushed, then SIGKILL.' },
  ];
  const result = versioning.snapshot(sections);
  const root = versioning.versioningRoot();
  fs.writeFileSync(
    path.join(root, 'p10-child-result.json'),
    JSON.stringify(result, null, 2) + '\n',
    'utf8'
  );
  fs.writeFileSync(path.join(root, 'p10-ready.json'), JSON.stringify({ ready: true, pid: process.pid }));
  process.kill(process.pid, 'SIGKILL'); // real kill -9, no graceful exit
}

function runP10Verify(versionId) {
  try {
    const rec = versioning.load(versionId);
    const textReSha256 = versioning.sha256Text(rec.text);
    const sectionHashesMatch = (rec.sectionOrder || []).every((id) => {
      const sec = (rec.sections || []).find((s) => s.id === id);
      return sec && rec.sectionHashes[id] === versioning.sha256Text(sec.content);
    });
    console.log(
      JSON.stringify(
        {
          resolved: true,
          versionId: rec.versionId,
          sha256: rec.sha256,
          textReSha256,
          sectionCount: (rec.sectionOrder || []).length,
          sectionHashesMatch,
        },
        null,
        2
      )
    );
    process.exit(0);
  } catch (e) {
    console.log(JSON.stringify({ resolved: false, error: String((e && e.message) || e) }, null, 2));
    process.exit(1);
  }
}

const MODE = process.argv[2];
if (MODE === '--p10-child') {
  runP10Child();
  process.exit(0); // unreachable: SIGKILL lands first
}
if (MODE === '--p10-verify') {
  runP10Verify(process.argv[3] ?? '');
  process.exit(1);
}

// ===========================================================================
// Full probe
// ===========================================================================
console.log('=== SCOPE K PROBE — prompt versioning + test framework ===');
console.log(`node ${process.version}`);
console.log(`store root: ${freshStore('main')}`);
console.log('');

// ---------------------------------------------------------------------------
// P1 — Snapshot a built prompt (versionId, sha256, sectionHashes per section)
// ---------------------------------------------------------------------------
const v1 = versioning.snapshot(FIXTURE_V1);
console.log('P1 snapshot(v1) raw:');
console.log(JSON.stringify(v1, null, 2));
const v1HashesOk = FIXTURE_V1.every((s) => v1.sectionHashes[s.id] === versioning.sha256Text(s.content));
check(
  'P1 snapshot returns versionId + sha256 + per-section sectionHashes (4 sections, hashes recomputed and matching)',
  /^pv-[0-9a-f]{16}$/.test(v1.versionId) &&
    /^[0-9a-f]{64}$/.test(v1.sha256) &&
    Object.keys(v1.sectionHashes).length === 4 &&
    v1HashesOk,
  `versionId=${v1.versionId} sha256=${v1.sha256} sectionHashes keys=[${Object.keys(v1.sectionHashes).join(', ')}] per-section recompute=${v1HashesOk}`
);
console.log('');

// ---------------------------------------------------------------------------
// P2 — Change one section, snapshot again (two versionIds, two sha256)
// ---------------------------------------------------------------------------
const FIXTURE_V2 = FIXTURE_V1.map((s) =>
  s.id === 'doing-tasks' ? { id: s.id, content: EDITED_DOING_TASKS } : s
);
const v2 = versioning.snapshot(FIXTURE_V2);
console.log('P2 snapshot(v2) raw:');
console.log(JSON.stringify(v2, null, 2));
check(
  'P2 edited build snapshots to a DIFFERENT versionId and DIFFERENT sha256',
  v2.versionId !== v1.versionId && v2.sha256 !== v1.sha256,
  `v1: ${v1.versionId}/${v1.sha256.slice(0, 12)}...  v2: ${v2.versionId}/${v2.sha256.slice(0, 12)}...`
);
console.log('');

// ---------------------------------------------------------------------------
// P3 — Diff v1 vs v2 (only the changed section reports changed:true)
// ---------------------------------------------------------------------------
const d = versioning.diff(v1.versionId, v2.versionId); // by versionId string
console.log('P3 diff(v1, v2) raw:');
console.log(JSON.stringify(d, null, 2));
const changedOnes = d.sections.filter((s) => s.changed);
const unchangedOnes = d.sections.filter((s) => !s.changed);
const deltaOk =
  changedOnes.length === 1 &&
  changedOnes[0].id === 'doing-tasks' &&
  changedOnes[0].delta.kind === 'modified' &&
  changedOnes[0].delta.added.length === 1 &&
  changedOnes[0].delta.added[0].text === 'Verify with a live probe before reporting done.' &&
  changedOnes[0].delta.removed.length === 0;
check(
  'P3 only doing-tasks reports changed:true (with line-level delta); all other sections changed:false',
  d.sections.length === 4 && deltaOk && unchangedOnes.map((s) => s.id).join(',') === 'identity,system-rules,actions',
  `changed=[${changedOnes.map((s) => s.id).join(', ')}] unchanged=[${unchangedOnes.map((s) => s.id).join(', ')}] delta=${JSON.stringify(changedOnes[0]?.delta)}`
);
console.log('');

// ---------------------------------------------------------------------------
// P4 — Rollback to v1 (restoredSha256 == v1.sha256, byte-identical)
// ---------------------------------------------------------------------------
const rb = versioning.rollback(v1.versionId);
console.log('P4 rollback(v1) raw (text elided):');
console.log(JSON.stringify({ ...rb, text: `<${rb.text.length} chars>`, sections: `<${rb.sections.length} sections>` }, null, 2));
const reHash = versioning.sha256Text(rb.text);
const v2StillThere = (() => {
  try {
    return versioning.load(v2.versionId).versionId === v2.versionId;
  } catch {
    return false;
  }
})();
const active = versioning.active();
check(
  'P4 rollback restores v1 byte-identically; intermediate v2 still exists (RULE 3); active pointer moved to v1',
  rb.restored === true &&
    rb.restoredSha256 === v1.sha256 &&
    reHash === v1.sha256 &&
    v2StillThere &&
    active.active === v1.versionId,
  `restoredSha256=${rb.restoredSha256.slice(0, 12)}... v1.sha256=${v1.sha256.slice(0, 12)}... rehash(text)=${reHash.slice(0, 12)}... v2 resolvable=${v2StillThere} active=${active.active} previous=${active.previous}`
);
console.log('');

// ---------------------------------------------------------------------------
// P5 — Test passes (contains)
// ---------------------------------------------------------------------------
const v1Record = versioning.load(v1.versionId);
const p5 = testing.register({
  id: 't-p5-contains',
  description: 'the write pipeline line is present in the actions section',
  prompt: v1Record.text,
  assertions: [{ kind: 'contains', value: 'excise, tag, assert, then commit to disk' }],
});
const p5run = testing.run(p5.testId);
console.log('P5 run raw:');
console.log(JSON.stringify(p5run, null, 2));
check(
  'P5 contains test registers -> runs -> passed:true, zero failures',
  p5run.passed === true && p5run.failures.length === 0,
  `testId=${p5.testId} passed=${p5run.passed} durationMs=${p5run.durationMs}`
);
console.log('');

// ---------------------------------------------------------------------------
// P6 — Test fails (not-contains, value IS present): named assertion,
//      expected vs actual, no swallowing
// ---------------------------------------------------------------------------
const p6 = testing.register({
  id: 't-p6-not-contains',
  description: 'the placeholder marker must NOT appear in the built prompt',
  prompt: v1Record.text,
  assertions: [{ kind: 'not-contains', value: '[stated]' }],
});
const p6run = testing.run(p6.testId); // '[stated]' IS in system-rules -> must fail
console.log('P6 run raw (failing):');
console.log(JSON.stringify(p6run, null, 2));
const f = p6run.failures[0] ?? {};
check(
  'P6 failing not-contains names the assertion (index 0, kind) and shows expected vs actual',
  p6run.passed === false &&
    p6run.failures.length === 1 &&
    f.index === 0 &&
    f.kind === 'not-contains' &&
    f.expected?.absent === '[stated]' &&
    f.actual?.occurrences >= 1 &&
    typeof f.message === 'string' &&
    f.message.length > 0,
  `passed=${p6run.passed} failure: index=${f.index} kind=${f.kind} expected=${JSON.stringify(f.expected)} actual=${JSON.stringify(f.actual)}`
);
console.log('');

// ---------------------------------------------------------------------------
// P7 — within-budget: same test, over-budget prompt -> fail,
//      under-budget prompt -> pass (subject override per run)
// ---------------------------------------------------------------------------
const p7 = testing.register({
  id: 't-p7-budget',
  description: 'runtime prompt stays within 400 chars',
  prompt: 'base subject (overridden per run)',
  assertions: [{ kind: 'within-budget', maxChars: 400 }],
});
const overBudget = 'x'.repeat(500);
const underBudget = 'short prompt';
const p7over = testing.run(p7.testId, { prompt: overBudget });
const p7under = testing.run(p7.testId, { prompt: underBudget });
console.log('P7 run(over-budget) raw:');
console.log(JSON.stringify(p7over, null, 2));
console.log('P7 run(under-budget) raw:');
console.log(JSON.stringify(p7under, null, 2));
const fo = p7over.failures[0] ?? {};
check(
  'P7 within-budget: over-budget (500 chars vs max 400) FAILS with overBy; same test under-budget PASSES',
  p7over.passed === false &&
    fo.kind === 'within-budget' &&
    fo.expected?.maxChars === 400 &&
    fo.actual?.chars === 500 &&
    fo.actual?.overBy === 100 &&
    p7under.passed === true &&
    p7under.failures.length === 0,
  `over: passed=${p7over.passed} expected=${JSON.stringify(fo.expected)} actual=${JSON.stringify(fo.actual)} | under: passed=${p7under.passed} chars=${underBudget.length}`
);
console.log('');

// ---------------------------------------------------------------------------
// P8 — matches-schema: JSON payload validated against a JSON-Schema subset
// ---------------------------------------------------------------------------
const P8_SCHEMA = {
  type: 'object',
  required: ['section', 'chars'],
  properties: { section: { type: 'string' }, chars: { type: 'integer', minimum: 0 } },
  additionalProperties: false,
};
const p8pass = testing.register({
  id: 't-p8-schema-pass',
  description: 'section report payload matches the schema',
  prompt: JSON.stringify({ section: 'doing-tasks', chars: 512 }),
  assertions: [{ kind: 'matches-schema', schema: P8_SCHEMA }],
});
const p8fail = testing.register({
  id: 't-p8-schema-fail',
  description: 'section report payload must be rejected when wrong',
  prompt: JSON.stringify({ section: 'doing-tasks', chars: '512', extra: true }),
  assertions: [{ kind: 'matches-schema', schema: P8_SCHEMA }],
});
const r8pass = testing.run(p8pass.testId);
const r8fail = testing.run(p8fail.testId);
console.log('P8 run(valid payload) raw:');
console.log(JSON.stringify(r8pass, null, 2));
console.log('P8 run(invalid payload) raw:');
console.log(JSON.stringify(r8fail, null, 2));
const f8 = r8fail.failures[0] ?? {};
const errPaths = (f8.actual?.errors ?? []).map((e) => e.path).join(',');
check(
  'P8 matches-schema: valid payload passes; invalid payload (chars:"512", extra prop) fails with both violations named',
  r8pass.passed === true &&
    r8fail.passed === false &&
    (f8.actual?.errors ?? []).length === 2 &&
    errPaths === '$.chars,$.extra',
  `pass=${r8pass.passed} fail=${r8fail.passed} violation paths=[${errPaths}] message="${f8.message ?? ''}"`
);
console.log('');

// ---------------------------------------------------------------------------
// P9 — Determinism: same snapshot + same test runs twice -> identical output
//      (durationMs is wall-clock and masked, like timestamps elsewhere)
// ---------------------------------------------------------------------------
const s1 = versioning.snapshot(FIXTURE_V1); // content-addressed: dedups to P1's record
const s2 = versioning.snapshot(FIXTURE_V1);
const snapIdentical = JSON.stringify(s1) === JSON.stringify(s2);
testing.register({
  id: 't-p9-determinism',
  description: 'identity line is present (determinism witness)',
  prompt: v1Record.text,
  assertions: [{ kind: 'contains', value: 'You are JEXI' }],
});
const r9a = testing.run('t-p9-determinism');
const r9b = testing.run('t-p9-determinism');
const maskMs = (s) => s.replace(/"durationMs":\d+/g, '"durationMs":"<MS>"');
const runIdentical = maskMs(JSON.stringify(r9a)) === maskMs(JSON.stringify(r9b));
console.log('P9 snapshot run #1 raw:', JSON.stringify(s1));
console.log('P9 snapshot run #2 raw:', JSON.stringify(s2));
console.log('P9 test run #1 raw (durationMs shown):', JSON.stringify(r9a));
console.log('P9 test run #2 raw (durationMs shown):', JSON.stringify(r9b));
console.log(`P9 comparison (durationMs masked): snapshotIdentical=${snapIdentical} runIdentical=${runIdentical}`);
check(
  'P9 same snapshot twice -> byte-identical record; same test twice -> identical verdicts/failures (durationMs masked)',
  snapIdentical && runIdentical && r9a.passed === true && r9b.passed === true,
  `JSON.stringify(s1)===JSON.stringify(s2): ${snapIdentical}; masked run JSONs equal: ${runIdentical}`
);
console.log('');

// ---------------------------------------------------------------------------
// P10 — SIGKILL persistence: snapshot, kill -9 the writer, fresh process
//       resolves the versionId with sha256 intact
// ---------------------------------------------------------------------------
const p10Store = freshStore('p10');
console.log(`P10 store: ${p10Store}`);
const childA = spawnSync(process.execPath, [SCRIPT, '--p10-child'], {
  cwd: WT,
  env: { ...process.env },
  encoding: 'utf8',
});
console.log(`P10 child (writer) exit: status=${childA.status} signal=${childA.signal}`);
const resultFile = path.join(p10Store, 'p10-child-result.json');
const childWrote = fs.existsSync(resultFile) && fs.existsSync(path.join(p10Store, 'p10-ready.json'));
let p10snap = null;
try {
  p10snap = JSON.parse(fs.readFileSync(resultFile, 'utf8'));
} catch {
  p10snap = null;
}
console.log('P10 child result file raw:', JSON.stringify(p10snap));
const childB = spawnSync(process.execPath, [SCRIPT, '--p10-verify', p10snap?.versionId ?? 'missing'], {
  cwd: WT,
  env: { ...process.env },
  encoding: 'utf8',
});
console.log('P10 fresh-process verify stdout raw:');
console.log(childB.stdout.trim());
let verify = null;
try {
  verify = JSON.parse(childB.stdout);
} catch {
  verify = null;
}
check(
  'P10 writer child died by SIGKILL; fresh process resolves versionId with sha256 intact and section hashes verified',
  childA.signal === 'SIGKILL' &&
    childWrote &&
    verify?.resolved === true &&
    verify?.sha256 === p10snap?.sha256 &&
    verify?.textReSha256 === p10snap?.sha256 &&
    verify?.sectionHashesMatch === true,
  `signal=${childA.signal} versionId=${p10snap?.versionId} sha256=${p10snap?.sha256?.slice(0, 12)}... fresh-process sha match=${verify?.sha256 === p10snap?.sha256} text rehash match=${verify?.textReSha256 === p10snap?.sha256} sections=${verify?.sectionCount}`
);
console.log('');

// ---------------------------------------------------------------------------
// P11 — Zone check: git status --short shows ONLY this scope's paths
// ---------------------------------------------------------------------------
const st = spawnSync('git', ['status', '--short'], { cwd: WT, encoding: 'utf8' });
const lines = st.stdout.split('\n').filter((l) => l.trim() !== '');
console.log('P11 git status --short raw:');
console.log(st.stdout.trim());
const ALLOWED = ['prompt/testing/', 'prompt/versioning/', 'scripts/phase25-scope-k.mjs'];
const zoneOk =
  // consolidation cleanup: dropped `lines.length > 0` precondition — a clean committed
  // tree passes vacuously (every() on an empty list); the substantive assert is "no out-of-zone path".
  lines.every((l) => {
    const p = l.slice(3).trim().replace(/\/$/, '/');
    return l.startsWith('?? ') && ALLOWED.some((a) => p === a || p.startsWith(a));
  });
check(
  'P11 zone discipline: only prompt/versioning/** + prompt/testing/** + scripts/phase25-scope-k.mjs',
  zoneOk,
  `${lines.length} untracked path(s), all inside the Scope K zone: ${lines.map((l) => l.slice(3)).join(' | ')} (.jexi/ probe stores are gitignored)`
);
console.log('');

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log('---------------------------------------------');
console.log(`SCOPE K: ${11 - failures}/11 PASS, ${failures} FAIL`);
if (failures > 0) process.exit(1);
