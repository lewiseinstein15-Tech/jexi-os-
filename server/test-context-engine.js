/**
 * M4 — CONTEXT COMPILER regression suite.
 *
 * Proves: compileSections() enforces total char+token budgets over ordered
 * prompt sections (lowest priority drops first, `keep` survives, one
 * pathological section is clipped, never fatal); assemble() reports token
 * usage and honors maxTokens without ever dropping the live instruction;
 * buildRepoMap() renders a bounded workspace tree (skip lists, file caps,
 * manifest peeks, safe on missing roots); the live compiler
 * (assemblePrompt) enforces budgets by default, stays byte-stable for
 * normal prompts, and injects the repo map when given repoRoot; and the
 * autonomous coder wires its task workspace through with compile stats.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

// Isolate stores FIRST (config reads env at import).
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jexi-ctx4-'));
process.env.DATA_DIR = path.join(TMP, 'data');
process.env.WORKSPACE_DIR = path.join(TMP, 'ws');

let passed = 0, failedCount = 0;
const ok = (c, n) => { if (c) { passed++; console.log(`  ✅ ${n}`); } else { failedCount++; console.log(`  ❌ ${n}`); } };

const CE = await import('./src/services/ContextEngine.js');
const { assemblePrompt } = await import('./src/services/PromptAssembly.js');

console.log('\n== 1. compileSections: priority drops, keep survives ==');
const fat = 'x'.repeat(5000);
const c1 = CE.compileSections(
  [{ name: 'persona', content: 'WHOAMI', keep: true }, { name: 'skills', content: fat }, { name: 'thread', content: fat }],
  { maxChars: 6000, maxTokens: 50000 }
);
ok(c1.kept[0] === 'persona' && c1.text.includes('WHOAMI'), 'keep section survives the budget');
ok(c1.trimmed.some((t) => t === 'dropped:thread'), 'lowest-priority section drops first');
ok(c1.chars <= 6001, `total honors maxChars (${c1.chars})`);
ok(c1.tokens > 0 && Number.isInteger(c1.tokens), `token usage reported (${c1.tokens})`);

console.log('\n== 2. compileSections: pathological single section is clipped ==');
const c2 = CE.compileSections(
  [{ name: 'persona', content: 'WHOAMI', keep: true }, { name: 'files', content: 'y'.repeat(50000) }],
  { maxChars: 4000, maxTokens: 50000 }
);
ok(c2.text.length <= 4001 && c2.text.includes('WHOAMI'), 'giant section clipped/dropped, output within budget');
ok(c2.trimmed.length > 0, `trimming is reported (${c2.trimmed.join(', ')})`);

console.log('\n== 3. compileSections: token cap bites when chars do not ==');
// Dense low-whitespace text: many chars but few "words" — the char budget
// alone would pass while tokens overflow; use a tiny token cap to force it.
const c3 = CE.compileSections(
  [{ name: 'persona', content: 'WHOAMI', keep: true }, { name: 'bulk', content: ('word '.repeat(2000)) }],
  { maxChars: 100000, maxTokens: 100 }
);
ok(c3.tokens <= 100 && c3.kept.includes('persona'), `maxTokens enforced (${c3.tokens} tokens)`);
ok(c3.trimmed.some((t) => t === 'dropped:bulk'), 'token overflow drops the low-priority section');

console.log('\n== 4. assemble: token usage + maxTokens, instruction never dropped ==');
const a1 = CE.assemble({ instruction: 'do the thing', task: { title: 't', brief: 'b'.repeat(5000) } }, { budget: { maxTokens: 400 } });
ok(typeof a1.usage.tokens === 'number' && a1.usage.tokens <= 400, `usage.tokens reported and capped (${a1.usage.tokens})`);
ok(a1.messages[a1.messages.length - 1].content.includes('do the thing'), 'live instruction is the final message, always');
const a2 = CE.assemble({ instruction: 'x'.repeat(100) }, {});
ok(a2.usage.sections.includes('instruction') && a2.trimmed.length === 0, 'small assembly passes through untouched');

console.log('\n== 5. buildRepoMap: bounded tree, skips, peeks, safe roots ==');
const repo = path.join(TMP, 'repo');
fs.mkdirSync(path.join(repo, 'src', 'deep'), { recursive: true });
fs.mkdirSync(path.join(repo, 'node_modules', 'junk'), { recursive: true });
fs.mkdirSync(path.join(repo, '.git'), { recursive: true });
fs.writeFileSync(path.join(repo, 'package.json'), JSON.stringify({ name: 'demo', version: '1.0.0' }));
fs.writeFileSync(path.join(repo, 'src', 'index.js'), 'console.log(1)');
fs.writeFileSync(path.join(repo, 'src', 'deep', 'x.js'), 'x');
for (let i = 0; i < 30; i++) fs.writeFileSync(path.join(repo, 'src', `f${i}.js`), `// ${i}`);
const map = CE.buildRepoMap(repo);
ok(map.includes('src/') && map.includes('index.js'), 'tree lists real files');
ok(!map.includes('node_modules') && !map.includes('.git'), 'junk dirs skipped');
ok(map.includes('"name": "demo"') || map.includes('"name":"demo"'), 'package.json peeked');
ok(!map.includes('f29.js') || map.length <= 4001, 'bounded output');
const capped = CE.buildRepoMap(repo, { maxFiles: 5 });
ok(capped.includes('truncated at 5'), 'file cap truncates with a note');
ok(CE.buildRepoMap(path.join(TMP, 'nope')) === '', 'missing root returns empty, never throws');
ok(CE.buildRepoMap(path.join(repo, 'package.json')) === '', 'file root returns empty');
ok(CE.getCachedRepoMap(repo) === map, 'mtime cache returns the identical map');

console.log('\n== 6. retrieveRelevant + checkpoint never throw ==');
const rel = await CE.retrieveRelevant({ query: 'test', limit: 4 });
ok(Array.isArray(rel), 'retrieveRelevant returns an array offline');
const cp = CE.checkpoint([{ summary: 'did a' }, { summary: 'did b' }]);
ok(cp.includes('did a') && cp.includes('2 results'), 'checkpoint compresses deterministically');

console.log('\n== 7. Live compiler: budgeted by default, stable when small ==');
const s1 = {};
const p1 = await assemblePrompt({ stats: s1 });
ok(typeof p1 === 'string' && p1.length > 1000, 'assemblePrompt still returns a plain string');
ok(s1.chars === p1.length && s1.tokens > 0 && Array.isArray(s1.kept), 'stats filled (chars/tokens/kept)');
ok(s1.trimmed.length === 0, 'normal prompt untouched (zero trims = byte-stable)');
const s2 = {};
const p2 = await assemblePrompt({ budget: { maxChars: 2000 }, stats: s2 });
ok(p2.length <= 2001 && s2.trimmed.length > 0, 'tiny budget enforced with trim report');
ok(s2.kept.includes('persona'), 'persona survives even a tiny budget');

console.log('\n== 8. Live compiler: repoRoot injects the repo map ==');
const p3 = await assemblePrompt({ repoRoot: repo });
ok(p3.includes('Repo map (repo/)') && p3.includes('index.js'), 'repo-map section present with real files');
ok(!p3.includes('node_modules'), 'map section carries no junk dirs');

console.log('\n== 9. Coder wires its task workspace + compile stats ==');
const { activateTaskWorkspace, writeWorkspace } = await import('./src/services/WorkspaceRuntime.js');
const { WORKSPACE_DIR } = await import('./src/config.js');
const { runAutonomousCoding } = await import('./src/services/AutonomousCoding.js');
activateTaskWorkspace('m4-probe');
writeWorkspace('probe.js', 'console.log("m4")');
ok(fs.existsSync(path.join(WORKSPACE_DIR, 'probe.js')), 'staging area holds the probe file');
const run = await runAutonomousCoding({ query: 'noop', __mockCompletions: [{ toolCalls: [] }] });
ok(typeof run.statistics.contextChars === 'number' && run.statistics.contextChars > 0, `compile stats ride home (chars=${run.statistics.contextChars})`);
ok(typeof run.statistics.contextTokens === 'number' && Array.isArray(run.statistics.contextTrimmed), 'tokens + trim list present');
const p4 = await assemblePrompt({ repoRoot: WORKSPACE_DIR });
ok(p4.includes('probe.js'), 'staging area maps through the compiler');

console.log(`\nM4 context-engine: ${passed} passed, ${failedCount} failed`);
process.exit(failedCount ? 1 : 0);
