/**
 * JEXI OS — Phase 17 Scope A — OBSCURA FALLBACK POLICY.
 *
 * THE RULE: there is NO Chromium fallback. When Obscura is missing, the browser
 * runtime FAILS with a specific error. It does not quietly launch Chromium.
 *
 * Why this is a module and not a comment: a silent engine swap is the single
 * most dangerous failure mode in this phase. Every memory number (30 MB vs
 * 200+ MB), every stealth claim, and every CDP behaviour in the reports is
 * measured against Obscura. If the runtime could fall back to Chromium on a
 * machine without Obscura, those reports would describe an engine that did not
 * run, and the deployment target (the memory-constrained brain server that
 * motivated this phase) is precisely the machine where Obscura is absent and
 * the fallback would fire.
 *
 * So the policy is enforced in code:
 *   - `ObscuraUnavailableError` is thrown, never swallowed.
 *   - `assertObscura()` is the single gate every entry point passes through.
 *   - `describeUnavailability()` produces the honest "NOT VERIFIED" text used
 *     by probes and reports when Obscura cannot be obtained here.
 *
 * The Chromium path in DesktopManager is left untouched and remains reachable
 * by calling it DIRECTLY. What is forbidden is the browser runtime choosing it
 * on its own. Explicit is fine; implicit is the bug.
 */

/** Thrown whenever Obscura cannot be provided and no silent substitute is allowed. */
export class ObscuraUnavailableError extends Error {
  constructor(detail) {
    super(
      `ObscuraUnavailableError: Obscura is not available — ${detail}. ` +
      'The browser runtime does NOT fall back to Chromium: an engine swap would invalidate ' +
      'the memory and stealth figures measured against Obscura. Install the obscura binary ' +
      '(see runtimes/browser/README.md) or run the Docker image, then retry.'
    );
    this.name = 'ObscuraUnavailableError';
    this.code = 'E_OBSCURA_UNAVAILABLE';
    this.engine = 'obscura';
    this.fallback_allowed = false;
  }
}

/**
 * The single gate. Every browser-runtime entry point calls this before use.
 *
 * @param {object} o
 * @param {string|null} o.binary    path found on disk, or null
 * @param {boolean}     o.docker    whether a Docker daemon answered
 * @param {string[]}    [o.searched] paths that were searched (for the message)
 * @returns {string} the resolved transport ('process' | 'docker')
 * @throws {ObscuraUnavailableError} when neither is available
 */
export function assertObscura({ binary, docker, searched = [] } = {}) {
  if (binary) return 'process';
  if (docker) return 'docker';
  const where = searched.length ? ` Searched: ${searched.join(', ')}.` : '';
  throw new ObscuraUnavailableError(`no obscura binary on this host and no Docker daemon answered.${where}`);
}

/**
 * The honest unavailability report for probes and phase reports.
 *
 * Reports the verdict as NOT VERIFIED rather than inventing a result. The
 * `code_ready` field distinguishes "the implementation is present and lint-
 * clean" from "the runtime behaviour was observed" — the two are never merged.
 *
 * @param {object} o
 * @param {string} o.reason
 * @param {boolean} [o.codeReady]
 * @returns {object}
 */
export function describeUnavailability({ reason, codeReady = true } = {}) {
  return {
    verdict: 'NOT VERIFIED — Obscura not available in sandbox',
    reason,
    code_ready: codeReady,
    fallback_to_chromium: false,
    how_to_verify: [
      'curl -LO https://github.com/h4ckf0r0day/obscura/releases/latest/download/obscura-x86_64-linux-stealth.tar.gz',
      'tar xzf obscura-x86_64-linux-stealth.tar.gz -C ~/obscura',
      'OBSCURA_BIN=~/obscura/obscura node scripts/phase17-a-probe.mjs',
      'or: docker run -d -p 127.0.0.1:9222:9222 h4ckf0r0day/obscura:latest',
    ],
  };
}

/**
 * Guard that a caller is not about to silently substitute an engine.
 * Returns the engine name when it is Obscura, throws otherwise.
 */
export function assertEngineIsObscura(engineName) {
  if (String(engineName).toLowerCase() !== 'obscura') {
    throw new ObscuraUnavailableError(
      `refusing engine ${JSON.stringify(engineName)}: this runtime is Obscura-only and will not substitute another engine`
    );
  }
  return 'obscura';
}

export default { ObscuraUnavailableError, assertObscura, describeUnavailability, assertEngineIsObscura };
