#!/usr/bin/env node
/**
 * JEXI OS — Phase 9 Scope E probe — cost caps (P1–P11).
 *
 * One subcommand per probe case. Every case is SELF-CONTAINED (fresh
 * engine, fresh session ids) so runs are deterministic and order-free.
 * Raw output only; exit 1 on any failed assertion.
 *
 * p10 spans TWO real processes: p10a records spend + persists the ledger
 * to scratch/phase9-e-ledger.json and exits; p10b is a fresh process that
 * reloads it and proves the verdict survives. Runtime artifacts live in
 * scratch/ (never committed).
 */

import { createCaps } from '../integrations/providers/cost/caps.js';
import { createTracker } from '../integrations/providers/cost/tracker.js';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LEDGER_PATH = join(ROOT, 'scratch', 'phase9-e-ledger.json');
const VERDICT_PATH = join(ROOT, 'scratch', 'phase9-e-verdict.json');
const LLM_CLIENT = join(ROOT, 'server', 'src', 'providers', 'runtime', 'LLMClient.js');
const CHAT_BASE = join(ROOT, 'server', 'src', 'providers', 'adapters', 'chatClientBase.js');
const PROVIDERS_README = join(ROOT, 'providers', 'README.md');

let pass = 0;
let fail = 0;

function ok(cond, label) {
  if (cond) { pass += 1; console.log(`PASS: ${label}`); } else { fail += 1; console.log(`FAIL: ${label}`); }
}
function eq(got, want, label) {
  ok(got === want, `${label} (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`);
}
function raw(label, obj) {
  console.log(`--- ${label} (raw) ---`);
  console.log(JSON.stringify(obj, null, 2));
}
function done(name) {
  console.log(`[${name}] ${pass} PASS / ${fail} FAIL`);
  process.exit(fail === 0 ? 0 : 1);
}
function freshCaps() {
  return createCaps({ tracker: createTracker() }); // in-memory, default thresholds 0.8/1.0
}
function errShape(e) {
  return { name: e.name, code: e.code, message: e.message };
}

/* P1 — fresh session, no spend → ok, pct 0, remaining = budget. */
function p1() {
  const caps = freshCaps();
  const verdict = caps.check({ sessionId: 's1', providerId: 'providerA', spendUsd: 0, budgetUsd: 1.0 });
  raw('P1 caps.check fresh session', verdict);
  eq(verdict.state, 'ok', 'state is ok');
  eq(verdict.pct, 0, 'pct is 0');
  eq(verdict.remainingUsd, 1.0, 'remainingUsd is 1.00');
  eq(verdict.spendUsd, 0, 'spendUsd is 0');
  eq(verdict.terminated, false, 'not terminated');
  eq(verdict.reason, undefined, 'no reason on ok');
  done('P1');
}

/* P2 — record 0.80 of 1.00 → warn at exactly 80%, remaining 0.20. */
function p2() {
  const caps = freshCaps();
  const rec = caps.record({ sessionId: 's1', providerId: 'providerA', usd: 0.8 });
  const verdict = caps.check({ sessionId: 's1', budgetUsd: 1.0 });
  raw('P2 record', { ok: rec.ok, usd: rec.usd, sessionTotalUsd: rec.sessionTotalUsd });
  raw('P2 check after record', verdict);
  eq(verdict.state, 'warn', 'state is warn');
  eq(verdict.pct, 80, 'pct is 80');
  eq(verdict.remainingUsd, 0.2, 'remainingUsd is 0.20');
  eq(verdict.warnEmitted, true, 'warning emitted (first time)');
  eq(verdict.terminated, false, 'not terminated');
  const led = caps.ledger('s1');
  eq(led.warnings.length, 1, 'exactly one warning event in ledger');
  done('P2');
}

/* P3 — more spend inside the warn band → no SECOND warning event. */
function p3() {
  const caps = freshCaps();
  caps.record({ sessionId: 's1', providerId: 'providerA', usd: 0.8 });
  const first = caps.check({ sessionId: 's1', budgetUsd: 1.0 });
  caps.record({ sessionId: 's1', providerId: 'providerA', usd: 0.05 }); // delta 0.05 → cumulative 0.85
  const second = caps.check({ sessionId: 's1' });
  const led = caps.ledger('s1');
  raw('P3 first check (0.80)', first);
  raw('P3 second check (cumulative 0.85)', second);
  raw('P3 ledger warnings', led.warnings);
  console.log(`--- P3 note (raw) ---\nrecord delta 0.05 USD; cumulative sessionTotalUsd = ${led.totalUsd}`);
  eq(led.totalUsd, 0.85, 'cumulative spend is 0.85');
  eq(first.warnEmitted, true, 'first check emitted the warning');
  eq(second.state, 'warn', 'second check state is still warn');
  eq(second.warnEmitted, false, 'second check did NOT emit another warning');
  eq(second.warnAlreadyEmitted, true, 'second check reports warning already emitted');
  eq(led.warnings.length, 1, 'still exactly ONE warning event in ledger');
  done('P3');
}

/* P4 — record up to 1.00 → cap, terminated flag set. */
function p4() {
  const caps = freshCaps();
  caps.record({ sessionId: 's1', providerId: 'providerA', usd: 0.8 });
  caps.record({ sessionId: 's1', providerId: 'providerA', usd: 0.05 });
  caps.record({ sessionId: 's1', providerId: 'providerA', usd: 0.15 }); // cumulative 1.00
  const verdict = caps.check({ sessionId: 's1', budgetUsd: 1.0 });
  const led = caps.ledger('s1');
  raw('P4 check at 1.00', verdict);
  raw('P4 ledger entry', led);
  eq(verdict.state, 'cap', 'state is cap');
  eq(verdict.pct, 100, 'pct is 100');
  eq(verdict.remainingUsd, 0, 'remainingUsd is 0');
  eq(verdict.terminated, true, 'session terminated flag set');
  eq(led.capped, true, 'ledger capped flag set');
  ok(typeof led.cappedAt === 'string' && led.cappedAt.length > 0, 'cappedAt timestamp present');
  eq(led.cappedReason, verdict.reason, 'ledger cappedReason matches check reason');
  done('P4');
}

/* P5 — post-cap refusal: record on capped session → E_SESSION_CAPPED + attempt logged. */
function p5() {
  const caps = freshCaps();
  caps.record({ sessionId: 's1', providerId: 'providerA', usd: 0.8 });
  caps.record({ sessionId: 's1', providerId: 'providerA', usd: 0.05 });
  caps.record({ sessionId: 's1', providerId: 'providerA', usd: 0.15 });
  caps.check({ sessionId: 's1', budgetUsd: 1.0 }); // caps the session
  let err = null;
  try {
    caps.record({ sessionId: 's1', providerId: 'providerA', usd: 0.1 });
  } catch (e) {
    err = e;
  }
  ok(err !== null, 'record on capped session threw');
  raw('P5 refusal error', err ? errShape(err) : null);
  const led = caps.ledger('s1');
  raw('P5 ledger attempts + total', { attempts: led.attempts, totalUsd: led.totalUsd });
  eq(err?.code, 'E_SESSION_CAPPED', 'error code is E_SESSION_CAPPED');
  ok(err?.message.includes('capped'), 'message states the session is capped');
  eq(led.totalUsd, 1.0, 'ledger total unchanged (money not falsified)');
  eq(led.attempts.length, 1, 'refused attempt logged as evidence');
  eq(led.attempts[0]?.code, 'E_SESSION_CAPPED', 'attempt carries the code');
  done('P5');
}

/* P6 — multi-session isolation: s1 capped, s2 fresh → s2 ok. */
function p6() {
  const caps = freshCaps();
  const rec1 = caps.record({ sessionId: 's1', providerId: 'providerA', usd: 1.0, budgetUsd: 1.0 });
  const s1 = caps.check({ sessionId: 's1' });
  const s2 = caps.check({ sessionId: 's2', providerId: 'providerA', spendUsd: 0, budgetUsd: 1.0 });
  raw('P6 s1 record (record-path cap)', { ok: rec1.ok, event: rec1.event ?? null, sessionTotalUsd: rec1.sessionTotalUsd });
  raw('P6 s1 check', s1);
  raw('P6 s2 check', s2);
  eq(rec1.event, 'cap', 'cap fired inline at record time (defense in depth)');
  eq(s1.state, 'cap', 's1 is capped');
  eq(s1.terminated, true, 's1 terminated');
  eq(s2.state, 'ok', 's2 is ok — cap does not leak across sessions');
  eq(s2.terminated, false, 's2 not terminated');
  done('P6');
}

/* P7 — per-provider tracking: providerA 0.60 + providerB 0.40, sessionTotal 1.00. */
function p7() {
  const caps = freshCaps();
  caps.record({ sessionId: 's1', providerId: 'providerA', usd: 0.6, budgetUsd: 2.0 });
  caps.record({ sessionId: 's1', providerId: 'providerB', usd: 0.4 });
  const led = caps.ledger('s1');
  const view = { ...led.providers, sessionTotal: led.totalUsd };
  const verdict = caps.check({ sessionId: 's1' });
  raw('P7 ledger entry', led);
  raw('P7 spec view', view);
  eq(view.providerA, 0.6, 'providerA is 0.60');
  eq(view.providerB, 0.4, 'providerB is 0.40');
  eq(view.sessionTotal, 1.0, 'sessionTotal is 1.00');
  eq(verdict.state, 'ok', 'state ok (1.00 of 2.00 budget = 50%)');
  eq(verdict.pct, 50, 'pct is 50');
  done('P7');
}

/* P8 — reset('s1') → fresh ok; reset() clears all. */
function p8() {
  const caps = freshCaps();
  caps.record({ sessionId: 's1', providerId: 'providerA', usd: 1.0, budgetUsd: 1.0 }); // capped
  caps.record({ sessionId: 's2', providerId: 'providerA', usd: 0.1, budgetUsd: 1.0 });
  const r1 = caps.reset('s1');
  const after = caps.check({ sessionId: 's1', budgetUsd: 1.0 });
  const led = caps.ledger('s1');
  const rAll = caps.reset();
  raw('P8 reset(s1)', r1);
  raw('P8 check after reset', after);
  raw('P8 ledger after reset', led);
  raw('P8 reset(all)', rAll);
  eq(r1.ok, true, 'reset(s1) ok');
  eq(r1.cleared, 1, 'reset(s1) cleared 1');
  eq(after.state, 'ok', 'state fresh ok after reset');
  eq(after.pct, 0, 'pct back to 0');
  eq(after.remainingUsd, 1.0, 'remaining back to full budget');
  eq(after.terminated, false, 'termination cleared');
  eq(led.warnings.length, 0, 'warning events cleared');
  eq(rAll.scope, 'all', 'reset() scope all');
  eq(rAll.cleared, 2, 'reset() cleared both sessions (s1 + s2)');
  done('P8');
}

/* P9 — custom thresholds: warn=0.5, cap=0.75 → warn at 50%, cap at 75%. */
function p9() {
  const caps = createCaps({ tracker: createTracker(), warn: 0.5, cap: 0.75 });
  raw('P9 thresholds', caps.thresholds());
  const before = caps.check({ sessionId: 's9', budgetUsd: 1.0 });
  const rec1 = caps.record({ sessionId: 's9', providerId: 'providerA', usd: 0.5 });
  const atWarn = caps.check({ sessionId: 's9' });
  const rec2 = caps.record({ sessionId: 's9', providerId: 'providerA', usd: 0.25 }); // cumulative 0.75
  const atCap = caps.check({ sessionId: 's9' });
  raw('P9 check before spend', before);
  raw('P9 record 0.50', { ok: rec1.ok, event: rec1.event ?? null, sessionTotalUsd: rec1.sessionTotalUsd });
  raw('P9 check at 0.50 (warn=0.5)', atWarn);
  raw('P9 record 0.25 → 0.75', { ok: rec2.ok, event: rec2.event ?? null, sessionTotalUsd: rec2.sessionTotalUsd });
  raw('P9 check at 0.75 (cap=0.75)', atCap);
  eq(caps.thresholds().warn, 0.5, 'warn threshold is 0.5');
  eq(caps.thresholds().cap, 0.75, 'cap threshold is 0.75');
  eq(rec1.event, 'warn', 'warning fired at exactly 50% (record path)');
  eq(atWarn.state, 'warn', 'state warn at 50%');
  eq(atWarn.pct, 50, 'pct 50');
  eq(rec2.event, 'cap', 'cap fired at exactly 75% (record path)');
  eq(atCap.state, 'cap', 'state cap at 75%');
  eq(atCap.pct, 75, 'pct 75');
  eq(atCap.terminated, true, 'terminated at custom cap');
  done('P9');
}

/* P10a — process 1 of 2: record, cap, persist ledger + final verdict to disk. */
function p10a() {
  for (const f of [LEDGER_PATH, VERDICT_PATH]) if (existsSync(f)) rmSync(f);
  const caps = createCaps({ tracker: createTracker({ persistPath: LEDGER_PATH }) });
  console.log(`--- P10a ledger path (raw) ---\n${LEDGER_PATH}`);
  const rec1 = caps.record({ sessionId: 's1', providerId: 'providerA', usd: 0.8 });
  const v1 = caps.check({ sessionId: 's1', budgetUsd: 1.0 });
  const rec2 = caps.record({ sessionId: 's1', providerId: 'providerA', usd: 0.2 }); // cumulative 1.00
  const v2 = caps.check({ sessionId: 's1' });
  raw('P10a record 0.80', { ok: rec1.ok, sessionTotalUsd: rec1.sessionTotalUsd });
  raw('P10a check (0.80)', v1);
  raw('P10a record 0.20 → 1.00', { ok: rec2.ok, event: rec2.event ?? null, sessionTotalUsd: rec2.sessionTotalUsd });
  raw('P10a final check (1.00) — process 1', v2);
  const verdict = {
    state: v2.state, pct: v2.pct, remainingUsd: v2.remainingUsd,
    spendUsd: v2.spendUsd, budgetUsd: v2.budgetUsd, reason: v2.reason, terminated: v2.terminated,
  };
  mkdirSync(dirname(VERDICT_PATH), { recursive: true });
  writeFileSync(VERDICT_PATH, JSON.stringify(verdict, null, 2));
  eq(v1.state, 'warn', 'process 1: warn at 0.80');
  eq(v2.state, 'cap', 'process 1: cap at 1.00');
  eq(rec2.event, 'cap', 'process 1: record-path cap fired');
  ok(existsSync(LEDGER_PATH), 'ledger file written');
  console.log('[P10a] exiting process 1 — ledger persisted');
  done('P10a');
}

/* P10b — process 2 of 2: fresh process reloads the ledger from disk. */
function p10b() {
  ok(existsSync(LEDGER_PATH), 'ledger file exists for process 2');
  const caps = createCaps({ tracker: createTracker({ persistPath: LEDGER_PATH }) });
  const first = caps.check({ sessionId: 's1' }); // no budgetUsd — must come from the file
  const second = caps.check({ sessionId: 's1' });
  const persisted = JSON.parse(readFileSync(VERDICT_PATH, 'utf8'));
  const pick = (v) => JSON.stringify({ state: v.state, pct: v.pct, remainingUsd: v.remainingUsd, spendUsd: v.spendUsd, budgetUsd: v.budgetUsd, reason: v.reason, terminated: v.terminated });
  raw('P10b fresh-process check #1', first);
  raw('P10b fresh-process check #2', second);
  raw('P10b process-1 verdict (from file)', persisted);
  let refusal = null;
  try {
    caps.record({ sessionId: 's1', providerId: 'providerA', usd: 0.5 });
  } catch (e) {
    refusal = errShape(e);
  }
  raw('P10b post-restart record attempt', refusal);
  console.log('--- P10b ledger file (raw) ---');
  console.log(readFileSync(LEDGER_PATH, 'utf8'));
  console.log(`--- P10b statement (raw) ---
Default mode: the module-default caps instance is IN-MEMORY ONLY
(persistPath = ${process.env.JEXI_COST_LEDGER_PATH ?? 'unset'} → null).
Why: cost caps guard a LIVE session; durability is an explicit runtime
choice (persistPath option / JEXI_COST_LEDGER_PATH), not a hidden side
effect. When persistence IS configured, the ledger file survives process
exit — proven above across two REAL processes:
  * terminal cap state survived (record attempt after restart → E_SESSION_CAPPED)
  * warn-once state survived (warnAlreadyEmitted = ${first.warnAlreadyEmitted} — no re-spam after restart)
  * verdict is deterministic: same inputs → byte-identical verdict fields.`);
  eq(first.state, 'cap', 'process 2: reloaded state is cap');
  eq(first.warnAlreadyEmitted, true, 'warning state persisted (no re-spam)');
  eq(pick(first), pick(second), 'same inputs → byte-identical verdict (determinism)');
  eq(pick(first), JSON.stringify(persisted), 'process 2 verdict == process 1 verdict (cross-process determinism)');
  eq(refusal?.code, 'E_SESSION_CAPPED', 'capped state persisted — record refused after restart');
  done('P10b');
}

/* P11 — integration point: runtime-verified citations in the provider bridge. */
function findLine(file, marker) {
  const lines = readFileSync(file, 'utf8').split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].includes(marker)) return { line: i + 1, text: lines[i].trim() };
  }
  return null;
}
function p11() {
  console.log('--- P11 provider bridge identity (raw) ---');
  const bridge = findLine(PROVIDERS_README, 'L2 provider bridge');
  ok(bridge !== null, 'providers/README.md identifies the bridge location');
  console.log(`providers/README.md:${bridge.line}: ${bridge.text}`);

  console.log('--- P11 runtime-verified citations (raw) ---');
  const markers = [
    ['server/src/providers/runtime/LLMClient.js', 'opts.budget && typeof opts.budget.canSpend', 'EXISTING budget-gate precedent (Phase 1 request economy)'],
    ['server/src/providers/runtime/LLMClient.js', 'await call(prompt, system, imageBase64, opts, errors)', 'PER-MODEL-CALL dispatch — caps.check goes immediately before this'],
    ['server/src/providers/runtime/LLMClient.js', 'async function chatWithToolsOnce', 'TOOL-LOOP per-round model call wrapper'],
    ['server/src/providers/adapters/chatClientBase.js', 'async chat(request)', 'ADAPTER-LEVEL choke point (all vendor adapters)'],
  ];
  const found = [];
  for (const [file, marker, why] of markers) {
    const hit = findLine(file, marker);
    ok(hit !== null, `citation live: ${file} contains "${marker.slice(0, 40)}…"`);
    if (hit) {
      found.push({ file: `${file}:${hit.line}`, marker, why, text: hit.text });
      console.log(`${file}:${hit.line}`);
      console.log(`    why: ${why}`);
      console.log(`    code: ${hit.text}`);
    }
  }

  console.log('--- P11 wiring shape (raw) ---');
  console.log(`// zone-owner wiring shape (NOT committed to server/src/** — zone discipline):
// inside LLMClient.js __generateWalk, per provider rung, BEFORE the dispatch:
//
//   const verdict = caps.check({
//     sessionId: opts.sessionId ?? 'adhoc',       // session identity: zone-owner plumbing
//     providerId: provider,                        // ${JSON.stringify('openai')} etc. — real adapter ids
//     spendUsd: caps.ledger(opts.sessionId)?.totalUsd + estimateCost(request),
//     budgetUsd: opts.budgetUsd,
//   });
//   if (verdict.state === 'cap') throw new ClassifiedError(
//     \`cost cap reached: \${verdict.reason}\`, { provider, status: 402 });
//   if (verdict.state === 'warn') log.warn('cost warn', verdict.reason);
//   ... await call(prompt, system, imageBase64, opts, errors) ...
//   caps.record({ sessionId: opts.sessionId, providerId: provider, usd: realUsageCost });`);

  console.log('--- P11 live demo of the gate shape against the REAL engine (raw) ---');
  const caps = freshCaps();
  const warnProj = caps.check({ sessionId: 'bridge-demo', providerId: 'openai', spendUsd: 0.45, budgetUsd: 0.5 });
  const capProj = caps.check({ sessionId: 'bridge-demo', providerId: 'openai', spendUsd: 0.6, budgetUsd: 0.5 });
  raw('P11 pre-call projection 0.45/0.50', warnProj);
  raw('P11 pre-call projection 0.60/0.50', capProj);
  eq(warnProj.state, 'warn', 'projection 90% → warn (bridge proceeds + logs)');
  eq(capProj.state, 'cap', 'projection 120% → cap (bridge refuses BEFORE the model call)');
  eq(capProj.terminated, true, 'session terminated by the projected call');

  console.log('--- P11 zone-owner statement (raw) ---');
  console.log([
    'Wiring caps.check/caps.record into the bridge requires edits in',
    'server/src/providers/** — that is zone-owner territory (Scope E zone',
    'is providers/cost/** + scripts/phase9-*.mjs). providers/cost/ ships',
    'the engine; the call sites cited above (with runtime-verified line',
    'numbers) are the exact hook points for the zone-owner task.',
  ].join('\n'));
  done('P11');
}

const CASES = { p1, p2, p3, p4, p5, p6, p7, p8, p9, p10a, p10b, p11 };
const name = process.argv[2];
if (!name || !CASES[name]) {
  console.error(`usage: node scripts/phase9-e-probe.mjs <${Object.keys(CASES).join('|')}>`);
  process.exit(2);
}
await CASES[name]();
