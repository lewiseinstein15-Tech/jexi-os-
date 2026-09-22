// computer/sandbox/exec.js
// Phase 29 Scope I — bash / Jupyter / file operations through the injected
// AIO-compatible client, plus the sandbox path-containment guard.
//
// ISOLATION MODEL (declared):
// - This module performs ZERO host I/O. There is no child_process, no fs,
//   no network anywhere under computer/sandbox/** — every operation is a
//   validated pass-through to the injected client, which by contract runs
//   inside the remote AIO sandbox. Nothing executed here can escape to the
//   host because nothing is executed here at all.
// - File paths are additionally contained CLIENT-SIDE by resolvePath: every
//   path handed to the client is normalized to an ABSOLUTE path inside the
//   sandbox root (default /workspace). Traversal ('..'), absolute paths
//   outside the root, NUL bytes, and empty/non-string paths are refused
//   with E_INVALID_ARGUMENT BEFORE the client is ever called.
//
// DECLARED RESULT SHAPES (validated; never fabricated, never guessed):
//   execBash / runJupyter -> client { stdout, stderr, exitCode, refusal? }
//                          -> sandbox { stdout, stderr, exitCode }
//     - stdout/stderr absent -> '' (an absent stream is empty — a declared
//       normalization, not synthesized output); non-string -> misuse.
//     - exitCode must be an integer (negative = by-signal, legitimate).
//     - refusal: a non-empty string reason returned by the sandbox means it
//       REFUSED the command. Per the Scope I rule the refusal surfaces as
//       E_SANDBOX_EXEC_FAILED ("exec returned non-zero with a refusal
//       reason"): non-zero exitCode + refusal -> thrown with both in
//       details. A refusal paired with exitCode 0 is a client contract
//       violation -> E_INVALID_ARGUMENT (sandboxes do not refuse
//       successfully).
//   readFile     -> client { content } -> sandbox { content }  (content must
//                 be a string — a missing payload is malformed, never
//                 synthesized)
//   writeFile    -> client { ok } -> sandbox { ok }  (boolean pass-through;
//                 the client owns write outcomes — reported honestly)
//
// ERROR LAYERING (mirrors Scope B):
//   E_SANDBOX_UNAVAILABLE — no client configured (environment absent)
//   E_SANDBOX_EXEC_FAILED — the sandbox refused the command (refusal reason)
//   E_INVALID_ARGUMENT    — bad input or malformed client response (misuse)
// Availability is checked BEFORE argument validation: without a sandbox
// there is nothing to validate against (declared precedence).

import { ComputerError } from '../errors.js';

/** Declared default sandbox root (TARS AIO workspace convention). */
export const DEFAULT_ROOT = '/workspace';

/**
 * Validate a sandbox root: an absolute, normalized POSIX path (no trailing
 * slash, no duplicate slashes, no '..'). Returns the normalized root.
 * Misuse -> ComputerError(E_INVALID_ARGUMENT).
 */
export function assertRoot(root) {
  if (typeof root !== 'string' || root.length === 0 || !root.startsWith('/')) {
    throw new ComputerError(
      'E_INVALID_ARGUMENT',
      `sandbox: root must be an absolute POSIX path (got ${root === null ? 'null' : typeof root})`,
      { got: root === null ? 'null' : typeof root }
    );
  }
  const parts = root.split('/').filter((s) => s !== '' && s !== '.');
  if (parts.some((s) => s === '..')) {
    throw new ComputerError('E_INVALID_ARGUMENT', `sandbox: root must not contain '..' segments (got '${root}')`, {
      got: root,
    });
  }
  const norm = `/${parts.join('/')}`;
  if (norm !== root) {
    throw new ComputerError(
      'E_INVALID_ARGUMENT',
      `sandbox: root must be normalized (got '${root}', expected '${norm}')`,
      { got: root, normalized: norm }
    );
  }
  return norm;
}

/**
 * Contain a user-supplied path inside the sandbox root (pure string math —
 * no fs). Returns the normalized ABSOLUTE path that will be handed to the
 * client. Refusals (ComputerError E_INVALID_ARGUMENT):
 *   - non-string / empty path, or a NUL byte
 *   - a relative path whose '..' climbs above the root
 *   - an absolute path that resolves outside the root
 * Absolute paths inside the root are allowed (they address the same
 * contained tree). POSIX lexical normalization only: '.' dropped, '..'
 * pops, duplicate slashes collapse; '/..' stays at '/' (POSIX).
 */
export function resolvePath(root, input) {
  if (typeof input !== 'string' || input.length === 0) {
    throw new ComputerError(
      'E_INVALID_ARGUMENT',
      `sandbox: path must be a non-empty string (got ${input === null ? 'null' : typeof input})`,
      { got: input === null ? 'null' : typeof input }
    );
  }
  if (input.includes('\0')) {
    throw new ComputerError('E_INVALID_ARGUMENT', 'sandbox: path must not contain NUL bytes', { path: input });
  }
  if (input.startsWith('/')) {
    const segs = [];
    for (const part of input.split('/')) {
      if (part === '' || part === '.') continue;
      if (part === '..') {
        if (segs.length > 0) segs.pop(); // POSIX: /.. === /
        continue;
      }
      segs.push(part);
    }
    const norm = `/${segs.join('/')}`;
    const inside = root === '/' || norm === root || norm.startsWith(`${root}/`);
    if (!inside) {
      throw new ComputerError(
        'E_INVALID_ARGUMENT',
        `sandbox: absolute path '${input}' resolves outside the sandbox root '${root}'`,
        { path: input, resolved: norm, root }
      );
    }
    return norm;
  }
  const segs = root === '/' ? [] : root.split('/').filter((s) => s !== '');
  let relDepth = 0; // 0 = at the root; climbing above 0 is an escape
  for (const part of input.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (relDepth === 0) {
        throw new ComputerError(
          'E_INVALID_ARGUMENT',
          `sandbox: relative path '${input}' escapes the sandbox root '${root}'`,
          { path: input, root }
        );
      }
      segs.pop();
      relDepth -= 1;
      continue;
    }
    segs.push(part);
    relDepth += 1;
  }
  return `/${segs.join('/')}`;
}

// --- shared guards ------------------------------------------------------------

/** Availability gate: every operation requires an attached client. */
function requireClient(state) {
  if (!state || state.client === null || state.client === undefined) {
    throw new ComputerError(
      'E_SANDBOX_UNAVAILABLE',
      'sandbox: no AIO client configured — sandbox is unavailable',
      { configured: false }
    );
  }
  return state.client;
}

/** One required non-empty string argument, with no NUL bytes. */
function argString(params, field, what) {
  const value = params !== null && typeof params === 'object' ? params[field] : undefined;
  if (typeof value !== 'string' || value.length === 0) {
    throw new ComputerError(
      'E_INVALID_ARGUMENT',
      `sandbox: ${what} requires a non-empty string ${field} (got ${value === '' ? 'empty string' : value === null ? 'null' : typeof value})`,
      { field, got: value === '' ? 'empty string' : value === null ? 'null' : typeof value }
    );
  }
  if (value.includes('\0')) {
    throw new ComputerError('E_INVALID_ARGUMENT', `sandbox: ${what} ${field} must not contain NUL bytes`, {
      field,
    });
  }
  return value;
}

/** Reject a malformed client response (contract violation, never guessed around). */
function malformedClientResponse(what, res, expectation) {
  return new ComputerError(
    'E_INVALID_ARGUMENT',
    `sandbox: ${what} client returned a malformed result — expected ${expectation}`,
    { got: res === null ? 'null' : typeof res }
  );
}

/**
 * Validate one exec-shaped client response and apply the declared refusal
 * rule. Returns the exact { stdout, stderr, exitCode } triple — nothing
 * added, nothing synthesized.
 */
function finishRun(what, res) {
  if (res === null || typeof res !== 'object' || Array.isArray(res)) {
    throw malformedClientResponse(what, res, '{ stdout, stderr, exitCode }');
  }
  const stdout = res.stdout === undefined ? '' : res.stdout;
  const stderr = res.stderr === undefined ? '' : res.stderr;
  if (typeof stdout !== 'string' || typeof stderr !== 'string' || !Number.isInteger(res.exitCode)) {
    throw malformedClientResponse(what, res, '{ stdout: string, stderr: string, exitCode: integer }');
  }
  if (typeof res.refusal === 'string' && res.refusal.length > 0) {
    if (res.exitCode === 0) {
      // Contract violation: a sandbox does not refuse with a zero exit.
      throw malformedClientResponse(what, res, '{ exitCode: non-zero, refusal: string }');
    }
    throw new ComputerError(
      'E_SANDBOX_EXEC_FAILED',
      `sandbox: ${what} refused by the sandbox: ${res.refusal}`,
      { exitCode: res.exitCode, refusal: res.refusal }
    );
  }
  return { stdout, stderr, exitCode: res.exitCode };
}

// --- bash / jupyter ------------------------------------------------------------

/** sandbox.exec({ cmd }) -> { stdout, stderr, exitCode } — bash inside the sandbox. */
export function execBash(state, params) {
  const client = requireClient(state);
  const cmd = argString(params, 'cmd', 'exec');
  const res = client.execBash({ cmd });
  return finishRun('execBash', res);
}

/** sandbox.jupyter({ code }) -> { stdout, stderr, exitCode } — a notebook cell run. */
export function runJupyter(state, params) {
  const client = requireClient(state);
  const code = argString(params, 'code', 'jupyter');
  const res = client.runJupyter({ code });
  return finishRun('runJupyter', res);
}

// --- file ops (path-contained) ---------------------------------------------------

/** sandbox.read({ path }) -> { content } — read a file inside the sandbox root. */
export function readFile(state, params) {
  const client = requireClient(state);
  const path = argString(params, 'path', 'read');
  const resolved = resolvePath(state.root, path);
  const res = client.readFile({ path: resolved });
  if (res === null || typeof res !== 'object' || Array.isArray(res) || typeof res.content !== 'string') {
    throw malformedClientResponse('readFile', res, '{ content: string }');
  }
  return { content: res.content };
}

/** sandbox.write({ path, content }) -> { ok } — write a file inside the sandbox root. */
export function writeFile(state, params) {
  const client = requireClient(state);
  const path = argString(params, 'path', 'write');
  const content = argString(params, 'content', 'write');
  const resolved = resolvePath(state.root, path);
  const res = client.writeFile({ path: resolved, content });
  if (res === null || typeof res !== 'object' || Array.isArray(res) || typeof res.ok !== 'boolean') {
    throw malformedClientResponse('writeFile', res, '{ ok: boolean }');
  }
  return { ok: res.ok };
}
