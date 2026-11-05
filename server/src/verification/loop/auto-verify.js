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
import { SyntaxVerifier } from '../verifiers/SyntaxVerifier.js';
import { TestVerifier, runTestEvidence } from '../verifiers/TestVerifier.js';

// JEXI-018 — re-exported, not re-implemented. A caller that imports the seam
// from either entry point gets the SAME function, so the chat path and the
// WorkGraph path cannot drift apart again.
export { runTestEvidence };
import { BuildVerifier } from '../verifiers/BuildVerifier.js';
import { AgentVerifier } from '../verifiers/AgentVerifier.js';

/** The multi-layer order — cheapest (syntax) first, independent review last. */
export { VERIFY_LAYER_ORDER } from '../layers.js';

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
    syntax: { verifier: SyntaxVerifier, defaultOptions: { files: ctx.files, entryPoint: ctx.entryPoint } },
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
 * REAL HOOK: `real` lists layers to run through the REAL verifiers (real
 * spawn). When no injected layers are given at all, the default real layers
 * are ['lint', 'unit'] (JEXI-025).
 *
 * JEXI-025 — the default used to be `['lint']`, which means an ordinary edit
 * that compiles fine and breaks every test in the suite still came back
 * `ok: true`. Lint catches syntax, not behaviour. The default now runs lint
 * AND the real unit/TestVerifier layer, so a broken test suite is caught at
 * the edit that broke it instead of at the end of the turn. Callers that
 * genuinely only want a syntax check pass `{ real: ['lint'] }` explicitly.
 */
export const DEFAULT_REAL_LAYERS = ['syntax', 'lint', 'unit'];

export async function verifyAfterEdit(ctx, layers = {}, { real = null } = {}) {
  const steps = [
    { name: 'syntax', verifier: SyntaxVerifier },
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
  const realLayers = real ?? (Object.keys(layers).length === 0 ? DEFAULT_REAL_LAYERS : []);
  for (const layer of realLayers) {
    const res = await realVerifyLayer(layer, ctx);
    results.push(res);
    /* M21 — a layer that does not APPLY to this project (e.g. ESLint on a
       Python sandbox) is skipped, not failed: `inapplicable` must not block the
       cheaper-first loop before the layers that DO apply. A `fail` or `error`
       still stops the loop. An `unverifiable` layer (the auto-detected runner
       cannot check this edit — e.g. an exec-style pytest file) is skipped the
       same way: it is neither a green tick nor a defect to inject. */
    if (res.status === 'inapplicable' || res.status === 'unverifiable') continue;
    if (res.status !== 'pass') return finishFail(results, layer);
  }

  /* M21 — an all-skipped verify must NOT read as `verified`, and it must not
     masquerade as a FAILURE either. If every real layer was inapplicable
     (nothing could check the change — e.g. a flat sandbox with no lint runner
     and no test suite), the honest answer is `unverifiable`: no green tick, but
     also no "your work failed" message. Reporting it as a failure sent the
     model into a rewrite loop (measured: 16 iterations rewriting the same
     file) because it was told to fix something that was never broken. */
  const ranSomething = results.some((r) => r.status === 'pass' || r.status === 'fail' || r.status === 'error');
  if (!ranSomething && results.length) {
    return {
      ok: false,
      unverifiable: true,
      context: { verified: false, unverifiable: true, injectedFailure: null },
      results,
      reason: 'no applicable verification layer for this project — nothing was checked',
    };
  }

  return {
    ok: true,
    context: { verified: true, layers: results.map((r) => r.layer) },
    results,
  };
}

function finishFail(results, failedLayer) {
  /* M21 — report the layer that ACTUALLY blocked the loop, not the first
     non-pass entry. With a language-gated lint, the first non-pass result is
     now an `inapplicable` (skipped) layer; picking it by `status !== 'pass'`
     would report "lint: no applicable lint command" while the real blocker —
     e.g. a failing unit layer — is silently dropped from the injected failure
     the model reads. Match the named failed layer, and prefer a genuine
     fail/error over a skip. */
  const failed = results.find((r) => r.layer === failedLayer)
    || results.find((r) => r.status === 'fail' || r.status === 'error')
    || results[results.length - 1];
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