#!/usr/bin/env node
/**
 * PHASE 17 SCOPE E PROBE — context filesystem (viking://).
 *
 * Real filesystem, real tiers, real token accounting (documented chars/4
 * estimator, same convention as the Phase 4 MemoryProvider). Deterministic
 * organizers are labeled where they stand in for LLM work. The session in P8
 * is SYNTHETIC and labeled as such.
 *
 *   P1  URI parse + build (+ rejection cases)
 *   P2  write a tree (5 files, L0+L1+L2) + show the tree
 *   P3  ls — every entry carries its L0 sidecar
 *   P4  read L0 only (tokens)
 *   P5  read L2 on demand (tokens)
 *   P6  automatic tier selection — 3 questions → L0 / L1 / L2
 *   P7  token reduction — raw L2 read vs tier loading (real ratio)
 *   P8  session pipeline (synthetic, labeled) → viking://session/<id>
 *   P9  compile.run — wiki + knowledge-graph + report
 *   P10 persistence across process (real child process re-read)
 *   P11 integration point (server/src/context/** citations; zone-owner task)
 *   P12 no leakage — grep proof: zero viking imports from server/src/**
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseUri, buildUri, joinUri, VIKING_SCOPES } from '../context/viking/uri.js';
import { VikingFs, AUTO_LABEL } from '../context/viking/filesystem.js';
import { createLoader } from '../context/viking/layers.js';
import * as compile from '../context/viking/compile.js';
import { capture as captureSession, toSessionMemory } from '../context/viking/session.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STORE = '/tmp/phase17-e/store';

/* ───────────────────────── probe helpers ───────────────────────── */
const RESULTS = [];
const pass = (n, d) => { RESULTS.push({ n, ok: true }); console.log(`  PASS  ${n}  ${d}`); };
const fail = (n, d) => { RESULTS.push({ n, ok: false }); console.log(`  FAIL  ${n}  ${d}`); };
const assert = (c, n, okD, badD) => (c ? pass : fail)(n, c ? okD : badD);
const section = (t) => console.log(`\n── ${t} ${'─'.repeat(Math.max(1, 66 - t.length))}`);

function freshFs() {
  fs.rmSync(STORE, { recursive: true, force: true });
  return new VikingFs({ root: STORE });
}

/* ─────────────────────────────── probes ────────────────────────── */

function probeP1() {
  section('P1 — URI parse + build');
  const parsed = parseUri('viking://resources/jexi/architecture');
  console.log(`    parse("viking://resources/jexi/architecture") → ${JSON.stringify(parsed)}`);
  const built = buildUri(parsed);
  console.log(`    build(${JSON.stringify(parsed)}) → ${built}`);
  const cases = [
    ['viking://user/prefs/theme', { scope: 'user', path: 'prefs/theme' }],
    ['viking://session', { scope: 'session', path: '' }],
    ['viking://agent/workspace/notes/todo', { scope: 'agent', path: 'workspace/notes/todo' }],
  ];
  for (const [u, want] of cases) console.log(`    parse(${JSON.stringify(u)}) → ${JSON.stringify(parseUri(u))} (want ${JSON.stringify(want)})`);
  const rejects = [];
  for (const bad of ['viking://kernel/x', 'file:///etc/passwd', 'viking://resources/../../etc', 'viking://resources/a/../b']) {
    try { parseUri(bad); rejects.push(`${bad}: NOT rejected`); } catch (e) { rejects.push(`${bad} → ${e.code}`); }
  }
  for (const r of rejects) console.log(`    reject-check: ${r}`);
  const allParsed = cases.every(([u, w]) => JSON.stringify(parseUri(u)) === JSON.stringify(w));
  const roundTrip = built === 'viking://resources/jexi/architecture';
  const rejOk = (rejects.join(' ').match(/E_INVALID_SCOPE|E_INVALID_URI|E_PATH_TRAVERSAL/g) || []).length === 4;
  assert(allParsed && roundTrip && rejOk, 'P1 URI parse + build',
    `round-trip exact; scope roots, nested paths parse; all 4 hostile inputs rejected with codes`,
    `parsed=${allParsed} roundTrip=${built} rejects=${rejects.join('; ')}`);
}

function probeP2(vfs) {
  section('P2 — Write a tree (5 files, L0+L1+L2) + show the tree');
  const files = [
    ['viking://resources/test/overview.md', '# Test area\n\nThis area holds the probe fixtures for tiered loading demos.',
      'Fixture area for the viking probe.', 'Holds five fixture documents used by the phase-17(E) probe to exercise tiers, sidecars, and search.'],
    ['viking://resources/test/gateway.md', [
      '# Gateway service',
      '',
      'The Gateway service rate-limits public traffic.',
      '',
      'Per-client rate limit is 120 requests per minute; bursts are queued, never dropped.',
      '',
      '## Deployment',
      '',
      'The Gateway runs as three replicas behind the edge proxy. Each replica keeps a',
      'local token bucket; counters reconcile over the gossip bus every second. A replica',
      'that misses two reconciliations is drained and removed from the rotation.',
      '',
      '## Configuration',
      '',
      'Configuration ships as a versioned document. Every change is staged in a canary',
      'first: one percent of traffic for fifteen minutes, then a full ramp if the error',
      'budget holds. Operators can pin a version per namespace when a rollback is needed.',
      '',
      '## Failure history',
      '',
      'The worst incident was a clock skew of four hundred milliseconds that widened the',
      'bucket window and let bursts through for eleven minutes. Since then every replica',
      'cross-checks its clock against the edge proxy and refuses to serve when skewed.',
    ].join('\n'),
      'The Gateway service rate-limits public traffic.',
      'Per-client rate limit is 120 requests per minute; bursts are queued, never dropped. Deployment runs three replicas with gossip-reconciled token buckets, canary-staged config changes, and clock-skew self-checks.'],
    ['viking://resources/test/retries.md', '# Retry policy\n\nWhen the retry budget is exhausted the client receives 429 with a Retry-After header of 60 seconds.',
      undefined, undefined],
    ['viking://resources/test/namespaces.md', '# Namespaces\n\nEvery namespace maps to one mission; cross-mission reads are refused by the kernel.',
      'Namespaces are per-mission.', 'Namespace isolation maps every namespace to exactly one mission; the kernel refuses cross-mission reads.'],
    ['viking://resources/test/limits.md', '# Limits table\n\nDefault limits: 120 rpm per client, 8 concurrent connections, 10 MB payload.',
      'The default limits table.', 'Defaults: 120 requests per minute per client, 8 concurrent connections, 10 MB maximum payload.'],
  ];
  for (const [uri, content, l0, l1] of files) {
    const r = vfs.write(uri, content, { l0, l1 });
    console.log(`    write(${uri})  bytes=${r.bytes}  sidecars L0=${r.sidecars.L0 === 'explicit' ? 'explicit' : 'auto'} L1=${r.sidecars.L1 === 'explicit' ? 'explicit' : 'auto'}`);
  }
  const tree = vfs.tree('viking://resources/test');
  console.log('    tree:');
  for (const c of tree.children) console.log(`      ${c.name.padEnd(16)} ${c.type}  L0: ${c.l0}`);
  const side = JSON.parse(fs.readFileSync(path.join(STORE, 'resources/test/.viking/meta.json'), 'utf8'));
  const nExplicit = Object.values(side.entries).filter((e) => e.l0By !== AUTO_LABEL).length;
  const nAuto = Object.keys(side.entries).length - nExplicit;
  console.log(`    sidecar entries: ${Object.keys(side.entries).length} (${nExplicit} explicit sidecars, ${nAuto} auto-labeled)`);
  assert(tree.children.length === 5 && tree.children.every((c) => c.l0) && Object.keys(side.entries).length === 5,
    'P2 tree written with L0/L1/L2',
    `5 files under viking://resources/test/, all with L2 content + L0/L1 sidecars (${nExplicit} explicit, ${nAuto} auto-labeled)`,
    `children=${tree.children.length} withL0=${tree.children.filter((c) => c.l0).length}`);
}

function probeP3(vfs) {
  section('P3 — ls with L0 sidecars');
  const entries = vfs.ls('viking://resources/test');
  for (const e of entries) console.log(`    ${e.name.padEnd(16)} ${e.type.padEnd(4)} l0="${e.l0}"`);
  const all = entries.length === 5 && entries.every((e) => e.hasL0 && typeof e.l0 === 'string' && e.l0.length > 10);
  assert(all, 'P3 ls carries L0 per entry', `5/5 entries expose an L0 one-liner straight from the directory sidecar (no L2 opened)`,
    `entries=${entries.length} withL0=${entries.filter((e) => e.hasL0).length}`);
}

function probeP4(vfs) {
  section('P4 — Read L0 only');
  const r = vfs.read('viking://resources/test/gateway.md', { tier: 'L0' });
  console.log(`    read(gateway.md, L0) → "${r.content}"`);
  console.log(`    tier=${r.tier} tokens=${r.tokens} by=${r.by}`);
  assert(r.tier === 'L0' && r.tokens <= 40 && typeof r.by === 'string' && /explicit|auto/.test(r.by), 'P4 L0 read',
    `one sentence, ${r.tokens} tokens, provenance labeled (${r.by.slice(0, 30)}…)`, `tier=${r.tier} tokens=${r.tokens} by=${r.by}`);
}

function probeP5(vfs) {
  section('P5 — Read L2 on demand');
  const r = vfs.read('viking://resources/test/gateway.md', { tier: 'L2' });
  console.log(`    read(gateway.md, L2) → ${JSON.stringify(r.content.slice(0, 80))}…`);
  console.log(`    tier=${r.tier} tokens=${r.tokens} bytes=${Buffer.byteLength(r.content)}`);
  assert(r.tier === 'L2' && r.content.includes('rate-limits') && r.tokens > 20, 'P5 L2 read',
    `full content (${r.tokens} tokens) — the only tier that touches the file body`,
    `tier=${r.tier} tokens=${r.tokens}`);
}

async function probeP6(vfs) {
  section('P6 — Automatic tier selection (layers.load)');
  const loader = createLoader(vfs);
  const qs = [
    ['viking://resources/test/gateway.md', 'What does the Gateway service do?', 'expect L0 (sidecar sentence carries both keywords)'],
    ['viking://resources/test/gateway.md', 'What is the per-client rate limit for bursts?', 'expect L1 (details live in the overview paragraph)'],
    ['viking://resources/test', 'What happens when the retry budget is exhausted?', 'expect L2 (only the retries doc holds it)'],
  ];
  const out = [];
  for (const [uri, q, note] of qs) {
    const r = await loader.load(uri, q);
    console.log(`    Q: "${q}" @ ${uri}   (${note})`);
    out.push(r);
    console.log(`      → tier=${r.tier} tokens=${r.tokens} tokensUsed=${r.tokensUsed} keywords=[${r.keywords.join(',')}]`);
    console.log(`        ladder: ${r.ladder.map((l) => `${l.tier}:${l.answered ? 'answered' : `no (${(l.missing || []).slice(0, 3).join(',')} missing)`}:${l.tokens}t`).join(' → ')}`);
  }
  const tiers = out.map((r) => r.tier);
  assert(tiers[0] === 'L0' && tiers[1] === 'L1' && tiers[2] === 'L2', 'P6 tier ladder picks correctly',
    `L0-question→L0 (${out[0].tokensUsed}t), L1-question→L1 (${out[1].tokensUsed}t), L2-question→L2 (${out[2].tokensUsed}t); judge labeled: ${out[0].judge}`,
    `tiers=${tiers.join(',')}`);
  return out;
}

function probeP7(vfs, loads) {
  section('P7 — Token reduction: raw read vs tier loading');
  const raw = vfs.read('viking://resources/test/gateway.md', { tier: 'L2' });
  // The L1 answer to the burst question, had we read raw: full file. Compare.
  const tiered = loads[1];
  const rawCost = raw.tokens, tierCost = tiered.tokensUsed;
  const ratio = rawCost / tierCost;
  console.log(`    question: "What rate limit applies to bursts?"`);
  console.log(`    raw L2 read of gateway.md:      ${rawCost} tokens (whole file)`);
  console.log(`    viking tiered load (L0→L1):     ${tierCost} tokens (L0 ${tiered.ladder[0].tokens}t + L1 ${tiered.ladder[1].tokens}t)`);
  console.log(`    ratio: ${rawCost}/${tierCost} = ${ratio.toFixed(1)}× fewer tokens for the same answer`);
  assert(tierCost < rawCost && ratio > 1.5, 'P7 real token reduction',
    `${ratio.toFixed(1)}× reduction answering from L0+L1 sidecars instead of the raw file`,
    `raw=${rawCost} tiered=${tierCost} ratio=${ratio.toFixed(2)}`);
}

function probeP8(vfs) {
  section('P8 — Session pipeline (synthetic session, labeled)');
  const r = captureSession(vfs, {
    sessionId: 'synth-2026-09-19-a',
    label: 'synthetic session (no live agent session available in this sandbox)',
    turns: [
      { role: 'user', text: 'Draft the rollout plan for the tiered context loader.' },
      { role: 'assistant', text: 'Plan: ship L0 sidecars first, then layer loading behind a flag, then compile pipelines. Rollout in three stages with a rollback tag per stage.' },
      { role: 'user', text: 'What about migration of old transcripts?' },
      { role: 'assistant', text: 'Old transcripts import as session digests via toSessionMemory — one episodic memory per session, confidence 0.6 default.' },
    ],
    decisions: ['Ship L0 sidecars before enabling layer loading', 'Gate tiered loading behind a feature flag for one release'],
  });
  console.log(`    captured ${r.written} files under ${r.root} (label: ${r.label})`);
  console.log(`    L0: "${r.l0}"`);
  console.log(`    L1: ${JSON.stringify(r.l1)}`);
  const listing = vfs.ls('viking://session');
  console.log(`    ls("viking://session") → ${listing.map((e) => `${e.name}(${e.type})`).join(', ')}`);
  console.log(`    session dir L0: "${listing[0].l0}"`);
  const sum = vfs.read(r.uris.summary, { tier: 'L2' });
  const turnsL0 = vfs.read(r.uris.turns, { tier: 'L0' });
  console.log(`    summary.md L2 tokens=${sum.tokens}; turns.md L0="${turnsL0.content}"`);
  const digest = toSessionMemory(vfs);
  console.log(`    toSessionMemory → ${digest.length} MemoryEntry-shaped digest(s): ${JSON.stringify(digest.map((d) => d.id))}`);
  const ok = r.written === 3 && listing.length === 1 && listing[0].hasL0 && sum.content.includes('synthetic session') && digest.length === 1;
  assert(ok, 'P8 session capture (synthetic, labeled)',
    `3 files under viking://session/synth-2026-09-19-a with explicit L0+L1; provenance label stored in summary; memory digest produced`,
    `written=${r.written} listing=${listing.length} labelInSummary=${sum.content.includes('synthetic session')}`);
}

function probeP9(vfs) {
  section('P9 — compile.run (wiki + knowledge-graph + report)');
  vfs.write('viking://resources/probe-source.md', [
    '# Vulcan rollout notes',
    '',
    'Kai Mensah decided to adopt `viking-context` for the Project Vulcan agent.',
    'The loader depends on `L0-sidecars` and deterministic token estimates.',
    '',
    '## Storage',
    '',
    'Sidecar files live in `.viking` directories beside the content.',
    '',
    '## Rollout',
    '',
    'Dana Whitfield gates the rollout behind a feature flag and monitors token spend.',
  ].join('\n'), { l0: 'Rollout notes for the Vulcan context loader.' });
  const r = compile.run({
    source: 'viking://resources/probe-source.md',
    target: 'all',
    fs: vfs,
    dest: 'viking://resources/compiled',
  });
  console.log('    ── wiki (first 12 lines) ──');
  console.log(r.artifacts.wiki.split('\n').slice(0, 12).map((l) => `    │ ${l}`).join('\n'));
  console.log('    ── knowledge-graph ──');
  console.log(`      extractor: ${r.artifacts.knowledgeGraph.extractor}`);
  console.log(`      entities (${r.artifacts.knowledgeGraph.entities.length}): ${r.artifacts.knowledgeGraph.entities.map((e) => `${e.name}[${e.type}]`).join(', ')}`);
  console.log(`      relations: ${r.artifacts.knowledgeGraph.relations.map((x) => `${x.from} --${x.type}--> ${x.to}`).join('; ')}`);
  console.log('    ── report ──');
  console.log(r.artifacts.report.split('\n').map((l) => `    │ ${l}`).join('\n'));
  const writtenTo = ['wiki.md', 'knowledge-graph.json', 'report.md'].map((n) => vfs.stat(`viking://resources/compiled/${n}`));
  console.log(`    persisted: ${writtenTo.map((s) => `${s.uri.split('/').pop()}(${s.tiers.join('+')})`).join(', ')}`);
  const ok = r.artifacts.wiki.includes('## Contents') && r.artifacts.knowledgeGraph.entities.length >= 3
    && r.artifacts.report.includes('Summary of findings') && writtenTo.every((s) => s.tiers.includes('L0') && s.tiers.includes('L1') && s.tiers.includes('L2'));
  assert(ok, 'P9 compile → three artifacts, persisted with sidecars',
    `wiki structured markdown; KG ${r.artifacts.knowledgeGraph.entities.length} entities / ${r.artifacts.knowledgeGraph.relations.length} relations (rule-based — LLM extraction NOT VERIFIED); report narrative; all three written to viking://resources/compiled/ with L0+L1+L2`,
    `wiki=${r.artifacts.wiki.includes('## Contents')} kg=${r.artifacts.knowledgeGraph.entities.length} report=${r.artifacts.report.includes('Summary of findings')}`);
}

function probeP10() {
  section('P10 — Persistence across process (real child process)');
  const child = execFileSync(process.execPath, ['-e', `
    const { VikingFs } = await import('${ROOT}/context/viking/filesystem.js');
    const vfs = new VikingFs({ root: '${STORE}' });
    const l2 = vfs.read('viking://resources/test/gateway.md', { tier: 'L2' });
    const l0 = vfs.read('viking://resources/test/gateway.md', { tier: 'L0' });
    const stat = vfs.stat('viking://resources/test');
    console.log(JSON.stringify({ l2: l2.content, l0: l0.content, type: stat.type, files: stat.tiers }));
  `], { encoding: 'utf8' });
  const out = JSON.parse(child.trim().split('\n').pop());
  console.log(`    fresh process read viking://resources/test/gateway.md:`);
  console.log(`      L0: "${out.l0}"`);
  console.log(`      L2: ${JSON.stringify(out.l2.slice(0, 60))}…`);
  console.log(`      stat(viking://resources/test): type=${out.type} tiers=${JSON.stringify(out.files)}`);
  assert(out.l0 && out.l2.includes('rate-limits') && out.type === 'dir', 'P10 persistence across process',
    `a NEW process re-opened the same store and read L0+L2 intact (plain files on disk; no in-memory state)`,
    `l0=${out.l0} l2ok=${out.l2 && out.l2.includes('rate-limits')}`);
}

function probeP11() {
  section('P11 — Integration point (server/src/context/**)');
  console.log('    $ grep -n "registerSource\\|produce" server/src/context/sources/index.js | head -4');
  console.log(execFileSync('grep', ['-n', 'registerSource\\|produce', 'server/src/context/sources/index.js'], { encoding: 'utf8' })
    .split('\n').slice(0, 4).map((l) => `      ${l}`).join('\n'));
  console.log('    $ grep -n "build(" server/src/routes/context.js | head -2');
  console.log(execFileSync('grep', ['-n', 'await build(', 'server/src/routes/context.js'], { encoding: 'utf8' })
    .split('\n').map((l) => `      ${l}`).join('\n').trimEnd());
  console.log('    $ grep -rn "readFile" server/src/context/ --include=*.js | wc -l');
  const zero = execFileSync('bash', ['-c', "grep -rn 'readFile' server/src/context/ --include=*.js | wc -l"], { encoding: 'utf8' }).trim();
  console.log(`      ${zero}   ← the context builder itself does NO raw file reads`);
  console.log('    HOW VIKING REPLACES RAW READS:');
  console.log('      today: producers return whole documents; the budget allocator clips them.');
  console.log('      with viking: a producer calls vfs.read(uri, {tier}) / loader.load(uri, q)');
  console.log('      and hands the builder L0/L1 content sized to the token budget — details');
  console.log('      (L2) are fetched only when a later step explicitly needs them.');
  console.log('    ZONE-OWNER TASK (not actioned): register a "viking" context source in');
  console.log('      server/src/context/sources/index.js:17 (registerSource contract) and/or');
  console.log('      convert upstream raw reads (server/src/services/AgentInstructions.js:50)');
  console.log('      to tiered viking reads. Both require touching server/src/** .');
  assert(zero === '0', 'P11 integration point cited (wiring NOT done — zone-owner task)',
    'registerSource contract (sources/index.js:17-26) + build() call site (routes/context.js:52) cited; zero raw file reads inside server/src/context; conversion recorded as zone-owner task',
    `readFile hits inside server/src/context: ${zero}`);
}

function probeP12() {
  section('P12 — No leakage to other zones');
  console.log('    $ grep -rn "context/viking" server/src --include=*.js | wc -l');
  const leaks = execFileSync('bash', ['-c', "grep -rn 'context/viking' server/src --include=*.js | wc -l"], { encoding: 'utf8' }).trim();
  console.log(`      ${leaks}`);
  console.log('    $ grep -rln "viking" server/src --include=*.js | wc -l');
  const leaks2 = execFileSync('bash', ['-c', "grep -rln 'viking' server/src --include=*.js | wc -l"], { encoding: 'utf8' }).trim();
  console.log(`      ${leaks2}`);
  console.log(`    commit files (this scope): context/viking/** + scripts/phase17-e-probe.mjs only`);
  assert(leaks === '0' && leaks2 === '0', 'P12 zero leakage',
    `grep proves zero references to viking anywhere under server/src/** (zone respected)`,
    `leaks=${leaks}/${leaks2}`);
}

/* ──────────────────────────────── main ────────────────────────────── */

async function main() {
  console.log('PHASE 17 — SCOPE E PROBE — context filesystem (viking://)');
  console.log(`node ${process.version}; store (real files): ${STORE}`);
  console.log('labels: auto sidecars + judges + organizers are deterministic — LLM summarization');
  console.log('        / relevance judgment / extraction NOT VERIFIED (no LLM key in sandbox).');

  const vfs = freshFs();
  probeP1();
  probeP2(vfs);
  probeP3(vfs);
  probeP4(vfs);
  probeP5(vfs);
  const loads = await probeP6(vfs);
  probeP7(vfs, loads);
  probeP8(vfs);
  probeP9(vfs);
  probeP10();
  probeP11();
  probeP12();

  const nPass = RESULTS.filter((r) => r.ok).length;
  const nFail = RESULTS.filter((r) => !r.ok).length;
  console.log(`\n══ SUMMARY: ${nPass} pass / ${nFail} fail ══`);
  console.log('verdict: real files, real tiers, real token accounting; every non-LLM shortcut labeled.');
  process.exitCode = nFail > 0 ? 1 : 0;
}

main().catch((e) => { console.error('PROBE CRASH:', e); process.exitCode = 1; });
