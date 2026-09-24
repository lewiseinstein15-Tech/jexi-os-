import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { createDaemon } from '../runtime/rlm/daemon/index.js';
import { readJournal } from '../runtime/rlm/daemon/recovery.js';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'p10d-'));
const daemon = createDaemon({ directory: root });
const journal = path.join(root, 'sessions.ndjson');
const pids = new Set();
function alive(pid) { try { process.kill(pid, 0); return !fs.readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1].startsWith('Z'); } catch { return false; } }
async function until(fn) { for (let i = 0; i < 200; i++) { if (await fn()) return; await new Promise(r => setTimeout(r, 25)); } throw new Error('PROBE_TIMEOUT'); }
let passes = 0;
const pass = x => { passes++; console.log(`PASS ${x}`); };
try {
  console.log('P1'); const info = await daemon.start(); pids.add(info.pid); console.log(JSON.stringify(info)); assert.ok(alive(info.pid)); assert.ok(fs.existsSync(info.endpoint)); assert.equal((await createDaemon({ directory: root }).start()).pid, info.pid);
  console.log(execFileSync('ps', ['-o', 'pid,ppid,stat,args', '-p', String(info.pid)], { encoding: 'utf8' })); pass('P1 real daemon and socket');
  console.log('P2'); const a = await daemon.open('A'); pids.add(a.workerPid); console.log(JSON.stringify(await daemon.listSessions())); assert.equal(a.status, 'running');
  await daemon.eval('A', "const x = 5; context.set('task', 'build'); x * 3"); pass('P2');
  console.log('P3'); await daemon.detach('A'); assert.ok(alive(a.workerPid)); await daemon.attach('A'); const value = await daemon.eval('A', "[x, context.get('task')]"); assert.deepEqual(value.result, [5, 'build']); console.log(JSON.stringify({ workerPid: a.workerPid, alive: true, value })); pass('P3');
  console.log('P4'); const b = await daemon.open('B'); pids.add(b.workerPid); process.kill(b.workerPid, 'SIGKILL');
  await until(async () => (await daemon.listSessions()).find(s => s.id === 'B').status === 'inactive');
  const listed = await daemon.listSessions(); assert.equal(listed.find(s => s.id === 'A').status, 'running'); assert.ok(alive(info.pid)); console.log(JSON.stringify(listed)); pass('P4');
  console.log('P5'); const prefix = fs.readFileSync(journal); process.kill(info.pid, 'SIGKILL'); await until(() => !alive(info.pid) && !alive(a.workerPid));
  const next = await daemon.start(); pids.add(next.pid); const recovered = await daemon.recover('A'); pids.add(recovered.workerPid); console.log(JSON.stringify({ restarted: next, recovered }));
  const restored = await daemon.eval('A', "[x, context.get('task')]"); assert.deepEqual(restored.result, [5, 'build']); console.log(JSON.stringify(restored));
  readJournal(journal).filter(r => r.kind.startsWith('recovery.')).forEach(r => console.log(JSON.stringify(r)));
  assert.deepEqual(fs.readFileSync(journal).subarray(0, prefix.length), prefix); pass('P5 checkpoint replay preserves lexical and named context');
  console.log('P6'); await daemon.stop(); await until(() => !fs.existsSync(next.endpoint) && [...pids].every(pid => !alive(pid))); assert.ok(fs.existsSync(journal));
  const ps = spawnSync('ps', ['-o', 'pid,ppid,stat,args', '-p', [...pids].join(',')], { encoding: 'utf8' }); console.log(ps.stdout); console.log(`ps exit=${ps.status} (1 means no matching processes)`);
  console.log(JSON.stringify({ liveProcesses: [...pids].filter(alive), endpointExists: fs.existsSync(next.endpoint), journalIntact: true })); pass('P6');
  console.log('P7'); console.log(execFileSync('wc', ['-l', journal], { encoding: 'utf8' }).trim());
  const counts = {}; for (const r of readJournal(journal)) counts[r.kind] = (counts[r.kind] || 0) + 1;
  for (const [kind, count] of Object.entries(counts)) console.log(`${kind} ${count}`);
  for (const [kind, count] of Object.entries({ 'session.opened': 2, 'worker.spawned': 2, 'session.detached': 1, 'session.attached': 1, 'worker.died': 1, 'recovery.started': 1, 'recovery.completed': 1, 'session.closed': 2 })) assert.equal(counts[kind], count, kind);
  assert.ok(counts.checkpoint >= 2); pass('P7');
  console.log('P8');
  async function repeat(name) {
    const dir = path.join(root, name); const d = createDaemon({ directory: dir }); const i = await d.start(); pids.add(i.pid);
    try { const s = await d.open('X'); pids.add(s.workerPid); await d.eval('X', "context.set('task','build')"); await d.detach('X'); await d.attach('X'); return readJournal(path.join(dir, 'sessions.ndjson')).map(({ ts, ...r }) => { if (r.payload.pid) delete r.payload.pid; return r; }); }
    finally { await d.stop(); await until(() => !fs.existsSync(i.endpoint)); }
  }
  const one = await repeat('one'), two = await repeat('two'); assert.deepEqual(one, two); console.log(JSON.stringify({ identical: true, records: one.length, structure: one.map(r => r.kind) })); pass('P8');
  console.log('P9'); const last = await daemon.start(); pids.add(last.pid); await assert.rejects(daemon.recover('nonexistent'), { code: 'E_SESSION_NOT_FOUND' }); assert.ok(alive(last.pid)); console.log('E_SESSION_NOT_FOUND; daemonAlive=true'); pass('P9');
  console.log('P10'); const concurrent = await Promise.all(['C', 'D', 'E'].map(id => daemon.open(id))); concurrent.forEach(s => pids.add(s.workerPid));
  assert.equal(new Set(concurrent.map(s => s.workerPid)).size, 3); assert.ok(concurrent.every(s => s.status === 'running' && alive(s.workerPid))); console.log(JSON.stringify(await daemon.listSessions())); pass('P10');
  await daemon.stop(); await until(() => [...pids].every(pid => !alive(pid)));
  console.log(`TOTAL ${passes} PASS ${passes} FAIL 0`);
} finally {
  try { await daemon.stop(); } catch {}
  for (const pid of pids) if (alive(pid)) try { process.kill(pid, 'SIGKILL'); } catch {}
  fs.rmSync(root, { recursive: true, force: true });
}
