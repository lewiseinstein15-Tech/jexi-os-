/**
 * JEXI OS — VERIFICATION — TestVerifier.
 *
 * Runs a test command against the SNAPSHOT source (never the live workspace)
 * and parses the output into evidence. A 'fail' status propagates to the work
 * graph as a blocker; evidence is attached to the node.
 *
 * REAL SPAWN (Phase 5 Scope B): unless an explicit `options.run` runner is
 * injected, the verifier spawns the project's real test command via
 * child_process.spawn. If no test command is configured, it returns
 * { status: 'error', reason: 'no test command configured' } — NEVER a canned
 * pass. stdout/stderr are parsed into failures.
 */

import { runCommand, resolveConfiguredCommand } from '../spawn/execute.js';
import { verifyCwd, cleanupSandbox } from '../spawn/sandbox.js';

/** @type {import('../interface/Verifier.js').Verifier} */
export const TestVerifier = {
  name: 'TestVerifier',

  /**
   * @type {(context: import('../interface/Verifier.js').VerifyContext) => Promise<import('../interface/Verifier.js').VerifyResult>}
   */
  async verify({ _nodeId, snapshotId, snapshot, _acceptanceCriteria, _claimantAcbId, options = {} }) {
    const started = Date.now();
    const { run, cwd = process.cwd(), timeoutMs, command, args = [], testCommand, materialize } = options;
    // An explicitly injected runner wins (tests use this); otherwise the real
    // spawn path runs.
    if (typeof run === 'function') {
      const res = await run();
      const pass = res.exitCode === 0 && !/fail|failing/i.test(res.output);
      return {
        status: pass ? 'pass' : 'fail',
        evidence: [{
          source: 'TestVerifier',
          snapshotId,
          content: `exitCode=${res.exitCode} ${res.output}`,
          at: Date.now(),
        }],
        reason: pass ? undefined : 'tests failed',
        durationMs: Date.now() - started,
      };
    }

    // Precedence: explicit `testCommand`/`command`+`args` → configured command.
    const spec = testCommand || (command ? [command, ...args] : resolveConfiguredCommand(cwd, 'test'));
    if (!spec) {
      return {
        status: 'error',
        evidence: [{ source: 'TestVerifier', snapshotId, content: 'no test command configured', at: Date.now() }],
        reason: 'no test command configured',
        durationMs: Date.now() - started,
      };
    }

    // Verify the FROZEN snapshot bytes, not the live workspace: materialize
    // the snapshot into a temp sandbox and run the command there.
    const { cwd: runCwd, sandbox } = verifyCwd(snapshot, { cwd, materialize });
    const res = await runCommand(spec, { cwd: runCwd, timeoutMs });
    if (sandbox) cleanupSandbox(sandbox);

    if (!res.ok && res.spawnError && !res.stdout && !res.stderr) {
      return {
        status: 'error',
        evidence: [{ source: 'TestVerifier', snapshotId, content: res.spawnError, at: Date.now() }],
        reason: res.spawnError,
        durationMs: Date.now() - started,
      };
    }

    const pass = res.ok;
    const evidence = [{
      source: 'TestVerifier',
      snapshotId,
      content: `exitCode=${res.code} ${res.output || (res.ok ? 'ok' : '')}`.trim(),
      at: Date.now(),
      meta: {
        spawn: { command: spec[0], args: spec.slice(1), timedOut: res.timedOut, stdout: res.stdout, stderr: res.stderr, exitCode: res.code },
        sandboxed: Boolean(sandbox),
      },
    }];
    return {
      status: pass ? 'pass' : 'fail',
      evidence,
      reason: pass ? undefined : (res.failures[0] || `tests failed (exitCode=${res.code})`),
      durationMs: Date.now() - started,
    };
  },
};