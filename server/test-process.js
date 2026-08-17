/**
 * Stage 11 (process subsystem) tests — spawn real short-lived commands.
 */
import fs from 'fs';
import path from 'path';
import os from 'os';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jexi-proc-test-'));
process.env.DATA_DIR = path.join(tmp, 'data');

const { startProcess, listProcesses, getProcessLog, stopProcess, deleteProcess } =
  await import('./src/services/ProcessManager.js');

let passed = 0, failed = 0;
function check(name, ok) {
  if (ok) { passed++; console.log('✅ ' + name); }
  else { failed++; console.log('❌ ' + name); }
}

const waitFor = async (fn, timeoutMs = 10000) => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (fn()) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return fn();
};

/* ---------------- start + capture output ---------------- */
const p = startProcess('echo hello-jexi-process', { timeoutMs: 15000 });
check('startProcess returns a running record', p.status === 'running' && Boolean(p.id) && Boolean(p.pid));

const logOk = await waitFor(() => (getProcessLog(p.id) || '').includes('hello-jexi-process'));
check('stdout is captured', logOk);

const exited = await waitFor(() => listProcesses().find((x) => x.id === p.id)?.status !== 'running');
check('process reaches a terminal status', exited);
const rec = listProcesses().find((x) => x.id === p.id);
check('short command exits cleanly', rec && rec.status === 'exited' && rec.exitCode === 0);

/* ---------------- stop a long-running process ---------------- */
const slow = startProcess('sleep 30', { timeoutMs: 60000 });
check('long process starts', slow.status === 'running');
const stopped = stopProcess(slow.id);
check('stopProcess succeeds', stopped.success === true);
check('stopProcess refuses for finished processes', stopProcess(slow.id).success === false);
// Race guard: stopProcess returns before the child's async 'close' handler
// persists. If that persist fires AFTER the fake registry is written below,
// it clobbers the file and the interrupted-on-load check reads the real
// registry instead. Wait for the close handler (log line 'exited with code').
for (let i = 0; i < 30; i++) {
  const rec = listProcesses().find((x) => x.id === slow.id);
  if (rec && /exited with code/.test(rec.log || '')) break;
  await new Promise((r) => setTimeout(r, 50));
}

/* ---------------- delete + persistence ---------------- */
const finished = listProcesses().find((x) => x.id === p.id);
const del = deleteProcess(finished.id);
check('deleteProcess removes finished process', del.success === true && !listProcesses().some((x) => x.id === p.id));

const saved = JSON.parse(fs.readFileSync(path.join(tmp, 'data', 'processes.json'), 'utf-8'));
check('registry persists to disk', Object.keys(saved).length >= 1);

// Simulate a server crash: a registry entry left 'running' must be honestly
// marked 'interrupted' when the module boots fresh.
fs.writeFileSync(path.join(tmp, 'data', 'processes.json'), JSON.stringify({
  'proc-fake': { id: 'proc-fake', command: 'sleep 1', status: 'running', createdAt: Date.now(), log: '' },
}));
const { listProcesses: listFresh } = await import(`./src/services/ProcessManager.js?bust=${Date.now()}`);
check('running processes are marked interrupted on load', listFresh().some((x) => x.id === 'proc-fake' && x.status === 'interrupted'));

console.log(`\n=== RESULT: ${passed} passed, ${failed} failed ===`);
process.exit(failed ? 1 : 0);
