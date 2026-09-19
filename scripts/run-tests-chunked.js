#!/usr/bin/env node
/**
 * Chunked regression runner (JEXI OS Phase 8 standard).
 *
 * The full `npm test` chain is 210 shell commands; the sandbox reaps
 * long-lived processes, so the chain is split into chunks and each command
 * runs in its own short-lived `node` process. State is persisted per
 * command — a killed run resumes where it stopped.
 *
 *   node scripts/run-tests-chunked.js                 # run all (4 chunks)
 *   node scripts/run-tests-chunked.js --chunk=2       # one chunk only
 *   node scripts/run-tests-chunked.js --status        # report + tally only
 *
 * Exit 0 iff every command passed. Raw per-command results printed.
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPTS = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(SCRIPTS, '..');
const SERVER = path.join(REPO, 'server');
const STATE_FILE = path.join(SCRIPTS, '.chunked-state.json');

const testScript = JSON.parse(fs.readFileSync(path.join(SERVER, 'package.json'), 'utf8')).scripts.test;
const COMMANDS = testScript.split(' && ').map((c) => c.trim());

const CHUNKS = 4;
const arg = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v === undefined ? true : v]; }));

const state = fs.existsSync(STATE_FILE) ? JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) : { results: {} };
const save = () => fs.writeFileSync(STATE_FILE, JSON.stringify(state));

function runCommand(cmd) {
  const t0 = Date.now();
  const r = spawnSync('node', ['-e', `
    const { spawn } = require('node:child_process');
    const parts = process.argv[1].split(' ');
    const child = spawn(parts[0] === 'node' ? process.execPath : parts[0], parts.slice(parts[0] === 'node' ? 1 : 0), { cwd: ${JSON.stringify(SERVER)}, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    child.stdout.on('data', (d) => { out += d; if (out.length > 40000) out = out.slice(-20000); });
    child.stderr.on('data', (d) => { err += d; if (err.length > 40000) err = err.slice(-20000); });
    child.on('close', (code) => process.stdout.write(JSON.stringify({ code, out: out.slice(-2000), err: err.slice(-2000) })));
  `, cmd], { encoding: 'utf8', timeout: 240000, maxBuffer: 32 * 1024 * 1024 });
  let parsed = { code: r.status === null ? 124 : r.status, out: '', err: String(r.stderr || '').slice(-2000) };
  try { parsed = JSON.parse(String(r.stdout).trim().split('\n').pop()); } catch { /* keep fallback */ }
  if (parsed.code === null || parsed.code === undefined) parsed.code = 124;
  return { ...parsed, ms: Date.now() - t0 };
}

if (arg.status) {
  let pass = 0, fail = 0, pending = 0;
  COMMANDS.forEach((cmd, i) => {
    const r = state.results[i];
    if (!r) { pending += 1; return; }
    if (r.code === 0) pass += 1; else fail += 1;
  });
  console.log(JSON.stringify({ total: COMMANDS.length, pass, fail, pending }));
  process.exit(fail ? 1 : 0);
}

const perChunk = Math.ceil(COMMANDS.length / CHUNKS);
const chunkWanted = arg.chunk ? Number(arg.chunk) : null;
let pass = 0, failCount = 0;
const failures = [];

for (let chunk = 1; chunk <= CHUNKS; chunk += 1) {
  if (chunkWanted && chunk !== chunkWanted) continue;
  const slice = COMMANDS.slice((chunk - 1) * perChunk, chunk * perChunk);
  console.log(`\n===== CHUNK ${chunk}/${CHUNKS} — ${slice.length} command(s) =====`);
  for (let i = 0; i < slice.length; i += 1) {
    const idx = (chunk - 1) * perChunk + i;
    const cmd = slice[i];
    if (state.results[idx] && state.results[idx].code === 0) {
      pass += 1;
      console.log(`PASS [${idx + 1}/${COMMANDS.length}] (cached) ${cmd}`);
      continue;
    }
    const r = runCommand(cmd);
    state.results[idx] = { code: r.code, ms: r.ms };
    save();
    if (r.code === 0) {
      pass += 1;
      console.log(`PASS [${idx + 1}/${COMMANDS.length}] (${r.ms}ms) ${cmd}`);
    } else {
      failCount += 1;
      failures.push({ idx: idx + 1, cmd, code: r.code, err: r.err });
      console.log(`FAIL [${idx + 1}/${COMMANDS.length}] (exit ${r.code}, ${r.ms}ms) ${cmd}`);
      if (r.err) console.log(`  stderr tail: ${r.err.split('\n').slice(-6).join(' | ')}`);
    }
  }
}

console.log(`\n===== TALLY =====`);
console.log(`pass: ${pass}  fail: ${failCount}  total: ${COMMANDS.length}`);
if (failures.length) {
  console.log('FAILURES:');
  for (const f of failures) console.log(`  [${f.idx}] exit ${f.code} — ${f.cmd}`);
}
process.exit(failCount ? 1 : 0);
