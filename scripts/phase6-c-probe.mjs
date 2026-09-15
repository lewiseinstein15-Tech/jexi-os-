/**
 * Phase 6 Scope C live probe — raw output only.
 *
 * Boots the REAL server (index.js), then over HTTP exercises the context
 * manager: sources, budgeted build (with a real drop), greedy packing,
 * deterministic compaction, and pressure.
 *
 * Run with: DOTENV_CONFIG_QUIET=true node scripts/phase6-c-probe.mjs
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVER_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'server');
const PORT = 3298;
const BASE = `http://127.0.0.1:${PORT}`;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'phase6-c-data-'));
const out = (x) => console.log(JSON.stringify(x, null, 1));
const get = async (p) => (await fetch(`${BASE}${p}`)).json();
const post = async (p, body) => (await fetch(`${BASE}${p}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) })).json();

const child = spawn(process.execPath, ['index.js'], {
  cwd: SERVER_DIR,
  env: { ...process.env, PORT: String(PORT), DATA_DIR, DOTENV_CONFIG_QUIET: 'true', NODE_NO_WARNINGS: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
const boot = [];
child.stdout.on('data', (d) => boot.push(d.toString()));
child.stderr.on('data', (d) => boot.push(d.toString()));
function cleanup(code = 0) { try { child.kill('SIGKILL'); } catch { /* noop */ } setTimeout(() => process.exit(code), 200); }

async function waitForBoot(timeoutMs = 60000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try { if ((await fetch(`${BASE}/api/health`)).ok) return true; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

if (!(await waitForBoot())) { console.log('server never came up'); cleanup(1); }
else {
  try {
    console.log('== 1. GET /api/context/sources ==');
    out(await get('/api/context/sources'));

    console.log('\n== 2. POST /api/context/build — small budget forces a real drop ==');
    out(await post('/api/context/build', {
      input: {
        mission: { title: 'Ship Phase 6', goal: 'build 4 subsystems + 3 migrations', status: 'in progress' },
        memories: ['prefers direct commits to main', 'works with raw tool output'],
        history: [{ role: 'user', content: 'resume phase 6' }, { role: 'assistant', content: 'on it' }],
        tools: [{ name: 'bash', description: 'run a shell command' }, { name: 'edit', description: 'edit a file' }],
        instruction: 'Implement Scope C context manager',
      },
      budget: { maxChars: 400, maxTokens: 55, perSectionChars: 5000 },
    }));

    console.log('\n== 3. POST /api/context/pack — greedy under a token cap ==');
    out(await post('/api/context/pack', {
      items: [
        { id: 'a', text: 'x'.repeat(400), score: 9 },
        { id: 'b', text: 'y'.repeat(400), score: 5 },
        { id: 'c', text: 'z'.repeat(400), score: 1 },
      ],
      maxTokens: 120, maxItems: 10,
    }));

    console.log('\n== 4. POST /api/context/compact — 40 events down to a bounded block ==');
    const events = Array.from({ length: 40 }, (_, i) => `event-${i}: something happened`);
    out(await post('/api/context/compact', { events, maxChars: 220, headCount: 3, tailCount: 3 }));

    console.log('\n== 5. GET /api/context/pressure ==');
    out(await get('/api/context/pressure?used=8800&budget=8000'));
    out(await get('/api/context/pressure?used=1000&budget=8000'));
  } catch (e) {
    console.error('probe error:', e);
    cleanup(1);
  }
  cleanup(0);
}