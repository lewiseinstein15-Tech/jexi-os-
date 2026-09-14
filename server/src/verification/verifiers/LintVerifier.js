/**
 * JEXI OS — VERIFICATION — LintVerifier.
 *
 * Runs a lint command (syntax/diagnostics) on the snapshot source. Purely
 * syntactic; cheap; runs FIRST in the multi-layer loop. Any diagnostic line
 * (warning count, "error", "no-undef", etc.) becomes evidence.
 *
 * REAL SPAWN (Phase 5 Scope B): unless an explicit `options.run` runner is
 * injected, the verifier spawns REAL eslint (via the node_modules/.bin
 * resolveBin pattern from Scope A) over the changed files. If no lint command
 * is configured it returns { status: 'error', reason: 'no lint command
 * configured' } — NEVER a canned pass.
 */

import { runCommand, resolveBin, resolveConfiguredCommand, normalizeCommandSpec } from '../spawn/execute.js';
import { verifyCwd, cleanupSandbox } from '../spawn/sandbox.js';

/** @type {import('../interface/Verifier.js').Verifier} */
export const LintVerifier = {
  name: 'LintVerifier',

  /**
   * @type {(context: import('../interface/Verifier.js').VerifyContext) => Promise<import('../interface/Verifier.js').VerifyResult>}
   */
  async verify({ _nodeId, snapshotId, snapshot, _acceptanceCriteria, _claimantAcbId, options = {} }) {
    const started = Date.now();
    const { run, cwd = process.cwd(), timeoutMs, lintCommand, files = [], eslint, materialize } = options;
    if (typeof run === 'function') {
      const res = await run();
      const diagnostics = (res.output.match(/error|warning|no-undef|semi|unused-vars/gi) || []).length;
      const pass = res.exitCode === 0 && diagnostics === 0;
      return {
        status: pass ? 'pass' : 'fail',
        evidence: [{
          source: 'LintVerifier',
          snapshotId,
          content: res.output || `no diagnostics (exitCode=${res.exitCode})`,
          at: Date.now(),
        }],
        reason: pass ? undefined : `${diagnostics} diagnostics`,
        durationMs: Date.now() - started,
      };
    }

    // Precedence for the default real spawn: explicit `lintCommand` wins;
    // otherwise lint the edited `files` when provided (edit-path semantics);
    // otherwise fall back to the configured lint command.
    let resolved;
    if (lintCommand) {
      resolved = normalizeCommandSpec(lintCommand);
    } else if (files.length) {
      resolved = [eslint || resolveBin('eslint'), '--no-color', '--format', 'json', ...files];
    } else {
      const configured = resolveConfiguredCommand(cwd, 'lint');
      resolved = configured || [eslint || resolveBin('eslint'), '--no-color', '--format', 'json', 'src'];
    }
    if (!resolved.length) {
      return {
        status: 'error',
        evidence: [{ source: 'LintVerifier', snapshotId, content: 'no lint command configured', at: Date.now() }],
        reason: 'no lint command configured',
        durationMs: Date.now() - started,
      };
    }

    const { cwd: runCwd, sandbox } = verifyCwd(snapshot, { cwd, materialize });
    const res = await runCommand(resolved, { cwd: runCwd, timeoutMs });
    if (sandbox) cleanupSandbox(sandbox);
    if (!res.ok && res.spawnError && !res.stdout && !res.stderr) {
      return {
        status: 'error',
        evidence: [{ source: 'LintVerifier', snapshotId, content: res.spawnError, at: Date.now() }],
        reason: res.spawnError,
        durationMs: Date.now() - started,
      };
    }

    // Real diagnostics: eslint --format json returns [] (pass) or a list of
    // { filePath, messages[] }. Count error/warning messages.
    let diagnostics = 0;
    let messages = [];
    const stdoutTrim = (res.stdout || '').trim();
    if (stdoutTrim && stdoutTrim.startsWith('[')) {
      try {
        const parsed = JSON.parse(stdoutTrim);
        for (const item of parsed) {
          for (const m of item.messages || []) {
            diagnostics += 1;
            messages.push(`${item.filePath}:${m.line}:${m.column} ${m.ruleId ?? ''} ${m.message}`.trim());
          }
        }
      } catch { diagnostics = (stdoutTrim.match(/error|warning/gi) || []).length; }
    } else {
      diagnostics = (stdoutTrim.match(/error|warning/gi) || []).length;
    }

    const pass = res.ok && diagnostics === 0;
    const evidence = [{
      source: 'LintVerifier',
      snapshotId,
      content: pass ? `no diagnostics (exitCode=${res.code})` : (messages[0] || res.output || `diagnostics found (exitCode=${res.code})`),
      at: Date.now(),
      meta: {
        spawn: { command: resolved[0], args: resolved.slice(1), timedOut: res.timedOut, stdout: res.stdout, stderr: res.stderr, exitCode: res.code, messages: messages.slice(0, 50) },
        sandboxed: Boolean(sandbox),
      },
    }];
    return {
      status: pass ? 'pass' : 'fail',
      evidence,
      reason: pass ? undefined : `${diagnostics} diagnostics`,
      durationMs: Date.now() - started,
    };
  },
};