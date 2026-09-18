/**
 * JEXI OS — Phase 8 Scope E — EXEC-BRIDGE ALLOWLIST.
 *
 * What may cross the network boundary. Deny-by-default: an op that is not
 * listed here is refused with the specific rule; a listed op with bad
 * arguments (unknown binary, path outside the workspace mount, protected
 * path) is refused just as specifically.
 *
 *   Allowed (default):
 *     run_command   — specific binaries only, no shell, arg-count caps
 *     read_file     — inside the workspace mount only
 *     write_file    — inside the workspace mount only
 *     list_tools    — capability discovery
 *     report_result — structured results back to jexi-net
 *
 *   Forbidden by default (explicit refusal rules):
 *     anything that touches jexi-net          → NO_JEXI_NET_EGRESS
 *     anything that reads credentials         → CREDENTIAL_ACCESS
 *     anything that changes the bridge itself → BRIDGE_READ_ONLY
 */

import path from 'node:path';

export const ALLOWED_OPS = ['run_command', 'read_file', 'write_file', 'list_tools', 'report_result'];

/** Binaries sandbox-net may execute. `node` powers the pipeline phase workers. */
export const ALLOWED_BINARIES = ['node', 'echo'];

export const MAX_ARGS = 64;
export const MAX_ARG_LENGTH = 4096;
export const MAX_FILE_BYTES = 4 * 1024 * 1024; // read_file ceiling
export const MAX_RESULT_BYTES = 1024 * 1024;   // report_result payload ceiling

/** Credential-shaped request targets that are refused even inside a mount. */
export const CREDENTIAL_PATH_PATTERN = /(^|\/)\.(jexi-secrets|env|git-credentials|netrc)(\/|$)|id_rsa|\.pem$|credentials\.json$/i;

export function checkOp(op) {
  if (typeof op !== 'string' || !ALLOWED_OPS.includes(op)) {
    return { allowed: false, rule: 'OP_NOT_ALLOWED', reason: `op ${JSON.stringify(op ?? null)} not on allowlist — allowed: ${ALLOWED_OPS.join(', ')}` };
  }
  return { allowed: true, rule: null, reason: 'op on allowlist' };
}

export function checkRunCommand({ binary, args } = {}) {
  if (typeof binary !== 'string' || !ALLOWED_BINARIES.includes(binary)) {
    return { allowed: false, rule: 'BINARY_NOT_ALLOWED', reason: `binary ${JSON.stringify(binary ?? null)} not on binary allowlist — allowed: ${ALLOWED_BINARIES.join(', ')}` };
  }
  if (args === undefined) return { allowed: true, rule: null, reason: 'no args' };
  if (!Array.isArray(args) || args.some((a) => typeof a !== 'string')) {
    return { allowed: false, rule: 'BAD_ARGS', reason: 'run_command args must be an array of strings (no shell, no interpolation)' };
  }
  if (args.length > MAX_ARGS) return { allowed: false, rule: 'BAD_ARGS', reason: `run_command args exceed ${MAX_ARGS} entries` };
  if (args.some((a) => a.length > MAX_ARG_LENGTH)) return { allowed: false, rule: 'BAD_ARGS', reason: `run_command arg exceeds ${MAX_ARG_LENGTH} chars` };
  return { allowed: true, rule: null, reason: 'binary allowlisted, args well-formed' };
}

/** Lexical containment (canonicalized) — the executor runs inside one mount. */
export function isPathUnder(target, root) {
  const t = path.resolve(String(target || ''));
  const r = path.resolve(String(root || ''));
  if (t === r) return true;
  const prefix = r.endsWith(path.sep) ? r : r + path.sep;
  return t.startsWith(prefix);
}

/**
 * Path gate for read_file / write_file. `protectedPaths` are absolute dirs
 * the sandbox side may NEVER write (the bridge + runtime modules themselves).
 */
export function checkFilePath(op, targetPath, { workspaceMount, protectedPaths = [] } = {}) {
  if (typeof targetPath !== 'string' || !targetPath.trim()) {
    return { allowed: false, rule: 'BAD_PATH', reason: `${op}: target path required` };
  }
  const resolved = path.resolve(targetPath);
  if (CREDENTIAL_PATH_PATTERN.test(resolved)) {
    return { allowed: false, rule: 'CREDENTIAL_ACCESS', reason: `${op}: credential-shaped path refused — ${resolved}` };
  }
  if (!isPathUnder(resolved, workspaceMount)) {
    return { allowed: false, rule: 'PATH_OUTSIDE_WORKSPACE', reason: `${op}: ${resolved} is outside the workspace mount (${workspaceMount})` };
  }
  if (op === 'write_file') {
    const hit = protectedPaths.find((p) => isPathUnder(resolved, p));
    if (hit) {
      return { allowed: false, rule: 'BRIDGE_READ_ONLY', reason: `write_file: ${resolved} is inside a protected path (${hit}) — the bridge is read-only from sandbox-net` };
    }
  }
  return { allowed: true, rule: null, reason: 'path inside workspace mount' };
}

export function checkReportResult(payload = {}) {
  const size = Buffer.byteLength(JSON.stringify(payload ?? {}), 'utf8');
  if (size > MAX_RESULT_BYTES) {
    return { allowed: false, rule: 'RESULT_TOO_LARGE', reason: `report_result payload ${size} bytes exceeds ${MAX_RESULT_BYTES}` };
  }
  return { allowed: true, rule: null, reason: 'result payload within cap' };
}

/** Capability discovery payload (list_tools). */
export function tools() {
  return {
    scheme: 'exec-bridge',
    ops: [
      { op: 'run_command', constraint: `binaries: ${ALLOWED_BINARIES.join(' | ')}; no shell; ≤${MAX_ARGS} string args` },
      { op: 'read_file', constraint: 'inside workspace mount only; credential paths refused' },
      { op: 'write_file', constraint: 'inside workspace mount only; bridge/runtime paths read-only' },
      { op: 'list_tools', constraint: 'this document' },
      { op: 'report_result', constraint: `≤${MAX_RESULT_BYTES} bytes; appended to results.jsonl on sandbox-net` },
    ],
    forbiddenByDefault: [
      'anything that touches jexi-net',
      'anything that reads credentials',
      'anything that changes the bridge itself',
    ],
  };
}

export default { ALLOWED_OPS, ALLOWED_BINARIES, checkOp, checkRunCommand, checkFilePath, checkReportResult, tools, isPathUnder };
