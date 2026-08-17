/**
 * B99 — CODE MODE (PTC) regression suite (deepseek-harness `code` preset
 * mirror: run_code transport + generated TS SDK + worker-thread runtime).
 *
 * Proves: SDK rendering, program execution with tool-call bindings,
 * ToolCallError semantics, JSON-only arguments/results, log capture +
 * output limits, parallel read calls, runaway-program budget kill, and the
 * run_code tool through the gated ToolRuntime with its output contract.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

// Isolate stores FIRST (config reads env at import).
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jexi-code-'));
process.env.DATA_DIR = path.join(TMP, 'data');
process.env.WORKSPACE_DIR = path.join(TMP, 'ws');

let passed = 0, failedCount = 0;
const ok = (c, n) => { if (c) { passed++; console.log(`  ✅ ${n}`); } else { failedCount++; console.log(`  ❌ ${n}`); } };

const { renderToolsSdk, runCodeProgram, buildRunCodeSchema, RUN_CODE_NAME } = await import('./src/services/CodeModeRuntime.js');
const { executeTool } = await import('./src/services/ToolRuntime.js');

const DEFS = [
  { slug: 'web-search', name: 'Web Search', desc: 'Search the web for current information.' },
  { slug: 'todo', name: 'Todo List', desc: 'Manage a visible task list: add, list, complete.' },
];

console.log('\n== 1. Generated SDK (dsh tools:sdk mirror) ==');
const sdk = renderToolsSdk(DEFS);
ok(sdk.includes('## Writing code for run_code'), 'SDK usage instructions present');
ok(sdk.includes('interface ToolArgsMap'), 'ToolArgsMap declared');
ok(sdk.includes('interface ToolOutputMap'), 'ToolOutputMap declared');
ok(sdk.includes('type ToolName = keyof ToolOutputMap'), 'ToolName union declared');
ok(sdk.includes('declare class ToolCallError extends Error'), 'ToolCallError declared');
ok(sdk.includes('declare const tools'), 'tools binding declared');
ok(sdk.includes('web-search') && sdk.includes('todo'), 'every visible tool declared');
ok(sdk.includes('ToolArgsMap') === true, 'deterministic output shape');
const sdk2 = renderToolsSdk([DEFS[1], DEFS[0]]);
ok(sdk2 === sdk, 'deterministic — input order does not change output (sorted)');
const schema = buildRunCodeSchema();
ok(schema.function.name === RUN_CODE_NAME, 'run_code schema name');
ok(schema.function.parameters.required.includes('code') && schema.function.parameters.required.includes('description'), 'code+description required (dsh parameters)');

console.log('\n== 2. Program execution: logs + JSON result ==');
const r1 = await runCodeProgram({
  code: `const t = await tools.ping({ message: 'hi' }); console.log('ping said', t.message); return { ok: true, echoed: t.message };`,
  toolNames: ['ping'],
  isReadTool: () => true,
  dispatch: async (name, args) => ({ message: args.message }),
});
ok(r1.result && r1.result.ok === true && r1.result.echoed === 'hi', 'return value is JSON, dispatched args intact');
ok(r1.logs.length === 1 && r1.logs[0].includes('ping said hi'), 'console.log captured into logs');
ok(r1.toolCalls === 1 && !r1.error, 'one sub-call, no error');

console.log('\n== 3. ToolCallError semantics (dsh: try/catch + toolName) ==');
const r2 = await runCodeProgram({
  code: `let caught = null; try { await tools.bad({}); } catch (e) { caught = e.name + ':' + e.toolName + ':' + e.message; } return caught;`,
  toolNames: ['bad'],
  isReadTool: () => true,
  dispatch: async () => { throw new Error('denied by permission gate'); },
});
ok(r2.result === 'ToolCallError:bad:denied by permission gate', 'failed call rejects with ToolCallError carrying toolName + message');

console.log('\n== 4. Honest failures ==');
const r3 = await runCodeProgram({ code: `throw new Error('boom');`, toolNames: [], isReadTool: () => true, dispatch: async () => null });
ok(r3.error === 'boom', 'program exception surfaces as error');
const r4 = await runCodeProgram({ code: `return { a: undefined };`, toolNames: [], isReadTool: () => true, dispatch: async () => null });
ok(!!r4.error && /JSON/i.test(r4.error), 'non-JSON return value rejected loudly');
const r5 = await runCodeProgram({ code: `await tools.x({ f: () => 1 });`, toolNames: ['x'], isReadTool: () => true, dispatch: async () => null });
ok(!!r5.error && /lossless JSON/i.test(r5.error), 'non-JSON arguments rejected');

console.log('\n== 5. Runaway program killed with a clean budget error ==');
const r6 = await runCodeProgram({
  code: `while (true) {}`,
  toolNames: [], isReadTool: () => true, dispatch: async () => null,
  maxRunMs: 1200,
});
ok(!!r6.error && /budget/.test(r6.error), `runaway loop → budget error (${r6.error})`);

console.log('\n== 6. Parallel read calls (dsh concurrency contract) ==');
const started = Date.now();
const r7 = await runCodeProgram({
  code: `await Promise.all([tools.a({}), tools.b({}), tools.c({})]); return 'parallel done';`,
  toolNames: ['a', 'b', 'c'],
  isReadTool: () => true,
  dispatch: async () => { await new Promise((res) => setTimeout(res, 300)); return {}; },
  maxParallel: 3,
});
const elapsed = Date.now() - started;
ok(r7.result === 'parallel done' && r7.toolCalls === 3, '3 parallel read calls completed');
ok(elapsed < 800, `ran concurrently, not serially (${elapsed}ms < 800ms)`);

console.log('\n== 7. run_code through the gated ToolRuntime ==');
const codeTools = [
  { slug: 'todo', name: 'Todo List', desc: 'Manage a visible task list.' },
  { slug: 'skill-search', name: 'Skill Search', desc: 'Search the discovered skill catalog.' },
];
const toolRes = await executeTool({
  slug: 'run_code',
  args: {
    code: `const t = await tools.todo({ op: 'list' }); const s = await tools['skill-search']({ query: 'zzz' }); return { todos: (t.todos || []).length, skills: (s.results || []).length };`,
    description: 'Compose two tools in one program',
  },
  codeTools,
});
ok(toolRes.ok === true, 'run_code executes through the gate');
ok(toolRes.result && /"kind": "code-run"/.test(String(toolRes.result)), 'output contract kind=code-run');
ok(toolRes.result && /"toolCalls": 2/.test(String(toolRes.result)), 'two sub-calls recorded');
const blockedRes = await executeTool({ slug: 'run_code', args: { code: `return 1;`, description: '' } });
ok(blockedRes.ok === true, 'empty description tolerated (defaults)');
const badRes = await executeTool({ slug: 'run_code', args: { code: '', description: 'empty' } });
ok(badRes.ok === false && /code body/.test(badRes.error || ''), 'empty code body fails honestly');

console.log('\n== 8. Contract: run_code cannot recurse into itself ==');
const recurse = await executeTool({
  slug: 'run_code',
  args: { code: `try { await tools.run_code({ code: 'return 1;', description: 'nested' }); } catch (e) { return e.name + ':' + e.toolName; } return 'no-error';`, description: 'recursion guard' },
  codeTools: [{ slug: 'run_code', name: 'Run Code', desc: 'itself' }],
});
ok(recurse.result && /ToolCallError/.test(String(recurse.result)), 'run_code inside a program rejects with ToolCallError (no recursion)');

console.log(`\nB99 code-mode: ${passed} passed, ${failedCount} failed`);
process.exit(failedCount ? 1 : 0);
