/**
 * B114 — AUTO MODE regression suite: JEXI decides direct vs agent per query.
 *
 * Proves: DIRECT_INTENTS routing (conversation/direct_answer/translate/
 * math_solve/creative_writing → direct; code_task/research/news → agent),
 * confidence gating, and the mode resolution defaults (auto when absent).
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

// Isolate stores FIRST (config reads env at import).
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jexi-auto-'));
process.env.DATA_DIR = path.join(TMP, 'data');
process.env.WORKSPACE_DIR = path.join(TMP, 'ws');

let passed = 0, failedCount = 0;
const ok = (c, n) => { if (c) { passed++; console.log(`  ✅ ${n}`); } else { failedCount++; console.log(`  ❌ ${n}`); } };

const { isDirectIntent, DIRECT_INTENTS } = await import('./src/services/Planner.js');

console.log('\n== 1. Direct intents (conversational → answered directly) ==');
for (const i of ['conversation', 'direct_answer', 'translate', 'math_solve', 'creative_writing']) {
  ok(isDirectIntent(i) === true, `${i} → direct`);
}
for (const i of ['code_task', 'research', 'news_latest', 'study_topic', 'github', 'data', 'link_analysis', 'knowledge_recall', 'docs', 'perf', 'compound_task']) {
  ok(isDirectIntent(i) === false, `${i} → agent pipeline`);
}
ok(DIRECT_INTENTS.size === 10, `direct set has the 5 conversational + 5 plugin intents (${DIRECT_INTENTS.size})`);

console.log('\n== 2. Mode resolution: default is AUTO (B158-era: planner-complexity routing) ==');
// B114/B117 implemented auto-mode with inline flags in index.js
// (`let autoDirect`, `isDirectIntent(dec.intent)`, …). B66/B157 moved that
// routing INTO the Planner: every task is classified, SIMPLE intents
// (single-shot, conversational + direct answers) take the runSimpleTask
// fast path and everything else runs the agent pipeline — the same
// "default is auto, preset never forces agent" behavior, one layer down.
const idx = fs.readFileSync('./index.js', 'utf-8');
const plannerSrc = fs.readFileSync('./src/services/Planner.js', 'utf-8');
ok(/plan\.complexity === 'SIMPLE'/.test(idx), 'server routes SIMPLE plans to the fast path (auto-direct)');
ok(/runSimpleTask/.test(idx), 'simple fast path wired (runSimpleTask)');
ok(/SIMPLE_INTENTS\s*=\s*new Set\[?\(?\[?/.test(plannerSrc) || /SIMPLE_INTENTS = new Set/.test(plannerSrc), 'planner owns the SIMPLE (direct) intent set');
ok(/plan\.complexity = SIMPLE_INTENTS\.has\(plan\.intent\) \? 'SIMPLE' : 'COMPLEX'/.test(plannerSrc), 'auto-routing classifies every task (default AUTO, no mode header needed)');
ok(/export function isDirectIntent/.test(plannerSrc), 'routing still exposes isDirectIntent');
ok(!/x-jexi-mode/.test(idx), 'no forced-mode header on the server (preset never forces agent)');

console.log('\n== 3. Frontend: ONE mode — no toggle, JEXI decides (B117) ==');
const hook = fs.readFileSync('../src/hooks/useJexiEngine.js', 'utf-8');
ok(!/x-jexi-mode/.test(hook.replace(/No x-jexi-mode header is ever sent/, '')), 'engine never sends x-jexi-mode');
ok(!/jexi_mode/.test(hook), 'engine no longer reads jexi_mode');
ok(/x-jexi-preset/.test(hook), 'preset header still rides along');
const chat = fs.readFileSync('../src/components/ChatWindow.jsx', 'utf-8');
ok(!/> AGENT</.test(chat) && !/> NORMAL</.test(chat), 'ChatWindow has NO agent/normal toggle buttons');
ok(!/MODE_STORAGE|toggleMode/.test(chat), 'ChatWindow has no mode state/toggle');
// v3 redesign: the badge is GONE entirely (monochrome minimal shell) — the
// one-mode invariant now lives in the absence of any mode UI + the engine
// never sending the mode header (checked above).
ok(!/JEXI DECIDES/.test(chat) && !/MODE/.test(chat), 'ChatWindow has no mode badge at all (v3 minimal)');
ok(/onSend\(t, image\)/.test(chat) || /handleComposerSend/.test(chat), 'send passes the composer draft + image (B195 isolated Composer)');
ok(!/onSend\([^)]*,\s*[^)]*,\s*[^)]*,\s*mode\)/.test(chat), 'send no longer passes a mode argument (the B117 freeze bug)');
const home = fs.readFileSync('../src/components/HomeView.jsx', 'utf-8');
ok(!/toggleMode/.test(home) && !/jexi_mode/.test(home), 'HomeView has no mode pill/toggle');
ok(/ONE MODE · JEXI DECIDES/.test(home), 'Home shows the one-mode badge');
const settings = fs.readFileSync('../src/components/SettingsPanel.jsx', 'utf-8');
ok(!/jexi_mode/.test(settings), 'presets no longer write jexi_mode');

console.log('\n== 4. Regression: classification BEFORE dispatch (B66/B157-era TDZ successor) ==');
// The old TDZ regression watched `const mode` vs the auto block in index.js.
// Routing now lives in the Planner: complexity is set during planning and
// index.js dispatches on it — a plan can never reach runSimpleTask
// unclassified. Same invariant, new shape.
const idxLines = idx.split('\n');
const classifyUses = plannerSrc.includes("plan.complexity = SIMPLE_INTENTS.has(plan.intent) ? 'SIMPLE' : 'COMPLEX'");
const dispatchLine = idxLines.findIndex((l) => l.includes("plan.complexity === 'SIMPLE'"));
const simpleCall = idxLines.findIndex((l) => l.includes('await runSimpleTask'));
ok(classifyUses, 'planner classifies EVERY plan (SIMPLE/COMPLEX) before dispatch');
ok(dispatchLine !== -1 && simpleCall !== -1 && dispatchLine < simpleCall, `dispatch checks complexity BEFORE runSimpleTask (check ${dispatchLine} < call ${simpleCall})`);
ok(idxLines.filter((l) => l.includes('runSimpleTask(')).length === 1, 'exactly ONE runSimpleTask call site');
ok(!/const mode = String\(req\.body\.mode/.test(idx), 'no legacy per-request mode variable left in the handler');

console.log('\n== 5. B124 — plugin fast-path: no search for weather/crypto/currency/time/ip ==');
const { detectPluginIntent } = await import('./src/services/Planner.js');
const PLUGIN_QS = [
  ['what is the weather in Nairobi', 'weather', 'weather-now'],
  ['weather forecast for tokyo tomorrow', 'weather', 'weather-now'],
  ['what is the price of bitcoin', 'crypto_price', 'crypto-price'],
  ['how much is 5 sol in usd', 'crypto_price', 'crypto-price'],
  ['convert 100 usd to ksh', 'currency_convert', 'currency-convert'],
  ['exchange rate usd to kes', 'currency_convert', 'currency-convert'],
  ['what time is it in machakos', 'time_now', 'time-now'],
  ['current time in new york', 'time_now', 'time-now'],
  ['what is my ip', 'ip_geo', 'ip-geo'],
];
for (const [q, intent, tool] of PLUGIN_QS) {
  const d = detectPluginIntent(q);
  ok(d && d.intent === intent && d.tool === tool, `"${q}" → ${intent} via ${tool}`);
  ok(isDirectIntent(intent) === true, `${intent} is a DIRECT intent (no search pipeline)`);
}
ok(detectPluginIntent('what is the capital of kenya') === null, 'non-plugin question not misrouted');
ok(detectPluginIntent('price of eggs in the market') === null, 'non-crypto "price of" not misrouted');
// The direct path must offer plugin tools and NO web-search.
const st = fs.readFileSync('./src/services/SimpleTask.js', 'utf-8');
const al = fs.readFileSync('./src/services/AgentLoop.js', 'utf-8');
ok(/listPluginTools\(\)\.filter/.test(st), 'direct path builds the plugin tool set');
ok(/buildNativeSchemas\(/.test(al), 'tool schemas are built for the model (native function calling)');
ok(/generateWithToolsLoop/.test(al), 'direct path runs a tool loop (not bare text)');
ok(!/web-search/.test(st.slice(st.indexOf('listPluginTools()'), st.indexOf('const system =') > 0 ? st.indexOf('const system =') : undefined)), 'NO web-search in the SIMPLE tool set');

console.log(`\nB114+B116+B117+B124 auto-mode: ${passed} passed, ${failedCount} failed`);
process.exit(failedCount ? 1 : 0);
