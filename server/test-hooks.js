/**
 * Stage 22 (hook engine) tests — all deterministic, isolated DATA_DIR.
 */
import fs from 'fs';
import path from 'path';
import os from 'os';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jexi-hook-test-'));
process.env.DATA_DIR = path.join(tmp, 'data');

const { listHooks, addHook, updateHook, removeHook, runHooks } =
  await import('./src/services/HookEngine.js');

let passed = 0, failed = 0;
function check(name, ok) {
  if (ok) { passed++; console.log('✅ ' + name); }
  else { failed++; console.log('❌ ' + name); }
}

/* ---------------- CRUD + validation ---------------- */
const deny = addHook({ name: 'No memory writes', event: 'beforeTool', matcher: 'memory-write', action: 'deny', message: 'memory writes are off' });
check('addHook returns a hook with id', Boolean(deny.id) && deny.action === 'deny');
check('listHooks contains it', listHooks().some((h) => h.id === deny.id));

let threw = false;
try { addHook({ event: 'bogus' }); } catch (e) { threw = true; }
check('unknown event rejected', threw);

/* ---------------- Matcher + actions ---------------- */
const allow = runHooks('beforeTool', { tool: 'web-search', query: 'solar' });
check('non-matching hook does not fire', allow.allowed === true && allow.logs.length === 0);

const blocked = runHooks('beforeTool', { tool: 'memory-write', query: 'remember x' });
check('deny hook blocks matching tool', blocked.allowed === false && blocked.blocked?.name === 'No memory writes');

const logHook = addHook({ name: 'Watch searches', event: 'beforeTool', matcher: 'web-search', action: 'log', message: 'search observed' });
const logged = runHooks('beforeTool', { tool: 'web-search' });
check('log hook records but allows', logged.allowed === true && logged.logs.includes('Watch searches'));

/* ---------------- Events + disable ---------------- */
check('afterTool hooks do not fire on beforeTool', runHooks('afterTool', { tool: 'web-search' }).logs.length === 0);
updateHook(deny.id, { enabled: false });
check('disabled hook is skipped', runHooks('beforeTool', { tool: 'memory-write' }).allowed === true);
updateHook(deny.id, { enabled: true });

/* ---------------- Removal + persistence ---------------- */
removeHook(logHook.id);
check('removeHook works', !listHooks().some((h) => h.id === logHook.id));
const saved = JSON.parse(fs.readFileSync(path.join(tmp, 'data', 'hooks.json'), 'utf-8'));
check('hooks persist to disk', Array.isArray(saved) && saved.some((h) => h.id === deny.id));

/* ---------------- ToolRuntime integration ---------------- */
process.env.WORKSPACE_DIR = path.join(tmp, 'ws');
const { executeTool } = await import('./src/services/ToolRuntime.js');
const blockedTool = await executeTool({ slug: 'memory-write', args: { fact: 'x', label: 'y' }, profile: 'auto' });
check('ToolRuntime honors a deny hook', blockedTool.blocked === true && blockedTool.byHook === 'No memory writes');

removeHook(deny.id);
const allowedTool = await executeTool({ slug: 'memory-write', args: { fact: 'hook test fact', label: 'test' }, profile: 'auto' });
check('ToolRuntime runs after hook removed', allowedTool.ok === true);

console.log(`\n=== RESULT: ${passed} passed, ${failed} failed ===`);
process.exit(failed ? 1 : 0);
