/**
 * JEXI OS — benchmarks/swebench-pro/index.js
 *
 * Public API (Phase 31 Scope 12 contract):
 *   swepro.load({ split, fixturePath? })                    -> instances[]
 *   swepro.patchFromEdits({ edits, before, after })         -> unifiedDiff
 *   swepro.apply(patch, { repoPath, dryRun })               -> { applied, filesChanged, ... }
 *   swepro.evaluate(instance, { testRunner })               -> { failToPass, passToPass, resolved, ... }
 *   swepro.run({ fixture, testRunner, agent })              -> { resolved, total, perInstance[], ... }
 *
 * run() orchestrates load -> [optional agent leg: edits -> patch -> dry-run
 * apply] -> evaluate -> report. The agent and testRunner are INJECTED:
 * - sandbox (scope 12): testRunner stub with pre-declared results; agent
 *   omitted (evaluate-only run);
 * - real run (scope 17): agent produces edits from problem_statement, the
 *   patch is applied inside the per-instance Docker container
 *   (allowDocker:true) and the real harness runner executes
 *   FAIL_TO_PASS / PASS_TO_PASS lists.
 */

import { load, loadDiagnostics, validateInstance, loadHf, FIXTURES } from './dataset.js';
import { patchFromEdits, fileDiff } from './patch.js';
import { apply, parsePatch } from './apply.js';
import { evaluate } from './evaluate.js';
import { buildReport } from './report.js';

export async function run({ fixture, split = 'mini', testRunner, agent, allowDocker = false } = {}) {
  const diag =
    fixture === null
      ? { instances: await load({ split, fixturePath: null }), rejected: [] } // gated: throws NOT VERIFIED
      : await loadDiagnostics({ split, fixturePath: fixture });

  const evaluated = [];
  for (const instance of diag.instances) {
    let patchApplied = null;
    if (typeof agent === 'function') {
      // Agent leg (scope 17): agent({ instance }) -> { edits, before, after, repoPath }.
      const out = await agent({ instance });
      const patch = patchFromEdits({ edits: out?.edits ?? [], before: out?.before ?? [], after: out?.after ?? [] });
      const result = apply(patch, { repoPath: out?.repoPath ?? null, dryRun: !allowDocker });
      patchApplied = { patch, applied: result.applied, filesChanged: result.filesChanged };
    }
    const verdict = await evaluate(instance, { testRunner });
    evaluated.push({
      instance_id: instance.instance_id,
      repo: instance.repo,
      language: instance.language,
      failToPass: verdict.failToPass,
      passToPass: verdict.passToPass,
      resolved: verdict.resolved,
      tests: verdict.tests,
      ...(patchApplied ? { patch: patchApplied.patch, filesChanged: patchApplied.filesChanged } : {}),
    });
  }

  return buildReport({
    split,
    fixture: fixture ?? `bundled:${split}`,
    evaluated,
    rejected: diag.rejected,
  });
}

export const swepro = {
  load,
  loadDiagnostics,
  validateInstance,
  patchFromEdits,
  fileDiff,
  apply,
  parsePatch,
  evaluate,
  run,
  FIXTURES,
};
export { load, loadDiagnostics, validateInstance, patchFromEdits, fileDiff, apply, parsePatch, evaluate, FIXTURES };
export default swepro;
