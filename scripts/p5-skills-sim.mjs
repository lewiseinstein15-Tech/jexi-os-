#!/usr/bin/env node
/**
 * PHASE 5 P5-1 — SKILLS SIMULATION.
 *
 * "Ask a task requiring a known skill; assert the skill was invoked
 *  (raw tool log entry)."
 *
 * Path A (direct): POST /api/skills/library/invoke → skill resolved from the
 *                  1164-file library, body returned, invocation logged.
 * Path B (chat):   keyless chat turn "how do I set up pre-commit hooks with
 *                  husky?" → agentic lane → runDirectAnswer → library skill
 *                  dispatch → answer sourced from the library + log entry.
 * Both paths assert DATA_DIR/skills-log.jsonl contains the raw entries.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SERVER_DIR = path.join(ROOT, 'server');
const PORT = Number(process.env.JEXI_SK_SIM_PORT || 3046);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitHealthy(base, tries = 90) {
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(`${base}/api/health`); if (r.ok) return true; } catch { /* not up */ }
    await wait(1000);
  }
  return false;
}

function readLog(dataDir) {
  const p = path.join(dataDir, 'skills-log.jsonl');
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
}

async function main() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jexi-p51-'));
  const env = { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', DATA_DIR: dataDir, JEXI_MCP_MINIMAL: '1', NODE_ENV: 'production' };
  const child = spawn(process.execPath, ['index.js'], { cwd: SERVER_DIR, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let bootLog = '';
  child.stdout.on('data', (d) => { bootLog += d.toString(); });
  child.stderr.on('data', (d) => { bootLog += d.toString(); });
  const base = `http://127.0.0.1:${PORT}`;
  let pass = 0, total = 0;
  try {
    const up = await waitHealthy(base);
    if (!up) { console.log(`[BOOT FAIL] tail:\n${bootLog.split('\n').slice(-20).join('\n')}`); process.exit(1); }
    const libLine = bootLog.split('\n').find((l) => l.includes('[Skills] library index:'));
    console.log(`[BOOT] ${libLine ? libLine.trim() : 'NO LIBRARY LINE'}`);

    // ── Path A: direct invocation API ──────────────────────────────────
    total++;
    const res = await fetch(`${base}/api/skills/library/invoke`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: 'setup pre-commit hooks with husky and lint-staged', args: {} }),
    });
    const data = await res.json();
    const entryA = readLog(dataDir).find((e) => e.slug === 'setup-pre-commit');
    const okA = res.ok && data.success && data.slug === 'setup-pre-commit' && data.mode === 'reference' && typeof data.body === 'string' && data.body.length > 100 && Boolean(entryA);
    if (okA) pass++;
    console.log(`[${okA ? 'PASS' : 'FAIL'}] P5-1/A direct invoke → slug=${data.slug} mode=${data.mode} bodyLen=${(data.body || '').length}`);
    console.log(`   raw log entry: ${entryA ? JSON.stringify(entryA) : 'MISSING'}`);

    // ── Path B: chat turn routed through the agentic lane ──────────────
    total++;
    const chatRes = await fetch(`${base}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-jexi-session': `p51-${Date.now()}` },
      body: JSON.stringify({ query: 'how do I set up pre-commit hooks with husky' }),
    });
    const text = await chatRes.text();
    let answer = '';
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      let ev; try { ev = JSON.parse(line); } catch { continue; }
      if (ev.type === 'done' && ev.summary) answer = ev.summary;
    }
    const slugInAnswer = /setup-pre-commit/.test(answer);
    const entryB = readLog(dataDir).find((e) => e.slug === 'setup-pre-commit' && e.query.includes('husky'));
    const okB = slugInAnswer && Boolean(entryB);
    if (okB) pass++;
    console.log(`[${okB ? 'PASS' : 'FAIL'}] P5-1/B chat turn → answer from library: ${slugInAnswer}; log entry: ${Boolean(entryB)}`);
    console.log(`   answer head: ${JSON.stringify(answer.slice(0, 120))}`);
    console.log(`   raw log entry: ${entryB ? JSON.stringify(entryB) : 'MISSING'}`);
  } finally {
    try { child.kill('SIGTERM'); } catch { /* gone */ }
    await wait(500);
    try { child.kill('SIGKILL'); } catch { /* gone */ }
    try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
  console.log(`P5-1 SKILLS SIM: ${pass}/${total} PASS`);
  process.exit(pass === total ? 0 : 1);
}

await main();
