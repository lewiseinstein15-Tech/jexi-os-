/**
 * JEXI OS — VERIFICATION — auto-verify loop (Aider pattern).
 *
 * After every edit the loop runs the cheapest verification that would catch a
 * regression, in order: lint → unit tests → integration tests → build →
 * independent agent review. Runs stop at the first failure; the structured
 * failure is INJECTED back into the caller (not just logged), so the next
 * agent turn sees it as context.
 */

import { LintVerifier } from '../verifiers/LintVerifier.js';
import { TestVerifier } from '../verifiers/TestVerifier.js';
import { BuildVerifier } from '../verifiers/BuildVerifier.js';
import { AgentVerifier } from '../verifiers/AgentVerifier.js';

/** The multi-layer order — cheapest (syntax) first, independent review last. */
export const VERIFY_LAYER_ORDER = ['lint', 'unit', 'integration', 'build', 'agent'];

/** Coerce a raw command fn to a {exitCode, output} runner. */
const runner = (fn) => () => Promise.resolve(fn()).then(
  (out) => (typeof out === 'string' ? { exitCode: 0, output: out } : out),
);

/**
 * A composed passthrough context that carries snapshot + criteria + claimant.
 * @typedef {object} AutoVerifyContext
 * @property {string} nodeId
 * @property {string} snapshotId
 * @property {object} [snapshot]
 * @property {string} acceptanceCriteria
 * @property {string} claimantAcbId
 */

/**
 * Run the layers in order until a step fails.
 * @param {AutoVerifyContext} ctx
 * @param {object} layers  — { lint, unit, integration, build, agent } fns
 * @returns {Promise<{ok:boolean, results:object[]}>}
 */
export async function autoVerify(ctx, layers = {}) {
  const steps = [
    { name: 'lint', verifier: LintVerifier, run: layers.lint },
    { name: 'unit', verifier: TestVerifier, run: layers.unit },
    { name: 'integration', verifier: TestVerifier, run: layers.integration },
    { name: 'build', verifier: BuildVerifier, run: layers.build },
    { name: 'agent', verifier: AgentVerifier, run: layers.agent },
  ].filter((s) => s.run);
  const results = [];
  for (const step of steps) {
    const isAgent = step.name === 'agent';
    const stepCtx = {
      ...ctx,
      options: isAgent ? layers.agent : { run: runner(step.run) },
    };
    const result = await step.verifier.verify(stepCtx);
    results.push({ layer: step.name, status: result.status, reason: result.reason, evidence: result.evidence });
    if (result.status !== 'pass') {
      return { ok: false, results, failedLayer: step.name };
    }
  }
  return { ok: true, results };
}

/**
 * Hook for the edit path: after a file edit, run autoVerify and return
 * structured failure context that gets injected into the next agent turn.
 */
export async function verifyAfterEdit(ctx, layers = {}) {
  const outcome = await autoVerify(ctx, layers);
  return {
    ok: outcome.ok,
    context: outcome.ok
      ? { verified: true, layers: outcome.results.map((r) => r.layer) }
      : {
          verified: false,
          injectedFailure: {
            layer: outcome.failedLayer,
            reason: outcome.results.find((r) => r.status !== 'pass')?.reason,
            evidence: outcome.results.find((r) => r.status !== 'pass')?.evidence ?? [],
          },
        },
    results: outcome.results,
  };
}