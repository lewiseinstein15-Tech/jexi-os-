/**
 * Phase 6 Scope B live probe — raw output only.
 *
 * Boots the REAL server (index.js), then over HTTP:
 *   1. registers a `* * * * *` cron job and waits past a minute boundary to
 *      show it actually fired, printing the Observer event + run record;
 *   2. registers an event-triggered job, emits the event, shows it fired;
 *   3. registers a condition job whose predicate flips true;
 *   4. GET /api/scheduler/jobs → shows real job history.
 *
 * Run with: DOTENV_CONFIG_QUIET=true node scripts/phase6-b-probe.mjs
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVER_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'server');
const PORT = 3299;
const BASE = `http://127.0.0.1:${PORT}`;
// Isolated data dir so repeated probe runs never inherit stale jobs.
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'phase6-b-data-'));
const out = (x) => console.log(JSON.stringify(x, null, 1));
const get = async (p) => (await fetch(`${BASE}${p}`)).json();
const post = async (p, body) => (await fetch(`${BASE}${p}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) })).json();

const child = spawn(process.execPath, ['index.js'], {
  cwd: SERVER_DIR,
  env: { ...process.env, PORT: String(PORT), DATA_DIR, DOTENV_CONFIG_QUIET: 'true', NODE_NO_WARNINGS: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
const boot = [];
child.stdout.on('data', (d) => boot.push(d.toString()));
child.stderr.on('data', (d) => boot.push(d.toString()));

function cleanup(code = 0) {
  try { child.kill('SIGKILL'); } catch { /* noop */ }
  setTimeout(() => process.exit(code), 200);
}

async function waitForBoot(timeoutMs = 60000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const h = await fetch(`${BASE}/api/health`);
      if (h.ok) return true;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

const ok = await waitForBoot();
console.log('== server boot ==');
console.log(`port ${PORT} healthy: ${ok}`);
const bootLine = boot.join('').split('\n').filter((l) => /scheduler|BRAIN running/.test(l));
out(bootLine);
if (!ok) cleanup(1);
else {
  try {
    console.log('\n== 1. cron "* * * * *" — register, then wait past a minute boundary ==');
    const created = await post('/api/scheduler/jobs', {
      name: 'probe every minute',
      kind: 'cron',
      cron: '* * * * *',
      action: { type: 'emit', event: 'probe.cron.fired' },
    });
    out(created);

    // Wait until just after the next minute boundary, then a beat for delivery.
    const now = new Date();
    const waitMs = (60 - now.getSeconds()) * 1000 + 6000;
    console.log(`waiting ${Math.round(waitMs / 1000)}s for the minute boundary…`);
    await new Promise((r) => setTimeout(r, waitMs));

    const afterCron = await get('/api/scheduler/autonomy');
    const cronRun = afterCron.status && afterCron.jobs.find((j) => j.id === created.job.id);
    out({ job: cronRun, fairness: afterCron.status.fairness, pool: afterCron.status.pool });

    const obs1 = await get('/api/observer/recent?typePrefix=scheduler.&limit=10').catch(() => null);
    if (obs1) out({ observer: obs1 });

    console.log('\n== 2. event-triggered job — register, then emit the event ==');
    const evJob = await post('/api/scheduler/jobs', {
      name: 'probe on mission completed',
      kind: 'event',
      event: 'mission.completed',
      action: { type: 'emit', event: 'probe.event.fired' },
    });
    out(evJob);
    // Emit the trigger through the real scheduler path: a job whose action
    // emits `mission.completed`, run on demand. The event lands on the Observer
    // bus and the subscription above fires. No test seam involved.
    const emitter = await post('/api/scheduler/jobs', {
      name: 'probe emit mission.completed',
      kind: 'cron',
      cron: '0 0 1 1 *',
      action: { type: 'emit', event: 'mission.completed' },
    });
    out({ emitter: emitter.job && emitter.job.id });
    out(await post(`/api/scheduler/jobs/${emitter.job.id}/run`));
    await new Promise((r) => setTimeout(r, 1500));
    const afterEvent = await get('/api/scheduler/jobs?limit=20');
    out({ eventTriggeredRun: afterEvent.runs.filter((r) => r.trigger === 'event') });

    console.log('\n== 3. condition job — predicate flips true ==');
    const condJob = await post('/api/scheduler/jobs', {
      name: 'probe condition always',
      kind: 'condition',
      condition: 'always',
      intervalSeconds: 1,
      action: { type: 'emit', event: 'probe.condition.fired' },
    });
    out(condJob);
    await new Promise((r) => setTimeout(r, 2500));

    console.log('\n== 4. GET /api/scheduler/jobs — real job history ==');
    out(await get('/api/scheduler/jobs?limit=20'));

    console.log('\n== 5. engine status ==');
    const status = await get('/api/scheduler/autonomy');
    out({ status: status.status });
  } catch (e) {
    console.error('probe error:', e);
    cleanup(1);
  }
  cleanup(0);
}