#!/usr/bin/env node
/**
 * PHASE 4 — SELF-AWARENESS TEST.
 *
 * 8 questions covering agents, capabilities, skills, tools, MCPs, hooks,
 * plugins, memory. For each: the expected REAL numbers are read from
 * brain.roster() (the same live registries the server reads), then the
 * question is sent through POST /api/chat on the real server. Assertions:
 *   - the answer contains the real numbers (not "I don't know" / "I don't
 *     have any" while the data exists);
 *   - the answer never contains the forbidden-model strings (Phase 3 holds).
 *
 * Usage: node scripts/self-awareness-test.mjs
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SERVER_DIR = path.join(ROOT, 'server');
const PORT = Number(process.env.JEXI_SA_PORT || 3045);

const QUESTIONS = [
  { id: 'SIM-AGENTS', q: 'how many agents do you have?', pick: (r) => String(r.agents?.total), match: (a, r) => a.includes(String(r.agents?.total)) },
  { id: 'SIM-CAPABILITIES', q: 'what can you do?', pick: (r) => `${r.tools?.total} registered tools`, match: (a, r) => a.includes(String(r.tools?.total)) && a.includes(String(r.agents?.total)) },
  { id: 'SIM-SKILLS', q: 'how many skills do you have?', pick: (r) => `${r.skills?.registry} + ${r.skills?.library}`, match: (a, r) => a.includes(String(r.skills?.registry)) && a.includes(String(r.skills?.library)) },
  { id: 'SIM-TOOLS', q: 'what tools do you have?', pick: (r) => String(r.tools?.total), match: (a, r) => a.includes(String(r.tools?.total)) },
  { id: 'SIM-MCPS', q: 'what MCPs are connected?', pick: (r) => `${r.mcps?.enabled} enabled / ${r.mcps?.connected} connected / ${r.mcps?.dormant} dormant`, match: (a, r) => a.includes(String(r.mcps?.enabled)) && a.includes(String(r.mcps?.dormant ?? -1)) },
  { id: 'SIM-HOOKS', q: 'what hooks are wired?', pick: (r) => `${r.hooks?.wired} wired / ${r.hooks?.stubs} stubs`, match: (a, r) => a.includes(String(r.hooks?.wired)) && a.includes(String(r.hooks?.stubs)) },
  { id: 'SIM-PLUGINS', q: 'how many plugins do you have?', pick: (r) => String(r.plugins?.total), match: (a, r) => a.includes(String(r.plugins?.total)) },
  { id: 'SIM-MEMORY', q: 'how much memory do you have?', pick: () => '4-source brain recall', match: (a) => /4-source/i.test(a) || /brain recall/i.test(a) },
];

const FORBIDDEN = ['OpenAI', 'GPT', 'Anthropic', 'Claude', 'Llama', 'Groq', 'DeepSeek', 'Google', 'Gemini'];
const DENY_PATTERNS = [/i don'?t have any/i, /i don'?t know/i, /i have no /i, /i do not have any/i];

function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function waitHealthy(base, tries = 90) {
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(`${base}/api/health`); if (r.ok) return true; } catch { /* not up */ }
    await wait(1000);
  }
  return false;
}

async function ask(base, prompt, session) {
  const res = await fetch(`${base}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-jexi-session': session },
    body: JSON.stringify({ query: prompt }),
  });
  const text = await res.text();
  let final = null, streamText = '';
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let ev; try { ev = JSON.parse(line); } catch { continue; }
    if (ev.type === 'stream' && ev.text) streamText += ev.text;
    if (ev.type === 'done') final = ev;
  }
  return String((final && (final.summary || final.answer)) || streamText || '');
}

async function main() {
  // Expected numbers — from the SAME brain.roster() the server uses.
  const rosterMod = await import(path.join(ROOT, 'mind/brain/roster.js'));
  const roster = await rosterMod.roster({ refresh: true });
  console.log(`[EXPECTED] agents=${roster.agents?.total} skills=${roster.skills?.registry}+${roster.skills?.library} tools=${roster.tools?.total} mcps=${roster.mcps?.enabled}/${roster.mcps?.connected}/${roster.mcps?.dormant} hooks=${roster.hooks?.wired}/${roster.hooks?.stubs} plugins=${roster.plugins?.total}`);

  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jexi-selfaware-'));
  const env = { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', DATA_DIR: dataDir, JEXI_MCP_MINIMAL: '1', NODE_ENV: 'production' };
  const child = spawn(process.execPath, ['index.js'], { cwd: SERVER_DIR, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let bootLog = '';
  child.stdout.on('data', (d) => { bootLog += d.toString(); });
  child.stderr.on('data', (d) => { bootLog += d.toString(); });
  const base = `http://127.0.0.1:${PORT}`;

  let pass = 0;
  try {
    const up = await waitHealthy(base);
    if (!up) {
      console.log(`[BOOT FAIL] tail:\n${bootLog.split('\n').slice(-25).join('\n')}`);
      console.log(`SELF-AWARENESS TEST: 0/${QUESTIONS.length} PASS`);
      process.exit(1);
    }
    // boot must show the roster line (proof the roster is in live context)
    const rosterLineSeen = /\[Roster\] brain\.roster\(\) loaded:/.test(bootLog);
    console.log(`[BOOT] roster line in boot log: ${rosterLineSeen ? 'YES' : 'NO'}`);
    if (rosterLineSeen) {
      const m = bootLog.match(/\[Roster\][^\n]*/);
      if (m) console.log(`   ${m[0].trim()}`);
    }
    for (const { id, q, pick, match } of QUESTIONS) {
      const answer = await ask(base, q, `selfaware-${Date.now()}`);
      const numbersOk = match(answer, roster);
      const denied = DENY_PATTERNS.some((re) => re.test(answer));
      const leak = FORBIDDEN.some((f) => new RegExp(`\\b${f}\\b`, 'i').test(answer));
      const ok = numbersOk && !denied && !leak && answer.length > 0;
      if (ok) pass++;
      console.log(`[${ok ? 'PASS' : 'FAIL'}] ${id} "${q}"`);
      console.log(`   expect: ${pick(roster)}`);
      console.log(`   answer: ${JSON.stringify(answer.slice(0, 180))}`);
      if (!ok) console.log(`   numbersOk=${numbersOk} denied=${denied} leak=${leak}`);
    }
  } finally {
    try { child.kill('SIGTERM'); } catch { /* gone */ }
    await wait(500);
    try { child.kill('SIGKILL'); } catch { /* gone */ }
    try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
  console.log(`SELF-AWARENESS TEST: ${pass}/${QUESTIONS.length} PASS`);
  console.log(pass === QUESTIONS.length ? 'ALL PASS' : 'FAILURES PRESENT');
  process.exit(pass === QUESTIONS.length ? 0 : 1);
}

await main();
