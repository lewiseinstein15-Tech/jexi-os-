// research/swarm/shared-frontier.js
// PHASE 21 SCOPE H — the swarm's shared frontier (val_bpb analog: one number
// every agent competes to beat). Monotone: only improvements move it. Every
// update returns { advanced, best, previousBest } so callers can show exactly
// who moved the frontier and by how much.
//
// Honest scope: this coordinates agents INSIDE one process (the overnight run
// and probes). A multi-host swarm would put this object behind one service;
// the contract below is exactly what that service must expose.
export function createSharedFrontier({ metricName = 'val_metric', initialBest = null } = {}) {
  let best = initialBest;
  let bestBy = null;
  let updatedAt = initialBest === null ? null : Date.now();
  const history = [];

  return {
    metricName,
    get best() {
      return best;
    },
    get bestBy() {
      return bestBy;
    },
    get history() {
      return history.map((h) => ({ ...h }));
    },
    // CONTRACT: offer(experimentId, metric) -> { advanced, best, previousBest }
    offer(experimentId, metric) {
      const previousBest = best;
      const advanced = Number.isFinite(metric) && (best === null || metric < best);
      if (advanced) {
        best = metric;
        bestBy = experimentId;
        updatedAt = Date.now();
      }
      history.push({ at: Date.now(), experimentId, metric, previousBest, advanced });
      return { advanced, best, previousBest };
    },
    snapshot() {
      return { metricName, best, bestBy, updatedAt, updates: history.length };
    },
  };
}
