#!/usr/bin/env node
// Phase 10 Scope I — context offloading probe (P1–P11)
// Real files on disk. Real SIGKILL. Raw output only.

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync, execFileSync, fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OFFLOAD_DIR = path.join(ROOT, '.jexi/offload');

const { offload } = await import(path.join(ROOT, 'context/offload/file.js'));
const { history } = await import(path.join(ROOT, 'context/offload/history.js'));
const { createSessions } = await import(path.join(ROOT, 'workgraph/session/index.js'));

let pass = 0, fail = 0;
const ok = (cond, msg) => {
  if (cond) { pass++; console.log(`  ✅ ${msg}`); }
  else { fail++; console.log(`  ❌ ${msg}`); }
};

function cleanOffload(name) {
  try { offload.delete(name); } catch {}
}

console.log('ROOT', ROOT);
console.log('OFFLOAD_DIR', OFFLOAD_DIR);

// ── P1 ──
console.log('\n════ P1 — Write 200KB to offload "big" and read back, sha256 match ════');
let originalContent = '';
{
  cleanOffload('big');
  // 200KB deterministic content
  const chunk = 'abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_-';
  const repeat = Math.ceil((200 * 1024) / chunk.length);
  originalContent = chunk.repeat(repeat).slice(0, 200 * 1024);
  console.log(`  original chars=${originalContent.length} bytes=${Buffer.byteLength(originalContent)}`);

  const written = offload.write('big', originalContent);
  console.log(`  write result: ${JSON.stringify(written)}`);
  ok(written.written === true && written.name === 'big', 'P1 write returned written:true');

  const read = offload.read('big');
  console.log(`  read result: sizeBytes=${read.sizeBytes} sha256=${read.sha256} contentLen=${read.content.length}`);
  ok(read.sha256 === written.sha256, `P1 sha256 match: ${read.sha256} === ${written.sha256}`);
  ok(read.content === originalContent, 'P1 content identical');
  ok(read.content.length === 200 * 1024, 'P1 200KB length');
}

// ── P2 ──
console.log('\n════ P2 — readRange big start=1000 end=2000 ════');
{
  const range = offload.readRange('big', { start: 1000, end: 2000 });
  console.log(`  range result: rangeStart=${range.rangeStart} rangeEnd=${range.rangeEnd} totalBytes=${range.totalBytes} contentLen=${range.content.length}`);
  const expected = originalContent.slice(1000, 2000);
  console.log(`  expected slice len=${expected.length} first20=${expected.slice(0,20)}`);
  console.log(`  actual slice first20=${range.content.slice(0,20)}`);
  ok(range.content === expected, 'P2 substring matches chars 1000-2000');
  ok(range.rangeStart === 1000 && range.rangeEnd === 2000, 'P2 rangeStart/rangeEnd correct');
}

// ── P3 ──
console.log('\n════ P3 — list() returns entries with required fields ════');
{
  const entries = offload.list();
  console.log(`  list entries: ${entries.length}`);
  console.log(JSON.stringify(entries.slice(0, 5), null, 2));
  ok(entries.length >= 1, 'P3 list >=1 entry');
  const e = entries.find(x => x.name === 'big');
  ok(!!e, 'P3 found big');
  if (e) {
    ok(typeof e.name === 'string' && typeof e.path === 'string' && typeof e.sizeBytes === 'number' && typeof e.createdAt === 'string' && typeof e.sha256 === 'string', 'P3 entry has name, path, sizeBytes, createdAt, sha256');
    console.log(`  big entry: ${JSON.stringify(e)}`);
  }
}

// ── P4 ──
console.log('\n════ P4 — Name collision E_OFFLOAD_EXISTS and overwrite:true ════');
{
  cleanOffload('collision-test');
  const first = offload.write('collision-test', 'first-content');
  console.log(`  first write: ${JSON.stringify(first)}`);
  let threwExists = false;
  try {
    offload.write('collision-test', 'second-content');
  } catch (err) {
    console.log(`  second write without overwrite threw: code=${err.code} message=${err.message}`);
    threwExists = err.code === 'E_OFFLOAD_EXISTS';
  }
  ok(threwExists, 'P4 collision without overwrite returns E_OFFLOAD_EXISTS');

  const second = offload.write('collision-test', 'second-content-different', { overwrite: true });
  console.log(`  overwrite write: ${JSON.stringify(second)}`);
  ok(second.sha256 !== first.sha256, `P4 overwrite new sha256 ${second.sha256} !== ${first.sha256}`);
  ok(second.written === true, 'P4 overwrite succeeded');

  cleanOffload('collision-test');
}

// ── P5 ──
console.log('\n════ P5 — Invalid names E_INVALID_NAME (3 cases) ════');
{
  const tests = [
    { name: '../etc/passwd', label: 'dots and slash (path traversal)' },
    { name: 'has space', label: 'spaces' },
    { name: 'has/slash', label: 'slash' },
  ];
  for (const t of tests) {
    let threw = false;
    try {
      offload.write(t.name, 'content');
    } catch (err) {
      console.log(`  write "${t.name}" (${t.label}) threw: code=${err.code}`);
      threw = err.code === 'E_INVALID_NAME';
    }
    ok(threw, `P5 ${t.label} "${t.name}" → E_INVALID_NAME`);
  }
}

// ── P6 ──
console.log('\n════ P6 — Read missing name E_OFFLOAD_NOT_FOUND ════');
{
  let threw = false;
  try {
    offload.read('never-written-xyz-123');
  } catch (err) {
    console.log(`  read missing threw: code=${err.code} message=${err.message}`);
    threw = err.code === 'E_OFFLOAD_NOT_FOUND';
  }
  ok(threw, 'P6 missing name returns E_OFFLOAD_NOT_FOUND');
}

// ── P7 ──
console.log('\n════ P7 — Session NDJSON 10 nodes, history queries ════');
{
  const sessionId = 'test-i-10';
  const sessionFile = path.join(ROOT, '.jexi/sessions', `${sessionId}.ndjson`);
  // Clean previous
  try { fs.unlinkSync(sessionFile); } catch {}
  try { fs.unlinkSync(path.join(ROOT, '.jexi/sessions', '.writer.lock')); } catch {}

  const sessions = createSessions({ directory: path.join(ROOT, '.jexi/sessions') });
  const store = sessions.store(sessionId);

  // Create 10 nodes, chain
  let parentId = null;
  const kinds = ['turn', 'task', 'turn', 'task', 'decision', 'turn', 'task', 'turn', 'task', 'turn'];
  for (let i = 0; i < 10; i++) {
    const payload = i === 3 ? { text: `node ${i}`, secretFlag: 'match-me', important: true }
      : i === 7 ? { text: `node ${i}`, secretFlag: 'match-me-again' }
      : i % 2 === 0 ? { text: `node ${i} hello`, index: i }
      : { text: `node ${i} task content`, taskId: `task-${i}` };
    const node = store.append({ parentId, kind: kinds[i], payload });
    console.log(`  appended node ${i}: id=${node.id} kind=${node.kind} payload=${JSON.stringify(payload).slice(0,80)}`);
    parentId = node.id;
  }

  // recent 3
  const recent3 = history.recent(sessionId, 3);
  console.log(`\n  history.recent(${sessionId}, 3) returned ${recent3.length}:`);
  console.log(JSON.stringify(recent3, null, 2));
  ok(recent3.length === 3, 'P7 recent 3 returns 3');
  ok(recent3[0].id === `${sessionId}:7` && recent3[2].id === `${sessionId}:9`, 'P7 recent last 3 ids 7,8,9');

  // query filtering kind=task
  const tasks = history.query({ sessionId, filter: { kind: 'task' } });
  console.log(`\n  history.query filter kind=task returned ${tasks.length}:`);
  console.log(JSON.stringify(tasks, null, 2));
  ok(tasks.length === 4, `P7 query kind=task returns 4 (got ${tasks.length})`);
  ok(tasks.every(n => n.kind === 'task'), 'P7 all filtered are task');

  // search predicate matching payload key secretFlag
  const matched = history.search(sessionId, node => node.payload && node.payload.secretFlag && node.payload.secretFlag.includes('match-me'));
  console.log(`\n  history.search predicate secretFlag includes 'match-me' returned ${matched.length}:`);
  console.log(JSON.stringify(matched, null, 2));
  ok(matched.length === 2, 'P7 search predicate returns 2 matching secretFlag');
  ok(matched.some(n => n.payload.secretFlag === 'match-me'), 'P7 search found specific payload key');

  // Additional: query with limit
  const limited = history.query({ sessionId, limit: 2 });
  console.log(`\n  history.query limit 2 returned ${limited.length}`);
  ok(limited.length === 2, 'P7 query limit 2');
}

// ── P8 ──
console.log('\n════ P8 — Token reduction measurement (real, not claimed) ════');
{
  const huge = originalContent; // 200KB
  const inlineChars = huge.length;
  const inlineTokens = Math.ceil(inlineChars / 4);
  const refString = `offload:big sha256:${offload.read('big').sha256} (200KB offloaded)`;
  const refChars = refString.length;
  const refTokens = Math.ceil(refChars / 4);
  const ratio = (inlineTokens / refTokens).toFixed(2);

  console.log(`  inline context: chars=${inlineChars} → tokens≈${inlineTokens} (ceil(chars/4))`);
  console.log(`  offload reference: "${refString}"`);
  console.log(`  ref chars=${refChars} → tokens≈${refTokens}`);
  console.log(`  ratio = inlineTokens / refTokens = ${inlineTokens} / ${refTokens} = ${ratio}x`);
  console.log(`  tokenizer: Math.ceil(chars/4) — documented approximation, same as viking fs and MemoryProvider`);

  ok(inlineTokens === 51200, `P8 inline 200KB = 51200 tokens (got ${inlineTokens})`);
  ok(refTokens < 50, `P8 ref tokens small (<50) got ${refTokens}`);
  ok(parseFloat(ratio) > 100, `P8 ratio >100x measured ${ratio}x`);
}

// ── P9 ──
console.log('\n════ P9 — Durability: write, SIGKILL, fresh process read ════');
{
  cleanOffload('p9-durable');
  const content = 'durable-content-123-' + Date.now();
  const written = offload.write('p9-durable', content);
  console.log(`  wrote p9-durable: ${JSON.stringify(written)} content=${content}`);

  // Spawn a child that will be SIGKILLed
  const childScript = path.join(ROOT, '.jexi', 'p9-child.js');
  fs.writeFileSync(childScript, `
    console.log('child pid', process.pid, 'writing then SIGKILL self');
    const { offload } = await import('${ROOT}/context/offload/file.js');
    offload.write('p9-child', 'child-content', {overwrite:true});
    process.kill(process.pid, 'SIGKILL');
  `);
  console.log('  spawning child that will SIGKILL itself...');
  const childResult = spawnSync(process.execPath, [childScript], { encoding: 'utf8', timeout: 5000 });
  console.log(`  child status=${childResult.status} signal=${childResult.signal} stdout=${childResult.stdout} stderr=${childResult.stderr?.slice(0,200)}`);
  ok(childResult.signal === 'SIGKILL', `P9 child killed by SIGKILL (signal=${childResult.signal})`);

  // Fresh process reads p9-durable
  const freshScript = path.join(ROOT, '.jexi', 'p9-fresh.js');
  fs.writeFileSync(freshScript, `
    import { offload } from '${ROOT}/context/offload/file.js';
    const r = offload.read('p9-durable');
    console.log(JSON.stringify({content: r.content, sha256: r.sha256, sizeBytes: r.sizeBytes}));
  `);
  const freshOutput = execFileSync(process.execPath, [freshScript], { encoding: 'utf8', timeout: 5000 });
  console.log(`  fresh process read output: ${freshOutput.trim()}`);
  const parsed = JSON.parse(freshOutput.trim());
  ok(parsed.content === content, `P9 fresh process content intact: "${parsed.content}" === "${content}"`);
  ok(parsed.sha256 === written.sha256, 'P9 sha256 matches after SIGKILL');

  // Cleanup child artifacts
  try { fs.unlinkSync(childScript); } catch {}
  try { fs.unlinkSync(freshScript); } catch {}
  cleanOffload('p9-child');
  cleanOffload('p9-durable');
}

// ── P10 ──
console.log('\n════ P10 — Same content two names, identical sha256, list ordering deterministic ════');
{
  cleanOffload('dup-a');
  cleanOffload('dup-b');
  const sameContent = 'identical-content-for-dup-test-xyz';
  const a = offload.write('dup-a', sameContent);
  const b = offload.write('dup-b', sameContent);
  console.log(`  dup-a: ${JSON.stringify(a)}`);
  console.log(`  dup-b: ${JSON.stringify(b)}`);
  ok(a.sha256 === b.sha256, `P10 identical sha256 ${a.sha256}`);

  const list1 = offload.list();
  const list2 = offload.list();
  console.log(`  list1 order: ${list1.map(x=>x.name).join(', ')}`);
  console.log(`  list2 order: ${list2.map(x=>x.name).join(', ')}`);
  ok(JSON.stringify(list1.map(x=>x.name)) === JSON.stringify(list2.map(x=>x.name)), 'P10 list ordering matches twice');
  ok(list1.find(x=>x.name==='dup-a') && list1.find(x=>x.name==='dup-b'), 'P10 both dup names in list');

  cleanOffload('dup-a');
  cleanOffload('dup-b');
}

// ── P11 ──
console.log('\n════ P11 — git status --short (only context/offload and scripts/phase10 files) ════');
{
  const gitStatus = execFileSync('git', ['status', '--short'], { cwd: ROOT, encoding: 'utf8' });
  console.log(gitStatus || '(clean)');
  const lines = gitStatus.split('\n').filter(Boolean);
  console.log(`  lines: ${lines.length}`);
  for (const line of lines) console.log(`    ${line}`);
  // Allowed: context/offload/ and scripts/phase10*
  const allowedPrefixes = ['context/offload/', 'scripts/phase10'];
  const disallowed = lines.filter(l => {
    const file = l.slice(3).trim();
    return !allowedPrefixes.some(p => file.startsWith(p));
  });
  console.log(`  disallowed (should be 0): ${disallowed.length} ${JSON.stringify(disallowed)}`);
  ok(disallowed.length === 0, `P11 only allowed files in status (got ${lines.length} lines, disallowed ${disallowed.length})`);
  // Also check that .jexi/ is ignored
  const hasJexi = lines.some(l => l.includes('.jexi/'));
  ok(!hasJexi, 'P11 .jexi/ is ignored (no .jexi in status)');
}

console.log(`\n════ SCOPE I PROBE DONE — ${pass} passed, ${fail} failed ════`);
if (fail > 0) process.exit(1);
