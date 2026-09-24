/**
 * JEXI OS — Phase 22 Scope E — GSD loop orchestrator.
 *
 * Ported from open-gsd/gsd-core @ ccfed633551a7687ef3edb1774d6bd43ea34577b
 * (MIT). GSD runs a task as five phases — Discuss -> Plan -> Execute -> Verify
 * -> Ship — each in a FRESH context window, so context rot cannot accumulate
 * across a long task. The phase artifact is the ONLY channel between phases:
 * CONTEXT.md -> PLAN.md -> SUMMARY.md -> UAT.md -> (ship is terminal).
 *
 * Fresh-context discipline, enforced structurally:
 *   - every phase entry begins by reading its declared `consumes` from disk;
 *   - every phase exit ends by writing its `produces` to disk;
 *   - no module-level mutable state and no per-task cache exists, so a phase
 *     entered in a brand-new process sees exactly what a phase entered in this
 *     process sees. There is no in-memory simulation to drift from the disk.
 *
 * Which phase runs next is derived purely from which artifacts exist on disk,
 * never from an in-memory cursor, so a process killed between phases resumes
 * exactly where the disk says it stopped.
 *
 * STATE.md is written after each phase as a cross-session observability record
 * (upstream's living memory). No phase consumes it and it does not drive
 * ordering, so it cannot reorder or short-circuit the loop.
 *
 * Determinism: artifacts embed no timestamps, no pids and no randomness, so
 * the same taskId + same input always produce identical bytes and an identical
 * phase sequence.
 *
 * The upstream `gsd:loop-host` contract this ports (12 loop points across the
 * five steps) is recorded in LOOP_CONTRACT below so the mapping is auditable
 * against upstream rather than asserted in prose.
 *
 * API:
 *   gsd.run(taskId, opts)  -> { phase, artifacts, nextPhase? }
 *   gsd.step(taskId, opts) -> advances exactly one phase
 *   gsd.status(taskId)     -> { taskId, phase, artifacts, shipped, done }
 *
 * Errors: E_UNKNOWN_TASK, E_OUT_OF_ORDER, E_ALREADY_SHIPPED, E_SHIP_BLOCKED.
 */
import fs from 'node:fs';
import path from 'node:path';

import discuss from './discuss.js';
import plan from './plan.js';
import execute from './execute.js';
import verify from './verify.js';
import ship, { ShipBlocked } from './ship.js';

export { ShipBlocked };

/** Upstream loop-host contract, verbatim from gsd-core/bin/lib/loop-host-contract.cjs. */
export const LOOP_CONTRACT = [
  { step: 'discuss', points: ['discuss:pre', 'discuss:post'], agentRoles: ['orchestrator'], coreArtifacts: { produces: ['CONTEXT.md'], consumes: [] } },
  { step: 'plan', points: ['plan:pre', 'plan:post'], agentRoles: ['researcher', 'planner', 'checker'], coreArtifacts: { produces: ['PLAN.md'], consumes: ['CONTEXT.md'] } },
  { step: 'execute', points: ['execute:pre', 'execute:wave:pre', 'execute:wave:post', 'execute:post'], agentRoles: ['executor', 'verifier'], coreArtifacts: { produces: ['SUMMARY.md'], consumes: ['PLAN.md'] } },
  { step: 'verify', points: ['verify:pre', 'verify:post'], agentRoles: ['orchestrator'], coreArtifacts: { produces: ['UAT.md'], consumes: ['SUMMARY.md'] } },
  { step: 'ship', points: ['ship:pre', 'ship:post'], agentRoles: ['orchestrator'], coreArtifacts: { produces: [], consumes: ['UAT.md'] } },
];

/** Ordered phase modules. */
export const PHASES = [discuss, plan, execute, verify, ship];
export const PHASE_NAMES = PHASES.map((p) => p.name);

/** ship declares no `produces`, so its terminal state is recorded by marker. */
export const SHIP_MARKER = 'SHIPPED';

export class GsdError extends Error {
  constructor(code, reason) {
    super(`${code}: ${reason}`);
    this.name = 'GsdError';
    this.code = code;
    this.reason = reason;
  }
}

const STATE_FILE = 'STATE.md';

/** Artifact filename for a phase; ship's completion marker is not an artifact. */
function artifactOf(phaseModule) {
  return phaseModule.produces ? phaseModule.produces : SHIP_MARKER;
}

/** Resolve a phase module by name, or null. Pure lookup — no state. */
function phaseByName(name) {
  return PHASES.find((p) => p.name === name) || null;
}

// Contract self-check: every declared input must be some earlier phase's
// output, so a typo'd `consumes` fails loudly at import rather than as a
// mysterious E_OUT_OF_ORDER at runtime.
const PRODUCED = new Set(PHASES.map((p) => p.produces).filter(Boolean));
for (const p of PHASES) {
  for (const dep of p.consumes) {
    if (!PRODUCED.has(dep)) {
      throw new GsdError('E_BAD_CONTRACT', `${p.name} declares unknown input ${dep}`);
    }
  }
}

export class Gsd {
  /**
   * @param {{root?: string}} [opts] root defaults to <cwd>/.jexi/gsd
   */
  constructor(opts = {}) {
    this.root = opts.root ? path.resolve(opts.root) : path.resolve(process.cwd(), '.jexi', 'gsd');
  }

  /** Task directory. */
  taskDir(taskId) {
    return path.join(this.root, taskId);
  }

  /**
   * Remove temp files left by a write killed mid-flight. Called on the first
   * write to a task directory, so a SIGKILL between `writeFileSync(tmp)` and
   * `renameSync` cannot leave debris that accumulates across restarts.
   */
  _sweepTemps(dir) {
    let names = [];
    try {
      names = fs.readdirSync(dir);
    } catch {
      return;
    }
    for (const n of names) {
      if (n.includes('.tmp-')) {
        try { fs.rmSync(path.join(dir, n)); } catch { /* best effort */ }
      }
    }
  }

  /* ─────────────── disk I/O — the only state channel ─────────────── */

  /** Read a file from a task dir, or null when absent. Always hits the disk. */
  _read(taskId, file) {
    const p = path.join(this.taskDir(taskId), file);
    try {
      return fs.readFileSync(p, 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT') return null;
      throw err;
    }
  }

  /**
   * Write atomically: a SIGKILL mid-write leaves the previous bytes intact
   * rather than a truncated artifact, so a restart can never read a partial
   * artifact as complete.
   */
  _write(taskId, file, content) {
    const dir = this.taskDir(taskId);
    fs.mkdirSync(dir, { recursive: true });
    this._sweepTemps(dir);
    const target = path.join(dir, file);
    const tmp = `${target}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, content);
    fs.renameSync(tmp, target);
    return target;
  }

  /** True when the task's directory exists at all. */
  exists(taskId) {
    return fs.existsSync(this.taskDir(taskId));
  }

  /** Phase completion is decided by the artifact's presence ON DISK. */
  isPhaseDone(taskId, phaseModule) {
    return this._read(taskId, artifactOf(phaseModule)) !== null;
  }

  /** Artifacts present so far, in phase order. */
  artifacts(taskId) {
    return PHASES
      .map((p) => ({ phase: p.name, artifact: artifactOf(p), present: this.isPhaseDone(taskId, p) }))
      .filter((a) => a.present)
      .map((a) => a.artifact);
  }

  /**
   * The first phase whose artifact is missing — i.e. what to run next. Derived
   * purely from disk, so it is correct after a crash with no in-memory hint.
   */
  nextPhase(taskId) {
    for (const p of PHASES) if (!this.isPhaseDone(taskId, p)) return p.name;
    return null;
  }

  /** @throws E_UNKNOWN_TASK when the task has no directory. */
  _assertKnown(taskId) {
    if (!taskId || typeof taskId !== 'string') {
      throw new GsdError('E_UNKNOWN_TASK', 'taskId must be a non-empty string');
    }
    if (!this.exists(taskId)) {
      throw new GsdError('E_UNKNOWN_TASK', `no such task "${taskId}" (no state at ${this.taskDir(taskId)})`);
    }
  }

  /**
   * Execute one phase with fresh-context discipline: read declared inputs from
   * disk FIRST, build, write the artifact LAST.
   *
   * @param {string} taskId
   * @param {object} phaseModule
   * @param {{input?: string}} [opts]
   * @returns {{artifact: string, path: string, content: string}}
   */
  _runPhase(taskId, phaseModule, opts = {}) {
    // FIRST ACTION: load this phase's declared inputs from disk. Nothing was
    // carried in from a previous phase — this read is the whole handoff.
    const inputs = {};
    for (const dep of phaseModule.consumes) {
      const text = this._read(taskId, dep);
      if (text === null) {
        throw new GsdError(
          'E_OUT_OF_ORDER',
          `${phaseModule.name} requires ${dep}, which does not exist for task "${taskId}" — its predecessor phase has not run`,
        );
      }
      inputs[dep] = text;
    }

    const seq = PHASES.findIndex((p) => p.name === phaseModule.name);

    // 'discuss' consumes nothing, so its input is the caller's task statement.
    if (phaseModule.name === 'discuss' && opts.input === undefined
        && !this.isPhaseDone(taskId, phaseModule)) {
      throw new GsdError('E_OUT_OF_ORDER', `discuss requires opts.input on first run for task "${taskId}"`);
    }

    const ctx = { taskId, seq, input: opts.input !== undefined ? String(opts.input) : '' };
    const content = phaseModule.build(ctx, inputs);
    const file = artifactOf(phaseModule);

    // LAST ACTION: write the artifact to disk.
    const target = this._write(taskId, file, content);

    // STATE.md is the living record across session boundaries. It is not an
    // input to any phase, so rewriting it cannot reorder the loop.
    const done = PHASES.filter((p) => this.isPhaseDone(taskId, p)).map((p) => p.name);
    this._write(taskId, STATE_FILE, [
      '---',
      'artifact: STATE.md',
      `task: ${taskId}`,
      'step: state',
      '---',
      '',
      `# State — ${taskId}`,
      '',
      `Completed phases: ${done.join(', ') || '(none)'}`,
      `Next phase: ${this.nextPhase(taskId) || '(complete)'}`,
      '',
    ].join('\n'));

    return { artifact: file, path: target, content };
  }

  /* ───────────────────────── public API ───────────────────────── */

  /**
   * Create a task (idempotent) and run it.
   *
   * @param {string} taskId
   * @param {{input?: string, phase?: string}} [opts]
   *        phase: run exactly that phase. Omit to run from the next
   *        incomplete phase through ship.
   * @returns {{phase: string, artifacts: string[], nextPhase?: string}}
   */
  run(taskId, opts = {}) {
    if (opts.phase !== undefined) {
      const pm = phaseByName(opts.phase);
      if (!pm) throw new GsdError('E_UNKNOWN_PHASE', `no such phase "${opts.phase}"`);
      if (!this.exists(taskId)) {
        if (opts.phase !== 'discuss') {
          throw new GsdError('E_UNKNOWN_TASK', `no such task "${taskId}" — only discuss can create a task`);
        }
        fs.mkdirSync(this.taskDir(taskId), { recursive: true });
      }
      if (this.isPhaseDone(taskId, phaseByName('ship'))) {
        throw new GsdError('E_ALREADY_SHIPPED', `task "${taskId}" is already shipped — the loop is terminal`);
      }
      // Ordering: every declared input must already exist on disk.
      for (const dep of pm.consumes) {
        if (this._read(taskId, dep) === null) {
          throw new GsdError('E_OUT_OF_ORDER', `cannot run ${pm.name}: ${dep} is missing for task "${taskId}" — run its predecessor first`);
        }
      }
      const out = this._runPhase(taskId, pm, opts);
      return { phase: pm.name, artifacts: this.artifacts(taskId), nextPhase: this.nextPhase(taskId) || undefined, artifactPath: out.path };
    }

    // Whole-loop mode: create the task if new, then run to completion.
    if (!this.exists(taskId)) {
      if (opts.input === undefined) {
        throw new GsdError('E_UNKNOWN_TASK', `no such task "${taskId}" and no opts.input given to create it`);
      }
      fs.mkdirSync(this.taskDir(taskId), { recursive: true });
    }

    let last = null;
    for (const pm of PHASES) {
      if (this.isPhaseDone(taskId, pm)) continue;
      const out = this._runPhase(taskId, pm, opts);
      last = { phase: pm.name, artifacts: this.artifacts(taskId), artifactPath: out.path };
      // Once shipped there is nothing further to run.
      if (pm.name === 'ship') break;
    }
    if (!last) {
      throw new GsdError('E_ALREADY_SHIPPED', `task "${taskId}" is already shipped — the loop is terminal`);
    }
    return { ...last, nextPhase: this.nextPhase(taskId) || undefined };
  }

  /**
   * Advance exactly one phase.
   * @param {string} taskId
   * @param {{input?: string, phase?: string}} [opts]
   */
  step(taskId, opts = {}) {
    this._assertKnown(taskId);

    if (this.isPhaseDone(taskId, phaseByName('ship'))) {
      throw new GsdError('E_ALREADY_SHIPPED', `task "${taskId}" is already shipped — the loop is terminal`);
    }

    let target;
    if (opts.phase !== undefined) {
      target = phaseByName(opts.phase);
      if (!target) throw new GsdError('E_UNKNOWN_PHASE', `no such phase "${opts.phase}"`);
      // Explicit out-of-order request: reject before doing any work.
      for (const dep of target.consumes) {
        if (this._read(taskId, dep) === null) {
          throw new GsdError('E_OUT_OF_ORDER', `cannot step to ${target.name}: ${dep} is missing for task "${taskId}" — run its predecessor first`);
        }
      }
      const done = PHASES.filter((p) => this.isPhaseDone(taskId, p)).map((p) => p.name);
      const expected = this.nextPhase(taskId);
      if (done.includes(target.name)) {
        throw new GsdError('E_OUT_OF_ORDER', `cannot step to ${target.name}: it already ran for task "${taskId}" (expected ${expected || 'nothing'})`);
      }
      if (expected && target.name !== expected) {
        throw new GsdError('E_OUT_OF_ORDER', `cannot step to ${target.name}: expected ${expected} for task "${taskId}"`);
      }
    } else {
      const expected = this.nextPhase(taskId);
      if (!expected) {
        throw new GsdError('E_ALREADY_SHIPPED', `task "${taskId}" has no phase left to run — the loop is complete`);
      }
      target = phaseByName(expected);
    }

    const out = this._runPhase(taskId, target, opts);
    return { phase: target.name, artifacts: this.artifacts(taskId), nextPhase: this.nextPhase(taskId) || undefined, artifactPath: out.path };
  }

  /**
   * Current phase + artifacts so far. Derived entirely from disk.
   * @param {string} taskId
   */
  status(taskId) {
    this._assertKnown(taskId);
    const done = PHASES.filter((p) => this.isPhaseDone(taskId, p)).map((p) => p.name);
    const next = this.nextPhase(taskId);
    return {
      taskId,
      phase: done.length ? done[done.length - 1] : null,
      donePhases: done,
      nextPhase: next || undefined,
      artifacts: this.artifacts(taskId),
      shipped: this.isPhaseDone(taskId, phaseByName('ship')),
    };
  }
}

/** Process-wide default rooted at <cwd>/.jexi/gsd. */
export const gsd = new Gsd();

export default gsd;