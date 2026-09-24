// research/loop/scheduler.js
// Overnight, indefinite, bounded. The loop above can run forever; the scheduler
// is what makes that safe: it drives runLoop and stops on
//   - maxIterations (hard cap on experiments),
//   - maxWallMs (wall clock since start),
//   - maxStalled (consecutive non-kept experiments — hopeless streak).
// Returns a summary suitable for a wake-up report.

import { runLoop } from './experiment-loop.js';

export async function runScheduled(config, opts = {}) {
  const {
    maxIterations = Infinity,
    maxWallMs = Infinity,
    maxStalled = Infinity,
    intervalMs = 0,
  } = opts;
  const startedAt = Date.now();

  let iterations = 0;
  let keptCount = 0;
  let discardedCount = 0;
  let crashedCount = 0;
  let best = opts.initialBest ?? null;
  let stalled = 0;
  let stoppedBecause = 'exhausted';

  for await (const event of runLoop(config, { ...opts })) {
    if (event.status === 'complete') {
      best = event.metric;
      stoppedBecause =
        iterations >= maxIterations
          ? 'maxIterations'
          : Date.now() - startedAt >= maxWallMs
            ? 'maxWallMs'
            : 'exhausted';
      break;
    }
    iterations++;
    if (event.status === 'kept') {
      keptCount++;
      stalled = 0;
      best = event.metric;
    } else if (event.status === 'discarded') {
      discardedCount++;
      stalled++;
    } else {
      crashedCount++;
      stalled++;
    }

    if (Date.now() - startedAt >= maxWallMs) {
      stoppedBecause = 'maxWallMs';
      break;
    }
    if (stalled >= maxStalled) {
      stoppedBecause = 'maxStalled';
      break;
    }
    if (intervalMs > 0) await new Promise((r) => setTimeout(r, intervalMs));
  }

  return {
    iterations,
    kept: keptCount,
    discarded: discardedCount,
    crashed: crashedCount,
    best,
    stalled,
    elapsedMs: Date.now() - startedAt,
    stoppedBecause,
  };
}
