#!/usr/bin/env node
/**
 * JEXI OS — PHASE 31 SCOPE 16.5 — live probe (P1 memory repro, P2 SQLite control).
 *
 * P1  memory store repro (JobStore memory fallback — Node without unflagged node:sqlite):
 *      listJobs().cron == "0 3 * * *"
 *      getJob().cron  == "0 3 * * *"      (was undefined pre-fix)
 *      saveJob(getJob()); listJobs().cron still "0 3 * * *"
 *      stored action is a string (once-encoded JSON), not a JSON-encoded string
 * P2  SQLite store control: identical behaviour when node:sqlite is available
 *     (run with NODE_OPTIONS=--experimental-sqlite on Node 22.5–22.12).
 *
 * Read-only against the repo (no writes outside process memory). Zero dependencies.
 */
import { JobStore } from '../server/src/scheduler/queue/store.js';

const ORIG_ACTION = { type: 'handler', name: 'brain-cycle', payload: { dryRun: false } };
const FAILS = [];
let n = 0;
function check(id, ok, detail) {
  n += 1;
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${id} — ${detail}`);
  if (!ok) FAILS.push(`${id}: ${detail}`);
}

function seedJob() {
  return {
    id: 'w31-brain-cycle',
    name: 'w31 brain dream cycle',
    kind: 'cron',
    lane: 'memory',
    priority: 0,
    enabled: true,
    cron: '0 3 * * *',
    event: null,
    condition: null,
    intervalSeconds: null,
    action: ORIG_ACTION,
    lastRunAt: null,
    lastStatus: null,
    runCount: 0,
    nextRunAt: new Date('2026-09-23T03:00:00Z').getTime(),
    createdAt: 1758000000000,
  };
}

const storedActionOf = {
  memory: (store) => store._mem.jobs.get('w31-brain-cycle').action,
  sqlite: (store) => store.db.prepare('SELECT action FROM jobs WHERE id = ?').get('w31-brain-cycle').action,
};

function suite(label, store, rawAction) {
  console.log(`\n== ${label} ==`);
  store.saveJob(seedJob());

  const l1 = store.listJobs()[0];
  check(`${label}.P1a.listJobs.cron`, !!l1 && l1.cron === '0 3 * * *',
    `listJobs()[0].cron == ${JSON.stringify(l1 && l1.cron)}`);

  const g1 = store.getJob('w31-brain-cycle');
  check(`${label}.P1b.getJob.cron`, !!g1 && g1.cron === '0 3 * * *',
    `getJob().cron == ${JSON.stringify(g1 && g1.cron)}   (pre-fix: undefined — raw un-hydrated row)`);

  store.saveJob(g1);
  const l2 = store.listJobs()[0];
  check(`${label}.P1c.resave.cron`, !!l2 && l2.cron === '0 3 * * *',
    `saveJob(getJob()) then listJobs()[0].cron == ${JSON.stringify(l2 && l2.cron)}   (pre-fix: null — spec clobbered)`);

  const raw = rawAction(store);
  let decoded = '<unparseable>';
  try { decoded = JSON.parse(raw); } catch { /* keep marker */ }
  check(`${label}.P1d.action-encoding`, typeof raw === 'string' && typeof decoded === 'object' && decoded !== null
    && JSON.stringify(decoded) === JSON.stringify(ORIG_ACTION),
    `stored action is ${typeof raw} (once-encoded JSON), not a JSON-encoded string; decodes to ${typeof decoded} ${JSON.stringify(decoded)}`);

  const g2 = store.getJob('w31-brain-cycle');
  console.log(`  evidence: getJob().action typeof=${typeof g2.action} value=${JSON.stringify(g2.action)}`);
  console.log(`  evidence: getJob().enabled=${JSON.stringify(g2.enabled)} nextRunAt=${JSON.stringify(g2.nextRunAt)} cron=${JSON.stringify(g2.cron)}`);
  store.close();
}

console.log(`node ${process.version}`);
console.log(`P1 memory store repro — JobStore({ memory: true })`);
suite('P1-memory', new JobStore({ memory: true }), storedActionOf.memory);

const sqliteStore = new JobStore({ file: ':memory:' });
if (sqliteStore.available) {
  suite('P2-sqlite', sqliteStore, storedActionOf.sqlite);
} else {
  console.log(`\n== P2-sqlite ==`);
  console.log(`[SKIP] P2 — node:sqlite unavailable on ${process.version} (ERR_UNKNOWN_BUILTIN_MODULE / flag missing): SQLite control needs NODE_OPTIONS=--experimental-sqlite on Node 22.5–22.12 or Node >= 22.13`);
  sqliteStore.close();
}

console.log(`\n== SUMMARY: ${n - FAILS.length}/${n} checks pass ==`);
if (FAILS.length) { console.log('FAILURES:'); for (const f of FAILS) console.log(`  - ${f}`); }
process.exit(FAILS.length ? 1 : 0);
