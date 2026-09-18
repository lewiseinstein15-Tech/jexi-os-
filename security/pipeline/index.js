/**
 * JEXI OS — Phase 8 Scope A: PENTEST PIPELINE — facade.
 *
 *   security/pipeline/
 *   ├── index.js               ← this facade
 *   ├── orchestration/
 *   │   ├── durable-workflow.js  Temporal-equivalent driver
 *   │   └── checkpoint.js        durable state I/O (atomic, append-only events)
 *   ├── phases/
 *   │   ├── pre-recon.phase.js     1/5 source analysis
 *   │   ├── recon.phase.js         2/5 live app exploration
 *   │   ├── vulnerability.phase.js 3/5 five parallel OWASP agents
 *   │   ├── exploitation.phase.js  4/5 PoC validation, partial-resume
 *   │   └── reporting.phase.js     5/5 "no exploit, no report" deliverable
 *   ├── fixtures/vuln-app.js     deliberately vulnerable LOCAL sandbox target
 *   └── probe.js                 re-runnable live probe (run|resume|run-then-die)
 *
 * Contract — every phase implements:
 *   {
 *     id: string,
 *     inputs: string[],
 *     outputs: string[],
 *     run(ctx)                  → AsyncIterable<PhaseEvent>,
 *     resume(checkpointId, ctx) → AsyncIterable<PhaseEvent>,
 *   }
 *
 * Durability: state lives ONLY on disk (.state/<engagementId>/). kill -9 at
 * any instant, then `resume` — completed phases are skipped, the interrupted
 * phase re-enters via resume() and honors per-item partial progress.
 *
 * CLI:
 *   node security/pipeline/index.js run   --engagement=E --source=DIR --base=URL
 *   node security/pipeline/index.js resume --engagement=E --source=DIR --base=URL
 */

import { DurableWorkflow } from './orchestration/durable-workflow.js';
import * as preRecon from './phases/pre-recon.phase.js';
import * as recon from './phases/recon.phase.js';
import * as vulnerability from './phases/vulnerability.phase.js';
import * as exploitation from './phases/exploitation.phase.js';
import * as reporting from './phases/reporting.phase.js';
import * as store from './orchestration/checkpoint.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));

export const PIPELINE_VERSION = '1.0.0';
export const PHASE_ORDER = ['pre-recon', 'recon', 'vulnerability', 'exploitation', 'reporting'];
export const PHASES = [preRecon.phase, recon.phase, vulnerability.phase, exploitation.phase, reporting.phase];
export { DurableWorkflow, store };

export function createStateRoot(explicit) {
  return explicit ? path.resolve(explicit) : path.resolve(MODULE_DIR); // .state/ lives beside the pipeline by default
}

export function createWorkflow({ engagementId, sourceRoot, baseUrl, stateRoot, engagement = null, engagementsStore = null, dualNetwork = null, execBridge = null }) {
  const store_ = engagementsStore;
  return new DurableWorkflow({
    engagementId,
    phases: PHASES,
    stateRoot: createStateRoot(stateRoot),
    ctx: {
      sourceRoot: sourceRoot ? path.resolve(sourceRoot) : path.join(MODULE_DIR, 'fixtures'),
      baseUrl,
      targetName: 'planted-vuln-app',
    },
    // Phase 8(D): when an engagement bundle is provided, every phase
    // transition is gated on the engagement (scope + time window) and every
    // phase validates its action against the RoE before run(). Additive:
    // undefined keeps the ungated Scope A behavior.
    engagement,
    engagementStore: store_,
    // Phase 8(E): security.dualNetwork — default false (single-network).
    // When true, phases dispatch through the exec-bridge; engagementDb lets
    // the sandbox-side RoE gates reopen the same SQLite store.
    dualNetwork,
    execBridge,
    engagementDb: store_ ? store_.dbPath : null,
  });
}

/* --------------------------------- CLI ----------------------------------- */

async function main() {
  const args = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v === undefined ? true : v];
  }));
  const mode = process.argv[2];
  if (mode !== 'run' && mode !== 'resume') {
    console.error('usage: node index.js <run|resume> --engagement=E [--source=DIR] [--base=URL] [--state-root=DIR]');
    process.exit(2);
  }
  if (!args.engagement) {
    console.error('missing --engagement');
    process.exit(2);
  }
  const wf = createWorkflow({
    engagementId: args.engagement,
    sourceRoot: args.source,
    baseUrl: args.base,
    stateRoot: args['state-root'],
  });
  for await (const event of wf.execute({ resume: mode === 'resume' })) {
    console.log(JSON.stringify(event));
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}

export default { PHASES, PHASE_ORDER, createWorkflow, DurableWorkflow };
