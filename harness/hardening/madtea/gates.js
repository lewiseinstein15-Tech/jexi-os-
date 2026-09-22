/**
 * JEXI OS — Phase 23 Scope A — madtea test gate runner.
 *
 * A gate is a named check that must pass before madtea merges:
 *
 *   { name, cmd }   -> run via /bin/sh in the operation cwd, pass = exit 0
 *   { name, check } -> pure function, pass = truthy return
 *                      (or { pass, output } for a checked outcome + note)
 *
 * Gates run in the order given. The FIRST failing gate stops the runner
 * (fail-fast): a later gate's result is unknown until the earlier one is
 * fixed, and running past a failure would burn minutes to report a verdict
 * the caller cannot act on yet.
 *
 * LEAK RULE (Phase 23 A): captured gate output is checked against the
 * operation's SecretGuard BEFORE it can enter any result. A gate that
 * prints a credential aborts the whole finish with E_CRED_LEAK — the
 * runner does not redact-and-continue, because output that carried a
 * secret is evidence of a leaking tool, not a formatting problem.
 * Output that is clean is redacted anyway (no-op for clean text) and
 * carried verbatim in the results.
 *
 * Errors (SemanticaError):
 *   E_INVALID_ARGUMENT  gates is not an array / a gate has no name
 *   E_UNKNOWN_GATE      a gate has neither cmd nor check
 *   E_CRED_LEAK         gate output contains a registered credential value
 */

import { execFileSync } from 'node:child_process';
import { SemanticaError } from '../../../semantica/_internal.js';

/** Max bytes of combined output kept per gate. Older discipline: keep evidence, bound memory. */
export const GATE_OUTPUT_MAX_BYTES = 64 * 1024;

function clip(text) {
  if (text.length <= GATE_OUTPUT_MAX_BYTES) return text;
  return text.slice(0, GATE_OUTPUT_MAX_BYTES) + `\n[... output clipped at ${GATE_OUTPUT_MAX_BYTES} bytes ...]`;
}

function assertGateShape(gate, index) {
  if (!gate || typeof gate !== 'object' || Array.isArray(gate)) {
    throw new SemanticaError('E_INVALID_ARGUMENT', `gates[${index}] must be an object with { name, cmd | check }`);
  }
  if (typeof gate.name !== 'string' || gate.name.trim() === '') {
    throw new SemanticaError('E_INVALID_ARGUMENT', `gates[${index}].name must be a non-empty string`);
  }
  const hasCmd = typeof gate.cmd === 'string' && gate.cmd.trim() !== '';
  const hasCheck = typeof gate.check === 'function';
  if (!hasCmd && !hasCheck) {
    throw new SemanticaError('E_UNKNOWN_GATE', `gate "${gate.name}" has neither a cmd to run nor a check to evaluate`);
  }
  if (hasCmd && hasCheck) {
    throw new SemanticaError('E_INVALID_ARGUMENT', `gate "${gate.name}" has both cmd and check; exactly one is allowed`);
  }
}

/** Run a cmd gate in cwd. Returns { passed, output, exitCode }. */
function runCmdGate(gate, cwd) {
  let exitCode = 0;
  let output = '';
  try {
    output = execFileSync('/bin/sh', ['-c', gate.cmd], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    });
  } catch (e) {
    exitCode = typeof e.status === 'number' ? e.status : 1;
    output = `${e.stdout || ''}${e.stderr || ''}` || (e.message ? `gate spawn error: ${e.message}` : '');
  }
  return { passed: exitCode === 0, output: clip(String(output)), exitCode };
}

/** Run a check-function gate. Returns { passed, output }. */
function runCheckGate(gate) {
  const outcome = gate.check();
  if (outcome && typeof outcome === 'object' && !Array.isArray(outcome)) {
    return { passed: Boolean(outcome.pass), output: clip(String(outcome.output ?? '')) };
  }
  return { passed: Boolean(outcome), output: '' };
}

/**
 * Run gates in order, fail-fast.
 *
 *   runGates(gates, { cwd, guard }) -> {
 *     passed,              // every gate passed
 *     failed,              // name of the first failed gate | null
 *     results: [{ name, passed, output, exitCode? }]  // gates that RAN only
 *   }
 *
 * guard (SecretGuard) is required when any gate can produce output; when
 * omitted, a null guard (no registered secrets) is used.
 */
export function runGates(gates, { cwd = process.cwd(), guard = null } = {}) {
  if (!Array.isArray(gates)) {
    throw new SemanticaError('E_INVALID_ARGUMENT', `gates must be an array, got ${Array.isArray(gates) ? 'array' : typeof gates}`);
  }
  const activeGuard = guard || { redact: (t) => t, assertClean: () => {} };

  gates.forEach(assertGateShape);

  const results = [];
  for (const gate of gates) {
    const outcome = typeof gate.cmd === 'string' ? runCmdGate(gate, cwd) : runCheckGate(gate);

    // LEAK RULE: raw output is checked BEFORE it can enter any result.
    activeGuard.assertClean(outcome.output, `gate "${gate.name}" output`);

    const result = { name: gate.name, passed: outcome.passed, output: activeGuard.redact(outcome.output) };
    if (outcome.exitCode !== undefined) result.exitCode = outcome.exitCode;
    results.push(result);

    if (!outcome.passed) {
      return { passed: false, failed: gate.name, results };
    }
  }
  return { passed: true, failed: null, results };
}
