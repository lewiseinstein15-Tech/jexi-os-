/**
 * JEXI OS — VERIFICATION — BuildVerifier.
 *
 * Runs the build against the snapshot and checks the exit code. Expensive,
 * runs near the END of the multi-layer loop (after tests). A nonzero exit is a
 * blocker; evidence records stdout/stderr tail.
 *
 * REAL SPAWN (Phase 5 Scope B): unless an explicit `options.run` runner is
 * injected, the verifier spawns the project's real build command via
 * child_process.spawn. If no build command is configured it returns
 * { status: 'error', reason: 'no build command configured' } — NEVER a canned
 * pass.
 */

import { runCommand, resolveConfiguredCommand } from '../spawn/execute.js';
import { verifyCwd, cleanupSandbox } from '../spawn/sandbox.js';

/** @type {import('../interface/Verifier.js').Verifier} */
export const BuildVerifier = {
  name: 'BuildVerifier',

  /**
   * @type {(context: import('../interface/Verifier.js').VerifyContext) => Promise<import('../interface/Verifier.js').VerifyResult>}
   */
  async verify({ _nodeId, snapshotId, snapshot, _acceptanceCriteria, _claimantAcbId, options = {} }) {
    const started = Date.now();
    const { run, cwd = process.cwd(), timeoutMs, command, args = [], buildCommand, materialize } = options;
    if (typeof run === 'function') {
      const res = await run();
      const pass = res.exitCode === 0;
      return {
        status: pass ? 'pass' : 'fail',
        evidence: [{
          source: 'BuildVerifier',
          snapshotId,
          content: `exitCode=${res.exitCode} ${res.output}`,
          at: Date.now(),
        }],
        reason: pass ? undefined : `build failed (exitCode=${res.exitCode})`,
        durationMs: Date.now() - started,
      };
    }

    const spec = buildCommand || (command ? [command, ...args] : resolveConfiguredCommand(cwd, 'build'));
    if (!spec) {
      return {
        status: 'error',
        evidence: [{ source: 'BuildVerifier', snapshotId, content: 'no build command configured', at: Date.now() }],
        reason: 'no build command configured',
        durationMs: Date.now() - started,
      };
    }

    const { cwd: runCwd, sandbox } = verifyCwd(snapshot, { cwd, materialize });
    const res = await runCommand(spec, { cwd: runCwd, timeoutMs });
    if (sandbox) cleanupSandbox(sandbox);

    if (!res.ok && res.spawnError && !res.stdout && !res.stderr) {
      return {
        status: 'error',
        evidence: [{ source: 'BuildVerifier', snapshotId, content: res.spawnError, at: Date.now() }],
        reason: res.spawnError,
        durationMs: Date.now() - started,
      };
    }

    const pass = res.ok;
    const evidence = [{
      source: 'BuildVerifier',
      snapshotId,
      content: `exitCode=${res.code} ${res.output || (res.ok ? 'build ok' : '')}`.trim(),
      at: Date.now(),
      meta: {
        spawn: { command: spec[0], args: spec.slice(1), timedOut: res.timedOut, stdout: res.stdout, stderr: res.stderr, exitCode: res.code },
        sandboxed: Boolean(sandbox),
      },
    }];
    return {
      status: pass ? 'pass' : 'fail',
      evidence,
      reason: pass ? undefined : `build failed (exitCode=${res.code}): ${res.failures[0] || ''}`.trim(),
      durationMs: Date.now() - started,
    };
  },
};