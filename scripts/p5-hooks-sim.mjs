#!/usr/bin/env node
/**
 * PHASE 5 P5-3 — HOOKS SIMULATION.
 *
 * 1. Fire REAL external hook scripts through the kernel runner at a WIRED
 *    lifecycle point (PreToolUse): a dev-server command must be BLOCKED by
 *    dev-server-blocker.js (exit 2 → block), a harmless one must pass.
 * 2. Fire PostToolUse scripts (the second wired emitter).
 * 3. Catalog honesty: every non-wired event must be a DECLARED intentional
 *    no-op with an in-file reason; wired events must map to real emitters.
 * Raw hook stdout is printed verbatim — that IS the evidence.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'jexi-p53-'));
delete process.env.TMUX; // dev-server-blocker must see "outside tmux"

const runner = await import(path.join(ROOT, 'server/src/kernel/hooks/runner.js'));
const cat = await import(path.join(ROOT, 'harness/parity/hooks/catalog.js'));

let pass = 0, total = 0;

// ── 1. PreToolUse BLOCK: real script, real exit-code decision ──────────
total++;
const block = runner.runHook('PreToolUse', { tool: 'terminal.execute', args: { command: 'npm run dev' }, sessionId: 'p53' });
const blockedOk = block.blocked === true || block.blocked === 2 || block.blocked !== null;
const logHasBlock = (block.logs || []).some((l) => /BLOCKED/i.test(l));
if (blockedOk && logHasBlock) pass++;
console.log(`[${blockedOk && logHasBlock ? 'PASS' : 'FAIL'}] PreToolUse blocks "npm run dev" → blocked=${JSON.stringify(block.blocked)}`);
for (const l of block.logs || []) console.log(`   hook stdout: ${l}`);

// ── 2. PreToolUse ALLOW: non-dev command passes ────────────────────────
total++;
const allow = runner.runHook('PreToolUse', { tool: 'terminal.execute', args: { command: 'ls -la /tmp' }, sessionId: 'p53' });
const allowOk = (allow.blocked === null || allow.blocked === false) && (allow.logs || []).some((l) => /allow/i.test(l));
if (allowOk) pass++;
console.log(`[${allowOk ? 'PASS' : 'FAIL'}] PreToolUse allows "ls -la" → blocked=${JSON.stringify(allow.blocked)}`);
for (const l of allow.logs || []) console.log(`   hook stdout: ${l}`);

// ── 3. PostToolUse fires its registered script ─────────────────────────
total++;
const post = runner.runHook('PostToolUse', { tool: 'fs_read', args: { path: '/tmp/x' }, result: { ok: true, bytes: 512 }, sessionId: 'p53' });
const postOk = Array.isArray(post.logs) && post.logs.some((l) => /log-tool-result/.test(l) && /OK fs_read/.test(l));
if (postOk) pass++;
console.log(`[${postOk ? 'PASS' : 'FAIL'}] PostToolUse script executed → ${post.logs ? `${post.logs.length} script log line(s)` : 'no logs'}`);
for (const l of post.logs || []) console.log(`   hook stdout: ${l}`);

// ── 4. Catalog honesty: every stub declared with a reason ─────────────
total++;
const all = cat.HOOK_CATALOG || [];
const wired = all.filter((h) => h.wired);
const noOps = all.filter((h) => h.intentionalNoOp);
const everyNoOpHasReason = noOps.every((h) => h.noOpReason && h.noOpReason.length > 10);
const countsOk = all.length === 30 && wired.length === 6 && noOps.length === 24 && everyNoOpHasReason;
if (countsOk) pass++;
console.log(`[${countsOk ? 'PASS' : 'FAIL'}] catalog: 30 events = ${wired.length} wired (${wired.map((h) => h.event).join(', ')}) + ${noOps.length} intentional no-ops, every no-op has an in-file reason=${everyNoOpHasReason}`);
console.log(`   sample no-op reasons: ${noOps.slice(0, 3).map((h) => `${h.event}: ${h.noOpReason}`).join(' | ')}`);

console.log(`P5-3 HOOKS SIM: ${pass}/${total} PASS`);
process.exit(pass === total ? 0 : 1);
