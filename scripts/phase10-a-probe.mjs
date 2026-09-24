import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { PersistentRepl, ContextVariable } from '../runtime/rlm/kernel/index.js';
let passed = 0;
function check(name, fn) { fn(); console.log(`PASS ${++passed}: ${name}`); }
const repl = new PersistentRepl();
check('1+1 -> 2', () => assert.equal(repl.eval('1+1').result, 2));
check('const x = 5; x * 3 -> 15', () => assert.equal(repl.eval('const x = 5; x * 3').result, 15));
check('set task=build; NEW eval reads build', () => {
  repl.eval("context.set('task', 'build')");
  assert.equal(repl.eval("context.get('task')").result, 'build');
});
check('lexical x persists across turns', () => assert.equal(repl.eval('x').result, 5));
check('scoped ctx + console output', () => assert.deepEqual(repl.eval("console.log(ctx.label); ctx.n * x", { label: 'turn', n: 2 }), { result: 10, output: 'turn\n' }));
check('ctx resets at next turn', () => assert.equal(repl.eval('ctx.n').result, undefined));
check('mutable lexical state', () => { repl.eval('let count = 1;'); assert.equal(repl.eval('++count').result, 2); });
check('runtime error returned, namespace remains', () => { assert.equal(repl.eval("throw new Error('example')").error.message, 'example'); assert.equal(repl.eval('x').result, 5); });
const snapshot = JSON.parse(JSON.stringify(repl.snapshot()));
const restored = PersistentRepl.restore(snapshot);
check('snapshot/restore lexical + slots', () => { assert.equal(restored.eval('x + count').result, 7); assert.equal(restored.eval("context.get('task')").result, 'build'); });
check('restore in a NEW Node process', () => {
  const moduleUrl = new URL('../runtime/rlm/kernel/index.js', import.meta.url).href;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', `import {PersistentRepl} from ${JSON.stringify(moduleUrl)}; import fs from 'node:fs'; const r=PersistentRepl.restore(JSON.parse(fs.readFileSync(0,'utf8'))); console.log(JSON.stringify([r.eval('x + count').result,r.eval("context.get('task')").result]));`], { input: JSON.stringify(snapshot), encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr); assert.deepEqual(JSON.parse(child.stdout), [7, 'build']);
});
check('state does NOT leak to another REPL', () => { const other = new PersistentRepl(); assert.equal(other.eval('typeof x').result, 'undefined'); assert.deepEqual(other.context.list(), []); other.eval('Array.prototype.leak = 1'); assert.equal(repl.eval('[].leak').result, undefined); });
check('restored branch independent', () => { restored.eval('count = 99'); restored.context.set('task', 'changed'); assert.equal(repl.eval('count').result, 2); assert.equal(repl.context.get('task'), 'build'); });
check('context named slots are copied, not aliased', () => { const c = new ContextVariable(); const v = { a: [1] }; c.set('prompt', v); v.a.push(2); const got = c.get('prompt'); got.a.push(3); assert.deepEqual(c.get('prompt'), { a: [1] }); assert.deepEqual(c.list(), ['prompt']); });
check('non-JSON context refused', () => assert.throws(() => repl.context.set('bad', () => 1), /RLM_CONTEXT_JSON_REQUIRED/));
check('timeout bounded + unsupported snapshot refused', () => { const r = new PersistentRepl({ timeout: 20 }); assert.match(r.eval('while(true){}').error.message, /timed out/); assert.throws(() => r.snapshot(), /UNSUPPORTED_STATE/); });
check('tampered replay observation refused', () => { const bad = structuredClone(snapshot); bad.journal[0].response = '{}'; assert.throws(() => PersistentRepl.restore(bad), /REPLAY_DIVERGED/); });
console.log(`TOTAL ${passed} PASS ${passed} FAIL 0`);
