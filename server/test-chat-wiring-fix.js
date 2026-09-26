/**
 * AUDIT FIX (fix/chat-memory-provider-wiring, Part B) — provider routing
 * regression proof. Headless, keyless-sandbox safe, ZERO network.
 *
 * Live-laptop bug being guarded: GROQ_API_KEY set (only key), boot chip
 * honest ("provider ready - groq grov"), but every chat turn walked the
 * memory/coder coworker chains — gemini → openrouter → openrouter →
 * vllm → huggingface → mistral — none of which contain groq, all of which
 * lacked keys on that host. Every leg failed → "No coworker completed the
 * request" after ~11.5s of guaranteed-dead attempts.
 *
 * Proven here, without any live provider:
 *   B1  only GROQ_API_KEY        → groq is attempt #1 on EVERY coworker;
 *                                  unconfigured legs are DROPPED (never tried);
 *   B1b groq + gemini keys       → groq still first, configured originals kept;
 *   B2  tool-capability flag     → TOOL_CAPABLE recognizes groq (Groq API
 *                                  supports tools); gemini is text-only here;
 *   B3  no keys at all           → chain = [pollinations] (keyless floor) —
 *                                  a conversational turn degrades to an
 *                                  answer, never to a hard E_TURN_FAILED;
 *   —   static roster untouched  → COWORKERS / coworkerChain() byte-stable
 *                                  (researcher still groq-led with its own
 *                                  model choice preserved as head leg);
 *   —   runWorker end-to-end     → tool lane returns ok through the
 *                                  __mockCompletions test seam (no network).
 *
 * Run: node test-chat-wiring-fix.js   (exit 0 = all green)
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Isolate settings/DATA_DIR BEFORE any server module is imported — the
// sandbox/dev settings.json must never leak keys into key resolution.
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'jexi-wiring-test-'));
delete process.env.JEXI_MODEL_PROVIDER;
delete process.env.JEXI_MODEL_API_KEY;
delete process.env.JEXI_MODEL_NAME;
delete process.env.MODEL_PROVIDER;
delete process.env.VLLM_BASE_URL;
delete process.env.GROQ_API_KEY;
delete process.env.GEMINI_API_KEY;
delete process.env.OPENROUTER_API_KEY;
delete process.env.HF_TOKEN;
delete process.env.MISTRAL_API_KEY;
delete process.env.NVIDIA_API_KEY;

let passed = 0;
let failed = 0;
const ok = (cond, msg) => {
  if (cond) { passed++; console.log(`  ✅ ${msg}`); }
  else { failed++; console.log(`  ❌ ${msg}`); }
};
const KEYS = (over = {}) => ({ groqKey: '', geminiKey: '', openrouterKey: '', hfKey: '', mistralKey: '', nvidiaKey: '', deepseekKey: '', xaiKey: '', cerebrasKey: '', deepinfraKey: '', sambanovaKey: '', cloudflareKey: '', pollinationsKey: '', ...over });

const { COWORKERS, coworkerChain, coworkerFor, runtimeChain, legConfigured, runWorker } = await import('./src/providers/catalog/WorkerRouter.js');
const { TOOL_CAPABLE } = await import('./src/providers/runtime/LLMClient.js');

console.log('\n== AUDIT FIX — CONFIGURED-FIRST PROVIDER ROUTING (Part B) ==');

// --- B1: groq-only host (the exact laptop scenario, key in ENV) -------------
process.env.GROQ_API_KEY = 'laptop-style-env-key';
const groqOnly = runtimeChain('memory');
console.log(`  memory runtimeChain (groq-only): ${groqOnly.map((p) => p.model ? `${p.key}(${p.model})` : p.key).join(' → ')}`);
ok(groqOnly[0].key === 'groq' && groqOnly[0].model === 'openai/gpt-oss-120b',
  'B1: groq is attempt #1 for the memory coworker (default flagship openai/gpt-oss-120b)');
ok(!groqOnly.some((p) => ['gemini', 'openrouter', 'vllm', 'huggingface', 'mistral'].includes(p.key)),
  'B1: unconfigured legs DROPPED — gemini/openrouter/vllm/hf/mistral never attempted');
ok(groqOnly[groqOnly.length - 1].key === 'pollinations',
  'B3: keyless pollinations floor is the last resort');

ok(runtimeChain('coder')[0].key === 'groq',
  'B1: groq is attempt #1 for the coder coworker too');

// --- B1c: Settings-only key (no env) must lead exactly like an env key ------
delete process.env.GROQ_API_KEY;
const settingsFile = path.join(process.cwd(), 'settings.json');
const settingsBackup = fs.existsSync(settingsFile) ? fs.readFileSync(settingsFile, 'utf-8') : null;
fs.writeFileSync(settingsFile, JSON.stringify({ groqKey: 'settings-only-key' }), 'utf-8');
try {
  const viaSettings = runtimeChain('memory');
  ok(viaSettings[0].key === 'groq' && viaSettings[0].model === 'openai/gpt-oss-120b',
    'B1c: a Settings-only groq key (no env) ALSO leads the chain (env OR Settings unified)');
} finally {
  if (settingsBackup === null) fs.rmSync(settingsFile, { force: true });
  else fs.writeFileSync(settingsFile, settingsBackup, 'utf-8');
}

// --- B1b: groq + gemini keys — configured originals survive, groq still first
process.env.GROQ_API_KEY = 'k1';
process.env.GEMINI_API_KEY = 'k2';
const groqGemini = runtimeChain('memory');
ok(groqGemini[0].key === 'groq', 'B1b: with groq+gemini keys, groq still leads (router priority)');
ok(groqGemini.some((p) => p.key === 'gemini' && p.model === 'gemini-3.6-flash'),
  'B1b: the memory chain\'s own configured gemini leg is preserved (model kept)');
ok(!groqGemini.some((p) => p.key === 'openrouter'),
  'B1b: openrouter (no key) still dropped');
delete process.env.GROQ_API_KEY;
delete process.env.GEMINI_API_KEY;

// --- B2: tool-capability flag ----------------------------------------------
ok(TOOL_CAPABLE.has('groq'), 'B2: TOOL_CAPABLE recognizes groq (Groq API supports tools)');
ok(!TOOL_CAPABLE.has('gemini') && !TOOL_CAPABLE.has('vllm'),
  'B2: gemini/vllm remain text-only in the native tool loop (unchanged truth)');
ok(groqOnly.some((p) => TOOL_CAPABLE.has(p.key)),
  'B2: the groq-only runtime chain contains a tool-capable rung (tools stay ON)');

// --- B3: zero keys — fail-soft floor, never a hard failure ------------------
const none = runtimeChain('memory', KEYS());
console.log(`  memory runtimeChain (no keys): ${none.map((p) => p.key).join(' → ')}`);
ok(none.length === 1 && none[0].key === 'pollinations',
  'B3: with NO keys the chain still has the keyless pollinations rung (text answer, not E_TURN_FAILED)');

// --- Static roster untouched (zero edits to COWORKERS) ----------------------
ok(coworkerChain('memory')[0].key === 'gemini' && coworkerChain('memory')[0].model === 'gemini-3.6-flash',
  'static roster untouched: coworkerChain(memory) still documents gemini as its primary');
ok(coworkerChain('researcher')[0].key === 'groq' && coworkerChain('researcher')[0].model === 'openai/gpt-oss-120b',
  'static roster untouched: researcher still groq-led');
const researcher = runtimeChain('researcher', { groqKey: 'present' });
ok(researcher[0].key === 'groq' && researcher[0].model === 'openai/gpt-oss-120b',
  'researcher keeps its OWN groq model choice as the head leg (no default override)');

// --- legConfigured rules ----------------------------------------------------
ok(legConfigured({ key: 'pollinations' }, KEYS()) === true, 'pollinations is always configured (keyless)');
ok(legConfigured({ key: 'vllm' }, KEYS()) === false, 'vllm unconfigured without VLLM_BASE_URL');
process.env.VLLM_BASE_URL = 'http://127.0.0.1:8000/v1';
ok(legConfigured({ key: 'vllm' }, KEYS()) === true, 'vllm configured when VLLM_BASE_URL is set (B74 rule)');
delete process.env.VLLM_BASE_URL;
ok(legConfigured({ key: 'gemini' }, KEYS({ geminiKey: 'k' })) === true, 'gemini configured when its key resolves');
ok(legConfigured({ key: 'gemini' }, KEYS()) === false, 'gemini unconfigured without a key');

// --- runWorker end-to-end through the deterministic test seam ---------------
process.env.GROQ_API_KEY = 'sandbox-proof-key'; // presence only — the mock seam never dials out
try {
  const res = await runWorker('memory', 'The user asked: "2+2"', 'You are JEXI OS.', {
    tools: [{ type: 'function', function: { name: 'memory-recall', description: 'recall', parameters: { type: 'object', properties: {} } } }],
    __mockCompletions: [{ text: '2 + 2 = 4.' }],
  });
  ok(res.ok === true && String(res.text).includes('2 + 2 = 4'),
    'runWorker end-to-end: tool lane completes OK (deterministic seam, zero network)');
} catch (e) {
  ok(false, `runWorker end-to-end threw: ${e.message}`);
}
delete process.env.GROQ_API_KEY;

// --- intent routing sanity (memory coworker owns general chat) --------------
ok(coworkerFor('direct_answer') === 'memory' && coworkerFor('conversation') === 'memory',
  'general chat still routes to the memory coworker (now groq-capable)');

console.log(`\n== RESULT: ${passed} passed, ${failed} failed ==`);
process.exit(failed ? 1 : 0);
