#!/usr/bin/env node
// scripts/phase25-scope-l.mjs
// Phase 25 — Scope L live probe: anti-pattern lint.
// Zero dependencies. Real detection over real prompt fixtures — every rule
// must actually fire on its intended pattern AND stay silent on a clean,
// balanced, imperative-voiced prompt (no false positives). Pure string
// work: no LLM, no disk state. Raw output per check. Exit 1 on any failure.

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

import { lint, DEFAULT_SEVERITIES, SEVERITIES } from '../prompt/anti-patterns/index.js';

const WT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let failures = 0;
function check(name, ok, evidence) {
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}`);
  console.log(`        ${evidence}`);
  if (!ok) failures += 1;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
// Clean prompt: balanced sections, imperative voice, explicit termination,
// unique rules, no contradictions, no hardcoded values. Must lint to
// ok:true with ZERO findings (RULE 4).
const CLEAN = [
  {
    id: 'identity',
    content:
      'You are JEXI, a personal operating system for knowledge work.\nYou follow the constitution and never improvise beyond it.',
  },
  {
    id: 'system-rules',
    content:
      'Refuse untagged writes with an explicit error.\nTag user-provided content as [stated].\nEscalate ambiguity instead of guessing.',
  },
  {
    id: 'doing-tasks',
    content:
      'Work section by section.\nMake the smallest change that satisfies the request.\nNever leave a task half-done.\nReport when all tasks are complete.',
  },
  {
    id: 'actions',
    content: 'Before any write: excise, tag, assert, then commit to disk.',
  },
  {
    id: 'output-style',
    content: "Answer in the user's language.\nKeep replies tight and factual.",
  },
];

// One deliberately bad fixture per rule. Each fixture fires ONLY its target
// rule (cross-fire would make the P2 evidence muddy).
const BAD = {
  'AP-GOD-PROMPT': [{ id: 'spec', content: 'x'.repeat(600) }, { id: 'misc', content: 'tiny' }],
  'AP-VAGUE': 'Handle edge cases when needed.',
  'AP-BRANCHING-PROSE':
    'If the section is missing then create it else refuse.\nDepending on the season, pick a greeting.',
  'AP-HARDCODED':
    'Use gpt-4o for every request.\nConfig lives at /etc/jexi/config.yaml.\nRetry 4096 times before giving up.',
  'AP-FLATTERY': 'Great question! Let me lay out the migration plan.',
  'AP-SOFT-CONSTRAINT':
    'You should try to validate input.\nConsider memory limits.\nWhen possible, stream output.',
  'AP-NO-TERMINATION': [
    { id: 'doing-tasks', content: 'Work on the queue one item at a time.\nKeep notes short.' },
  ],
  'AP-DUPLICATE': [
    { id: 'system-rules', content: 'Always verify the tag before any write.\nRefuse untagged content.' },
    { id: 'actions', content: 'Always verify the tag before any write.\nThen commit to disk.' },
    { id: 'output-style', content: 'Keep replies tight and factual.' },
  ],
  'AP-CONFLICT': [
    { id: 'system-rules', content: 'Always write the audit line.' },
    { id: 'actions', content: 'Never write the audit line.' },
    { id: 'misc', content: 'Keep the ledger honest.' },
  ],
};
const RULE_ORDER = [
  'AP-GOD-PROMPT',
  'AP-VAGUE',
  'AP-BRANCHING-PROSE',
  'AP-HARDCODED',
  'AP-FLATTERY',
  'AP-SOFT-CONSTRAINT',
  'AP-NO-TERMINATION',
  'AP-DUPLICATE',
  'AP-CONFLICT',
];

// Kitchen-sink bad prompt for the determinism check: flattery + vague +
// branching + no-termination + hardcoded + duplicate + conflict.
const KITCHEN = [
  { id: 'identity', content: 'Great question! You are JEXI.' },
  {
    id: 'system-rules',
    content: 'Handle edge cases when needed.\nIf the tag is missing then refuse the write.',
  },
  { id: 'doing-tasks', content: 'Work the queue one item at a time.' },
  { id: 'actions', content: 'Use gpt-4o at /etc/jexi/config.yaml.\nAlways verify the tag before any write.' },
  { id: 'actions2', content: 'Always verify the tag before any write.\nNever verify the tag before any write.' },
];

console.log('=== SCOPE L PROBE — anti-pattern lint ===');
console.log(`node ${process.version}`);
console.log('');

// ---------------------------------------------------------------------------
// P1 — Clean prompt -> ok:true, 0 findings
// ---------------------------------------------------------------------------
const r1 = lint.run(CLEAN);
console.log('P1 lint.run(CLEAN) raw:');
console.log(JSON.stringify(r1, null, 2));
check(
  'P1 clean balanced prompt lints to ok:true with ZERO findings (no false positives)',
  r1.ok === true && r1.findings.length === 0,
  `ok=${r1.ok} findings=${r1.findings.length} sections=${CLEAN.length}`
);
console.log('');

// ---------------------------------------------------------------------------
// P2 — Every rule fires at least once (dedicated fixture per rule)
// ---------------------------------------------------------------------------
const catalog = lint.rules();
const p2All = [];
let p2ok = catalog.length === 9 && catalog.every((r) => SEVERITIES.includes(r.severity));
for (const ruleId of RULE_ORDER) {
  const r = lint.run(BAD[ruleId]);
  const mine = r.findings.filter((f) => f.ruleId === ruleId);
  const fired = mine.length >= 1 && r.findings.every((f) => f.ruleId === ruleId);
  const sevOk = mine.every((f) => f.severity === DEFAULT_SEVERITIES[ruleId]);
  const evOk = mine.every((f) => typeof f.evidence === 'string' && f.evidence.length > 0);
  console.log(`P2 ${ruleId} (fixture fires ${r.findings.length} finding(s), all ${ruleId}):`);
  console.log(JSON.stringify(mine[0], null, 2));
  p2All.push(`${ruleId}:${mine.length}`);
  if (!(fired && sevOk && evOk)) p2ok = false;
}
check(
  'P2 all 9 rules fire on their dedicated fixture with default severity and non-empty evidence (no cross-fire)',
  p2ok,
  `catalog=${catalog.length} rules; findings per rule: ${p2All.join(' ')}`
);
console.log('');

// ---------------------------------------------------------------------------
// P3 — Error blocks, warn doesn't
// ---------------------------------------------------------------------------
const p3bad = lint.run('Great question! Handle edge cases when needed.');
const p3warnOnly = lint.run('Handle edge cases when needed.');
console.log('P3 lint.run(flattery + vague) raw:');
console.log(JSON.stringify(p3bad, null, 2));
console.log('P3 lint.run(vague only) raw:');
console.log(JSON.stringify(p3warnOnly, null, 2));
check(
  'P3 flattery (error) + vague (warn) -> ok:false; vague alone (warn only) -> ok:true',
  p3bad.ok === false &&
    p3bad.findings.some((f) => f.ruleId === 'AP-FLATTERY' && f.severity === 'error') &&
    p3bad.findings.some((f) => f.ruleId === 'AP-VAGUE' && f.severity === 'warn') &&
    p3warnOnly.ok === true &&
    p3warnOnly.findings.length === 1 &&
    p3warnOnly.findings[0].severity === 'warn',
  `with error: ok=${p3bad.ok}; warn-only: ok=${p3warnOnly.ok} findings=${p3warnOnly.findings.length}`
);
console.log('');

// ---------------------------------------------------------------------------
// P4 — Determinism: same bad prompt twice -> identical findings
// ---------------------------------------------------------------------------
const k1 = lint.run(KITCHEN);
const k2 = lint.run(KITCHEN);
const a = JSON.stringify(k1);
const b = JSON.stringify(k2);
console.log('P4 lint.run(KITCHEN) findings raw (run #1):');
console.log(JSON.stringify(k1.findings, null, 2));
console.log('P4 byte comparison:');
console.log(`run#1 length=${a.length}  run#2 length=${b.length}  identical=${a === b}`);
check(
  'P4 same bad prompt twice -> byte-identical findings list (findings carry no timestamps; ts masking is a no-op)',
  a === b && k1.findings.length >= 7 && k1.ok === false,
  `findings=${k1.findings.length} ok=${k1.ok} JSON.stringify equality: ${a === b}`
);
console.log('');

// ---------------------------------------------------------------------------
// P5 — Duplicate detection (both section ids named)
// ---------------------------------------------------------------------------
const r5 = lint.run(BAD['AP-DUPLICATE']);
const dup = r5.findings.find((f) => f.ruleId === 'AP-DUPLICATE');
console.log('P5 duplicate finding raw:');
console.log(JSON.stringify(dup, null, 2));
check(
  'P5 AP-DUPLICATE fires with BOTH section ids and the duplicated line as evidence',
  !!dup &&
    JSON.stringify(dup.location.sections) === JSON.stringify(['system-rules', 'actions']) &&
    dup.evidence === 'Always verify the tag before any write.' &&
    dup.severity === 'warn',
  `location.sections=${JSON.stringify(dup?.location.sections)} evidence="${dup?.evidence}"`
);
console.log('');

// ---------------------------------------------------------------------------
// P6 — Conflict detection (always X vs never X)
// ---------------------------------------------------------------------------
const r6 = lint.run(BAD['AP-CONFLICT']);
const conflict = r6.findings.find((f) => f.ruleId === 'AP-CONFLICT');
console.log('P6 conflict finding raw:');
console.log(JSON.stringify(conflict, null, 2));
check(
  'P6 AP-CONFLICT fires (error) on "Always write the audit line." vs "Never write the audit line."',
  !!conflict &&
    conflict.severity === 'error' &&
    conflict.evidence.includes('always write the audit line') &&
    conflict.evidence.includes('never write the audit line') &&
    JSON.stringify(conflict.location.sections) === JSON.stringify(['system-rules', 'actions']),
  `severity=${conflict?.severity} evidence="${conflict?.evidence}" sections=${JSON.stringify(conflict?.location.sections)}`
);
console.log('');

// ---------------------------------------------------------------------------
// P7 — God-prompt detection (actual percentage shown)
// ---------------------------------------------------------------------------
const r7 = lint.run(BAD['AP-GOD-PROMPT']);
const god = r7.findings.find((f) => f.ruleId === 'AP-GOD-PROMPT');
console.log('P7 god-prompt finding raw:');
console.log(JSON.stringify(god, null, 2));
const pctMatch = /consumes (\d+(?:\.\d+)?)%/.exec(god?.message ?? '');
const pct = pctMatch ? parseFloat(pctMatch[1]) : -1;
check(
  'P7 AP-GOD-PROMPT fires (error) naming the section with the actual percentage > 50%',
  !!god &&
    god.severity === 'error' &&
    god.location.section === 'spec' &&
    pct > 50 &&
    god.evidence.startsWith('xxx'),
  `message="${god?.message}" parsed pct=${pct}`
);
console.log('');

// ---------------------------------------------------------------------------
// P8 — Hardcoded detection (model name, file path, magic number)
// ---------------------------------------------------------------------------
const r8 = lint.run(BAD['AP-HARDCODED']);
const hard = r8.findings.filter((f) => f.ruleId === 'AP-HARDCODED');
console.log('P8 hardcoded findings raw:');
console.log(JSON.stringify(hard, null, 2));
const evs = hard.map((f) => f.evidence);
check(
  'P8 AP-HARDCODED fires with the offending strings: model name, file path, magic number',
  evs.includes('gpt-4o') &&
    evs.includes('/etc/jexi/config.yaml') &&
    evs.includes('4096') &&
    hard.every((f) => f.severity === 'warn'),
  `evidences=${JSON.stringify(evs)}`
);
console.log('');

// ---------------------------------------------------------------------------
// P9 — Catalog exists: 9 rule sections, each with violation + clean example
// ---------------------------------------------------------------------------
const catPath = path.join(WT, 'prompt', 'anti-patterns', 'catalog.md');
const catText = fs.existsSync(catPath) ? fs.readFileSync(catPath, 'utf8') : '';
const blocks = catText.split(/^## /m).slice(1); // first chunk is the header
const catDetail = RULE_ORDER.map((id) => {
  const block = blocks.find((b) => b.startsWith(`${id}\n`) || b.startsWith(`${id} `) || b.startsWith(id));
  if (!block) return `${id}:MISSING`;
  const hasViolation = /violation example/i.test(block);
  const hasClean = /clean alternative/i.test(block);
  return `${id}:${hasViolation && hasClean ? 'ok' : 'incomplete'}`;
});
const apSections = catText.match(/^## AP-/gm)?.length ?? 0;
console.log(`P9 catalog.md: exists=${fs.existsSync(catPath)} chars=${catText.length} "## AP-" sections=${apSections}`);
console.log(`P9 per-rule sections (violation example + clean alternative): ${catDetail.join(' ')}`);
check(
  'P9 catalog.md exists with 9 rule sections, each documented with a violation example and a clean alternative',
  fs.existsSync(catPath) && apSections === 9 && catDetail.every((d) => d.endsWith(':ok')),
  `${apSections} sections; detail: ${catDetail.join(' ')}`
);
console.log('');

// ---------------------------------------------------------------------------
// P10 — Zone check: git status --short shows ONLY this scope's paths
// ---------------------------------------------------------------------------
const st = spawnSync('git', ['status', '--short'], { cwd: WT, encoding: 'utf8' });
const lines = st.stdout.split('\n').filter((l) => l.trim() !== '');
console.log('P10 git status --short raw:');
console.log(st.stdout.trim());
const ALLOWED = ['prompt/anti-patterns/', 'scripts/phase25-scope-l.mjs'];
const zoneOk =
  lines.length > 0 &&
  lines.every((l) => {
    const p = l.slice(3).trim().replace(/\/$/, '/');
    return l.startsWith('?? ') && ALLOWED.some((a) => p === a || p.startsWith(a));
  });
check(
  'P10 zone discipline: only prompt/anti-patterns/** + scripts/phase25-scope-l.mjs',
  zoneOk,
  `${lines.length} untracked path(s), all inside the Scope L zone: ${lines.map((l) => l.slice(3)).join(' | ')}`
);
console.log('');

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log('---------------------------------------------');
console.log(`SCOPE L: ${10 - failures}/10 PASS, ${failures} FAIL`);
if (failures > 0) process.exit(1);
