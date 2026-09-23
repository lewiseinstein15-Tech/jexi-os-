/**
 * JEXI OS — benchmarks/_meta/index.js
 *
 * Public API of the unified metrics + reproducibility + cost-cap layer:
 *
 *   meta.result(adapter, raw, { manifest, clock?, cap? }) -> unifiedResult
 *   meta.trace({ runId, adapter, tracePath? })            -> { record, flush }
 *   meta.manifest({ benchmark, adapterVersion, model, datasetRev, seed }, { clock }?)
 *                                                          -> { manifest, sha256 }
 *   meta.cost({ cap, currency })                          -> { charge, assert, snapshot }
 *   meta.run({ benchmark?, adapter, runner, manifest, costCap, clock?, tracePath? })
 *                                                          -> { unifiedResult, manifest, tracePath }
 *
 * meta.run is the whole contract in one call: pin the run with a
 * manifest (E_NO_MANIFEST without one), hard-cap the spend, run the
 * runner task by task, charge each task's cost as it completes, and
 * on a refused charge (E_COST_CAP_EXCEEDED) abort CLEANLY — the
 * mid-flight task plus every remaining task is marked NOT_RUN (pass
 * false, zero usage) and never counted toward resolved. Only tasks
 * that completed under the cap reach the trace sink.
 *
 * The runner is injection-seamed: { taskIds, runTask(taskId) } —
 * scope 17 plugs the real adapter agents in; the probe uses a stub.
 * runTask returns { pass, tokens, durationMs, costUsd, input?,
 * toolCalls?, output? } — the completeness rule (E_INCOMPLETE_TASK)
 * holds for runner rows exactly as for raw report rows.
 *
 * Determinism: ranAt comes from the injected clock (null without one),
 * runId derives from benchmark + manifest sha256, and the envelope is
 * built by the same buildEnvelope meta.result uses — same inputs +
 * same clock => byte-identical output.
 */

import { SemanticaError } from '../../semantica/_internal.js';
import { resolveClock } from './manifest.js';
import { createCost } from './cost.js';
import { createTrace } from './trace.js';
import { buildEnvelope, normalizeResult, resolveAdapter, SHAPES, ADAPTER_NAMES } from './result.js';

export { normalizeResult as result } from './result.js';
export { createTrace as trace } from './trace.js';
export { buildManifest as manifest } from './manifest.js';
export { createCost as cost } from './cost.js';

const notRun = (taskId) => ({
  taskId,
  pass: false,
  tokens: 0,
  durationMs: 0,
  costUsd: 0,
  status: 'NOT_RUN',
});

export async function run(input = {}) {
  const i = input ?? {};
  const { benchmark, adapter, runner, manifest, costCap, clock, tracePath } = i;

  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)
      || typeof manifest.sha256 !== 'string' || manifest.sha256 === ''
      || !manifest.manifest || typeof manifest.manifest !== 'object') {
    throw new SemanticaError(
      'E_NO_MANIFEST',
      'meta.run: every run is pinned by a manifest — pass the { manifest, sha256 } envelope from meta.manifest()',
    );
  }
  if (typeof costCap !== 'number' || !Number.isFinite(costCap) || costCap < 0) {
    throw new SemanticaError('E_INVALID_ARGUMENT', `meta.run: costCap must be a finite non-negative number (the per-run hard cap), got ${JSON.stringify(costCap)}`);
  }
  const { name, version } = resolveAdapter(adapter);
  if (!SHAPES[name]) {
    throw new SemanticaError(
      'E_INVALID_ARGUMENT',
      `meta.run: unknown adapter ${JSON.stringify(name)} — the unified layer runs exactly: ${ADAPTER_NAMES.filter((k) => k !== 'webarena-verified').join(', ')}`,
    );
  }
  if (!runner || typeof runner !== 'object' || Array.isArray(runner)
      || !Array.isArray(runner.taskIds) || typeof runner.runTask !== 'function') {
    throw new SemanticaError(
      'E_INVALID_ARGUMENT',
      'meta.run: runner must be { taskIds: string[], runTask(taskId) -> { pass, tokens, durationMs, costUsd, input?, toolCalls?, output? } }',
    );
  }
  for (const id of runner.taskIds) {
    if (typeof id !== 'string' || id === '') {
      throw new SemanticaError('E_INVALID_ARGUMENT', `meta.run: runner.taskIds entries must be non-empty strings, got ${JSON.stringify(id)}`);
    }
  }

  const m = manifest.manifest;
  if (benchmark !== undefined && benchmark !== null && benchmark !== m.benchmark) {
    throw new SemanticaError('E_INVALID_ARGUMENT', `meta.run: benchmark ${JSON.stringify(benchmark)} does not match the manifest pin ${JSON.stringify(m.benchmark)}`);
  }
  if (version !== null && version !== m.adapterVersion) {
    throw new SemanticaError('E_INVALID_ARGUMENT', `meta.run: adapter version ${JSON.stringify(version)} does not match the manifest pin ${JSON.stringify(m.adapterVersion)}`);
  }

  const ranAt = resolveClock(clock ?? null);
  const runId = `${m.benchmark}-${manifest.sha256.slice(0, 16)}`;
  const controller = createCost({ cap: costCap });
  const sink = createTrace({ runId, adapter: name, tracePath: tracePath ?? null });

  const rows = [];
  let aborted = false;
  for (const taskId of runner.taskIds) {
    if (aborted) {
      rows.push(notRun(taskId));
      continue;
    }
    const r = await runner.runTask(taskId);
    if (!r || typeof r !== 'object' || Array.isArray(r)) {
      throw new SemanticaError('E_INCOMPLETE_TASK', `meta.run: task ${taskId} runner returned ${Array.isArray(r) ? 'array' : typeof r} — { pass, tokens, durationMs, costUsd } required`);
    }
    if (typeof r.pass !== 'boolean') {
      throw new SemanticaError('E_INCOMPLETE_TASK', `meta.run: task ${taskId} must carry a boolean pass, got ${JSON.stringify(r.pass)}`);
    }
    for (const field of ['tokens', 'durationMs', 'costUsd']) {
      const v = r[field];
      if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
        throw new SemanticaError(
          'E_INCOMPLETE_TASK',
          `meta.run: task ${taskId} is missing a valid ${field} (finite non-negative number required) — every task carries tokens + durationMs + costUsd`,
        );
      }
    }
    try {
      controller.charge(r.costUsd);
    } catch (e) {
      if (e instanceof SemanticaError && e.code === 'E_COST_CAP_EXCEEDED') {
        aborted = true; // clean abort: this task + all remaining marked NOT_RUN, no phantom spend
        rows.push(notRun(taskId));
        continue;
      }
      throw e;
    }
    rows.push({
      taskId,
      pass: r.pass,
      tokens: r.tokens,
      durationMs: r.durationMs,
      costUsd: r.costUsd,
      status: 'EVALUATED',
    });
    sink.record(taskId, {
      input: r.input ?? null,
      toolCalls: r.toolCalls ?? [],
      output: r.output ?? null,
      tokens: r.tokens,
      durationMs: r.durationMs,
      costUsd: r.costUsd,
    });
  }

  const unifiedResult = buildEnvelope({
    benchmark: m.benchmark,
    adapterVersion: m.adapterVersion,
    ranAt,
    rows,
    manifestRef: manifest.sha256,
    costCap,
  });
  const flushed = await sink.flush();
  return { unifiedResult, manifest, tracePath: flushed.path };
}
