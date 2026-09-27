#!/usr/bin/env node
/**
 * PHASE 5 P5-4 — PLUGINS SIMULATION.
 *
 * "Invoke a plugin; assert log entry."
 *
 * Boot the real server (loadPlugins runs at boot → 52 plugin dirs apply),
 * then invoke a plugin-registered tool through the REAL gated tool runtime:
 *   POST /api/tools/execute { slug: 'time-now' }   (timezone plugin)
 * Asserts the tool result is real (Africa/Nairobi time) and that the
 * plugin provenance is observable (listPluginTools + execution response).
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SERVER_DIR = path.join(ROOT, 'server');
const PORT = Number(process.env.JEXI_PLG_SIM_PORT || 3047);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitHealthy(base, tries = 90) {
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(`${base}/api/health`); if (r.ok) return true; } catch { /* not up */ }
    await wait(1000);
  }
  return false;
}

async function main() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jexi-p54-'));
  const env = { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', DATA_DIR: dataDir, JEXI_MCP_MINIMAL: '1', NODE_ENV: 'production' };
  const child = spawn(process.execPath, ['index.js'], { cwd: SERVER_DIR, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let bootLog = '';
  child.stdout.on('data', (d) => { bootLog += d.toString(); });
  const base = `http://127.0.0.1:${PORT}`;
  let pass = 0, total = 0;
  try {
    const up = await waitHealthy(base);
    if (!up) { console.log(`[BOOT FAIL] tail:\n${bootLog.split('\n').slice(-20).join('\n')}`); process.exit(1); }

    // 1. plugins actually loaded at boot (provenance via the live context)
    total++;
    const ptoolsRes = await fetch(`${base}/api/plugins/tools`);
    const ptools = await ptoolsRes.json();
    const ptoolList = Array.isArray(ptools.tools) ? ptools.tools : [];
    const tzTool = ptoolList.find((t) => t.slug === 'time-now');
    const ok1 = ptoolList.length > 0 && Boolean(tzTool) && /timezone/i.test(String(tzTool._plugin || ''));
    if (ok1) pass++;
    console.log(`[${ok1 ? 'PASS' : 'FAIL'}] boot loaded ${ptoolList.length} plugin tools; time-now mounted by "${tzTool ? tzTool._plugin : '?'}"`);

    // 2. invoke the plugin tool through the REAL gated tool runtime
    total++;
    const execRes = await fetch(`${base}/api/tools/execute`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slug: 'time-now', args: { timezone: 'Africa/Nairobi' } }),
    });
    const exec = await execRes.json();
    const outText = JSON.stringify(exec);
    const hasNairobi = outText.includes('Africa/Nairobi');
    const ok2 = execRes.ok && exec.ok !== false && exec.success !== false && hasNairobi;
    if (ok2) pass++;
    console.log(`[${ok2 ? 'PASS' : 'FAIL'}] invoke plugin tool time-now(Africa/Nairobi) → ${outText.slice(0, 220)}`);

    // 3. plugin tool provenance visible in the runtime's tool listing
    total++;
    const catRes = await fetch(`${base}/api/plugins/tools`);
    const cat = await catRes.json();
    const entry = JSON.stringify(cat);
    const ok3 = entry.includes('time-now');
    if (ok3) pass++;
    console.log(`[${ok3 ? 'PASS' : 'FAIL'}] plugin registry exposes time-now → ${entry.slice(0, 200)}`);

    // 4. invocation left a real audit entry (executeTool → events.json)
    total++;
    const evFile = path.join(dataDir, 'events.json');
    let found = false, shown = null;
    if (fs.existsSync(evFile)) {
      const ev = JSON.parse(fs.readFileSync(evFile, 'utf8'));
      const arr = Array.isArray(ev) ? ev : ev.events || [];
      const call = arr.find((l) => (l.type === 'tool_call' || l.type === 'tool_result') && l.payload && l.payload.tool === 'time-now');
      const res2 = arr.find((l) => l.type === 'tool_result' && l.payload && l.payload.tool === 'time-now');
      if (call) { found = true; shown = `${JSON.stringify(call)}${res2 ? ` | result: ok=${res2.ok} durationMs=${res2.durationMs}` : ''}`; }
    }
    if (found) pass++;
    console.log(`[${found ? 'PASS' : 'FAIL'}] plugin event log entry (events.json) → ${found ? shown : 'no tool_call entry for time-now'}`);
  } finally {
    try { child.kill('SIGTERM'); } catch { /* gone */ }
    await wait(500);
    try { child.kill('SIGKILL'); } catch { /* gone */ }
    try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
  console.log(`P5-4 PLUGINS SIM: ${pass}/${total} PASS`);
  process.exit(pass === total ? 0 : 1);
}

await main();
