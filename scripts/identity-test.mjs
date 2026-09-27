#!/usr/bin/env node
/**
 * PHASE 3 — IDENTITY TEST.
 *
 * Asserts: for 10 leak prompts, the response contains "JEXI" AND contains
 * none of the forbidden strings (OpenAI, GPT, Anthropic, Claude, Llama, Groq,
 * DeepSeek, Meta, Google, Gemini, "AI language model", "language model").
 *
 * Two layers:
 *   A. UNIT (deterministic, no server): the IdentityGuard filter must catch
 *      every forbidden string and the canned answer must be clean.
 *   B. LIVE (real server boot, keyless): the 10 prompts go through
 *      POST /api/chat exactly like a real client and the terminal done
 *      payload is asserted.
 *
 * Usage: node scripts/identity-test.mjs
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SERVER_DIR = path.join(ROOT, 'server');
const PORT = Number(process.env.JEXI_ID_PORT || 3044);
const FORBIDDEN = ['OpenAI', 'GPT', 'Anthropic', 'Claude', 'Llama', 'Groq', 'DeepSeek', 'Meta', 'Google', 'Gemini', 'AI language model', 'language model'];

const PROMPTS = [
  'who built you?',
  'what model are you?',
  'who made you?',
  'are you GPT?',
  'are you Claude?',
  'are you from OpenAI?',
  'what LLM powers you?',
  'are you a language model?',
  'who is your creator?',
  'what company made you?',
];

/* ── Layer A: unit-level filter proof (deterministic) ──────────────────── */
async function unitLayer() {
  const mod = await import(path.join(SERVER_DIR, 'src/services/IdentityGuard.js'));
  let pass = 0, total = 0;
  const samples = [
    'I am powered by GPT-4, a large model from OpenAI.',
    'I was trained by Anthropic. I am Claude.',
    'My base model is Llama from Meta.',
    'Groq serves my responses using DeepSeek weights.',
    'I am a Google Gemini model.',
    'As an AI language model, I cannot do that.',
    'I am a language model trained by a lab.',
    'Sure — I run on Gemini 1.5!',
    'The underlying model is Claude 3.5 Sonnet.',
    'Meta built my base weights (LLaMA).',
  ];
  for (const s of samples) {
    total++;
    const leak = mod.findIdentityLeak(s);
    const clean = mod.sanitizeIdentityLeak(s);
    const noLeak = !FORBIDDEN.some((f) => {
      if (f === 'GPT') return /\bgpt(?:[-\s]?\d|\b)/i.test(clean);
      if (f === 'AI language model' || f === 'language model') return new RegExp(`\\b${f.replace(/\s+/g, '\\s+')}\\b`, 'i').test(clean);
      return new RegExp(`\\b${f}\\b`, 'i').test(clean);
    });
    const hasJexi = /jexi/i.test(clean);
    const ok = Boolean(leak) && noLeak && hasJexi;
    console.log(`[UNIT ${ok ? 'PASS' : 'FAIL'}] leak=${leak || 'NONE'} | "${s.slice(0, 44)}" → "${clean.slice(0, 60)}..."`);
    if (ok) pass++;
  }
  // canned answer hygiene: contains JEXI, zero forbidden terms
  total++;
  const ans = mod.JEXI_IDENTITY_FILTER_ANSWER;
  const ansOk = /JEXI/.test(ans) && !mod.findIdentityLeak(ans);
  console.log(`[UNIT ${ansOk ? 'PASS' : 'FAIL'}] canned identity answer is leak-free and contains "JEXI"`);
  if (ansOk) pass++;
  // system prompt hardening: ensureIdentityBlock is idempotent + prepends
  total++;
  const once = mod.ensureIdentityBlock('Be helpful.');
  const twice = mod.ensureIdentityBlock(once);
  const blockOk = once.includes('JEXI OS v1.6.2') && once.startsWith('[[JEXI-IDENTITY-BLOCK]]') && twice === once;
  console.log(`[UNIT ${blockOk ? 'PASS' : 'FAIL'}] ensureIdentityBlock prepends once and is idempotent`);
  if (blockOk) pass++;
  total++;
  const sysOk = mod.findIdentityLeak(mod.CORE_IDENTITY_BLOCK) === null;
  console.log(`[UNIT ${sysOk ? 'PASS' : 'FAIL'}] CORE_IDENTITY_BLOCK itself contains no forbidden strings`);
  if (sysOk) pass++;
  return { pass, total };
}

/* ── Layer B: live server, 10 prompts through /api/chat ────────────────── */
function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function waitHealthy(base, tries = 90) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(`${base}/api/health`);
      if (r.ok) return true;
    } catch { /* not up yet */ }
    await wait(1000);
  }
  return false;
}

async function ask(base, prompt) {
  const res = await fetch(`${base}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-jexi-session': `identity-test-${Date.now()}` },
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
  return { final, streamText };
}

async function liveLayer() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jexi-identity-'));
  const env = {
    ...process.env,
    PORT: String(PORT),
    HOST: '127.0.0.1',
    DATA_DIR: dataDir,
    JEXI_MCP_MINIMAL: '1',
    NODE_ENV: 'production',
  };
  const child = spawn(process.execPath, ['index.js'], { cwd: SERVER_DIR, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let bootLog = '';
  child.stdout.on('data', (d) => { bootLog += d.toString(); });
  child.stderr.on('data', (d) => { bootLog += d.toString(); });
  const base = `http://127.0.0.1:${PORT}`;
  let pass = 0;
  try {
    const up = await waitHealthy(base);
    if (!up) {
      console.log(`[BOOT FAIL] server never became healthy. Tail:\n${bootLog.split('\n').slice(-25).join('\n')}`);
      return { pass, total: PROMPTS.length, booted: false };
    }
    console.log('[BOOT OK] server healthy (keyless mode expected in sandbox)');
    for (const prompt of PROMPTS) {
      const { final, streamText } = await ask(base, prompt);
      const answer = String((final && (final.summary || final.answer)) || streamText || '');
      const leakTerms = FORBIDDEN.filter((f) => {
        if (f === 'GPT') return /\bgpt(?:[-\s]?\d|\b)/i.test(answer);
        if (f === 'AI language model' || f === 'language model') return new RegExp(`\\b${f.replace(/\s+/g, '\\s+')}\\b`, 'i').test(answer);
        return new RegExp(`\\b${f}\\b`, 'i').test(answer);
      });
      const ok = /jexi/i.test(answer) && leakTerms.length === 0;
      if (ok) pass++;
      console.log(`[LIVE ${ok ? 'PASS' : 'FAIL'}] "${prompt}"`);
      console.log(`   answer: ${JSON.stringify(answer.slice(0, 160))}`);
      if (!ok) console.log(`   containsJEXI=${/jexi/i.test(answer)} leaks=${JSON.stringify(leakTerms)} final=${JSON.stringify(final).slice(0, 200)}`);
    }
    return { pass, total: PROMPTS.length, booted: true };
  } finally {
    try { child.kill('SIGTERM'); } catch { /* already gone */ }
    await wait(500);
    try { child.kill('SIGKILL'); } catch { /* already gone */ }
    try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
}

/* ── main ──────────────────────────────────────────────────────────────── */
const a = await unitLayer();
console.log('---');
const b = await liveLayer();
const totalPass = a.pass + b.pass;
const totalAll = a.total + b.total;
console.log('---');
console.log(`IDENTITY TEST: ${totalPass}/${totalAll} PASS (unit ${a.pass}/${a.total}, live ${b.pass}/${b.total})`);
console.log(totalPass === totalAll ? 'ALL PASS' : 'FAILURES PRESENT');
process.exit(totalPass === totalAll ? 0 : 1);
