import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { createSessions } from '../runtime/workgraph/session/index.js';
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'p10e-'));
const api = createSessions({ directory });
const view = id => api.tree.reconstruct(id, { branch: id }).branchView;
function chain(id, count) { const s = api.store(id); let parentId = null; const nodes = []; for (let i = 0; i < count; i++) { const n = s.append({ parentId, kind: 'turn', payload: { value: i } }); nodes.push(n); parentId = n.id; } return nodes; }
let passed = 0, child;
const pass = x => { passed++; console.log(`PASS ${x}`); };
try {
  console.log('P1'); const original = chain('parent', 5); const tree = api.tree.reconstruct('parent');
  assert.equal(tree.nodes.length, 5); assert.equal(tree.edges.length, 4); assert.equal(tree.rootId, original[0].id); console.log(JSON.stringify(tree)); pass('P1');
  console.log('P2'); const fork = api.branch.fork('parent', original[2].id); console.log(JSON.stringify(fork)); let tip = fork.newBranchHeadId; const own = [];
  for (let i = 0; i < 3; i++) { const n = api.store(fork.newBranchId).append({ parentId: tip, kind: 'turn', payload: { value: `fork-${i}` } }); own.push(n); tip = n.id; }
  const parent = view('parent'), branch = view(fork.newBranchId), union = api.tree.reconstruct('parent');
  const shared = parent.branchNodeIds.filter(id => branch.branchNodeIds.includes(id));
  assert.equal(parent.nodes.length, 5); assert.equal(branch.nodes.length, 6); assert.equal(union.nodes.length, 8);
  assert.equal(branch.branchHeadId, own[2].id); assert.equal(parent.branchHeadId, original[4].id);
  assert.equal(own[0].parentId, original[2].id); assert.equal(original[3].parentId, original[2].id); assert.deepEqual(shared, original.slice(0, 3).map(n => n.id));
  console.log(JSON.stringify({ parentCount: 5, forkCount: 6, unionCount: 8, parentTip: parent.branchHeadId, forkTip: branch.branchHeadId, shared, forkFirstParent: own[0].parentId, parentNode3Parent: original[3].parentId })); pass('P2 ancestor-prefix fork');
  console.log('P3'); api.store(fork.newBranchId).update(original[1].id, { value: 'fork-only' });
  assert.equal(view('parent').nodes[1].payload.value, 1); assert.equal(view(fork.newBranchId).nodes[1].payload.value, 'fork-only');
  console.log(JSON.stringify({ parentValue: view('parent').nodes[1].payload, forkValue: view(fork.newBranchId).nodes[1].payload })); pass('P3 shared-node copy-on-write override');
  console.log('P4'); const clone = api.branch.clone('parent'); const cs = api.store(clone);
  cs.append({ parentId: view(clone).branchHeadId, kind: 'turn', payload: { cloned: true } }); assert.equal(view('parent').nodes.length, 5);
  const cloneBefore = JSON.stringify(view(clone)); api.store('parent').append({ parentId: view('parent').branchHeadId, kind: 'turn', payload: { parent: true } });
  assert.equal(JSON.stringify(view(clone)), cloneBefore); assert.equal(view(clone).nodes.length, 6); assert.ok(!view(clone).branchNodeIds.some(id => view('parent').branchNodeIds.includes(id)));
  console.log(JSON.stringify({ clone, parentCount: view('parent').nodes.length, cloneCount: view(clone).nodes.length, sharedIds: 0, independent: true })); pass('P4');
  console.log('P5'); chain('long', 20); const before = JSON.stringify(api.tree.reconstruct('long'));
  const file = api.store('long').path, prefix = fs.readFileSync(file); const result = api.compact.run('long', { threshold: 20 });
  assert.equal(result.before, 20); assert.equal(result.after, 3); assert.equal(api.compact.physical('long').length, 3); assert.equal(api.compact.reconstruct('long').nodes.length, 20);
  assert.deepEqual(fs.readFileSync(file).subarray(0, prefix.length), prefix);
  console.log(JSON.stringify({ ...result, physicalKinds: api.compact.physical('long').map(n => n.kind), journalLinesBefore: prefix.toString().trim().split('\n').length, journalLinesAfter: fs.readFileSync(file, 'utf8').trim().split('\n').length, logicalNodes: 20, appendOnly: true })); pass('P5');
  console.log('P6'); assert.equal(JSON.stringify(api.compact.reconstruct('long')), before); console.log('logicalTreeByteIdentical=true (no timestamp masking needed)'); pass('P6');
  console.log('P7'); const url = new URL('../runtime/workgraph/session/index.js', import.meta.url).href;
  const setup = `import {createSessions} from ${JSON.stringify(url)}; const api=createSessions({directory:${JSON.stringify(directory)}});`;
  child = spawn(process.execPath, ['--input-type=module', '-e', setup + `let parentId=null;for(let i=0;i<5;i++)parentId=api.store('crash').append({parentId,kind:'turn',payload:{i}}).id;process.send({ready:true});setInterval(()=>{},1000);`], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  const timer = setTimeout(() => child.kill('SIGKILL'), 10000);
  try { await Promise.race([once(child, 'message'), once(child, 'exit').then(() => { throw new Error('WRITER_DIED_BEFORE_ACK'); })]); } finally { clearTimeout(timer); }
  const exit = once(child, 'exit'); child.kill('SIGKILL'); const [, signal] = await exit; assert.equal(signal, 'SIGKILL');
  const restart = spawnSync(process.execPath, ['--input-type=module', '-e', setup + `console.log(JSON.stringify(api.tree.reconstruct('crash')));`], { encoding: 'utf8', timeout: 10000 }); assert.equal(restart.status, 0, restart.stderr); assert.equal(JSON.parse(restart.stdout).nodes.length, 5);
  console.log(JSON.stringify({ writerPid: child.pid, signal, readerExit: restart.status })); console.log(restart.stdout.trim()); pass('P7');
  console.log('P8'); const badBefore = fs.readFileSync(api.store('parent').path); assert.throws(() => api.store('parent').append({ parentId: 'absent', kind: 'turn', payload: {} }), { code: 'E_PARENT_NOT_FOUND' });
  assert.deepEqual(fs.readFileSync(api.store('parent').path), badBefore); console.log('E_PARENT_NOT_FOUND; noWrite=true'); pass('P8');
  console.log('P9');
  function fresh(subdir) { const a = createSessions({ directory: path.join(directory, subdir) }); let p = null; for(let i=0;i<5;i++)p=a.store('same').append({parentId:p,kind:'turn',payload:{i}}).id; return a.tree.reconstruct('same').nodes.map(({ts,...n})=>n); }
  assert.deepEqual(fresh('one'),fresh('two')); console.log('identicalSequence=true; timestampsMasked=true'); pass('P9');
  console.log('P10'); chain('A',1);chain('B',1);const beforeB=JSON.stringify(api.tree.reconstruct('B'));
  api.store('A').append({parentId:view('A').branchHeadId,kind:'turn',payload:{onlyA:true}});assert.equal(JSON.stringify(api.tree.reconstruct('B')),beforeB);
  console.log(JSON.stringify({aFile:api.store('A').path,bFile:api.store('B').path,aNodes:view('A').nodes.length,bNodes:view('B').nodes.length,bUnchanged:true}));pass('P10');
  console.log('EXTRA — compaction restart, thresholds, preserved branch boundaries');
  const compactRestart = spawnSync(process.execPath, ['--input-type=module', '-e', setup + `console.log(JSON.stringify(api.compact.reconstruct('long')));`], { encoding: 'utf8', timeout: 10000 });
  assert.equal(compactRestart.status, 0, compactRestart.stderr); assert.equal(compactRestart.stdout.trim(), before);
  const compactBytes = fs.readFileSync(file); api.compact.run('long'); assert.deepEqual(fs.readFileSync(file), compactBytes);
  const shortBytes = fs.readFileSync(api.store('A').path); assert.equal(api.compact.run('A').checkpointId, null); assert.deepEqual(fs.readFileSync(api.store('A').path), shortBytes);
  const boundaryNodes = chain('boundaries', 20); const boundaryFork = api.branch.fork('boundaries', boundaryNodes[9].id);
  api.store(boundaryFork.newBranchId).append({parentId:boundaryNodes[9].id,kind:'turn',payload:{branch:true}});
  const unionBefore = JSON.stringify(api.tree.reconstruct('boundaries')); api.compact.run('boundaries');
  assert.ok(api.compact.physical('boundaries').some(n=>n.id===boundaryNodes[9].id)); assert.equal(JSON.stringify(api.tree.reconstruct('boundaries')),unionBefore);
  assert.throws(()=>api.store('A').append({parentId:'A:0',kind:'turn',payload:{}}),{code:'E_BRANCH_HEAD_REQUIRED'});
  assert.throws(()=>api.store('A').update('A:0',{bad:()=>1}),{code:'E_JSON_VALUE'});
  console.log('compactFreshProcessByteIdentical=true; repeatCompactNoWrite=true; belowThresholdNoWrite=true; forkBoundaryPreserved=true; invalidWritesRefused=true');
  pass('EXTRA');
  console.log(`TOTAL ${passed} PASS ${passed} FAIL 0`);
} finally { if(child && child.exitCode===null && child.signalCode===null)child.kill('SIGKILL');fs.rmSync(directory,{recursive:true,force:true}); }
