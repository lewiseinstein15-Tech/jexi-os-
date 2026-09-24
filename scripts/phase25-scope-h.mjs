#!/usr/bin/env node
// scripts/phase25-scope-h.mjs
// Phase 25 — Scope H live probe: incident-driven negative few-shots.
// Zero dependencies. Real append-only NDJSON under gitignored .jexi/ probe
// roots (one isolated store per section). Real SIGKILL in P8. Prints raw
// evidence per check. Exit 1 on any failure.

import { spawnSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

import {
  incidents,
  INCIDENT_CODES,
  RULE_METHOD,
  log as incidentLog,
} from '../capabilities/prompts/incidents/index.js';
import { CANONICAL_SECTIONS } from '../capabilities/prompts/assembly/order.js';
import { createSectionRegistry } from '../capabilities/prompts/assembly/registry.js';

const WT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INDEX_URL = pathToFileURL(path.join(WT, 'capabilities/prompts/incidents/index.js')).href;

let failures = 0;
function check(name, ok, evidence) {
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}`);
  console.log(`        ${evidence}`);
  if (!ok) failures += 1;
}

function sha256(s) {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}

const STORE_BASE = path.join(WT, '.jexi', 'probe-incidents', 'scope-h');
function storePath(name) {
  return path.join(STORE_BASE, name);
}
/** Fresh isolated store root for a section; also points process.env at it. */
function freshStore(name) {
  const p = storePath(name);
  fs.rmSync(p, { recursive: true, force: true });
  process.env.JEXI_INCIDENTS_ROOT = p;
  return p;
}
/** Point process.env at an EXISTING probe store (no wipe). */
function useStore(name) {
  const p = storePath(name);
  process.env.JEXI_INCIDENTS_ROOT = p;
  return p;
}

/** Raw log text of a store with timestamps masked (RULE 7 comparisons). */
function maskedLog(root) {
  const p = path.join(root, 'log.ndjson');
  const raw = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
  return raw.replace(/"(recordedAt|promotedAt|at)":"[^"]*"/g, '"$1":"<TS>"');
}

console.log('=== SCOPE H PROBE — incident-driven negative few-shots ===');
console.log(`node ${process.version}`);
console.log('');

// ---------------------------------------------------------------------------
// P1 — Record 3 incidents (different triggers/contexts/failures/fixes)
// ---------------------------------------------------------------------------
freshStore('main');
const P1_INCIDENTS = [
  {
    trigger: 'probe crashed when the store root did not exist',
    context: 'scope H P8 persistence rehearsal on a fresh .jexi root',
    failure: 'child process threw ENOENT on the first append instead of creating the store root',
    fix: 'call mkdirSync recursive before the first append',
  },
  {
    trigger: 'duplicate promotion events appended on every re-run',
    context: 'scope H promote() called twice for the same incident',
    failure: 'the section accumulated one identical rule per promote call',
    fix: 'return the existing active rule instead of appending a new event',
  },
  {
    trigger: 'injection exceeded the section character budget',
    context: 'scope H soak test with 10 promoted rules in one section',
    failure: 'rule text pushed the doing-tasks section past its 10000 char budget',
    fix: 'limit rules per section and drop the oldest on overflow',
  },
];
const p1Returns = P1_INCIDENTS.map((inc) => incidents.record(inc));
const p1List = incidents.list();
console.log('record() returns:');
for (const r of p1Returns) console.log(`  ${JSON.stringify(r)}`);
console.log(`incidents.list() -> ${p1List.length} entries:`);
for (const e of p1List) console.log(`  ${JSON.stringify(e)}`);
const isoRe = /^\d{4}-\d{2}-\d{2}T/;
const p1Ok =
  p1Returns.length === 3 &&
  p1Returns.every((r, i) => r.id === `INC-${String(i + 1).padStart(4, '0')}` && isoRe.test(r.recordedAt)) &&
  p1List.length === 3 &&
  p1List.every((e, i) =>
    e.type === 'incident' &&
    e.id === `INC-${String(i + 1).padStart(4, '0')}` &&
    e.seq === i + 1 && // seq = 1-based line order, assigned at append time
    e.trigger === P1_INCIDENTS[i].trigger &&
    e.context === P1_INCIDENTS[i].context &&
    e.failure === P1_INCIDENTS[i].failure &&
    e.fix === P1_INCIDENTS[i].fix &&
    typeof e.recordedAt === 'string' && isoRe.test(e.recordedAt),
  ) &&
  incidentLog.readEvents().parseErrors.length === 0;
check('P1 record 3 incidents -> INC-0001..0003 on disk, all four fields round-trip, recordedAt present', p1Ok,
  `ids=${JSON.stringify(p1List.map((e) => e.id))}; parseErrors=0; storage=${incidentLog.logPath()}`);

// ---------------------------------------------------------------------------
// P2 — Promote one -> valid rule with all four fields plus incidentId
// ---------------------------------------------------------------------------
const p2 = incidents.promote('INC-0001');
const p2RawLog = incidentLog.readEvents().raw;
const p2PromotionLine = p2RawLog.split('\n').find((l) => l.includes('"type":"promotion"'));
const p2PromotionEvent = p2PromotionLine ? JSON.parse(p2PromotionLine) : null;
console.log(`promote('INC-0001') -> ${JSON.stringify(p2)}`);
console.log(`promotion event on disk: ${p2PromotionLine}`);
const p2Ok =
  p2.active === true &&
  p2.ruleId === 'RULE-0001' &&
  typeof p2.rule.when === 'string' && p2.rule.when.length > 0 &&
  typeof p2.rule.do === 'string' && p2.rule.do.length > 0 &&
  typeof p2.rule.because === 'string' && p2.rule.because.length > 0 &&
  p2.rule.incidentId === 'INC-0001' &&
  p2PromotionEvent !== null &&
  p2PromotionEvent.method === RULE_METHOD &&
  p2PromotionEvent.rule.incidentId === 'INC-0001' &&
  Array.isArray(p2PromotionEvent.supersedes) && p2PromotionEvent.supersedes.length === 0;
check('P2 promote valid incident -> rule {when,do,because,incidentId} + RULE-0001; event labeled "rule-based - LLM promotion NOT VERIFIED"', p2Ok,
  `rule=${JSON.stringify(p2.rule)}; method=${p2PromotionEvent ? p2PromotionEvent.method : '<none>'}`);

// ---------------------------------------------------------------------------
// P3 — Promote one with vague trigger -> refused, rule NOT produced,
//      specific reason. (Recording is raw capture; promotion is the gate.)
// ---------------------------------------------------------------------------
const p3v = incidents.record({
  trigger: 'something went wrong',
  context: 'scope H P3 vague-trigger rehearsal',
  failure: 'unknown',
  fix: 'check the logs',
});
const rulesBefore3 = incidents.rules().length;
const p3ref = incidents.promote(p3v.id);
console.log(`record(vague) -> ${JSON.stringify(p3v)} (capture succeeds — gating happens at promote)`);
console.log(`promote('${p3v.id}') -> ${JSON.stringify(p3ref)}`);
const p3b = incidents.record({
  trigger: 'timer fired twice within one tick',
  context: 'scope H P3 vague-fix rehearsal',
  failure: 'a rule was derived from a fix that names no action',
  fix: 'idk whatever',
});
const p3refB = incidents.promote(p3b.id);
console.log(`promote('${p3b.id}') [vague fix] -> ${JSON.stringify(p3refB)}`);
const rulesAfter3 = incidents.rules().length;
const p3Ok =
  p3ref.rule === null && p3ref.active === false &&
  p3ref.errorCode === INCIDENT_CODES.VAGUE_TRIGGER &&
  p3ref.reason.includes('something went wrong') &&
  p3ref.reason.includes('concrete failure mode') &&
  p3refB.rule === null && p3refB.active === false &&
  p3refB.errorCode === INCIDENT_CODES.VAGUE_FIX &&
  p3refB.reason.includes('does not name a specific action') &&
  rulesBefore3 === 1 && rulesAfter3 === 1; // refusals appended NO rule event
check('P3 vague trigger -> refused E_VAGUE_TRIGGER with specific reason; vague fix -> E_VAGUE_FIX; zero rules produced', p3Ok,
  `errorCode=${p3ref.errorCode}/${p3refB.errorCode}; rules in store before=${rulesBefore3} after=${rulesAfter3} (refusals write no event)`);

// ---------------------------------------------------------------------------
// INTEGRATION DISPLAY (NOT WIRED) — how negative-shots.js would attach the
// rules to Scope A's doing-tasks section (order 4, static). prompt/assembly
// is NOT modified by this scope; the registry call below is read-only usage.
// ---------------------------------------------------------------------------
const dtSpec = CANONICAL_SECTIONS.find((s) => s.id === 'doing-tasks');
console.log('');
console.log('--- INTEGRATION DISPLAY (display only — nothing wired) ---');
console.log(`target section: id=${dtSpec.id} label="${dtSpec.label}" order=${dtSpec.order} kind=${dtSpec.kind} budget.maxChars=${dtSpec.budget.maxChars}`);
console.log('assembly-time wiring sketch (Scope M territory, NOT executed against prompt/assembly):');
console.log("  import { registerCanonical } from 'prompt/assembly/order.js';");
console.log("  import { createSectionRegistry } from 'prompt/assembly/registry.js';");
console.log("  import { incidents } from 'capabilities/prompts/incidents/index.js';");
console.log('  const registry = registerCanonical(createSectionRegistry());   // Scope A sections');
console.log('  const specs = registry.list().map((s) => ({ ...s }));          // unfrozen working copies');
console.log("  const withShots = incidents.inject(specs, { section: 'doing-tasks' });  // bounded(5) + idempotent");
console.log('  const nextRegistry = createSectionRegistry();                  // registry is append-only:');
console.log('  for (const s of withShots) nextRegistry.register(s);           // rebuild, never mutate');
console.log('  // nextRegistry.get("doing-tasks").build(ctx) now ends with the rule block.');

// ---------------------------------------------------------------------------
// P4 — Injection grows the section (Scope A canonical specs, real rule)
// ---------------------------------------------------------------------------
const BASE_DOING = '## Doing Tasks\n\n1. Read the task. 2. Plan before you edit. 3. Verify after you edit.';
const p4Sections = CANONICAL_SECTIONS.map((s) => ({ ...s }));
const p4Target0 = p4Sections.find((s) => s.id === 'doing-tasks');
const beforeText = p4Target0.build({ 'doing-tasks': BASE_DOING });
const beforeBytes = beforeText.length;
const p4Injected = incidents.inject(p4Sections, { section: 'doing-tasks' });
const p4Target1 = p4Injected.find((s) => s.id === 'doing-tasks');
const afterText = p4Target1.build({ 'doing-tasks': BASE_DOING });
const afterBytes = afterText.length;
const p4Plan = incidents.injectionPlan({ section: 'doing-tasks' });
console.log(`inject(sections, { section: 'doing-tasks' }) -> target wrapped; plan.kept=${JSON.stringify(p4Plan.kept)}`);
console.log(`before (${beforeBytes} bytes): ${JSON.stringify(beforeText)}`);
console.log(`after  (${afterBytes} bytes): ${JSON.stringify(afterText)}`);
// content-shaped section support (same block, same bytes):
const p4Content = incidents.inject([{ id: 'doing-tasks', content: BASE_DOING }], { section: 'doing-tasks' });
// registry compatibility demo (display-grade proof the spec still registers):
const demoReg = createSectionRegistry();
let regErr = null;
try {
  for (const s of p4Injected) demoReg.register(s);
} catch (e) {
  regErr = e;
}
const demoText = regErr === null ? demoReg.get('doing-tasks').build({ 'doing-tasks': BASE_DOING }) : null;
const p4Ok =
  Array.isArray(p4Injected) && p4Injected.length === 10 && p4Injected !== p4Sections &&
  afterText === beforeText + '\n\n' + p4Plan.block &&
  afterBytes > beforeBytes &&
  afterText.includes(`method="${RULE_METHOD}"`) &&
  afterText.includes('incident:INC-0001 rule:RULE-0001') &&
  p4Target0.build({ 'doing-tasks': BASE_DOING }) === beforeText && // input NOT mutated
  CANONICAL_SECTIONS[3].build({ 'doing-tasks': BASE_DOING }) === BASE_DOING && // frozen originals intact
  p4Content[0].content === afterText && // content-shaped sections get the same bytes
  regErr === null && demoText === afterText;
check('P4 injection grows doing-tasks: build output = original + marker-delimited rule block (byte counts below); inputs untouched; spec still registry-valid', p4Ok,
  `bytes ${beforeBytes} -> ${afterBytes} (+${afterBytes - beforeBytes}); registry error=${regErr ? regErr.message : 'none'}; injected-spec registry build matches=${demoText === afterText}`);

// ---------------------------------------------------------------------------
// P5 — Injection bounded: 10 rules, maxRulesPerSection=3 -> 3 remain,
//      oldest dropped FIRST in ascending ruleId order (deterministic).
// ---------------------------------------------------------------------------
freshStore('p5');
const p5RuleIds = [];
for (let i = 1; i <= 10; i++) {
  const r = incidents.record({
    trigger: `probe ${i} wrote past the staging boundary`,
    context: `bounded-injection soak run ${i}`,
    failure: `rule ${i} leaked into an unrelated section`,
    fix: `clamp rule ${i} to its declared section`,
  });
  const p = incidents.promote(r.id);
  p5RuleIds.push(p.ruleId);
}
const p5Plan = incidents.injectionPlan({ section: 'doing-tasks', maxRulesPerSection: 3 });
console.log(`promoted 10 rules: ${JSON.stringify(p5RuleIds)}`);
console.log(`plan(max=3) kept=${JSON.stringify(p5Plan.kept)}`);
console.log(`plan(max=3) dropped=${JSON.stringify(p5Plan.dropped)} (drop order = oldest promoted first)`);
const p5Injected = incidents.inject(CANONICAL_SECTIONS.map((s) => ({ ...s })), { section: 'doing-tasks', maxRulesPerSection: 3 });
const p5Out = p5Injected.find((s) => s.id === 'doing-tasks').build({ 'doing-tasks': BASE_DOING });
const p5Bullets = p5Out.split('\n').filter((l) => l.startsWith('- WHEN '));
console.log(`section output bullets (${p5Bullets.length}):`);
for (const b of p5Bullets) console.log(`  ${b}`);
const droppedAbsent = p5Plan.dropped.every((id) => !p5Out.includes(`rule:${id}`));
const p5Ok =
  p5RuleIds.length === 10 &&
  p5Plan.kept.length === 3 &&
  JSON.stringify(p5Plan.kept.map((k) => k.ruleId)) === JSON.stringify(['RULE-0008', 'RULE-0009', 'RULE-0010']) &&
  JSON.stringify(p5Plan.dropped) === JSON.stringify(['RULE-0001', 'RULE-0002', 'RULE-0003', 'RULE-0004', 'RULE-0005', 'RULE-0006', 'RULE-0007']) &&
  p5Bullets.length === 3 &&
  p5Bullets.every((b) => /rule:RULE-000[89]|rule:RULE-0010/.test(b)) &&
  droppedAbsent;
check('P5 bounded injection: 10 rules + max=3 -> only RULE-0008..0010 remain; RULE-0001..0007 dropped oldest-first (deterministic drop order)', p5Ok,
  `kept=3/10; dropped=${p5Plan.dropped.length} in ascending ruleId order; dropped ids absent from section=${droppedAbsent}`);

// ---------------------------------------------------------------------------
// P6 — Idempotent injection: same rules twice -> byte-identical section.
//      (Second inject runs on the ALREADY-INJECTED array — the real test.)
// ---------------------------------------------------------------------------
useStore('main'); // same store as P4 — one rule, no new promotions since
const p6once = incidents.inject(p4Sections, { section: 'doing-tasks' });
const p6twice = incidents.inject(p6once, { section: 'doing-tasks' });
const p6thrice = incidents.inject(p6twice, { section: 'doing-tasks' });
const b1 = p6once.find((s) => s.id === 'doing-tasks').build({ 'doing-tasks': BASE_DOING });
const b2 = p6twice.find((s) => s.id === 'doing-tasks').build({ 'doing-tasks': BASE_DOING });
const b3 = p6thrice.find((s) => s.id === 'doing-tasks').build({ 'doing-tasks': BASE_DOING });
console.log(`inject #1 -> ${b1.length} bytes (sha256 ${sha256(b1).slice(0, 16)}...)`);
console.log(`inject #2 -> ${b2.length} bytes (sha256 ${sha256(b2).slice(0, 16)}...)`);
console.log(`inject #3 -> ${b3.length} bytes (sha256 ${sha256(b3).slice(0, 16)}...)`);
const p6Ok = b1 === b2 && b2 === b3 && b1 === afterText &&
  sha256(b1) === sha256(b2) && sha256(b2) === sha256(b3);
check('P6 idempotent injection: injecting the same rules 2x and 3x (on already-injected arrays) yields byte-identical section output', p6Ok,
  `byte-identical=${b1 === b2 && b2 === b3}; bytes=${b1.length}; sha256=${sha256(b1)}`);

// ---------------------------------------------------------------------------
// P7 — Supersession: same incident recurs with a different fix -> new rule,
//      old rule marked superseded, BOTH remain in the log, injection uses
//      the NEW rule only.
// ---------------------------------------------------------------------------
freshStore('p7');
const X = {
  trigger: 'rebase drops staged changes',
  context: 'nightly branch sync on phase-25-glm',
  failure: 'git rebase ran with a dirty index and the staging area was lost',
};
const x1 = incidents.record({ ...X, fix: 'run git stash push before any rebase' });
const ruleA = incidents.promote(x1.id);
const x2 = incidents.record({ ...X, fix: 'abort the rebase and re-run with --autostash instead' });
const ruleB = incidents.promote(x2.id);
const p7Rules = incidents.rules();
const aEntry = p7Rules.find((r) => r.ruleId === ruleA.ruleId);
const bEntry = p7Rules.find((r) => r.ruleId === ruleB.ruleId);
const p7Raw = incidentLog.readEvents().raw;
console.log(`record X (fix 1) -> ${x1.id}; promote -> ${ruleA.ruleId}`);
console.log(`record X again (fix 2) -> ${JSON.stringify(incidents.get(x2.id))}`);
console.log(`promote -> ${JSON.stringify(ruleB)}`);
console.log(`rules(): A=${JSON.stringify(aEntry)} `);
console.log(`rules(): B=${JSON.stringify(bEntry)} `);
const p7Sections = incidents.inject(CANONICAL_SECTIONS.map((s) => ({ ...s })), { section: 'doing-tasks' });
const p7Out = p7Sections.find((s) => s.id === 'doing-tasks').build({ 'doing-tasks': BASE_DOING });
console.log(`injected section uses: ${p7Out.split('\n').filter((l) => l.startsWith('- WHEN ')).join(' || ')}`);
const p7Ok =
  ruleA.ruleId === 'RULE-0001' && ruleB.ruleId === 'RULE-0002' &&
  JSON.stringify(ruleB.superseded) === JSON.stringify(['RULE-0001']) &&
  incidents.get(x2.id).recurrenceOf === x1.id &&
  aEntry.active === false && aEntry.supersededBy === 'RULE-0002' &&
  bEntry.active === true && bEntry.supersededBy === null &&
  p7Raw.includes('"id":"RULE-0001"') && p7Raw.includes('"id":"RULE-0002"') &&
  p7Out.includes('rule:RULE-0002') && !p7Out.includes('rule:RULE-0001');
check('P7 supersession: recurrence with a different fix -> RULE-0002 supersedes RULE-0001; both remain in the log; injection uses rule B only', p7Ok,
  `A.active=${aEntry.active} (supersededBy=${aEntry.supersededBy}); B.active=${bEntry.active}; both-in-log=${p7Raw.includes('"id":"RULE-0001"') && p7Raw.includes('"id":"RULE-0002"')}`);

// ---------------------------------------------------------------------------
// EXTRA-1 — Revocation writes an event; the rule remains in the log (RULE 2);
//           after revoking the only active rule, injection renders no block.
// ---------------------------------------------------------------------------
const linesBeforeRev = incidentLog.readEvents().lineCount;
const rev = incidents.revoke('RULE-0002', 'operator retired this defense');
const linesAfterRev = incidentLog.readEvents().lineCount;
const rulesAfterRev = incidents.rules();
const revEntry = rulesAfterRev.find((r) => r.ruleId === 'RULE-0002');
const revInjected = incidents.inject(CANONICAL_SECTIONS.map((s) => ({ ...s })), { section: 'doing-tasks' });
const revOut = revInjected.find((s) => s.id === 'doing-tasks').build({ 'doing-tasks': BASE_DOING });
const revPlan = incidents.injectionPlan({ section: 'doing-tasks' });
console.log(`revoke('RULE-0002') -> ${JSON.stringify(rev)}`);
console.log(`rules() after revoke: RULE-0002 still present=${revEntry !== undefined}, revoked=${revEntry ? revEntry.revoked : '?'}, active=${revEntry ? revEntry.active : '?'}`);
console.log(`log lines ${linesBeforeRev} -> ${linesAfterRev}; injection block=${JSON.stringify(revPlan.block)}`);
const revOk =
  rev.revoked === true && typeof rev.at === 'string' &&
  linesAfterRev === linesBeforeRev + 1 &&
  incidentLog.readEvents().raw.includes('"type":"revoke"') &&
  revEntry !== undefined && revEntry.revoked === true && revEntry.active === false &&
  revPlan.block === null &&
  revOut === BASE_DOING && !revOut.includes('jexi:negative-few-shots');
check('EXTRA-1 revoke: event appended (nothing deleted), rule still listed as revoked/inactive, injection falls back to the clean section (no block)', revOk,
  `log +1 line; RULE-0002 revoked=${revEntry.revoked}; section bytes back to ${revOut.length}; block=${revPlan.block}`);

// ---------------------------------------------------------------------------
// P8 — SIGKILL persistence: record + promote, real SIGKILL, fresh process
//      reads back the incident AND the promoted rule.
// ---------------------------------------------------------------------------
const root8 = freshStore('p8');
const P8_INC = {
  trigger: 'snapshot file written non-atomically during teardown',
  context: 'scope H P8 kill/restart cycle',
  failure: 'a partial snapshot line was read back after an abrupt stop',
  fix: 'write the snapshot to a temp file and rename it into place',
};
const childA = spawn(process.execPath, ['--input-type=module', '-e', `
const { incidents } = await import(${JSON.stringify(INDEX_URL)});
const r = incidents.record(${JSON.stringify(P8_INC)});
const p = incidents.promote(r.id);
console.log('CHILD_A_IDS ' + JSON.stringify({ incidentId: r.id, ruleId: p.ruleId }));
setInterval(() => {}, 60000); // stay alive; parent will SIGKILL
`], { env: { ...process.env, JEXI_INCIDENTS_ROOT: root8 }, stdio: ['ignore', 'pipe', 'pipe'] });

let outA = '';
await new Promise((res) => {
  const timer = setTimeout(res, 10000);
  childA.stdout.on('data', (d) => {
    outA += String(d);
    if (outA.includes('CHILD_A_IDS')) { clearTimeout(timer); res(); }
  });
  childA.on('close', () => { clearTimeout(timer); res(); });
});
childA.kill('SIGKILL');
const closeA = await new Promise((res) => childA.on('close', (code, signal) => res({ code, signal })));
console.log(`child A stdout: ${outA.trim()}`);
console.log(`child A close: signal=${closeA.signal} code=${closeA.code}`);
const p8Ids = JSON.parse(outA.replace('CHILD_A_IDS ', '').split('\n')[0]);

const childB = spawnSync(process.execPath, ['--input-type=module', '-e', `
const { incidents } = await import(${JSON.stringify(INDEX_URL)});
const inc = incidents.get(process.env.JEXI_P8_INC);
const rules = incidents.rules();
console.log('CHILD_B_STATE ' + JSON.stringify({ incident: inc, rules }));
`], {
  env: { ...process.env, JEXI_INCIDENTS_ROOT: root8, JEXI_P8_INC: p8Ids.incidentId },
  encoding: 'utf8',
});
const outB = (childB.stdout || '').trim();
console.log(`child B (fresh process) stdout: ${outB}`);
let p8State = null;
try { p8State = JSON.parse(outB.replace('CHILD_B_STATE ', '')); } catch { /* fail below */ }
const p8Inc = p8State && p8State.incident;
const p8Rule = p8State && (p8State.rules || []).find((r) => r.ruleId === p8Ids.ruleId);
const p8Ok = closeA.signal === 'SIGKILL' && Boolean(p8Inc) && Boolean(p8Rule) &&
  p8Inc.id === p8Ids.incidentId &&
  p8Inc.trigger === P8_INC.trigger && p8Inc.context === P8_INC.context &&
  p8Inc.failure === P8_INC.failure && p8Inc.fix === P8_INC.fix &&
  p8Rule.active === true && p8Rule.incidentId === p8Ids.incidentId &&
  p8Rule.when === P8_INC.trigger && p8Rule.do === P8_INC.fix;
check('P8 SIGKILL persistence: fresh process reads back the incident (all four fields) and the active promoted rule referencing it', p8Ok,
  `writer killed via signal ${closeA.signal}; fresh process: incident=${p8Inc ? p8Inc.id : '<missing>'}, rule=${p8Rule ? `${p8Rule.ruleId} active=${p8Rule.active}` : '<missing>'}`);

// ---------------------------------------------------------------------------
// P9 — Determinism: same input sequence twice -> identical log with
//      timestamps masked. Two fresh child processes + two in-process runs.
// ---------------------------------------------------------------------------
const P9_A = {
  trigger: 'stale cache served after config change',
  context: 'scope H P9 determinism scenario',
  failure: 'renderer kept the old theme for the whole session',
  fix: 'invalidate the cache key when the config hash changes',
};
const P9_B = {
  trigger: 'empty section rendered when the build output was blank',
  context: 'scope H P9 determinism scenario',
  failure: 'assembler emitted a blank block instead of skipping the section',
  fix: 'skip sections whose build returns an empty string',
};
const P9_C = {
  trigger: 'rule text with newlines broke the one-rule-per-line layout',
  context: 'scope H P9 determinism scenario',
  failure: 'the injected block wrapped mid-rule and duplicated markers',
  fix: 'collapse whitespace before rendering a rule line',
};
const P9_A2 = { ...P9_A, fix: 'bump the cache key with the config hash on every read' };
const P9_VAGUE = {
  trigger: 'something went wrong',
  context: 'scope H P9 determinism scenario',
  failure: 'unknown',
  fix: 'check the logs',
};
const P9_CHILD_SCRIPT = `
const { incidents } = await import(${JSON.stringify(INDEX_URL)});
incidents.record(${JSON.stringify(P9_A)});
incidents.record(${JSON.stringify(P9_B)});
incidents.record(${JSON.stringify(P9_C)});
incidents.promote('INC-0001');
incidents.record(${JSON.stringify(P9_A2)});
incidents.promote('INC-0004');
incidents.record(${JSON.stringify(P9_VAGUE)});
const refused = incidents.promote('INC-0005');
console.log('P9_REFUSED ' + JSON.stringify({ rule: refused.rule, errorCode: refused.errorCode }));
`;
const root9a = freshStore('p9-a');
const child9a = spawnSync(process.execPath, ['--input-type=module', '-e', P9_CHILD_SCRIPT],
  { env: { ...process.env, JEXI_INCIDENTS_ROOT: root9a }, encoding: 'utf8' });
const root9b = freshStore('p9-b');
const child9b = spawnSync(process.execPath, ['--input-type=module', '-e', P9_CHILD_SCRIPT],
  { env: { ...process.env, JEXI_INCIDENTS_ROOT: root9b }, encoding: 'utf8' });
console.log(`child A refused: ${(child9a.stdout || '').trim()}`);
console.log(`child B refused: ${(child9b.stdout || '').trim()}`);

function runP9InProcess() {
  incidents.record(P9_A);
  incidents.record(P9_B);
  incidents.record(P9_C);
  incidents.promote('INC-0001');
  incidents.record(P9_A2);
  incidents.promote('INC-0004');
  incidents.record(P9_VAGUE);
  return incidents.promote('INC-0005');
}
const root9c = freshStore('p9-c');
const inProcRefusal1 = runP9InProcess();
const root9d = freshStore('p9-d');
const inProcRefusal2 = runP9InProcess();

const maskA = maskedLog(root9a);
const maskB = maskedLog(root9b);
const maskC = maskedLog(root9c);
const maskD = maskedLog(root9d);
const hA = sha256(maskA);
const hB = sha256(maskB);
const hC = sha256(maskC);
const hD = sha256(maskD);
console.log(`masked log sha256 (child A):  ${hA}`);
console.log(`masked log sha256 (child B):  ${hB}`);
console.log(`masked log sha256 (inproc 1): ${hC}`);
console.log(`masked log sha256 (inproc 2): ${hD}`);
console.log(`masked log line counts: a=${maskA.trim() ? maskA.trim().split('\n').length : 0} b=${maskB.trim() ? maskB.trim().split('\n').length : 0}`);
const p9ChildRefusalOk = (child9a.stdout || '').includes('"errorCode":"E_VAGUE_TRIGGER"') &&
  (child9b.stdout || '').includes('"errorCode":"E_VAGUE_TRIGGER"') &&
  inProcRefusal1.errorCode === INCIDENT_CODES.VAGUE_TRIGGER &&
  inProcRefusal2.errorCode === INCIDENT_CODES.VAGUE_TRIGGER;
const p9Ok = hA === hB && hB === hC && hC === hD && p9ChildRefusalOk &&
  maskA.trim().split('\n').length === 7 && // 5 incidents (A,B,C,A2,vague) + 2 promotions; refusals append nothing
  incidentLog.readEvents().parseErrors.length === 0;
check('P9 determinism: same input sequence in 2 fresh processes + 2 in-process runs -> identical logs (timestamps masked), vague promotion appends nothing (7 events)', p9Ok,
  `hashes equal=${hA === hB && hB === hC && hC === hD}; events=7 (5 incident + 2 promotion + 0 refusal-events)`);

// ---------------------------------------------------------------------------
// EXTRA-2 — RULE 1 sweep: no orphan rules anywhere in this probe's stores.
//           Every promotion references a recorded incident; rule.incidentId
//           matches its event; every revoke references a real rule.
// ---------------------------------------------------------------------------
const sweepRoot = STORE_BASE;
const stores = fs.existsSync(sweepRoot)
  ? fs.readdirSync(sweepRoot).filter((d) => fs.existsSync(path.join(sweepRoot, d, 'log.ndjson')))
  : [];
let orphanCount = 0;
const orphanDetails = [];
for (const d of stores) {
  const txt = fs.readFileSync(path.join(sweepRoot, d, 'log.ndjson'), 'utf8');
  const events = txt.split('\n').filter((l) => l.trim() !== '').map((l) => JSON.parse(l));
  const incIds = new Set(events.filter((e) => e.type === 'incident').map((e) => e.id));
  const ruleIds = new Set(events.filter((e) => e.type === 'promotion').map((e) => e.id));
  for (const e of events) {
    if (e.type === 'promotion') {
      if (!incIds.has(e.incidentId)) {
        orphanCount += 1;
        orphanDetails.push(`${d}: promotion ${e.id} references missing incident ${e.incidentId}`);
      }
      if (!e.rule || e.rule.incidentId !== e.incidentId) {
        orphanCount += 1;
        orphanDetails.push(`${d}: promotion ${e.id} rule.incidentId mismatch`);
      }
    }
    if (e.type === 'revoke' && !ruleIds.has(e.ruleId)) {
      orphanCount += 1;
      orphanDetails.push(`${d}: revoke references missing rule ${e.ruleId}`);
    }
  }
}
console.log(`swept ${stores.length} stores: ${JSON.stringify(stores)}`);
console.log(`orphan rules/promotions/revokes: ${orphanCount}${orphanDetails.length ? ' -> ' + orphanDetails.join('; ') : ''}`);
const extra2Ok = stores.length >= 6 && orphanCount === 0;
check('EXTRA-2 no-orphan sweep: every rule across all probe stores references a recorded incident (RULE 1 holds structurally)', extra2Ok,
  `stores=${stores.length}; orphans=${orphanCount}`);

// ---------------------------------------------------------------------------
// P10 — Zone discipline: git status has ZERO non-zone entries;
//       .jexi/ probe data gitignored. Zone: prompt/incidents/** +
//       scripts/phase25-*.mjs + ZONE-OWNER.md (P25-H-01 append).
// ---------------------------------------------------------------------------
const gitStatus = spawnSync('git', ['status', '--short'], { cwd: WT, encoding: 'utf8' });
const statusLines = (gitStatus.stdout || '').split('\n').filter((l) => l.trim() !== '');
console.log(`git status --short (${statusLines.length} lines):`);
for (const l of statusLines) console.log(`  ${l}`);
const zoneRe = /^..\s+(prompt\/incidents(\/.*)?|scripts\/phase25-[a-z0-9-]+\.mjs|ZONE-OWNER\.md)$/;
const nonZone = statusLines.filter((l) => !zoneRe.test(l));
const committed = statusLines.length === 0; // everything committed -> clean is PASS
const gitIgnore = spawnSync('git', ['check-ignore', '-v', '.jexi/probe-incidents/scope-h/main/log.ndjson'], { cwd: WT, encoding: 'utf8' });
console.log(`git check-ignore -v .jexi probe store: ${(gitIgnore.stdout || '').trim() || '<NOT IGNORED>'}`);
const p10Ok = (committed || (statusLines.length > 0 && nonZone.length === 0)) &&
  (gitIgnore.stdout || '').includes('.jexi/');
check('P10 zone discipline: git status has ZERO non-zone entries (zone-only pre-commit, clean post-commit); .jexi/ probe stores gitignored', p10Ok,
  `mode=${committed ? 'committed-clean' : 'pre-commit-zone-only'}; entries=${statusLines.length}; non-zone=${nonZone.length}; ignore=${(gitIgnore.stdout || '').trim()}`);

// ---------------------------------------------------------------------------
console.log('');
console.log('--- SUMMARY ---');
if (failures === 0) {
  console.log('SCOPE H PROBE — ALL PASS (10/10 sections + 2 extras, 0 failures)');
  process.exit(0);
} else {
  console.log(`SCOPE H PROBE — FAILED (${failures} failing checks)`);
  process.exit(1);
}
