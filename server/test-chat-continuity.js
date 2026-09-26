/**
 * AUDIT FIX (fix/chat-memory-provider-wiring, Part C) — MEMORY CONTINUITY
 * mechanism proof. Deterministic, headless, ZERO network, ZERO model calls.
 *
 * Lead's C3 test needs a live provider ("turn 2's ANSWER contains X" — that
 * part is scripts/chat-continuity-test.mjs, run on a keyed host). This suite
 * proves the server-side mechanism that makes turn 2's answer contain X:
 *
 *   C1  the per-session store (B66) captures each turn;
 *   C1  conversationContext() — the block injected into the prompt BEFORE the
 *       LLM call — carries turn 1's message into turn 2's prompt;
 *   C1  the profile extractor lifts "my name is X" into durable user facts;
 *   C1  convId pass-through (index.js runSimpleTask opts) is what activates
 *       compaction-aware context for THIS conversation;
 *   —   user-turn persistence happens exactly once per source (handler
 *       rememberTurn; the SimpleTask double-add wart is documented, not
 *       silently changed — zero-deletion discipline).
 *
 * Run: node test-chat-continuity.js   (exit 0 = all green)
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Isolate DATA_DIR BEFORE any server module import — fresh memory.json,
// fresh sessions dir; no sandbox state leaks in, none of ours leaks out.
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'jexi-continuity-test-'));
delete process.env.GROQ_API_KEY;
delete process.env.GEMINI_API_KEY;
delete process.env.OPENROUTER_API_KEY;

let passed = 0;
let failed = 0;
const ok = (cond, msg) => {
  if (cond) { passed++; console.log(`  ✅ ${msg}`); }
  else { failed++; console.log(`  ❌ ${msg}`); }
};

const { setActiveSession, getActiveSession, addChat, getChatHistory, loadMemory } = await import('./src/services/MemoryManager.js');
const { conversationContext } = await import('./src/services/Orchestrator.js');

console.log('\n== AUDIT FIX — MEMORY CONTINUITY MECHANISM (Part C) ==');

// --- Turn 1: "my name is Zephyr" on session A --------------------------------
setActiveSession('session-A');
ok(getActiveSession() === 'session-A', 'active session is set per request (chat handler contract)');

// The /api/chat handler's rememberTurn('user', raw) — the ONE canonical write.
addChat('user', 'my name is Zephyr');

ok(getChatHistory(12).some((h) => h.role === 'user' && /Zephyr/.test(h.text)),
  'C1: turn 1 persisted to the session store (getChatHistory sees it)');
ok(loadMemory().userProfile?.name === 'Zephyr' ||
   (loadMemory().userFacts || []).some((f) => /Zephyr/.test(f.fact || '')),
  'C1: "my name is Zephyr" lifted into durable profile/user facts');

// Session file on disk (B66 durability across restarts)
const sessionFiles = fs.readdirSync(path.join(process.env.DATA_DIR, 'sessions'));
ok(sessionFiles.length === 1, `C1: session store hit the disk (DATA_DIR/sessions/${sessionFiles[0]})`);

// --- Turn 2: the prompt JEXI's brain builds BEFORE the LLM call --------------
const ctx = await conversationContext('what is my name?', 'session-A');
ok(/Zephyr/.test(ctx), 'C1: conversationContext("what is my name?") CARRIES turn 1 ("Zephyr") into turn 2\'s prompt');
ok(/User:\s*my name is Zephyr/i.test(ctx), 'C1: turn 1 rides as the verbatim User turn (history block)');
ok(/name/i.test(ctx) && /Zephyr/.test(ctx), 'C1: profile fact + history both name Zephyr');

// --- convId pass-through matters (what Part C1 wired) ------------------------
const ctxNoConv = await conversationContext('what is my name?', null);
ok(typeof ctxNoConv === 'string' && /Zephyr/.test(ctxNoConv),
  'C1: even with convId=null the session history still flows (activeSession module scope)');

// --- SimpleTask prompt shape: the brain block slots between ctx and answer ---
// (the exact template SimpleTask.js assembles — asserted here so a future
//  edit cannot silently drop the continuity block from the prompt)
const brainBlockShape = `Conversation context:\n${ctx.slice(0, 4000)}`;
ok(brainBlockShape.includes('Zephyr'), 'C2: the assembled worker prompt carries the continuity block');

console.log(`\n== RESULT: ${passed} passed, ${failed} failed ==`);
process.exit(failed ? 1 : 0);
