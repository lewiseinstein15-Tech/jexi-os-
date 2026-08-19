/**
 * B126 — AUTONOMOUS CODING regression suite
 * (deepseek-harness tool-bash + tool-fs mirror).
 *
 * Proves: the coding plugin mounts bash/write/read/edit/list_files with the
 * DSH contracts + the coder skill (custom rank 300); the tools execute
 * through the gate (real write→read→edit→bash in an isolated workspace,
 * path safety); the runner drives write→run with files collected; code_task
 * routes to the runner (no team pipeline).
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

// Isolate stores FIRST (config reads env at import).
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jexi-ac-'));
process.env.DATA_DIR = path.join(TMP, 'data');
process.env.WORKSPACE_DIR = path.join(TMP, 'ws');

let passed = 0, failedCount = 0;
const ok = (c, n) => { if (c) { passed++; console.log(`  ✅ ${n}`); } else { failedCount++; console.log(`  ❌ ${n}`); } };

const { loadPlugins, setActivePluginContext, listPluginTools, listPluginSkills } = await import('./src/services/PluginContext.js');
const { executeTool } = await import('./src/services/ToolRuntime.js');
const { discoverSkills, loadSkillForModel } = await import('./src/services/SkillDiscovery.js');
const { runAutonomousCoding } = await import('./src/services/AutonomousCoding.js');
const { planner } = await import('./src/services/Planner.js');

console.log('\n== 1. Coding plugin mounts the DSH tool set + skill ==');
const { ctx, loaded, failed } = await loadPlugins({ services: {} });
setActivePluginContext(ctx);
ok(failed.length === 0, 'all plugins load');
ok(loaded.some((p) => p.name === 'coding'), 'coding plugin loaded');
const tools = listPluginTools();
for (const slug of ['bash', 'write', 'read', 'edit', 'list_files']) {
  ok(tools.some((t) => t.slug === slug), `${slug} mounted (DSH tool-bash/tool-fs)`);
}
const skills = listPluginSkills();
ok(skills.some((s) => s.slug === 'coder'), 'coder skill registered');
const disc = discoverSkills().find((c) => c.name === 'coder');
ok(!!disc && disc.rank === 300, 'coder skill discovered at custom rank 300');
const body = loadSkillForModel('coder');
ok(!!body && /Coder Skill/.test(String(body.content || '')), 'coder skill body loads');
ok(String(body.content || '').includes('WRITE') || String(body.content || '').includes('write'), 'skill teaches the write→run→fix loop');

console.log('\n== 2. Tools through the gate (real workspace) ==');
const w = await executeTool({ slug: 'write', args: { file_path: 'app.js', content: 'console.log("hi");' } });
ok(w.ok === true && /"operation": "create"/.test(String(w.result || '')), 'write creates (operation=create, DSH contract)');
const r = await executeTool({ slug: 'read', args: { file_path: 'app.js' } });
ok(r.ok === true && /console\.log/.test(String(r.result || '')), 'read returns content');
const e = await executeTool({ slug: 'edit', args: { file_path: 'app.js', old_string: '"hi"', new_string: '"hello"' } });
ok(e.ok === true && /"operation": "edit"/.test(String(e.result || '')), 'edit replaces exactly (DSH edit)');
const r2 = await executeTool({ slug: 'read', args: { file_path: 'app.js' } });
ok(/hello/.test(String(r2.result || '')), 'edit applied');
const b = await executeTool({ slug: 'bash', args: { command: 'node app.js', description: 'run the app' } });
ok(b.ok === true && /hello/.test(String(b.result || '')), 'bash runs the written code and captures output');
const bBad = await executeTool({ slug: 'bash', args: { command: 'node does-not-exist.js', description: 'fail' } });
ok(bBad.ok === false || /Error|Cannot find/.test(String(bBad.result || '')), 'bash reports failures honestly');
const l = await executeTool({ slug: 'list_files', args: {} });
ok(l.ok === true && /app\.js/.test(String(l.result || '')), 'list_files finds the file');
const wBad = await executeTool({ slug: 'write', args: { file_path: '../../escape.js', content: 'x' } });
ok(wBad.ok === false, 'path traversal write refused');
const eBad = await executeTool({ slug: 'edit', args: { file_path: 'app.js', old_string: 'not-there', new_string: 'x' } });
ok(eBad.ok === false && /not found/.test(eBad.error || ''), 'edit with missing old_string fails honestly');

console.log('\n== 3. Runner: write → run → summarize with files ==');
const res = await runAutonomousCoding({
  query: 'build a hello app',
  __mockCompletions: [
    { toolCalls: [{ id: 'c1', name: 'write', arguments: '{"file_path":"app.js","content":"console.log(1)"}' }] },
    { toolCalls: [{ id: 'c2', name: 'bash', arguments: '{"command":"node app.js","description":"run"}' }] },
    { text: '## Built\n\nCreated app.js and ran it successfully.\n\nFiles: app.js' },
  ],
  __executeOverride: async (calls) => calls.map((c) => {
    if (c.name === 'write') return { tool_call_id: c.id, content: JSON.stringify({ ok: true, kind: 'write-result', path: 'app.js', operation: 'create', size: 13 }) };
    if (c.name === 'bash') return { tool_call_id: c.id, content: JSON.stringify({ ok: true, kind: 'bash-result', output: '1', code: 0 }) };
    return { tool_call_id: c.id, content: 'ok' };
  }),
});
ok(res.success === true, 'runner completes with an answer');
ok(/Built/.test(res.summary), 'answer summarizes the build');
ok(res.files.some((f) => f.path === 'app.js'), 'files collected from write calls');
ok(res.statistics.fileCount === 1 && res.statistics.toolCalls === 2, 'statistics reflect the run');

console.log('\n== 4. Runner: honest degraded result when providers fail ==');
const bad = await runAutonomousCoding({ query: 'build x', __mockCompletions: [{ toolCalls: [] }] });
// B146 — degraded builds now SUCCEED with a transparent answer: it says the
// build could not complete, names the provider reasons, and tells the user
// what to do (retry / add a key) instead of a vague failure.
ok(bad.success === true && /could not complete the build/i.test(bad.summary) && /AI providers were temporarily unavailable/i.test(bad.summary), 'degraded result is honest + explains why (B146)');
ok(Array.isArray(bad.files), 'files array always present');

console.log('\n== 5. Routing: code_task → the autonomous runner ==');
const p1 = await planner.analyzeIntent('build me a todo app');
ok(p1.intent === 'code_task' || p1.intent === 'compound_task', `build classified as code (${p1.intent})`);
const idx = fs.readFileSync('./index.js', 'utf-8');
ok(/plan\.intent === 'code_task' \|\| plan\.intent === 'compound_task'/.test(idx), 'chat routes code intents to runAutonomousCoding');
ok(/runAutonomousCoding\(/.test(idx), 'runner wired into the main chat path');

console.log(`\nB126 autonomous-coding: ${passed} passed, ${failedCount} failed`);
process.exit(failedCount ? 1 : 0);
