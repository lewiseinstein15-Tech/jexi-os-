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
ok(/preset\.mode \|\| 'auto'/.test(idx), 'server defaults to auto when no mode header');
ok(/let autoDirect = false;/.test(idx), 'auto-routing flag present');
ok(/isDirectIntent\(dec\.intent\)/.test(idx), 'routing uses isDirectIntent');
ok(/confidence \|\| 0\) >= 0\.6/.test(idx), 'confidence gate ≥ 0.6');
ok(/\(mode === 'normal' \|\| autoDirect\) && !image/.test(idx), 'direct block runs for normal OR autoDirect');

console.log('\n== 3. Frontend: AUTO is the default everywhere ==');
const hook = fs.readFileSync('../src/hooks/useJexiEngine.js', 'utf-8');
ok(/jexi_mode'\) \|\| 'auto'/.test(hook), 'useJexiEngine defaults to auto');
const home = fs.readFileSync('../src/components/HomeView.jsx', 'utf-8');
ok(/jexi_mode'\) \|\| 'auto'/.test(home), 'Home pill defaults to auto');
ok(/AUTO → AGENT → NORMAL/.test(home) || /mode === 'auto' \? 'agent'/.test(home), 'pill cycles AUTO → AGENT → NORMAL');
ok(/\? <> <Zap|Zap className/.test(home), 'pill shows an AUTO label');
const settings = fs.readFileSync('../src/components/SettingsPanel.jsx', 'utf-8');
ok(/key === 'minimal' \? 'normal' : 'auto'/.test(settings), 'presets set auto (except minimal → normal)');

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

console.log(`\nB114+B116 auto-mode: ${passed} passed, ${failedCount} failed`);
process.exit(failedCount ? 1 : 0);
