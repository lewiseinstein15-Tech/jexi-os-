/**
 * JEXI OS — Phase 23 Scope C — ralph diagnostics: CI Doctor.
 *
 * Reads a CI/loop failure log and returns a diagnosis:
 *
 *   diagnose({ logs }) -> { rootCause, evidence, suggestions[] }
 *
 * THE UNTRUNCATED-LOG RULE
 * This is the rule the module exists for. Doctor never shortens what it
 * reports: evidence lines are VERBATIM substrings of the input log — the
 * raw line, byte for byte, however long. No ellipsis, no substring cap,
 * no "… (truncated)". A diagnosis that hides the middle of the failing
 * line is the reason an agent loops on a failure it cannot see.
 *
 * DIAGNOSIS MODEL
 * A fixed pattern table runs in priority order: specific runtime failures
 * (syntax, missing module, type error) outrank their symptoms (test
 * failure, non-zero exit). The FIRST pattern with at least one matching
 * raw line wins; the root cause is its name and the evidence is every
 * raw line it matched. No match -> rootCause 'unknown' and the evidence
 * is the FULL log, verbatim — nothing dropped.
 *
 *   Priority:  syntax-error, missing-module, type-error, test-failure,
 *              timeout, network-or-auth, permission-denied, out-of-memory,
 *              git-failure, non-zero-exit
 *
 * Empty logs (absent, empty, whitespace-only, or an empty line array)
 * make diagnosis impossible: E_NO_LOGS (SemanticaError, read-only reuse;
 * no new error class).
 *
 * Deterministic: pure function of the log — same log, byte-identical
 * diagnosis.
 */

import { SemanticaError } from '../../../services/semantica/_internal.js';

/**
 * The diagnostic table. `re` matches a single RAW line (never trimmed —
 * a trimmed line is no longer a verbatim substring of the input).
 * `suggestions` are stable, action-first strings.
 */
export const DIAGNOSTIC_PATTERNS = Object.freeze([
  {
    rootCause: 'syntax-error',
    re: /SyntaxError|ParseError|Unexpected (token|identifier|end of JSON input)|Unexpected end of JSON input/i,
    suggestions: [
      'open the file named in the error and inspect the reported line',
      'run a parser/linter pass on the touched files before re-running the loop',
    ],
  },
  {
    rootCause: 'missing-module',
    re: /Cannot find module|ModuleNotFoundError|ERR_MODULE_NOT_FOUND|Cannot resolve dependency/i,
    suggestions: [
      'install the missing dependency or fix the import path',
      'check module resolution (relative path, package export, extension)',
    ],
  },
  {
    rootCause: 'type-error',
    re: /TypeError:|ReferenceError:|is not a function|is not defined|Cannot read propert|Cannot destructure|undefined is not an object|null is not an object/i,
    suggestions: [
      'inspect the variable named in the error at the reported location',
      'verify the value shape against the module contract (field names, defaults)',
    ],
  },
  {
    rootCause: 'test-failure',
    re: /\bFAIL\b|AssertionError|Assertion failed|✗|expected .* to (be|equal|deep-equal|strictly equal)|Tests?: \d+ failed/i,
    suggestions: [
      're-run the failing test in isolation for a clean stack',
      'compare the assertion diff against the intended behavior',
    ],
  },
  {
    rootCause: 'timeout',
    re: /\btimeout\b|timed out|TimeoutError|ETIMEDOUT/i,
    suggestions: [
      'identify the step that exceeded its time budget',
      'raise the timeout only if the work is legitimately long; otherwise fix the hang',
    ],
  },
  {
    rootCause: 'network-or-auth',
    re: /ECONNREFUSED|ENOTFOUND|EAI_AGAIN|getaddrinfo|E_NO_REMOTE|E_NO_FORGE_CONNECTION|401 Unauthorized|403 Forbidden|Invalid credentials|authentication required/i,
    suggestions: [
      'check whether the operation needs a live remote that this sandbox refuses',
      'verify credentials via keyRef (never inline) and their scope',
    ],
  },
  {
    rootCause: 'permission-denied',
    re: /EACCES|EPERM|permission denied|Access is denied|Operation not permitted/i,
    suggestions: [
      'check filesystem permissions on the named path',
      'verify the process runs as the intended user',
    ],
  },
  {
    rootCause: 'out-of-memory',
    re: /heap out of memory|JavaScript heap|OOM|Killed signal|out of memory/i,
    suggestions: [
      'find the unbounded allocation (loop over unbounded data is the usual suspect)',
      'bound the input size or stream the work instead of materializing it',
    ],
  },
  {
    rootCause: 'git-failure',
    re: /\bfatal:|non-fast-forward|merge conflict|CONFLICT \(/i,
    suggestions: [
      'reproduce the failing git command and read its full output',
      'reconcile branch state (rebase/merge) before re-running the finish',
    ],
  },
  {
    rootCause: 'non-zero-exit',
    re: /exit(?:ed)? with (?:code )?[1-9]|Command failed|non-zero exit/i,
    suggestions: [
      'find the first error above the exit-code line — it usually names the real failure',
    ],
  },
]);

/** Split a log into raw lines without altering them. */
function rawLines(logs) {
  if (typeof logs === 'string') return logs.split('\n');
  if (Array.isArray(logs) && logs.every((l) => typeof l === 'string')) return [...logs];
  return null;
}

/**
 * Diagnose a failure log. Throws E_NO_LOGS when the log is absent or empty;
 * every other outcome is a returned diagnosis, deterministic in the log.
 */
export function diagnose({ logs } = {}) {
  if (logs === undefined || logs === null) {
    throw new SemanticaError('E_NO_LOGS', 'no logs provided; CI Doctor diagnoses failures from logs and refuses to guess');
  }
  const lines = rawLines(logs);
  if (lines === null) {
    throw new SemanticaError('E_NO_LOGS', `logs must be a string or an array of strings, got ${typeof logs}`);
  }
  if (lines.length === 0 || lines.join('\n').trim() === '') {
    throw new SemanticaError('E_NO_LOGS', 'logs are empty; CI Doctor diagnoses failures from logs and refuses to guess');
  }

  for (const pattern of DIAGNOSTIC_PATTERNS) {
    const matched = lines.filter((line) => pattern.re.test(line));
    if (matched.length > 0) {
      return { rootCause: pattern.rootCause, evidence: matched, suggestions: [...pattern.suggestions] };
    }
  }

  // No known signature: hand back the FULL log, verbatim, nothing dropped.
  return {
    rootCause: 'unknown',
    evidence: [...lines],
    suggestions: [
      'no recognizable failure signature; attach the full log to the loop context',
      're-run with more verbose logging to expose the failing step',
    ],
  };
}
