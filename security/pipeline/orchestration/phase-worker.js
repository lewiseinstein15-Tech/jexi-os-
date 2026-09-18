/**
 * JEXI OS — Phase 8 Scope E — PHASE WORKER (sandbox-net side of dispatch).
 *
 * When dual-network mode is enabled, durable-workflow.js does NOT run
 * phases in-process. Instead each phase is dispatched through the
 * exec-bridge as an allowlisted run_command: this worker executes ON
 * sandbox-net, in a scrubbed-environment child (process mode) or container
 * (docker mode):
 *
 *   node security/pipeline/orchestration/phase-worker.js \
 *        --phase=recon --mode=run --checkpoint=<cpId> \
 *        --ctx=<ctx.json> --spool=<spool.jsonl>
 *
 * The ctx file and spool live INSIDE the workspace mount and cross the
 * boundary exclusively through audited bridge ops (write_file / read_file).
 *
 * Responsibilities split honestly across the boundary:
 *   - jexi-net (orchestration): checkpoint lifecycle, events.jsonl, the
 *     engagement transition gate, run completion — disk stays authoritative.
 *   - sandbox-net (this worker): execute ONE phase's run()/resume() and
 *     stream its events as JSONL to the spool. It persists nothing else.
 *
 * Code vs data: the worker resolves phase CODE from the local install
 * (docker mode provisions it into the image at build time); DATA access is
 * confined to the workspace mount handed to the child (cwd + JEXI_SANDBOX_WORKSPACE).
 */

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openEngagements } from '../../engagements/store.js';
import * as preRecon from '../phases/pre-recon.phase.js';
import * as recon from '../phases/recon.phase.js';
import * as vulnerability from '../phases/vulnerability.phase.js';
import * as exploitation from '../phases/exploitation.phase.js';
import * as reporting from '../phases/reporting.phase.js';

const PHASES = {
  'pre-recon': preRecon.phase,
  'recon': recon.phase,
  'vulnerability': vulnerability.phase,
  'exploitation': exploitation.phase,
  'reporting': reporting.phase,
};

function fail(message) {
  process.stderr.write(`phase-worker: ${message}\n`);
  process.exit(2);
}

const arg = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => {
  const [k, v] = a.replace(/^--/, '').split('=');
  return [k, v === undefined ? true : v];
}));

const phaseId = String(arg.phase || '');
const mode = String(arg.mode || 'run');
const checkpointId = String(arg.checkpoint || '');
const ctxFile = String(arg.ctx || '');
const spoolFile = String(arg.spool || '');

if (!PHASES[phaseId]) fail(`unknown phase ${JSON.stringify(phaseId)} — known: ${Object.keys(PHASES).join(', ')}`);
if (mode !== 'run' && mode !== 'resume') fail(`mode must be run|resume — got ${JSON.stringify(mode)}`);
if (!checkpointId || !ctxFile || !spoolFile) fail('--checkpoint, --ctx and --spool are required');

let ctx;
try {
  ctx = JSON.parse(fs.readFileSync(ctxFile, 'utf8'));
} catch (err) {
  fail(`cannot read ctx ${ctxFile}: ${err.message}`);
}

// RoE gate inside the child: the engagement bundle crossed via ctx; the
// store handle is reopened here (same SQLite file, WAL) so action-validate
// audit rows persist even though this process dies with the phase.
if (ctx.engagement && ctx.engagementId && ctx.engagementDb && !ctx.engagementStore) {
  ctx.engagementStore = openEngagements({ dbPath: ctx.engagementDb });
}

const phase = PHASES[phaseId];
const stream = mode === 'resume' ? phase.resume(checkpointId, ctx) : phase.run(ctx);

try {
  for await (const event of stream) {
    if (!event || typeof event !== 'object') continue;
    const normalized = {
      type: event.type ?? 'log',
      phaseId,
      ts: event.ts ?? new Date().toISOString(),
      data: event.data ?? event,
    };
    fs.appendFileSync(spoolFile, `${JSON.stringify(normalized)}\n`);
  }
  process.exit(0);
} catch (err) {
  fs.appendFileSync(spoolFile, `${JSON.stringify({
    type: 'worker.error', phaseId, ts: new Date().toISOString(),
    data: { message: String(err && err.message ? err.message : err), stack: String(err && err.stack ? err.stack : '').split('\n').slice(0, 6) },
  })}\n`);
  process.exit(1);
}

export { PHASES };
export const WORKER_IDENTITY = { file: fileURLToPath(import.meta.url), side: 'sandbox-net' };
