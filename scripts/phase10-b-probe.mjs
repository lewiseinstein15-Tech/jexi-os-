import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createState } from '../harness/state/index.js';
import { basePrompt } from '../harness/immutable/index.js';
import { Journal } from '../harness/state/journal.js';
import { bind } from '../harness/state/skills.js';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'phase10-b-'));
const originalCwd = process.cwd();
const fixtures = {
  'prompt-notes': { text: 'Check the evidence before reporting.' },
  skills: { name: 'review', description: 'Review changes', whenToUse: 'Before commit' },
  memory: { key: 'language', value: 'English' },
  'subagent-specs': { name: 'reviewer', instructions: 'Review only the authorized diff.' },
};
const patches = { 'prompt-notes': { text: 'Report measured evidence.' }, skills: { description: 'Review the staged diff' }, memory: { value: 'English only' }, 'subagent-specs': { instructions: 'Inspect and cite test output.' } };
const masked = records => records.map(({ timestamp, ...rest }) => rest);
let passed = 0;
const pass = label => { passed++; console.log(`PASS ${label}`); };
let child;
try {
  console.log('P1 — CRUD round-trip per collection');
  const state = createState({ directory: path.join(root, 'p1') });
  const ids = {};
  for (const [collection, entry] of Object.entries(fixtures)) {
    const created = state.create(collection, entry); ids[collection] = created.id;
    assert.deepEqual(state.read(collection, created.id), created);
    const updated = state.update(collection, created.id, patches[collection]);
    assert.deepEqual(state.read(collection, created.id), updated);
    assert.deepEqual(state.list(collection), [updated]);
    console.log(JSON.stringify({ collection, created, read: created, updated, readUpdated: state.read(collection, created.id) }));
    pass(`P1 ${collection} create/read/update/read/list`);
  }
  assert.deepEqual(state.delete('prompt-notes', ids['prompt-notes']), { removed: true });
  assert.equal(state.read('prompt-notes', ids['prompt-notes']), null);
  assert.deepEqual(state.list('prompt-notes'), []);
  console.log(JSON.stringify({ deleted: ids['prompt-notes'], lists: Object.fromEntries(Object.keys(fixtures).map(k => [k, state.list(k)])) }));
  pass('P1 deletion reflected in list; other collections intact');

  console.log('P2 — journal records every successful mutation');
  const records = state.journal.read();
  const lines = fs.readFileSync(state.journal.path, 'utf8').trimEnd().split('\n');
  assert.equal(lines.length, 9);
  assert.deepEqual(records.map(r => r.op), ['create', 'update', 'create', 'update', 'create', 'update', 'create', 'update', 'delete']);
  console.log(`journal lines=${lines.length}; expected=4 creates + 4 updates + 1 delete = 9`);
  for (const { seq, op, collection, id, timestamp } of records) console.log(JSON.stringify({ seq, op, collection, id, timestamp }));
  pass('P2 all nine mutations logged; reads/list do not add records');

  console.log('P3 — immutable base prompt');
  process.chdir(root); // singleton default journal stays inside disposable fixture
  const baseline = basePrompt.read();
  console.log(`basePrompt.read()=${JSON.stringify(baseline)}`);
  assert.ok(Object.isFrozen(basePrompt));
  assert.throws(() => state.update('base-prompt', 'constitutional', { text: 'replace' }), { code: 'E_IMMUTABLE_VIOLATION' });
  console.log('state.update(base-prompt): E_IMMUTABLE_VIOLATION');
  assert.throws(() => { basePrompt.read = () => 'replaced'; }, { code: 'E_IMMUTABLE_VIOLATION' });
  console.log('exported basePrompt.read assignment: E_IMMUTABLE_VIOLATION');
  assert.throws(() => { delete basePrompt.read; }, { code: 'E_IMMUTABLE_VIOLATION' });
  assert.throws(() => Object.defineProperty(basePrompt, 'text', { value: 'replace' }), { code: 'E_IMMUTABLE_VIOLATION' });
  assert.throws(() => Object.setPrototypeOf(basePrompt, {}), { code: 'E_IMMUTABLE_VIOLATION' });
  assert.throws(() => basePrompt.assertUnchanged('different previous text'), { code: 'E_IMMUTABLE_VIOLATION' });
  assert.equal(basePrompt.read(), baseline);
  assert.equal(basePrompt.assertUnchanged(baseline), true);
  const refused = [...state.journal.read().filter(r => r.op === 'immutable-violation'), ...new Journal().read()];
  assert.equal(refused.length, 6);
  for (const r of refused) console.log(JSON.stringify(r));
  console.log('unchanged=true; Object.isFrozen=true; refused attempts logged=6');
  pass('P3 CRUD bypass/direct assignment/delete/define/prototype/prior mismatch refused and logged');

  console.log('P4 — determinism across fresh independent stores');
  function sequence(directory) {
    const s = createState({ directory });
    const returns = [];
    for (const [c, entry] of Object.entries(fixtures)) {
      const created = s.create(c, entry); returns.push(created);
      returns.push(s.update(c, created.id, patches[c]));
      if (c === 'prompt-notes') returns.push(s.delete(c, created.id));
    }
    return { returns, state: Object.fromEntries(Object.keys(fixtures).map(c => [c, s.list(c)])), journal: masked(s.journal.read()) };
  }
  const a = sequence(path.join(root, 'det-a')), b = sequence(path.join(root, 'det-b'));
  assert.deepEqual(a, b);
  console.log(`identical returns=true; identical state=true; identical journal (timestamps masked)=true; operations=${a.journal.length}`);
  pass('P4 deterministic IDs, state, return values and journal');

  console.log('P5 — process A creates, SIGKILL, process B reads');
  const moduleUrl = new URL('../harness/state/index.js', import.meta.url).href;
  const directory = path.join(root, 'process');
  child = spawn(process.execPath, ['--input-type=module', '-e', `import {createState} from ${JSON.stringify(moduleUrl)}; const s=createState({directory:${JSON.stringify(directory)}}); const entry=s.create('memory',{key:'restart',value:'survived'}); process.send(entry); setInterval(()=>{},1000);`], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  const timer = setTimeout(() => child?.kill('SIGKILL'), 10000);
  let entry;
  try {
    entry = await Promise.race([once(child, 'message').then(([value]) => value), once(child, 'exit').then(([code, signal]) => { throw new Error(`writer exited before ack: ${code}/${signal}`); })]);
  } finally { clearTimeout(timer); }
  const exited = once(child, 'exit');
  child.kill('SIGKILL');
  const [code, signal] = await exited;
  assert.equal(signal, 'SIGKILL');
  console.log(JSON.stringify({ process: 'A', pid: child.pid, created: entry, exitCode: code, signal }));
  child = spawn(process.execPath, ['--input-type=module', '-e', `import {createState} from ${JSON.stringify(moduleUrl)}; const s=createState({directory:${JSON.stringify(directory)}}); console.log(JSON.stringify(s.read('memory',${JSON.stringify(entry.id)})));`], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', d => { stdout += d; }); child.stderr.on('data', d => { stderr += d; });
  const [readCode] = await once(child, 'close');
  assert.equal(readCode, 0, stderr); assert.deepEqual(JSON.parse(stdout), entry);
  console.log(JSON.stringify({ process: 'B', pid: child.pid, read: JSON.parse(stdout), persisted: true }));
  pass('P5 durable state survives actual writer SIGKILL');

  console.log('ADDITIONAL — rejection, isolation, append-only and concurrent writer checks');
  const priorBytes = fs.readFileSync(state.journal.path);
  const adapter = bind(state);
  const skill = adapter.list()[0]; skill.description = 'caller mutation';
  assert.notEqual(adapter.read(skill.id).description, skill.description);
  assert.throws(() => adapter.update(skill.id, { id: 'new-id' }), { code: 'E_ID_IMMUTABLE' });
  assert.throws(() => state.create('skills', { name: 'incomplete' }), { code: 'E_ENTRY_SCHEMA' });
  assert.throws(() => state.create('../escape', {}), { code: 'E_COLLECTION_UNKNOWN' });
  assert.throws(() => adapter.create(adapter.read(skill.id)), { code: 'E_ENTRY_EXISTS' });
  assert.throws(() => adapter.delete('absent'), { code: 'E_ENTRY_NOT_FOUND' });
  assert.deepEqual(fs.readFileSync(state.journal.path), priorBytes);
  adapter.update(skill.id, { description: 'new append' });
  assert.deepEqual(fs.readFileSync(state.journal.path).subarray(0, priorBytes.length), priorBytes);
  pass('defensive copies; invalid writes do not log; successful write preserves full journal prefix');
  const other = createState({ directory: path.join(root, 'p1') });
  assert.equal(other.read('skills', skill.id).description, 'new append');
  fs.writeFileSync(`${state.journal.path}.lock`, 'held');
  assert.throws(() => adapter.update(skill.id, { description: 'blocked' }), { code: 'E_JOURNAL_BUSY' });
  fs.unlinkSync(`${state.journal.path}.lock`);
  pass('fresh replay sees other instance writes; occupied writer lock fails closed');
  const corrupt = createState({ directory: path.join(root, 'corrupt') });
  fs.writeFileSync(corrupt.journal.path, '{"incomplete":');
  assert.throws(() => corrupt.list('memory'), { code: 'E_JOURNAL_CORRUPT' });
  pass('torn journal tail detected, not silently discarded or rewritten');
  console.log(`TOTAL ${passed} PASS ${passed} FAIL 0`);
} finally {
  if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  process.chdir(originalCwd);
  fs.rmSync(root, { recursive: true, force: true });
}
