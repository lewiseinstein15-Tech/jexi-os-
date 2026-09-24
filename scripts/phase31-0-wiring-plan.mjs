#!/usr/bin/env node
// JEXI OS — PHASE 31 SCOPE 0 — WIRING PLAN (report-only enumeration artifact).
//
// This module is the machine-readable form of the Phase 31 WIRING PLAN:
//   1. It extracts the DEFERRED wiring ids from ZONE-OWNER.md (Category-5
//      wiring table, numbered DEFERRED rows, P24-F rows, infra rows).
//   2. It proves COVERAGE: every deferred ledger id is covered by exactly
//      one plan entry (directly, or via an explicit MAPPING).
//   3. It prints the plan grouped by scope with per-item verdicts.
//
// It performs NO wiring, NO network I/O, NO credential access. It edits
// nothing. Exit 1 only when the plan fails to cover a known ledger id.
// Later-scope ZONE-OWNER.md appends surface as INFO lines, not failures.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LEDGER = path.join(ROOT, 'ZONE-OWNER.md');
const text = readFileSync(LEDGER, 'utf8');

// ---------------------------------------------------------------- ledger ids
// Known deferred id families as of pre-phase-31-wiring (73e06b0).
const W_ROWS = ['W13','W14','W15','W16','W17','W18','W19','W24','W25','W26',
  'W27','W29','W30','WA1','WA2','WA3','WA4','WA5','WA6','WA7','WA8','WA9',
  'W10A1','W23','W23b','W23c','W23d','W23e','W23f','W36'];
const NUMBERED_DEFERRED = ['13','14','15','16','17','18','19','24','25','26','27','29','30'];
const P24F_DEFERRED = ['P24-F-01','P24-F-02','P24-F-03','P24-F-04','P24-F-05','P24-F-06','P24-F-07'];

// numbered row -> W row (the ledger states the pairs explicitly)
const NUMBERED_MAP = Object.fromEntries(NUMBERED_DEFERRED.map(n => [n, 'W' + n]));
// P24-F row -> WA parent (ledger states the pairings)
const P24F_MAP = { 'P24-F-01':'WA6','P24-F-02':'WA6','P24-F-03':'WA6','P24-F-04':'WA6',
  'P24-F-05':'WA8','P24-F-06':'WA9','P24-F-07':'WA7' };

// Presence proof: each known id must still exist in the ledger text
// (numbered rows live in markdown tables as `| <n> |`).
const needles = [
  ...W_ROWS,
  ...NUMBERED_DEFERRED.map(n => '| ' + n + ' |'),
  ...P24F_DEFERRED,
];
const missingInLedger = needles.filter(id => !text.includes(id));
if (missingInLedger.length) {
  console.error('LEDGER DRIFT: ids not found in ZONE-OWNER.md: ' + missingInLedger.join(', '));
  process.exit(1);
}

// INFO: ids present in the ledger but outside the known set (future appends).
const found = new Set(text.match(/\b(?:WA\d|W10A1|W23[a-f]|W\d{1,3}|P24-F-0\d)\b/g) || []);
const KNOWN = new Set([...W_ROWS, ...P24F_DEFERRED]);
const INFO_EXTRA = [...found].filter(id => !KNOWN.has(id));

// ---------------------------------------------------------------- plan table
// verdicts: WIREABLE | PARTIAL | NEEDS-DECISION | NOT-WIREABLE
// source:   ledger (Category-5 / numbered / P24-F row) | prompt (lead-mandated addition)
// scope:    1..5 (6 = final gate, codeless)
const P = (id, what, target, consumer, scope, verdict, note, source = 'ledger') =>
  ({ id, what, target, consumer, scope, verdict, note, source });

const PLAN = [
  // ---- SCOPE 1 — server bootstrap / server-consumer wiring -----------------
  P('WA2', 'semantica graph -> server memory', 'semantica/graph/** (RO)', 'server/src/memory registration at boot', 1, 'WIREABLE', 'bounded-query default answers the scale-policy blocker'),
  P('WA3', 'instincts observer -> session lifecycle', 'instincts/observe/hook.js (RO)', 'server boot session start/end', 1, 'WIREABLE', 'observe-only hook; no behavior change'),
  P('WA5', 'fleet -> server process supervisor', 'session/fleet/** (RO)', 'server boot supervisor', 1, 'WIREABLE', 'liveness honest-degrades where /proc unavailable'),
  P('W10A1', 'rlm kernel unregistered', 'rlm/kernel/ (RO)', 'server/src/commands-seam.js + kernel', 1, 'WIREABLE', 'commands-seam dynamic-import is the precedent'),
  P('WA1', 'prompt assembly -> provider bridge', 'prompt/** (RO)', 'server/src/providers registry/router', 1, 'WIREABLE', 'prompt/ untouched; glue lives on the server side'),
  P('W36', 'boot-time Node gate (code part of #36)', 'server/src/memory/* internals NOT edited', 'server/index.js boot check', 1, 'WIREABLE', 'boot check only; engines doc already landed'),
  P('W17', 'code source raw-reads', 'server/src/capability/code/graph-first.js', 'server/src/context/sources/code.js', 1, 'WIREABLE', 'graph-first with raw-read fallback'),
  P('W18', 'viking filesystem unregistered', 'context/viking/** (RO)', 'server/src/context/sources/index.js registerSource', 1, 'WIREABLE', 'conservative weights answer cost-policy blocker'),
  P('W19', 'visual QA unwired', 'verification/visual/** (RO)', 'server/src/services/director/Verifier.js', 1, 'WIREABLE', 'browser absence -> clean skip (BROWSER_UNAVAILABLE pattern)'),
  P('B1', 'brain.repo -> server persistence', 'brain/index (RO)', 'server/src/memory backend registration', 1, 'WIREABLE', 'prompt-added; API-fit verified at scope execution'),
  P('B2', 'brain.index -> session bootstrap', 'brain/index (RO)', 'server boot', 1, 'WIREABLE', 'prompt-added'),
  P('B3', 'brain.search.hybrid -> chat retrieval', 'brain/search/hybrid.js (RO)', 'server/src/context/sources', 1, 'WIREABLE', 'prompt-added'),
  P('B4', 'brain.hot.meta -> prompt assembly', 'brain/hot (RO)', 'prompt-assembly seam', 1, 'WIREABLE', 'prompt-added'),
  P('B5', 'brain.protocol verbs -> MCP surface', 'brain/protocol (RO)', 'server/mcp surface / routes', 1, 'WIREABLE', 'prompt-added'),
  P('WA8', 'provider config -> real LLM path (P24-F-05)', 'providers/** (RO) + Settings', 'server/src/providers/config + settings bootstrap', 1, 'PARTIAL', 'config plumbing wireable; live-LLM leg blocked: standing rule forbids new credentials'),
  P('WA9', 'chat runtime server-side (P24-F-06)', 'ui/web/console/chat/runtime.js (RO)', 'server/**', 0, 'NOT-WIREABLE', 'architecture refactor, not a hookup; WIRING RULE stop-and-report applies; stays DEFERRED'),

  // ---- SCOPE 2 — console wiring (disclosed call sites) ---------------------
  P('WA6', 'chat runtime modules -> console surface (P24-F-01/02/03/04)', 'ui/web/console/chat/{artifacts,checkpoints,queue,steer,multiagent}.js (RO)', 'ui/web/console/chat/mount.js (named call site)', 2, 'WIREABLE', 'screenshots required; in-process runtime kept (no server move)'),
  P('WA7', 'Agents View -> console nav (P24-F-07)', 'src/components/console/views/AgentsView.jsx (RO)', 'ui/web/console/shell nav (disclosed call site)', 2, 'WIREABLE', 'module located; sidebar-charter tension disclosed to lead'),
  P('WA4', 'swarm topologies -> workforce dispatch', 'swarm/topologies/** (RO)', 'server/src/workforce registry + panel view', 2, 'WIREABLE', 'default passthrough topology = behavior-neutral'),
  P('S2-COMP', 'Computer Agent dispatch -> chat command surface', 'computer/** (RO)', 'commands-seam / chat mount dispatch', 2, 'WIREABLE', 'prompt-added; computer internals untouched'),

  // ---- SCOPE 3 — event + scheduler wiring ----------------------------------
  P('S3-AUTO', 'autonomy -> scheduler', 'autonomy/** (RO)', 'server/src/scheduler', 3, 'WIREABLE', 'prompt-added'),
  P('S3-CYCLE', 'brain.cycle -> cron/daemon job', 'brain/cycle (RO)', 'server/src/scheduler job', 3, 'WIREABLE', 'prompt-added'),
  P('S3-OFFLOAD', 'context offload -> chat history retention', 'context/offload (RO)', 'chat runtime retention (disclosed call site)', 3, 'WIREABLE', 'prompt-added'),
  P('S3-GSD', 'GSD loop -> workgraph view', 'swarm/loops/looper.js (RO)', 'server/src/workgraph', 3, 'WIREABLE', 'prompt-added'),
  P('W23e', 'ralph diagnostics -> Ralph loop', 'harness/hardening/ralph/ (RO)', 'swarm/loops/ralph.js checkpoints (disclosed call site)', 3, 'WIREABLE', 'evaluate() call inserted, loop internals untouched'),
  P('W23f', 'ciDoctor -> CI failure path', 'harness/hardening/ralph/ci-doctor.js (RO)', '.github/workflows (disclosed call site)', 3, 'PARTIAL', 'call-site edit disclosed; CI green not verifiable from sandbox'),

  // ---- SCOPE 4 — registries, gates, dispatch -------------------------------
  P('W13', 'tools bypass gatedDispatch', 'skills/gates/gated-dispatch.js (RO)', 'server/src/tools/execution/executor.js', 4, 'WIREABLE', 'audit-only default; default-deny remains an owner call, disclosed'),
  P('W14', 'AAS MCP unregistered', 'skills/aas/mcp-server.js (RO)', 'server/mcp/registry.json (named call site)', 4, 'WIREABLE', 'local stdio transport live-probeable'),
  P('W23c', 'forgejo-mcp -> mcp registry', 'harness/hardening/forgejo/ (RO)', 'server/mcp/registry.json (named call site)', 4, 'PARTIAL', 'declarative entry wireable; live leg W23d blocked'),
  P('W23d', 'live forge connection', 'harness/hardening/forgejo/transport.js (RO)', 'real endpoint', 0, 'NOT-WIREABLE', 'needs forge credentials + egress; standing rule forbids new credentials'),
  P('W23', 'madtea -> server PR flow', 'harness/hardening/madtea/ (RO)', 'server PR flow (consumer existence TBC)', 4, 'NEEDS-DECISION', 'no confirmed PR-flow consumer on main; verify at scope, else report'),
  P('W23b', 'madtea gate execution choice', 'harness/hardening/madtea/gates.js (RO)', 'local vs CI-hosted', 0, 'NEEDS-DECISION', 'owner decision by ledger definition'),
  P('W29', 'Ralph pre-flight checks -> unified doctor', 'agent CLIs + MCP + bundles', 'server/src/capability/doctor', 4, 'WIREABLE', 'doctor is the consumer; checks added consumer-side'),
  P('S4-N8N', 'n8n-mcp -> registry', 'upstream n8n-mcp', 'server/mcp/registry.json (named call site)', 4, 'WIREABLE', 'declarative v3.3 pattern; enabled:false unless live-verified', 'prompt'),
  P('S4-EXEC', 'executable skills -> skills registry', 'skills/executable (RO)', 'server/src/skills registry', 4, 'WIREABLE', 'prompt-added'),
  P('S4-REPOCTX', 'repo-context -> session bootstrap', 'semantica/repo-map (RO)', 'session bootstrap', 4, 'WIREABLE', 'prompt-added'),
  P('S4-SP', 'superpowers gates -> server dispatch', 'skills/library (location TBC)', 'server dispatch', 4, 'NEEDS-DECISION', 'no superpowers dir found at recon; locate at scope or report absent', 'prompt'),
  P('S4-OUTFMT', 'output-format validation -> agent loop', 'gate module location TBC', 'agent loop', 4, 'NEEDS-DECISION', 'locate gate module at scope; else report absent', 'prompt'),
  P('S4-MEMFS', 'memory-fs rules -> server/src/memory', 'prompt/** memory-fs (RO)', 'server/src/memory', 4, 'NEEDS-DECISION', 'rule-surface mapping needs scope-time API fit; else report', 'prompt'),
  P('S4-A2A', 'A2A registry -> workforce dispatch', 'a2a/** — ZERO tracked files on main', 'workforce dispatch', 0, 'NOT-WIREABLE', 'target module absent from tree; needs decision (locate/restore) before any wiring', 'prompt'),

  // ---- ledger rows that are OUTSIDE the phase-31 file zone -----------------
  P('W15', 'aas dir-skip hardcoded', 'skills/aas/catalog.js', 'combined index', 0, 'NOT-WIREABLE', 'target file outside phase-31 zone (skills/** not owned); needs zone extension or skills owner'),
  P('W16', 'Phase 12 skills + gates uncalled', 'skills/design/** gates (RO)', 'CodingLoop/VerificationLoop call sites', 4, 'PARTIAL', 'wireable only if loop call sites resolve inside server/src; confirm at scope'),
  P('W24', 'OSINT registrations missing', 'intelligence/trust-pipeline/registered-urls.js', 'upstream registration', 0, 'NOT-WIREABLE', 'outside phase-31 zone + needs upstream stability review + egress proof'),
  P('W25', 'NABSA host relocated', 'intelligence/trust-pipeline/registered-urls.js', 're-registration', 0, 'NOT-WIREABLE', 'outside zone + canonical host unconfirmed (egress NOT-VERIFIED per #28)'),
  P('W26', 'AISStream WSS client', 'ships layer + registered-urls.js', 'WSS client', 0, 'NOT-WIREABLE', 'outside zone + needs WSS credentials (standing rule)'),
  P('W27', 'OSINT gaps flights/fires/traffic', 'registered-urls.js + layers', 'chunked fetch + egress', 0, 'NOT-WIREABLE', 'outside zone + per-API policy calls'),
  P('W30', 'GitLab Duo benchmark', '/code-review eval set', 'GitLab project', 0, 'NOT-WIREABLE', 'needs GitLab project access + eval harness; no credentials permitted'),

  // ---- SCOPE 5 — infra unblocks --------------------------------------------
  P('S5-BOOTSTRAP', 'install node_modules (root + server)', 'package-lock.json (declared deps ONLY)', 'npm ci at both roots', 5, 'WIREABLE', 'no new dependencies; transport failure -> stop-and-report', 'prompt'),
  P('S5-CHAIN', 'prune stale test chain entries', 'server/package.json test manifest (disclosed edit)', 'suite manifest', 5, 'WIREABLE', 'entries absent from BOTH parents; pruning is manifest hygiene', 'prompt'),
  P('S5-DOCS', 'Node >=22.5 floor + minimum server requirements doc', 'docs (disclosed edit)', 'README/AGENTS note', 5, 'WIREABLE', 'engines already landed; doc reconciles the runtime', 'prompt'),
];

// ---------------------------------------------------------------- coverage
const byId = new Map(PLAN.map(e => [e.id, e]));
const uncovered = [];
for (const id of W_ROWS) if (!byId.has(id)) uncovered.push(id);
for (const [num, wid] of Object.entries(NUMBERED_MAP)) if (!byId.has(wid)) uncovered.push('#' + num + '->' + wid);
for (const [pid, wid] of Object.entries(P24F_MAP)) if (!byId.has(wid)) uncovered.push(pid + '->' + wid);

if (uncovered.length) {
  console.error('COVERAGE FAILURE: plan does not cover: ' + uncovered.join(', '));
  process.exit(1);
}

// ---------------------------------------------------------------- report
const verdicts = {};
for (const e of PLAN) verdicts[e.verdict] = (verdicts[e.verdict] || 0) + 1;

console.log('PHASE 31 — WIRING PLAN (Scope 0, report-only)');
console.log('ledger snapshot: pre-phase-31-wiring @ 73e06b0');
console.log('plan entries: ' + PLAN.length + ' | verdicts: ' + JSON.stringify(verdicts));
console.log('coverage: ' + W_ROWS.length + ' Category-5 rows + ' + NUMBERED_DEFERRED.length +
  ' numbered dupes + ' + P24F_DEFERRED.length + ' P24-F rows => ALL COVERED');
if (INFO_EXTRA.length) console.log('INFO extra ledger ids outside known set (future appends): ' + INFO_EXTRA.join(', '));
console.log('NOTE: no W28 exists in the ledger (id gap; grep named it, ledger never had it).');
console.log('');

for (const s of [1, 2, 3, 4, 5]) {
  const rows = PLAN.filter(e => e.scope === s);
  if (!rows.length) continue;
  console.log('== SCOPE ' + s + ' ==');
  for (const e of rows) {
    console.log(`  [${e.id}] ${e.verdict} — ${e.what}`);
    console.log(`      target:   ${e.target}`);
    console.log(`      consumer: ${e.consumer}`);
    console.log(`      note:     ${e.note} (source: ${e.source})`);
  }
  console.log('');
}

const blocked = PLAN.filter(e => e.scope === 0);
console.log('== NOT WIREABLE THIS PHASE (scope 0 = no scope; carried with reasons) ==');
for (const e of blocked) console.log(`  [${e.id}] ${e.verdict} — ${e.what} — ${e.note}`);

console.log('');
console.log('COMMIT PLAN: phase-31(0): wiring plan (report-only)');
console.log('PLAN-COVERAGE: OK');
