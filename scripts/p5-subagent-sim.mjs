#!/usr/bin/env node
/**
 * PHASE 5 P5-7 — SUB-AGENT DISPATCH SIMULATION.
 *
 * "Multi-step turns dispatch REAL sub-agents from roster (not stubs).
 *  Contract: { allowedTools, maxTurns, permissionMode }
 *  Return:   { result, toolsUsed, cost, duration }"
 *
 * A compound chat turn ("search the web for X and remember what you find")
 * carries evidence for web_search + memory_write → the agentic lane
 * dispatches REAL child agents (own AgentLoop runs through SubagentRuntime)
 * under P30.C-enforced contracts, and the done payload records the dispatch.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SERVER_DIR = path.join(ROOT, 'server');
const PORT = Number(process.env.JEXI_P57_PORT || 3048);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitHealthy(base, tries = 90) {
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(`${base}/api/health`); if (r.ok) return true; } catch { /* not up */ }
    await wait(1000);
  }
  return false;
}

async function main() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jexi-p57-'));
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

    // The compound turn: web_search + memory_write evidence.
    total++;
    const res = await fetch(`${base}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-jexi-session': `p57-${Date.now()}` },
      body: JSON.stringify({ query: 'search the web for JEXI OS agentic operating system and remember that I asked about it' }),
    });
    const text = await res.text();
    let done = null;
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      let ev; try { ev = JSON.parse(line); } catch { continue; }
      if (ev.type === 'done') done = ev;
    }
    const stats = done && done.statistics || {};
    const used = stats.subagentsUsed || 0;
    const contracts = stats.subagentContracts || [];
    const results = stats.subagentResults || [];
    const contractOk = contracts.length >= 2 && contracts.every((c) =>
      Array.isArray(c.allowedTools) && Number.isInteger(c.maxTurns) && c.maxTurns > 0 && typeof c.permissionMode === 'string');
    const shapeOk = results.length >= 2 && results.every((r) =>
      ['result', 'toolsUsed', 'cost', 'duration'].every((k) => k in r));
    const enforcementOk = (stats.subagentEnforcement || []).every((e) => e.allowed !== false);
    const ok = used >= 2 && contractOk && shapeOk && enforcementOk;
    if (ok) pass++;
    console.log(`[${ok ? 'PASS' : 'FAIL'}] compound turn → subagentsUsed=${used}`);
    console.log(`   contracts: ${JSON.stringify(contracts)}`);
    console.log(`   enforcement: ${JSON.stringify(stats.subagentEnforcement || [])}`);
    console.log(`   results (contract shape): ${JSON.stringify(results.map(({ result, toolsUsed, cost, duration, status }) => ({ toolsUsed, cost, duration, status, resultHead: String(result).slice(0, 60) })), null, 1).slice(0, 600)}`);
    if (!ok) console.log(`   used=${used} contractOk=${contractOk} shapeOk=${shapeOk} enforcementOk=${enforcementOk} doneSummary=${JSON.stringify(done && done.summary || '').slice(0, 140)}`);

    // The dispatch is also visible in the live event bus (subagent.plan/start/done)
    total++;
    let sawEvents = false;
    try {
      const obs = await fetch(`${base}/api/observer/recent?limit=200`);
      const oj = await obs.json();
      const blob = JSON.stringify(oj);
      sawEvents = /subagent/.test(blob) || /compound turn/.test(blob);
    } catch { /* observer optional */ }
    if (sawEvents) pass++;
    console.log(`[${sawEvents ? 'PASS' : 'FAIL'}] subagent dispatch visible on the observer bus`);
  } finally {
    try { child.kill('SIGTERM'); } catch { /* gone */ }
    await wait(500);
    try { child.kill('SIGKILL'); } catch { /* gone */ }
    try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
  console.log(`P5-7 SUB-AGENT SIM: ${pass}/${total} PASS`);
  process.exit(pass === total ? 0 : 1);
}

await main();
