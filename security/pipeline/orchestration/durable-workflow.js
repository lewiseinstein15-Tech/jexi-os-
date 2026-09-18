/**
 * JEXI OS — Phase 8 Scope A: DURABLE WORKFLOW (Temporal-equivalent).
 *
 * Drives an ordered list of phases. Each phase implements the contract:
 *
 *   {
 *     id: 'pre-recon',
 *     inputs:  ['source.root'],
 *     outputs: ['artifacts/pre-recon.json'],
 *     run(ctx)                     → AsyncIterable<PhaseEvent>,
 *     resume(checkpointId, ctx)    → AsyncIterable<PhaseEvent>,
 *   }
 *
 * PhaseEvent: { type, phaseId, ts, data }
 *   type ∈ 'log' | 'progress' | 'finding' | 'artifact' | 'error'
 *
 * Durability semantics (survives process death — SIGKILL included):
 *   - checkpoint "running" written BEFORE phase work starts
 *   - every event appended to events.jsonl as it is emitted
 *   - checkpoint flipped "complete" only after the phase artifact is on disk
 *   - on restart:
 *       complete phase   → skipped (artifact reused)
 *       running phase    → phase.resume(checkpointId, ctx) re-attempted;
 *                          partial progress in cp.partial is honored, so
 *                          per-finding work done before the crash is skipped
 *
 * The workflow never holds state in memory across phases — disk is the
 * source of truth. Nothing here is simulated: kill -9 the process at any
 * point and a fresh `resume` continues from the last durable boundary.
 */

import * as store from './checkpoint.js';
import { validateEngagementLiveness, EngagementViolationError, normalizeTarget } from '../../engagements/validator.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const PHASE_WORKER = path.join(MODULE_DIR, 'phase-worker.js');

export const PHASE_EVENT_TYPES = ['log', 'progress', 'finding', 'artifact', 'error'];

/**
 * Phase 8(E): `security.dualNetwork` flag resolution. Explicit opt wins;
 * otherwise JEXI_SECURITY_DUAL_NETWORK=1|true opts in; DEFAULT FALSE —
 * single-network, exactly the pre-Scope-E behavior, so existing tests and
 * callers are untouched.
 */
export function resolveDualNetwork(explicit) {
  if (explicit !== undefined && explicit !== null) return Boolean(explicit);
  const v = process.env.JEXI_SECURITY_DUAL_NETWORK;
  return v === '1' || v === 'true';
}

function ev(type, phaseId, data) {
  return { type, phaseId, ts: new Date().toISOString(), data };
}

export class DurableWorkflow {
  /**
   * @param {object} opts
   * @param {string}   opts.engagementId
   * @param {Array}    opts.phases        ordered phase modules (contract above)
   * @param {string}   opts.stateRoot     root dir holding .state/
   * @param {object}   opts.ctx           base ctx handed to every phase
   * @param {object}   [opts.engagement]  Phase 8(D): engagement bundle — when
   *                                      present, EVERY phase transition is
   *                                      gated on the engagement still being
   *                                      valid (scope + time window)
   * @param {object}   [opts.engagementStore] durable engagement.audit sink
   * @param {boolean}  [opts.dualNetwork] Phase 8(E): security.dualNetwork —
   *                                      when true, phases dispatch through
   *                                      the exec-bridge (sandbox-net
   *                                      execution) instead of in-process
   * @param {object}   [opts.execBridge]  the exec-bridge instance (required
   *                                      when dualNetwork) + [opts.engagementDb]
   *                                      path so sandbox-side RoE gates can
   *                                      reopen the store
   */
  constructor({ engagementId, phases, stateRoot, ctx, engagement = null, engagementStore = null, dualNetwork = null, execBridge = null, engagementDb = null }) {
    if (!engagementId) throw new Error('DurableWorkflow: engagementId required');
    if (!Array.isArray(phases) || phases.length === 0) throw new Error('DurableWorkflow: phases required');
    for (const p of phases) {
      for (const k of ['id', 'inputs', 'outputs', 'run']) {
        if (typeof p[k] !== 'function' && p[k] === undefined) {
          throw new Error(`DurableWorkflow: phase missing contract field "${k}"`);
        }
      }
      if (typeof p.run !== 'function') throw new Error(`phase ${p.id}: run() must be a function`);
      if (typeof p.resume !== 'function') throw new Error(`phase ${p.id}: resume() must be a function`);
    }
    this.engagementId = engagementId;
    this.phases = phases;
    this.stateRoot = stateRoot;
    this.baseCtx = ctx || {};
    this.engagement = engagement;
    this.engagementStore = engagementStore;
    // Phase 8(E): dual-network mode. Default false (single-network) — the
    // flag exists so real engagements can opt in; nothing else changes.
    this.dualNetwork = resolveDualNetwork(dualNetwork);
    this.execBridge = execBridge;
    this.engagementDb = engagementDb;
    if (this.dualNetwork && !this.execBridge) {
      throw new Error('DurableWorkflow: dualNetwork=true requires an execBridge (build one via runtimes/sandbox createDualNetwork)');
    }
  }

  /** Primary entry. Yields PhaseEvents; set `resume` to continue a dead run. */
  async *execute({ resume = false } = {}) {
    const { stateRoot, engagementId } = this;
    if (!resume) store.wipeEngagement(stateRoot, engagementId);

    const prior = {}; // phaseId -> completed checkpoint (outputs + partial)
    let seq = 0;
    const done = new Set();

    if (resume) {
      for (const cp of store.listCheckpoints(stateRoot, engagementId)) {
        seq = Math.max(seq, cp.seq);
        if (cp.status === 'complete') {
          done.add(cp.phaseId);
          prior[cp.phaseId] = cp;
        }
      }
      yield ev('log', 'workflow', {
        message: `resuming engagement — ${done.size} phase(s) complete on disk, ${this.phases.length - done.size} to (re)run`,
        completed: [...done],
      });
    }

    for (const phase of this.phases) {
      // Phase 8(D): every phase transition checks the engagement is still
      // valid (time window, scope). If not → engagement.violation event +
      // abort with the specific reason. The gate is additive: without an
      // engagement the pipeline behaves exactly as before.
      if (this.engagement) {
        const target = normalizeTarget(this.baseCtx.baseUrl || '');
        const live = validateEngagementLiveness(this.engagement, { target, at: new Date() });
        if (this.engagementStore) {
          this.engagementStore.audit(engagementId, {
            kind: 'transition-check', action: null, target,
            allowed: live.allowed, rule: live.rule, reason: live.reason,
          });
        }
        if (live.allowed) {
          yield ev('engagement.audit', phase.id, {
            message: `transition check passed — ${live.reason}`,
            kind: 'transition-check', target, rule: null, reason: live.reason,
          });
        } else {
          const violation = ev('engagement.violation', phase.id, {
            message: `engagement no longer valid — aborting: ${live.reason}`,
            kind: 'transition-check', target, rule: live.rule, reason: live.reason,
          });
          store.appendEvents(stateRoot, engagementId, [violation]);
          yield violation;
          throw new EngagementViolationError(live, { action: null, target, phaseId: phase.id });
        }
      }

      if (done.has(phase.id)) {
        yield ev('log', phase.id, {
          message: `phase already complete on disk — skipping (artifact reused)`,
          outputs: prior[phase.id]?.outputs ?? [],
        });
        continue;
      }

      seq += 1;
      const existing = store.loadCheckpoint(stateRoot, engagementId, phase.id);
      const diedMidPhase = Boolean(existing && existing.status !== 'complete');

      let cp = existing && diedMidPhase
        ? { ...existing, attempt: existing.attempt + 1, startedAt: new Date().toISOString() }
        : store.newCheckpoint(engagementId, phase.id, seq);
      cp.status = 'running';
      store.saveCheckpoint(stateRoot, engagementId, cp);

      const ctx = {
        ...this.baseCtx,
        engagementId,
        stateRoot,
        checkpoint: cp,
        prior,
        diedMidPhase,
        engagement: this.engagement,
        engagementStore: this.engagementStore,
      };

      yield ev('log', phase.id, {
        message: diedMidPhase
          ? `phase was "running" when previous process died — resume() attempt ${cp.attempt}`
          : `phase start (attempt ${cp.attempt})`,
        checkpointId: cp.checkpointId,
      });

      const collected = [];
      try {
        // Phase 8(E): in dual-network mode the phase does NOT run in this
        // (jexi-net) process. The orchestration dispatches it through the
        // exec-bridge as an allowlisted run_command; a scrubbed-env worker
        // executes the phase on sandbox-net and its events cross back
        // through the bridge. Checkpoint ownership stays HERE — disk on the
        // jexi side remains the single source of truth.
        const stream = this.dualNetwork
          ? this.dispatchPhaseViaBridge(phase, cp, ctx, diedMidPhase)
          : (diedMidPhase ? phase.resume(cp.checkpointId, ctx) : phase.run(ctx));
        for await (const event of stream) {
          if (!event || typeof event !== 'object') continue;
          const e = { type: event.type ?? 'log', phaseId: phase.id, ts: event.ts ?? new Date().toISOString(), data: event.data ?? event };
          collected.push(e);
          store.appendEvents(stateRoot, engagementId, [e]);
          yield e;
        }
      } catch (err) {
        cp.status = 'failed';
        cp.error = String(err && err.stack ? err.stack : err);
        store.saveCheckpoint(stateRoot, engagementId, cp);
        const e = ev('error', phase.id, { message: `phase failed: ${err && err.message ? err.message : err}`, stack: err && err.stack ? err.stack.split('\n').slice(0, 4) : null });
        store.appendEvents(stateRoot, engagementId, [e]);
        yield e;
        throw err;
      }

      cp.status = 'complete';
      cp.completedAt = new Date().toISOString();
      cp.outputs = collected
        .filter((e) => e.type === 'artifact')
        .map((e) => e.data.path)
        .filter(Boolean);
      store.saveCheckpoint(stateRoot, engagementId, cp);
      prior[phase.id] = cp;
      done.add(phase.id);

      yield ev('log', phase.id, {
        message: 'phase complete — checkpoint closed',
        attempt: cp.attempt,
        outputs: cp.outputs,
      });
    }

    store.markRunComplete(stateRoot, engagementId, { phases: this.phases.map((p) => p.id) });
    yield ev('log', 'workflow', { message: 'workflow complete — run.json marked complete' });
  }

  /** JSON-safe ctx subset that crosses the bridge into the sandbox worker. */
  sandboxCtx(ctx) {
    return {
      sourceRoot: ctx.sourceRoot,
      baseUrl: ctx.baseUrl,
      targetName: ctx.targetName,
      engagementId: ctx.engagementId,
      stateRoot: ctx.stateRoot,
      checkpoint: ctx.checkpoint,
      prior: ctx.prior,
      diedMidPhase: ctx.diedMidPhase,
      engagement: ctx.engagement,
      engagementDb: this.engagementDb,
    };
  }

  /**
   * Phase 8(E): dispatch one phase through the exec-bridge.
   *
   *   1. write ctx.json into the workspace mount      (write_file — audited)
   *   2. run_command → phase-worker.js on sandbox-net  (scrubbed-env child,
   *      cwd = workspace mount; events spool to JSONL inside the mount)
   *   3. read the spool back through the bridge         (read_file — audited)
   *   4. replay the events into the normal stream so checkpoints, events
   *      file, and artifact tracking behave EXACTLY as in single-network mode
   *
   * Every step crosses the boundary as an authenticated, allowlisted,
   * audited bridge op — the only path between the networks.
   */
  async *dispatchPhaseViaBridge(phase, cp, ctx, diedMidPhase) {
    const bridge = this.execBridge;
    const caller = `jexi-net:workflow:${phase.id}`;
    const runDir = path.join(bridge.workspaceMount, '.bridge-runs', cp.checkpointId);
    const ctxFile = path.join(runDir, 'ctx.json');
    const spoolFile = path.join(runDir, 'spool.jsonl');
    const mode = diedMidPhase ? 'resume' : 'run';

    yield ev('bridge.dispatch', phase.id, {
      message: `dual-network: phase ${phase.id} dispatched through exec-bridge (mode=${mode}, side=sandbox-net)`,
      caller,
    });

    const pushed = await bridge.call('write_file', { path: ctxFile, content: JSON.stringify(this.sandboxCtx(ctx), null, 2) }, { caller });
    if (pushed.status !== 'ok') throw new Error(`exec-bridge refused ctx write [${pushed.rule}]: ${pushed.reason}`);

    const res = await bridge.call('run_command', {
      binary: 'node',
      args: [PHASE_WORKER, `--phase=${phase.id}`, `--mode=${mode}`, `--checkpoint=${cp.checkpointId}`, `--ctx=${ctxFile}`, `--spool=${spoolFile}`],
      timeoutMs: 300000,
    }, { caller });
    if (res.status !== 'ok') throw new Error(`exec-bridge refused phase dispatch [${res.rule}]: ${res.reason}`);
    if (res.result.exitCode !== 0) {
      // spool may carry a worker.error with the real failure — best-effort read
      let workerError = res.result.stderr ? String(res.result.stderr).trim() : `exit ${res.result.exitCode}`;
      try {
        const spool = await bridge.call('read_file', { path: spoolFile }, { caller });
        if (spool.status === 'ok') {
          const lines = spool.result.content.split('\n').filter((l) => l.trim());
          const errEvent = lines.map((l) => JSON.parse(l)).find((e) => e.type === 'worker.error');
          if (errEvent) workerError = errEvent.data.message;
          for (const e of lines) yield e; // surface everything the worker recorded
        }
      } catch { /* fall back to stderr summary */ }
      throw new Error(`phase worker failed on sandbox-net: ${workerError}`);
    }

    const readBack = await bridge.call('read_file', { path: spoolFile }, { caller });
    if (readBack.status !== 'ok') throw new Error(`exec-bridge refused spool read [${readBack.rule}]: ${readBack.reason}`);
    const events = readBack.result.content.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
    for (const e of events) yield e;

    yield ev('bridge.dispatch', phase.id, {
      message: `dual-network: phase ${phase.id} complete on sandbox-net — exit ${res.result.exitCode}, ${events.length} event(s) returned through the bridge`,
      caller,
      exitCode: res.result.exitCode,
      events: events.length,
    });
  }
}

export default DurableWorkflow;
