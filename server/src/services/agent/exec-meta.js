/**
 * JEXI OS — typed execution metadata (M17 / D1).
 *
 * ToolRuntime returns `result` as a FORMATTED STRING — the model and the TUI
 * need human-readable output, and they must keep getting it. The completion
 * gate, however, has to decide on TYPED facts: did the command run at all, did
 * it exit nonzero, did the tests actually execute, did it time out, was it
 * refused or denied? Reconstructing those facts from a pretty string is
 * guesswork, and M16 showed exactly how it fails: the gate read
 * `r.result.status`, `r.result` was a string, so `verified` was unreachable.
 *
 * This module derives a small typed `meta` object from the engine's RAW return
 * value and attaches it NEXT TO the formatted text. It is additive — `result`
 * stays the string the model sees; `meta` is the machine truth the gate, the
 * auditor and the benchmark read.
 *
 * Honesty rules (mirrors the testing domain, JEXI-024):
 *   - a green suite that executed ZERO tests is not a pass;
 *   - a timeout, a refusal, a permission denial or a pause is never a pass;
 *   - an engine that reports `status: 'error'` is an error, not a pass/fail;
 *   - natural-language text is never consulted — only typed fields.
 */

/** The slugs whose verdict can satisfy the completion gate. */
export const TEST_TOOL_SLUGS = new Set(['test_run', 'pytest_run', 'test_coverage', 'run_tests']);

/**
 * Parse a raw engine result: an object, a JSON string, or a domain envelope
 * `{ ok, domain, result }`. Returns the inner payload object, or null.
 */
export function parseEngineResult(raw) {
  let obj = raw;
  if (typeof obj === 'string') {
    try { obj = JSON.parse(obj); } catch { return null; }
  }
  if (!obj || typeof obj !== 'object') return null;
  if (obj.domain && obj.result && typeof obj.result === 'object') return obj.result;
  return obj;
}

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : undefined; };

/**
 * Classify one tool execution into typed metadata.
 *
 * @param {string} slug  the tool slug
 * @param {object} res   the executeTool return value (ok/blocked/declined/code/…)
 * @param {any}    raw   the engine's RAW result, when available
 * @returns {{kind:'test'|'generic', status:string, timedOut:boolean, reason?:string,
 *            framework?:string, exitCode?:number, tests?:number, passed?:number,
 *            failed?:number, errors?:number, evidence?:string}}
 */
export function classifyExecution(slug, res = {}, raw = undefined) {
  const isTest = TEST_TOOL_SLUGS.has(String(slug));
  const meta = { kind: isTest ? 'test' : 'generic', status: 'unknown', timedOut: false };

  // Transport-level facts dominate any engine payload.
  if (res && res.code === 'TOOL_TIMEOUT') {
    meta.status = 'timeout'; meta.timedOut = true; meta.reason = res.error || 'tool call timed out';
    return meta;
  }
  if (res && res.blocked === true) { meta.status = 'blocked'; meta.reason = res.error || 'blocked by a gate'; return meta; }
  if (res && res.declined === true) { meta.status = 'denied'; meta.reason = res.error || 'declined by the user'; return meta; }
  if (res && res.paused === true) { meta.status = 'not_run'; meta.reason = 'awaiting approval'; return meta; }
  if (res && res.ok === false) { meta.status = 'error'; meta.reason = res.error; return meta; }

  const inner = parseEngineResult(raw !== undefined ? raw : (res && res.result));
  if (inner) {
    meta.framework = inner.framework;
    meta.exitCode = num(inner.exitCode);
    meta.tests = num(inner.tests);
    meta.passed = num(inner.passed);
    meta.failed = num(inner.failed);
    meta.errors = num(inner.errors);
    const st = String(inner.status || '').toLowerCase();
    if (st === 'pass') {
      meta.status = (meta.tests ?? 0) > 0 ? 'pass' : 'error';
      if (meta.status === 'error') meta.reason = 'engine reported pass but executed 0 tests';
    } else if (st === 'fail') {
      meta.status = 'fail';
      meta.reason = `${meta.failed ?? 0} failed${meta.errors ? `, ${meta.errors} errored` : ''}`;
    } else if (st === 'error') {
      // A killed run reports exitCode -1 with no output — that is a timeout,
      // and it must be named as one (D3 is about timeouts being scored as
      // passes; the gate must never see this as a pass either).
      const killed = meta.exitCode === -1 && !String(inner.output || '').trim();
      if (killed) { meta.status = 'timeout'; meta.timedOut = true; meta.reason = 'test run timed out / was killed'; }
      else { meta.status = 'error'; meta.reason = inner.reason || 'engine reported error'; }
    } else if (inner.ok === true) {
      // A test tool that returns ok:true with no verdict did NOT prove a pass.
      meta.status = isTest ? 'error' : 'ok';
      if (isTest) meta.reason = 'test tool returned no verdict';
    } else if (inner.ok === false) {
      meta.status = 'error'; meta.reason = inner.reason || 'engine reported failure';
    }
    if (inner.output) meta.evidence = String(inner.output).slice(-1500);
    if (inner.spawnError) { meta.status = 'error'; meta.reason = String(inner.spawnError); }
  } else if (res && res.ok === true) {
    meta.status = 'ok';
  }
  return meta;
}

/** Attach `meta` to an executeTool result (idempotent; keeps an existing meta). */
export function attachExecMeta(res, slug, raw) {
  if (res && typeof res === 'object' && !res.meta) res.meta = classifyExecution(slug, res, raw);
  return res;
}

/** The gate's single question: did a REAL test suite actually pass here? */
export function isPassingTestMeta(meta) {
  return !!meta && meta.kind === 'test' && meta.status === 'pass';
}

/** Verdicts that mean "the suite is not green / did not run". */
export function isFailingTestMeta(meta) {
  if (!meta || meta.kind !== 'test') return false;
  return ['fail', 'error', 'timeout', 'blocked', 'denied', 'not_run', 'unknown'].includes(meta.status);
}
