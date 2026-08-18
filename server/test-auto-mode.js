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
ok(DIRECT_INTENTS.size === 5, 'direct set has exactly the 5 conversational intents');

console.log('\n== 2. Mode resolution: default is AUTO ==');
const idx = fs.readFileSync('./index.js', 'utf-8');
ok(/preset\.mode === 'normal' \? 'normal' : 'auto'/.test(idx), 'server defaults to auto when no mode header (preset never forces agent)');
ok(/let autoDirect = false;/.test(idx), 'auto-routing flag present');
ok(/isDirectIntent\(dec\.intent\)/.test(idx), 'routing uses isDirectIntent');
ok(/dec\.confidence === undefined \|\| dec\.confidence >= 0\.5/.test(idx), 'deterministic (no confidence) trusted; LLM needs ≥ 0.5');
ok(/preset\.mode === 'normal' \? 'normal' : 'auto'/.test(idx), 'preset no longer forces agent — only minimal forces direct');
ok(/\(mode === 'normal' \|\| autoDirect\) && !image/.test(idx), 'direct block runs for normal OR autoDirect');

console.log('\n== 3. Frontend: ONE mode — no toggle, JEXI decides (B117) ==');
const hook = fs.readFileSync('../src/hooks/useJexiEngine.js', 'utf-8');
ok(!/x-jexi-mode/.test(hook.replace(/No x-jexi-mode header is ever sent/, '')), 'engine never sends x-jexi-mode');
ok(!/jexi_mode/.test(hook), 'engine no longer reads jexi_mode');
ok(/x-jexi-preset/.test(hook), 'preset header still rides along');
const chat = fs.readFileSync('../src/components/ChatWindow.jsx', 'utf-8');
ok(!/> AGENT</.test(chat) && !/> NORMAL</.test(chat), 'ChatWindow has NO agent/normal toggle buttons');
ok(!/MODE_STORAGE|toggleMode/.test(chat), 'ChatWindow has no mode state/toggle');
ok(/AUTO · JEXI DECIDES/.test(chat), 'ChatWindow shows the static AUTO badge');
ok(!/onSend\([^)]*,\s*[^)]*,\s*[^)]*,\s*mode\)/.test(chat), 'send no longer passes a mode argument (the B117 freeze bug)');
const home = fs.readFileSync('../src/components/HomeView.jsx', 'utf-8');
ok(!/toggleMode/.test(home) && !/jexi_mode/.test(home), 'HomeView has no mode pill/toggle');
ok(/ONE MODE · JEXI DECIDES/.test(home), 'Home shows the one-mode badge');
const settings = fs.readFileSync('../src/components/SettingsPanel.jsx', 'utf-8');
ok(!/jexi_mode/.test(settings), 'presets no longer write jexi_mode');

console.log('\n== 4. Regression: no TDZ crash (B116-fix) ==');
const idxLines = idx.split('\n');
const modeDecl = idxLines.findIndex((l) => l.includes("const mode = String(req.body.mode"));
const autoUse = idxLines.findIndex((l) => l.includes("if (mode === 'auto')"));
ok(modeDecl !== -1 && autoUse !== -1, 'both lines present');
ok(modeDecl < autoUse, `mode declared BEFORE the auto block (decl ${modeDecl} < use ${autoUse}) — no "Cannot access 'mode' before initialization"`);
const modeDecls = idxLines.filter((l) => l.includes("const mode = String(req.body.mode")).length;
ok(modeDecls === 1, `exactly ONE mode declaration (${modeDecls}) — duplicate removed`);
const presetAfterMode = idxLines.slice(modeDecl).filter((l) => l.includes("const preset = resolvePreset")).length;
ok(presetAfterMode === 0, `no preset declaration AFTER mode in the chat handler (${presetAfterMode}) — the duplicate is gone`);

console.log(`\nB114+B116+B117 auto-mode: ${passed} passed, ${failedCount} failed`);
process.exit(failedCount ? 1 : 0);
