#!/usr/bin/env node
/**
 * P10 GAP 2 — SKILLS EXECUTABLE STEPS — acceptance test.
 *
 * Spec: for each of the 10 converted skills, send a task that should trigger
 * it. Assert the skill ran (matched + mode 'steps'), the steps executed
 * (every step ok), and the result is the aggregate of REAL tool outputs.
 *
 * 10/10 PASS required. Exit 0 only when all pass.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SERVER_DIR = path.join(ROOT, 'server');
const PORT = Number(process.env.JEXI_P10G2_PORT || 3062);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const TASKS = [
  { slug: 'research', q: 'research the topic of federated learning systems' },
  { slug: 'diagnosing-bugs', q: 'diagnose this bug for me' },
  { slug: 'code-review', q: 'review the code in this branch for me' },
  { slug: 'handoff', q: 'prepare the handoff document for the next agent' },
  { slug: 'implement', q: 'implement the spec as agreed work' },
  { slug: 'triage', q: 'triage the incoming issue queue' },
  { slug: 'tdd', q: 'run the tdd cycle for the new feature test' },
  { slug: 'json-canvas', q: 'create a json canvas mind map for the design' },
  { slug: 'defuddle', q: 'use defuddle to extract clean markdown from the html page' },
  { slug: 'obsidian-markdown', q: 'write an obsidian markdown note about the meeting' },
];

async function main() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p10-gap2-'));
  const env = { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', DATA_DIR: dataDir, JEXI_MCP_MINIMAL: '1', NODE_ENV: 'production' };
  const child = spawn(process.execPath, ['index.js'], { cwd: SERVER_DIR, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let bootLog = '';
  child.stdout.on('data', (d) => { bootLog += d.toString(); });
  child.stderr.on('data', (d) => { bootLog += d.toString(); });
  const base = `http://127.0.0.1:${PORT}`;
  let pass = 0, total = 0;
  try {
    let up = false;
    for (let i = 0; i < 90; i++) { try { const r = await fetch(`${base}/api/health`); if (r.ok) { up = true; break; } } catch {} await wait(1000); }
    if (!up) { console.log(`[BOOT FAIL] tail:\n${bootLog.split('\n').slice(-20).join('\n')}`); process.exit(1); }

    const bootLine = bootLog.split('\n').find((l) => /\[Skills\] library index/.test(l));
    console.log(`[BOOT] ${bootLine ? bootLine.trim() : '(skills line not found)'}`);

    for (const t of TASKS) {
      total++;
      const res = await fetch(`${base}/api/skills/library/invoke`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: t.q }),
      });
      const r = await res.json().catch(() => ({}));
      const steps = Array.isArray(r.steps) ? r.steps : [];
      const allOk = steps.length > 0 && steps.every((s) => s.output && s.output.ok !== false);
      const aggregateReal = typeof r.aggregate === 'string' && r.aggregate.length > 0 && /\[step \d+\]/.test(r.aggregate);
      const mode = r.mode;
      const ok = r.ok === true && mode === 'steps' && r.slug === t.slug && allOk && aggregateReal;
      if (ok) pass++;
      console.log(`\n[${ok ? 'PASS' : 'FAIL'}] ${t.slug} ← "${t.q}"`);
      console.log(`  matched slug: ${r.slug} (want ${t.slug}) | mode: ${mode} | ok: ${r.ok} | steps: ${steps.length}`);
      console.log(`  step results: ${steps.map((s) => `${s.tool}:${s.output && s.output.ok !== false ? 'ok' : 'FAIL'}`).join(' ')}`);
      console.log(`  aggregate (real tool outputs): ${JSON.stringify(String(r.aggregate || '').slice(0, 260))}`);
      if (!ok) console.log(`  raw: ${JSON.stringify(r).slice(0, 400)}`);
    }

    // raw invocation log evidence
    const logFile = path.join(dataDir, 'skills-log.jsonl');
    const entries = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l)) : [];
    const execEntries = entries.filter((e) => e.mode === 'steps');
    console.log(`\n[LOG] skills-log.jsonl: ${entries.length} invocations, ${execEntries.length} executed in steps mode`);
    for (const e of execEntries.slice(0, 12)) console.log(`  ${JSON.stringify({ slug: e.slug, mode: e.mode, ok: e.ok, stepCount: e.stepCount, durationMs: e.durationMs })}`);
  } finally {
    try { child.kill('SIGTERM'); } catch {}
    await wait(500);
    try { child.kill('SIGKILL'); } catch {}
    try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch {} // DATA_DIR temp — memory db is per-run
  }
  console.log(`\nP10 GAP 2 SKILL EXECUTION TEST: ${pass}/${total} PASS`);
  process.exit(pass === total ? 0 : 1);
}
await main();
