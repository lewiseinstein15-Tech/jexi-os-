/**
 * JEXI OS — Phase 26 Scope A — live probe for the observe hook.
 * Run: node scripts/phase26-a-probe.mjs
 */
import fs from 'node:fs';
import { createObserve } from '../instincts/observe/index.js';

let pass = 0, fail = 0;
const ok = (cond, label) => { if (cond) { pass += 1; console.log('PASS ' + label); } else { fail += 1; console.log('FAIL ' + label); } };
const errOf = (fn) => { try { fn(); return null; } catch (e) { return e; } };

const ROOT = '/tmp/p26-observe';
fs.rmSync(ROOT, { recursive: true, force: true });
const observe = createObserve(ROOT);

// P1 — attach + push + drain
const a = observe.attach('session-alpha', { projectId: 'proj-x' });
const p1 = observe.push({ projectId: 'proj-x', sessionId: 'session-alpha', kind: 'command-run', payload: { cmd: 'npm test' } });
const p2 = observe.push({ projectId: 'proj-x', sessionId: 'session-alpha', kind: 'file-edit', payload: { file: 'a.js' } });
const p3 = observe.push({ projectId: 'proj-x', sessionId: 'session-alpha', kind: 'error-seen', payload: { code: 'E1' } });
const drained = observe.drain('proj-x');
console.log('P1 ' + a.observerId + ' pushed: ' + [p1, p2, p3].map((p) => p.observationId).join(', '));
console.log('P1 drained: ' + drained.map((o) => o.id + ':' + o.kind + '@' + o.at).join(', '));
ok(drained.length === 3 && drained.map((o) => o.id).join() === 'obs-001,obs-002,obs-003', 'P1 drain(proj-x) returns 3 observations in order');

// P2 — project isolation (documented: empty, never cross-project data)
const drainedY = observe.drain('proj-y');
const scopeX = observe.scope('proj-x');
console.log('P2 drain(proj-y)=' + JSON.stringify(drainedY) + ' | scope(proj-x).isolated=' + scopeX.isolated);
ok(drainedY.length === 0, 'P2 drain(proj-y) is EMPTY — no cross-project data (documented: empty, not silent leak)');
ok(observe.drain('proj-x').length === 3 && scopeX.isolated === true, 'P2 proj-x data intact + isolated');
const crossPush = errOf(() => observe.push({ projectId: 'proj-y', sessionId: 'session-alpha', kind: 'x' }));
ok(crossPush && crossPush.code === 'E_SCOPE_MISMATCH', 'P2 push under wrong project -> E_SCOPE_MISMATCH');

// P3 — attach idempotent
const a2 = observe.attach('session-alpha', { projectId: 'proj-x' });
ok(a2.observerId === a.observerId, 'P3 attach twice -> same observerId (' + a2.observerId + ')');

// P4 — detach -> push fails; queue survives
observe.detach(a.observerId);
const afterDetach = errOf(() => observe.push({ projectId: 'proj-x', sessionId: 'session-alpha', kind: 'late' }));
console.log('P4 push after detach -> ' + (afterDetach ? afterDetach.code : 'no error') + ' | queue still ' + observe.drain('proj-x').length);
ok(afterDetach && afterDetach.code === 'E_OBSERVER_DETACHED', 'P4 push after detach -> E_OBSERVER_DETACHED');
ok(observe.drain('proj-x').length === 3, 'P4 queued observations survive detach');

// P5 — determinism: same sequence on a fresh root
const ROOT2 = '/tmp/p26-observe2';
fs.rmSync(ROOT2, { recursive: true, force: true });
const ob2 = createObserve(ROOT2);
ob2.attach('session-alpha', { projectId: 'proj-x' });
ob2.push({ projectId: 'proj-x', sessionId: 'session-alpha', kind: 'command-run', payload: { cmd: 'npm test' } });
ob2.push({ projectId: 'proj-x', sessionId: 'session-alpha', kind: 'file-edit', payload: { file: 'a.js' } });
ob2.push({ projectId: 'proj-x', sessionId: 'session-alpha', kind: 'error-seen', payload: { code: 'E1' } });
ok(JSON.stringify(observe.drain('proj-x')) === JSON.stringify(ob2.drain('proj-x')), 'P5 same push sequence -> byte-identical drain output');

// P7 — drain diagnostic for missing project (stderr, raw via child process)
const { spawnSync } = await import('node:child_process');
const child = spawnSync(process.execPath, ['-e',
  "import('/home/user/jexi-os-/instincts/observe/index.js').then(({ createObserve }) => {" +
  "const o = createObserve('/tmp/p26-observe');" +
  "const r = o.drain('project-that-does-not-exist');" +
  "console.log('RETURN=' + JSON.stringify(r));" +
  "});",
], { encoding: 'utf8' });
console.log('P7 child stdout: ' + child.stdout.trim());
console.log('P7 child stderr: ' + child.stderr.trim());
ok(
  child.stdout.trim() === 'RETURN=[]' &&
  child.stderr.includes('[jexi:observe] drain called for project with no observations dir: project-that-does-not-exist'),
  'P7 drain(missing project) -> [] AND stderr diagnostic line'
);

console.log('');
console.log('SCOPE A: ' + pass + '/' + (pass + fail) + ' PASS, ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);
