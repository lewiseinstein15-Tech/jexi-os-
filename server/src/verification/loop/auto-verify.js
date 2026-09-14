/**
 * JEXI OS — VERIFICATION — auto-verify loop (Aider pattern).
 *
 * After every edit the loop runs the cheapest verification that would catch a
 * regression, in order: lint → unit tests → integration tests → build →
 * independent agent review. Runs stop at the first failure; the structured
 * failure is INJECTED back into the caller (not just logged), so the next
 * agent turn sees it as context.
 *
 * REAL HOOK (Phase 5 Scope B): layers that are NOT explicitly injected run
 * the REAL verifiers (which spawn real commands). The injected `layers.*`
 * fns remain the deterministic test seam.
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
    { name: 'lint', verifier: LintVerifier },
    { name: 'unit', verifier: TestVerifier },
    { name: 'integration', verifier: TestVerifier },
    { name: 'build', verifier: BuildVerifier },
    { name: 'agent', verifier: AgentVerifier },
  ].filter((s) => layers[s.name] !== undefined);
  const results = [];
  for (const step of steps) {
    const isAgent = step.name === 'agent';
    const stepCtx = {
      ...ctx,
      options: isAgent ? layers[step.name] : { run: runner(layers[step.name]) },
    };
    const result = await step.verifier.verify(stepCtx);
    results.push({ layer: step.name, status: result.status, reason: result.reason, evidence: result.evidence, spawned: false });
    if (result.status !== 'pass') {
      return { ok: false, results, failedLayer: step.name };
    }
  }
  return { ok: true, results };
}

/**
 * Run ONE real verifier layer — the real-spawn path. No injected fn here;
 * the verifier itself spawns a genuine command (Test/Build/Lint) or routes to
 * a real agent (Agent). Layers that genuinely cannot spawn return an 'error'
 * result (never a pass), which is still a blocker.
 * @returns {Promise<{layer:string, status:string, reason?:string, evidence:object[], spawned:boolean}>}
 */
export async function realVerifyLayer(layer, ctx = {}) {
  const step = {
    lint: { verifier: LintVerifier, defaultOptions: { files: ctx.files } },
    unit: { verifier: TestVerifier },
    integration: { verifier: TestVerifier },
    build: { verifier: BuildVerifier },
    agent: { verifier: AgentVerifier },
  }[layer];
  if (!step) return { layer, status: 'error', reason: `unknown real layer ${layer}`, evidence: [], spawned: false };
  const result = await step.verifier.verify({
    ...ctx,
    options: { ...step.defaultOptions, ...(ctx.options ?? {}) },
  });
  return { layer, status: result.status, reason: result.reason, evidence: result.evidence, spawned: true, durationMs: result.durationMs };
}

/**
 * Hook for the edit path: after a file edit, run autoVerify and return
 * structured failure context that gets injected into the next agent turn.
 *
 * REAL HOOK (Phase 5 Scope B): `real` lists layers to run through the REAL
 * verifiers (real spawn). When no injected layers are given at all, the
 * cheapest real layer ('lint') is run against the edited files by default, so
 * an ordinary edit path gets immediate real verification. The loop stops at
 * the first non-pass; the structured failure (with real output) is injected
 * back as `context.injectedFailure`.
 */
export async function verifyAfterEdit(ctx, layers = {}, { real = null } = {}) {
  const steps = [
    { name: 'lint', verifier: LintVerifier },
    { name: 'unit', verifier: TestVerifier },
    { name: 'integration', verifier: TestVerifier },
    { name: 'build', verifier: BuildVerifier },
    { name: 'agent', verifier: AgentVerifier },
  ].filter((s) => layers[s.name] !== undefined);
  const results = [];
  for (const step of steps) {
    const isAgent = step.name === 'agent';
    const stepCtx = { ...ctx, options: isAgent ? layers[step.name] : { run: runner(layers[step.name]) } };
    const result = await step.verifier.verify(stepCtx);
    results.push({ layer: step.name, status: result.status, reason: result.reason, evidence: result.evidence, spawned: false });
    if (result.status !== 'pass') return finishFail(results, step.name);
  }

  // Real-spawn layers (cheapest first): only reached if injected layers pass.
  const realLayers = real ?? (Object.keys(layers).length === 0 ? ['lint'] : []);
  for (const layer of realLayers) {
    const res = await realVerifyLayer(layer, ctx);
    results.push(res);
    if (res.status !== 'pass') return finishFail(results, layer);
  }

  return {
    ok: true,
    context: { verified: true, layers: results.map((r) => r.layer) },
    results,
  };
}

function finishFail(results, failedLayer) {
  const failed = results.find((r) => r.status !== 'pass');
  return {
    ok: false,
    context: {
      verified: false,
      injectedFailure: {
        layer: failedLayer,
        reason: failed?.reason,
        evidence: failed?.evidence ?? [],
      },
    },
    results,
  };
}