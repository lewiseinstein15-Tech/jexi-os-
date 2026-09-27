#!/usr/bin/env node
/**
 * P10 GAP 1 — SUB-AGENT FINAL ANSWERS (keyless path) — acceptance test.
 *
 * Spec: boot keyless, send a multi-step question; the sub-agent coordinator
 * must assemble a final answer from its children's REAL { result } payloads
 * (deterministic composer, original question's rubric applied).
 *
 * Assert per scenario:
 *   A. final answer is non-empty
 *   B. contains at least one child's real result content
 *   C. structurally valid — the composer's structure is present and the
 *      answer is NOT an "I don't know" refusal
 *
 * 3/3 PASS required. Exit 0 only when all pass.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SERVER_DIR = path.join(ROOT, 'server');
const PORT = Number(process.env.JEXI_P10G1_PORT || 3061);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const SCENARIOS = [
  {
    id: 'G1-T1 search + remember (web_search + memory_write children)',
    query: 'search the web for JEXI OS agentic operating system and remember that I asked about it',
    // memory_write child's real output marker (unique to the child runner):
    childMarker: /Noted — I'll remember that:/,
  },
  {
    id: 'G1-T2 name store + recall shape (memory_write + memory_read children)',
    query: 'my name is Lewis and what is my name?',
    childMarker: /Noted — I'll remember that: User's name is Lewis/,
  },
  {
    id: 'G1-T3 file read + remember (file_read + memory_write children)',
    query: 'read the file /home/z/my-project/jexi-os/package.json and remember that I wanted it',
    childMarker: /Contents of `\/home\/z\/my-project\/jexi-os\/package\.json`/,
  },
];

async function ask(base, prompt, session) {
  const res = await fetch(`${base}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-jexi-session': session },
    body: JSON.stringify({ query: prompt }),
  });
  const text = await res.text();
  let done = null;
  const logs = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let ev; try { ev = JSON.parse(line); } catch { continue; }
    if (ev.type === 'done') done = ev;
    if (ev.type === 'log' && (ev.message || ev.data?.message)) logs.push(ev.message || ev.data.message);
  }
  return { done, logs };
}

async function main() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p10-gap1-'));
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
    const keyless = /No AI provider answered|keyless/i.test(bootLog) || !/provider.*configured.*true/i.test(bootLog);
    console.log(`[BOOT] keyless sandbox: ${keyless ? 'confirmed (no model key)' : 'WARNING — could not confirm from boot log; assertions below are structural regardless'}`);

    for (const sc of SCENARIOS) {
      total++;
      const { done, logs } = await ask(base, sc.query, `gap1-${Date.now()}-${total}`);
      const summary = String((done && (done.summary || done.answer)) || '');
      const stats = (done && done.statistics) || {};
      const results = stats.subagentResults || [];
      const nonEmpty = summary.trim().length > 0;
      const childContent = sc.childMarker.test(summary);
      const composedRide = Boolean(stats.subagentComposition);
      const structural = /Sub-agent results/i.test(summary) && !/i don'?t know\b/i.test(summary.slice(0, 400));
      const childrenDispatched = Number(stats.subagentsUsed || 0) >= 2;
      const childResultsReal = results.some((r) => r.result && !/could not produce a final answer/i.test(r.result));
      const ok = nonEmpty && childContent && structural && childrenDispatched && childResultsReal;
      if (ok) pass++;
      console.log(`\n[${ok ? 'PASS' : 'FAIL'}] ${sc.id}`);
      console.log(`  A non-empty: ${nonEmpty} (${summary.trim().length} chars) | B child content present: ${childContent} | C structural: ${structural} | dispatched: ${childrenDispatched} | childResultsReal: ${childResultsReal} | composerVerdict: ${JSON.stringify(stats.subagentComposition || null)}`);
      console.log(`  child results: ${JSON.stringify(results.map((r) => ({ status: r.status, toolsUsed: r.toolsUsed, head: String(r.result).slice(0, 70) })), null, 1)}`);
      console.log(`  final answer (head 400): ${JSON.stringify(summary.slice(0, 400))}`);
      if (!ok) console.log(`  decision logs: ${logs.filter((l) => /compound|composer|subagent|Decision/.test(l)).slice(0, 6).join(' || ').slice(0, 700)}`);
    }
  } finally {
    try { child.kill('SIGTERM'); } catch {}
    await wait(500);
    try { child.kill('SIGKILL'); } catch {}
    try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch {}
  }
  console.log(`\nP10 GAP 1 SUB-AGENT ANSWER TEST: ${pass}/${total} PASS`);
  process.exit(pass === total ? 0 : 1);
}
await main();
