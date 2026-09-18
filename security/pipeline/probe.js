/**
 * JEXI OS — Phase 8 Scope A: LIVE PROBE RUNNER (re-runnable, raw output).
 *
 * Modes:
 *   run           wipe engagement state, run all 5 phases to completion
 *   run-then-die  run until the FIRST exploitation finding is validated,
 *                 then SIGKILL this process mid-phase (real process death)
 *   resume        fresh process: skip completed phases, resume the
 *                 interrupted one from its checkpoint (partial progress)
 *
 * Every mode starts the planted vuln app in-process (localhost only),
 * prints one JSON PhaseEvent per line (raw), then prints artifact tree.
 *
 * Usage:
 *   node probe.js --mode=run           --engagement=demo-1
 *   node probe.js --mode=run-then-die  --engagement=dur-1
 *   node probe.js --mode=resume        --engagement=dur-1
 */

import { parseArgs } from 'node:util';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createWorkflow, store } from './index.js';
import { startVulnApp } from './fixtures/vuln-app.js';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));

const { values } = parseArgs({
  options: {
    mode: { type: 'string' },
    engagement: { type: 'string' },
    port: { type: 'string', default: '4488' },
  },
});

const mode = values.mode || 'run';
const engagement = values.engagement || `probe-${Date.now()}`;
const port = Number(values.port);
const stateRoot = MODULE_DIR;

const app = await startVulnApp({ port });
console.log(`[probe] mode=${mode} engagement=${engagement} target=http://127.0.0.1:${port} pid=${process.pid}`);

try {
  const wf = createWorkflow({
    engagementId: engagement,
    sourceRoot: path.join(MODULE_DIR, 'fixtures'),
    baseUrl: `http://127.0.0.1:${port}`,
    stateRoot,
  });

  for await (const event of wf.execute({ resume: mode === 'resume' })) {
    console.log(JSON.stringify(event));
    if (mode === 'run-then-die' && event.type === 'finding' && event.phaseId === 'exploitation') {
      const cp = store.loadCheckpoint(stateRoot, engagement, 'exploitation');
      console.error(`[probe] HARD DYING MID-PHASE NOW (SIGKILL self) — exploitation checkpoint status=${cp && cp.status}, validated=${Object.keys((cp && cp.partial && cp.partial.validated) || {}).length}`);
      process.kill(process.pid, 'SIGKILL'); // real process death — no cleanup, no flush
    }
  }

  // artifact manifest (run/resume completion path)
  const dir = store.stateDir(stateRoot, engagement);
  const manifest = [];
  const walk = (d, prefix) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p, `${prefix}${e.name}/`);
      else manifest.push(`${prefix}${e.name}  ${fs.statSync(p).size}b`);
    }
  };
  walk(dir, '');
  console.error(`[probe] artifacts:`);
  for (const m of manifest) console.error(`[probe]   ${m}`);
  console.error(`[probe] DONE exit=0`);
  process.exitCode = 0;
} catch (err) {
  console.error(`[probe] FAILED: ${err.message}`);
  process.exitCode = 1;
} finally {
  app.close();
}
