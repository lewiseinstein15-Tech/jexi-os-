/**
 * JEXI OS — AGENT — Failure diagnosis (M23, Workstream C).
 *
 * M22 fed the RAW grader output back to the model and recovered 3/15. That is
 * a blunt instrument: the model has to read a traceback, decide what class of
 * problem it is, and choose a fix — all at once. The M23 mission asks for the
 * classification step to be explicit, so the repair instruction can be SPECIFIC
 * ("the function is not defined" is a different fix from "the algorithm is
 * wrong").
 *
 * This module classifies a failed attempt from ACTUAL execution evidence: the
 * agent's error string, the official grader's output, and the written source.
 * It is PURE and deterministic — no model, no spawn — so it can gate the loop.
 *
 * The taxonomy (Workstream C, 1–10):
 *   contract-extraction-failure, missing-entry-point, signature-mismatch,
 *   syntax-error, runtime-exception, assertion-failure, incorrect-algorithm,
 *   timeout, tool-failure, provider-failure.
 *
 * The rule the mission states plainly — "do not confuse an algorithmic failure
 * with a syntax problem or a tool failure" — is enforced by ORDER: the most
 * specific, evidence-backed cause wins, and an algorithmic failure is only
 * claimed when the file parses, defines the entry point, runs, and still fails
 * an assertion.
 */

import { parseSignature } from './FunctionContract.js';

export const FAILURE_CLASSES = [
  'contract-extraction-failure',
  'missing-entry-point',
  'signature-mismatch',
  'syntax-error',
  'runtime-exception',
  'assertion-failure',
  'incorrect-algorithm',
  'timeout',
  'tool-failure',
  'provider-failure',
];

/** The Python exception names that indicate a runtime error (not an assert). */
const RUNTIME_EXCEPTIONS = [
  'NameError', 'TypeError', 'ValueError', 'IndexError', 'KeyError',
  'AttributeError', 'ZeroDivisionError', 'ImportError', 'ModuleNotFoundError',
  'UnboundLocalError', 'RecursionError', 'StopIteration', 'OverflowError',
  'FileNotFoundError', 'RuntimeError', 'NotImplementedError',
];

/**
 * Diagnose a failed attempt.
 *
 * @param {object} o
 * @param {string} [o.agentError]     the agent loop's own error, if any
 * @param {string} [o.gradeOutput]    the official grader's raw output
 * @param {boolean} [o.gradedPass]    did the grader pass
 * @param {string|null} [o.source]    the written source (may be null)
 * @param {object|null} [o.contract]  the extracted contract (may be null)
 * @returns {{class:string, confidence:'high'|'medium'|'low', evidence:string, detail:object}}
 */
export function diagnoseFailure({ agentError = null, gradeOutput = '', gradedPass = false, source = null, contract = null } = {}) {
  const err = String(agentError || '');
  const out = String(gradeOutput || '');
  const src = source == null ? null : String(source);

  /* 1. Provider / infrastructure — nothing about the code can be concluded. */
  if (/\b(ECONNREFUSED|ENOTFOUND|ETIMEDOUT|socket hang up|fetch failed|all providers|no provider|provider ladder|429|503|502)\b/i.test(err)) {
    return res('provider-failure', 'high', firstLine(err), { agentError: err.slice(0, 400) });
  }
  /* 2. Timeout — the agent ran out of budget; the file may be half-written. */
  if (/timed?\s*out|timeout/i.test(err)) {
    return res('timeout', 'high', firstLine(err), { agentError: err.slice(0, 400) });
  }
  /* 3. Tool failure — a tool call errored and no code was produced. */
  if (/\b(path escapes root|permission denied|blocked by permission|tool .*not found|unknown tool|EACCES)\b/i.test(err)
    || (/ERROR:/.test(out) && !/\bTraceback\b/.test(out))) {
    return res('tool-failure', 'medium', firstLine(err || out), { agentError: err.slice(0, 400), gradeOutput: out.slice(-400) });
  }

  /* 4. Contract extraction — the request named no checkable function, so the
        failure cannot be attributed to the code. */
  if (contract && !contract.name) {
    return res('contract-extraction-failure', 'medium', 'no function name could be extracted from the request', { contract });
  }

  /* 5. Syntax error — the compiler rejected the bytes. */
  const syntaxMatch = out.match(/\b(SyntaxError|IndentationError|TabError)\b[:\s]*([^\n]*)/);
  if (syntaxMatch) {
    return res('syntax-error', 'high', `${syntaxMatch[1]}: ${syntaxMatch[2]}`.trim(), { pythonException: syntaxMatch[1] });
  }

  /* 6. Structural / contract violations on the written source. This is where
        "missing entry point" and "wrong signature" live — the M22 residuals. */
  if (src != null) {
    if (!src.trim()) {
      return res('missing-entry-point', 'high', 'no file was written (or the file is empty)', { empty: true });
    }
    const sig = parseSignature(src);
    if (contract?.name) {
      const defs = [...src.matchAll(/^\s*(?:def|class)\s+([A-Za-z_]\w*)/gm)].map((m) => m[1]);
      if (!defs.includes(contract.name)) {
        return res('missing-entry-point', 'high', `${contract.name} is not defined (found: ${defs.join(', ') || 'none'})`, { expected: contract.name, found: defs });
      }
      if (sig && sig.name === contract.name) {
        const want = (contract.params || []).map((p) => p.name).join(',');
        const got = (sig.params || []).filter((p) => p.kind !== 'kwonly-marker' && p.kind !== 'positional-only-marker').map((p) => p.name).join(',');
        if (want && want !== got) {
          return res('signature-mismatch', 'high', `expected (${want}), got (${got})`, { expected: want, got });
        }
      }
    } else if (!sig) {
      return res('missing-entry-point', 'medium', 'no top-level def/class in the written file', {});
    }
  }

  /* 7. Runtime exception — the file ran and raised. */
  const rt = out.match(new RegExp(`\\b(${RUNTIME_EXCEPTIONS.join('|')})\\b[:\\s]*([^\\n]*)`));
  if (rt) {
    const cls = rt[1] === 'NameError' ? 'runtime-exception' : 'runtime-exception';
    return res(cls, 'high', `${rt[1]}: ${rt[2]}`.trim(), { pythonException: rt[1] });
  }

  /* 8. Assertion failure — the file ran, the entry point exists, and the
        official test's assertions did not hold. This is the ONLY evidence that
        supports "incorrect algorithm". */
  if (/AssertionError|assert\s|HUMANEVAL_GRADE=FAIL/i.test(out)) {
    /* Distinguish "the model produced the wrong values" from "it produced
       nothing" — both are algorithmic, but the fix hint differs. */
    const hasAssert = /AssertionError/.test(out);
    return res('assertion-failure', 'high',
      hasAssert ? firstLine(out.replace(/^\s+at .*$/gm, '')) : 'the official test did not pass',
      { algorithmic: true, pythonException: hasAssert ? 'AssertionError' : null });
  }

  /* 9. Fell through: the grader failed with no recognisable signal. Report it
        as an algorithmic failure only when the file at least parses; otherwise
        stay honest that we could not classify it. */
  if (src != null && sigOrNull(src)) {
    return res('incorrect-algorithm', 'low', firstLine(out) || 'grader failed without a recognisable signal', {});
  }
  return res('incorrect-algorithm', 'low', firstLine(out) || 'unclassified failure', { unclassified: true });
}

function sigOrNull(src) {
  try { return !!parseSignature(src); } catch { return false; }
}

function firstLine(text) {
  const line = String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean).pop() || '';
  return line.slice(0, 240);
}

function res(cls, confidence, evidence, detail) {
  return { class: cls, confidence, evidence, detail };
}

/**
 * A SPECIFIC correction instruction for a diagnosis, shaped for the model.
 * The point of the classification is this function: a syntax error and a wrong
 * algorithm get different, targeted guidance instead of the same traceback.
 */
export function correctionHint(diagnosis, contract = null) {
  const c = diagnosis?.class;
  const name = contract?.name || 'the required function';
  const byClass = {
    'contract-extraction-failure':
      'The request did not name a checkable function. Restate the exact function name and signature you are implementing before writing.',
    'missing-entry-point':
      `Your file does not define ${name}. Write the file again and make sure the TOP-LEVEL definition is exactly ${contract?.signature || name}. Do not rename it and do not nest it inside another function.`,
    'signature-mismatch':
      `Your file defines ${name} with the wrong parameters. Use EXACTLY this signature: ${contract?.signature || name}. Keep the parameter names and their order.`,
    'syntax-error':
      'Your file does not compile. The traceback names the line. Common causes: an unterminated triple-quoted string, an unclosed bracket, or a missing indented body. Fix the syntax and nothing else.',
    'runtime-exception':
      'Your file compiles and defines the function but raises an exception when run. Read the exception type and line, then fix the specific operation that raised it.',
    'assertion-failure':
      'Your function runs but returns the WRONG VALUE. This is an algorithm problem, not a syntax problem. Re-read the behaviour and the worked examples, work through one example by hand, and change the logic to match.',
    'incorrect-algorithm':
      'Your function does not produce the required result. Re-read the behaviour and the worked examples and change the algorithm.',
    timeout:
      'The previous attempt ran out of time. Produce a complete, self-contained file in ONE write rather than exploring.',
    'tool-failure':
      'A tool call failed, so no usable file was produced. Write the file with a single fs_write call to the exact path given.',
    'provider-failure':
      'The model provider failed. This is an infrastructure problem, not a code problem; retry the attempt.',
  };
  return byClass[c] || 'Read the failure evidence, form a hypothesis, and make a different change.';
}

/**
 * Did the model REPEAT substantially the same failed solution?
 *
 * The M23 mission asks explicitly whether the model learns from feedback or
 * repeats itself. "Substantially identical" is judged on normalised source:
 * whitespace collapsed, so a re-indent is not a new attempt, but a changed
 * expression is. Returns true when the new source is the same as any earlier
 * one.
 */
export function isRepeatedAttempt(newSource, priorSources = []) {
  const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
  const n = norm(newSource);
  if (!n) return false;
  return priorSources.some((p) => norm(p) === n);
}
