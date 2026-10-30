#!/usr/bin/env node
/**
 * M8 — AGGREGATE TEST RUNNER.
 *
 * Runs every suite in `suites.json` (the exact ordered list the former
 * package.json `test` chain contained) with the hermetic preload installed, so
 * the whole aggregate is deterministic and offline:
 *
 *   - the preload refuses any non-loopback dial at the transport level and
 *     marks the process as a test process (see hermetic-preload.mjs);
 *   - every child gets the preload via an ABSOLUTE `--import` path, so it also
 *     covers grandchildren spawned with a different cwd;
 *   - each suite has a wall-clock timeout and its process group is killed on
 *     expiry, so one leaked language-server child can never hang the run;
 *   - the exit code is nonzero if ANY suite failed or timed out.
 *
 * Usage (from server/):
 *   node tests/setup/run-suites.mjs               run everything
 *   node tests/setup/run-suites.mjs --filter mcp  run suites whose argv matches
 *   node tests/setup/run-suites.mjs --list        print the suite count
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = path.resolve(HERE, '../..');
const PRELOAD = path.join(HERE, 'hermetic-preload.mjs');
const MANIFEST = path.join(HERE, 'suites.json');

const args = process.argv.slice(2);
const filter = args.includes('--filter') ? args[args.indexOf('--filter') + 1] : null;
const listOnly = args.includes('--list');
const timeoutArg = args.find((a) => a.startsWith('--timeout='));
const SUITE_TIMEOUT_MS = timeoutArg ? Number(timeoutArg.split('=')[1]) : 300_000;

const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
let suites = manifest.suites;
if (filter) suites = suites.filter((s) => s.args.join(' ').includes(filter));

if (listOnly) {
  console.log(`${suites.length} suites${filter ? ` matching "${filter}"` : ''}`);
  process.exit(0);
}

/** Child environment: hermetic preload first, then any inherited NODE_OPTIONS. */
function childEnv() {
  const inherited = process.env.NODE_OPTIONS ? ` ${process.env.NODE_OPTIONS}` : '';
  return {
    ...process.env,
    NODE_OPTIONS: `--import=${PRELOAD}${inherited}`,
    DOTENV_CONFIG_QUIET: 'true',
  };
}

/** Run one suite; resolve { code, signal, timedOut, ms }. */
function runSuite(suite) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(suite.bin, suite.args, {
      cwd: SERVER_ROOT,
      env: childEnv(),
      stdio: 'inherit',
      // Own process group so a timeout kills leaked language-server trees too.
      detached: process.platform !== 'win32',
    });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child);
    }, SUITE_TIMEOUT_MS);
    const done = (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, timedOut, ms: Date.now() - started });
    };
    child.on('exit', done);
    child.on('error', () => done(null, null));
  });
}

function killTree(child) {
  try {
    if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGKILL');
    else child.kill('SIGKILL');
  } catch { /* already gone */ }
}

const failures = [];
const label = (s) => s.args.join(' ');
console.log(`Running ${suites.length} suites (hermetic; timeout ${SUITE_TIMEOUT_MS}ms each)\n`);

for (const [i, suite] of suites.entries()) {
  const tag = `[${i + 1}/${suites.length}] ${label(suite)}`;
  process.stdout.write(`\n===== ${tag} =====\n`);
  const res = await runSuite(suite);
  const ok = !res.timedOut && res.code === 0;
  if (!ok) {
    failures.push({ suite: label(suite), ...res });
    console.log(`\n❌ ${tag} — ${res.timedOut ? `TIMEOUT after ${res.ms}ms` : `exit ${res.code}${res.signal ? ` (${res.signal})` : ''}`}`);
  }
}

console.log('\n============================ SUMMARY ============================');
console.log(`suites: ${suites.length}   passed: ${suites.length - failures.length}   failed: ${failures.length}`);
for (const f of failures) {
  console.log(`  ❌ ${f.suite} — ${f.timedOut ? 'TIMEOUT' : `exit ${f.code}`} (${f.ms}ms)`);
}
console.log('=================================================================');
process.exit(failures.length ? 1 : 0);
