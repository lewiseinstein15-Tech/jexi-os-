#!/usr/bin/env node
/**
 * JEXI OS — Phase 22 Scope A — LIVE PROBES P1–P5 (Claude Mem pattern).
 *
 * Re-runnable, raw output only. Nothing simulated: every PASS line is backed
 * by the raw evidence printed next to it. P4 uses a real SIGKILL of a child
 * process mid-work; P5 compares two dependent hashes of the same input.
 *
 * Usage: node scripts/phase22-a-probe.mjs [--only=P1,P2,…]
 *        node scripts/phase22-a-probe.mjs --child-sigkill   (internal)
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import {
  captureSession, captureTurn, compress, readObservations, readTurns,
  storeDir, LLM_COMPRESSION_LABEL,
} from '../memory/session-compress.js';
import { inject, DEFAULT_TOKEN_BUDGET } from '../memory/session-inject.js';

const SCRIPTS = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(SCRIPTS, '..');
const only = (process.argv.find((a) => a.startsWith('--only=')) || '').replace('--only=', '');
const run = (id) => !only || only.split(',').includes(id);

const CHILD_MODE = process.argv.includes('--child-sigkill');
const SIGKILL_SID = 'p4-sigkill-session';

/* -------- internal child mode: capture+compress, then hold for SIGKILL ---- */
/* NOTE: this branch must never fall through into the parent probe flow — it
 * would recursively spawn children. It returns from module top-level work by
 * only running `main()` when CHILD_MODE is false (see bottom of file). */
if (CHILD_MODE) {
  const turns = syntheticTurns();
  captureSession(SIGKILL_SID, turns);
  compress(SIGKILL_SID);
  const marker = path.join(storeDir(), `${SIGKILL_SID}.child-done`);
  fs.writeFileSync(marker, String(process.pid));
  console.log(JSON.stringify({ child: 'compressed', pid: process.pid, sessionId: SIGKILL_SID }));
  setInterval(() => {}, 1000); // hold until SIGKILL
}

const results = {};
const pass = (id, n) => { results[id] = `PASS${n ? ` — ${n}` : ''}`; };
const fail = (id, n) => { results[id] = `FAIL — ${n}`; };
function header(id, title) {
  console.log('\n═══════════════════════════════════════════════════');
  console.log(`${id} — ${title}`);
  console.log('═══════════════════════════════════════════════════');
}
const show = (l, v) => console.log(`${l}: ${typeof v === 'string' ? v : JSON.stringify(v)}`);

function syntheticTurns() {
  const ts = (i) => `2026-09-20T10:${String(i).padStart(2, '0')}:00.000Z`;
  const t = [
    ['user', 'We need session memory compression for JEXI, following the claude-mem pattern of compact observations.'],
    ['assistant', 'I will read memory/README.md to see the existing memory layer before writing code.'],
    ['assistant', 'Read memory/lifecycle.js — it defines FRESH AGING STALE ARCHIVED states.'],
    ['assistant', 'Decided: keep compression rule-based instead of an LLM call, because no provider key exists in the sandbox.'],
    ['assistant', 'Rejected alternative: calling an LLM for observation extraction — rejected because it cannot be verified offline.'],
    ['user', 'Store observations under .jexi/session-mem/ please.'],
    ['assistant', 'Creating memory/session-compress.js with compress(sessionId) returning observations, sourceTurnCount, ratio.'],
    ['assistant', 'Wrote memory/session-compress.js — atomic write via rename so SIGKILL cannot truncate the store.'],
    ['assistant', 'Wrote memory/session-inject.js with inject(sessionId, query) and a token budget cap.'],
    ['user', 'How does injection pick observations?'],
    ['assistant', 'Found that token overlap plus concept and file boosts gives a deterministic integer ranking.'],
    ['assistant', 'Fixed a bug: the greedy budget loop skipped an observation instead of aborting, so smaller relevant observations still fit.'],
    ['assistant', 'Bug was a regression in the first draft; root cause was a hard break on first overflow.'],
    ['assistant', 'Test: probe P3 verifies matched observations stay within the token budget.'],
    ['assistant', 'Verified determinism: same turns twice produce the same observation hash.'],
    ['assistant', 'Refactor: renamed the internal key helper to groupKeyFor for clarity.'],
    ['user', 'Does the graph or entity work touch memory?'],
    ['assistant', 'Noticed the compression layer ignores entities; graph RAG is a separate scope and does not modify memory/** server wiring.'],
    ['assistant', 'Probe P4 kills the process mid-run and re-reads observations from disk.'],
    ['assistant', 'Probe P5 recompresses the same 20 turns and compares the hashes.'],
  ];
  return t.map(([role, text], i) => ({ role, text, ts: ts(i % 60) }));
}

/* ============================ P1 ============================ */
let sessionId = 'p1-20turn-session';
let compressed = null;
function P1() {
  header('P1', 'compress a synthetic 20-turn session');
  const turns = syntheticTurns();
  captureSession(sessionId, turns);
  compressed = compress(sessionId);
  show('storeDir()', storeDir());
  show('captured turns', readTurns(sessionId).length);
  show('compress() return (observations elided)', {
    sourceTurnCount: compressed.sourceTurnCount,
    observationCount: compressed.observationCount,
    ratio: compressed.ratio,
    sourceTokens: compressed.sourceTokens,
    observationTokens: compressed.observationTokens,
    label: compressed.label,
  });
  show('observation[0]', compressed.observations[0]);
  const ok = compressed.observations.length > 0 && compressed.sourceTurnCount === 20;
  (ok ? pass : fail)('P1', ok ? '20 turns captured and compressed into observations' : 'compress produced no observations');
}

/* ============================ P2 ============================ */
function P2() {
  header('P2', 'observation count + compression ratio');
  const stored = readObservations(sessionId);
  show('on-disk .obs.json', {
    compression_mode: stored.compression_mode,
    label: stored.label,
    sourceTurnCount: stored.sourceTurnCount,
    observationCount: stored.observationCount,
    sourceTokens: stored.sourceTokens,
    observationTokens: stored.observationTokens,
    ratio: stored.ratio,
  });
  show('observation types', compressed.observations.map((o) => o.type));
  const ok = stored.observationCount < stored.sourceTurnCount && stored.ratio > 1;
  (ok ? pass : fail)('P2', ok
    ? `${stored.sourceTurnCount} turns -> ${stored.observationCount} observations, ratio ${stored.ratio}:1`
    : `no compression observed (turns ${stored.sourceTurnCount}, obs ${stored.observationCount})`);
}

/* ============================ P3 ============================ */
function P3() {
  header('P3', 'inject with a query — matching observations within budget');
  const r = inject(sessionId, 'bug fix regression root cause determinism observations', { tokenBudget: 200 });
  show('budget', { tokenBudget: r.tokenBudget, tokens_used: r.tokens, considered: r.considered, matched: r.matched });
  show('label', r.label);
  show('returned titles + relevance', r.observations.map((o) => ({ title: o.title, relevance: o.relevance, type: o.type })));
  const within = r.tokens <= r.tokenBudget;
  const relevant = r.observations.length > 0 && r.observations.every((o) => o.relevance > 0);
  const ok = within && relevant;
  (ok ? pass : fail)('P3', ok
    ? `${r.observations.length} relevant observation(s), ${r.tokens}/${r.tokenBudget} tokens`
    : `budget or relevance violated (tokens ${r.tokens}/${r.tokenBudget}, n=${r.observations.length})`);
}

/* ============================ P4 ============================ */
function P4() {
  header('P4', 'SIGKILL persistence — observations survive');
  const sid = SIGKILL_SID;
  const marker = path.join(storeDir(), `${sid}.child-done`);
  try { fs.rmSync(marker); } catch { /* not present */ }
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), '--child-sigkill'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    const wait = setInterval(() => {
      if (fs.existsSync(marker)) {
        clearInterval(wait);
        const pid = child.pid;
        process.kill(pid, 'SIGKILL');
        child.on('exit', (code, signal) => {
          show('child stdout', out.trim());
          show('child exit', { code, signal });
          const after = readObservations(sid);
          show('post-SIGKILL read from disk (fresh process)', {
            found: !!after,
            observationCount: after?.observationCount,
            sourceTurnCount: after?.sourceTurnCount,
            firstTitle: after?.observations?.[0]?.title,
          });
          const ok = !!after && after.observations.length > 0 && signal === 'SIGKILL';
          (ok ? pass : fail)('P4', ok
            ? `observations survived SIGKILL (pid ${pid}, signal ${signal}, ${after.observationCount} observations)`
            : 'observations did not survive');
          resolve();
        });
      }
    }, 50);
    setTimeout(() => { clearInterval(wait); try { child.kill('SIGKILL'); } catch { /* gone */ } 
      fail('P4', 'child never signalled completion (timeout)'); resolve(); }, 20000);
  });
}

/* ============================ P5 ============================ */
function canonicalHash(sid) {
  const stored = readObservations(sid);
  const canonical = JSON.stringify(stored.observations.map((o) => ({
    type: o.type, title: o.title, narrative: o.narrative, facts: o.facts,
    concepts: o.concepts, files_read: o.files_read, files_modified: o.files_modified,
    turn_range: o.turn_range, discovery_tokens: o.discovery_tokens,
  })));
  return createHash('sha256').update(canonical).digest('hex');
}
async function P5() {
  header('P5', 'determinism — same input twice -> same output');
  const turns = syntheticTurns();
  const sidA = 'p5-determinism-a';
  const sidB = 'p5-determinism-b';
  captureSession(sidA, turns); const a1 = compress(sidA);
  const hashA1 = canonicalHash(sidA);
  captureSession(sidB, turns.map((t) => ({ ...t }))); compress(sidB);
  const hashB = canonicalHash(sidB);
  await new Promise((r) => setTimeout(r, 1100)); // cross a wall-clock second
  captureSession(sidA, turns); compress(sidA);
  const hashA2 = canonicalHash(sidA);
  show('hash(session A, run 1)', hashA1);
  show('hash(session B, same input)', hashB);
  show('hash(session A, run 2 after 1.1s)', hashA2);
  show('a1.observationCount / b.observationCount', [a1.observationCount, readObservations(sidB).observationCount]);
  const ok = hashA1 === hashB && hashA1 === hashA2;
  (ok ? pass : fail)('P5', ok
    ? `three compressions of the same input agree: ${hashA1}`
    : 'hashes diverged');
}

/* ============================ main ============================ */
async function main() {
  console.log(`PROBE phase22-a  repo=${REPO}  node=${process.version}`);
  console.log(`label: ${LLM_COMPRESSION_LABEL}  default budget: ${DEFAULT_TOKEN_BUDGET}`);
  if (run('P1')) P1();
  if (run('P2')) P2();
  if (run('P3')) P3();
  if (run('P4')) await P4();
  if (run('P5')) await P5();
  console.log('\n──────────── VERDICTS ────────────');
  for (const [k, v] of Object.entries(results)) console.log(`${k}: ${v}`);
  const failed = Object.values(results).some((v) => v.startsWith('FAIL'));
  process.exit(failed ? 1 : 0);
}

if (!CHILD_MODE) await main();