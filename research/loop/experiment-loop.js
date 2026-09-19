// research/loop/experiment-loop.js
// modify -> run -> evaluate -> keep/discard -> repeat.
// Async iterable of LoopEvents so overnight drivers (scheduler, overnight.js)
// can consume progress incrementally.
//
//   LoopEvent: { iteration, status: 'kept'|'discarded'|'crashed', metric, kept }
//   Terminal event: { iteration, status: 'complete', metric: best, kept: null }
//
// previousBest starts at opts.initialBest and advances only on kept experiments,
// so the frontier is monotone (karpathy/autoresearch keep semantics).

import { runExperiment } from './lifecycle.js';

// CONTRACT
//   runLoop(config, opts): AsyncIterable<LoopEvent>
// config: passed through to runExperiment (experimentDir, command, env, ...)
// opts:   { maxIterations, initialBest, iterations | makeExperiment(i, best),
//           onKeep, onDiscard }
export async function* runLoop(config, opts = {}) {
  const maxIterations = opts.maxIterations ?? Infinity;
  let best = opts.initialBest ?? null;
  let ran = 0;

  for (let i = 1; i <= maxIterations; i++) {
    const spec =
      typeof opts.makeExperiment === 'function'
        ? opts.makeExperiment(i, best)
        : Array.isArray(opts.iterations)
          ? opts.iterations[i - 1]
          : null;
    if (!spec) break;
    ran = i;

    const result = await runExperiment({
      ...config,
      id: spec.name ?? `exp-${i}`,
      mutate: spec.mutate ?? null,
      previousBest: best,
      onKeep: opts.onKeep,
      onDiscard: opts.onDiscard,
    });

    if (result.kept && result.metric !== null) best = result.metric;

    yield { iteration: i, status: result.status, metric: result.metric, kept: result.kept };
  }

  yield { iteration: ran, status: 'complete', metric: best, kept: null };
}
