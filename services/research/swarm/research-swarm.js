// research/swarm/research-swarm.js
// PHASE 21 SCOPE H — coordinator for multiple research agents.
//
// Agents propose experiments; the coordinator admits them through dedup, runs
// them (budget + keep/discard verdicts come from the caller's runFn — the same
// seam the loop uses), and updates the shared frontier. Redundant proposals
// are rejected with the reason, not silently re-run.
import { createSharedFrontier } from './shared-frontier.js';
import { createDedup } from './dedup.js';

export function createResearchSwarm({
  agents = [],
  metricName = 'val_metric',
  initialBest = null,
  ttlMs,
} = {}) {
  const frontier = createSharedFrontier({ metricName, initialBest });
  const dedup = createDedup({ ttlMs });
  const log = [];
  const stats = new Map(agents.map((a) => [a.id, { id: a.id, proposed: 0, admitted: 0, kept: 0, discarded: 0, bestMetric: null }]));

  // CONTRACT
  //   swarm.propose({ agentId, experimentId, knobs, code, run }) ->
  //     { admitted, verdict?, frontierAdvanced?, reason? }
  // run: async () => ({ kept, metric }) — the experiment's execution seam.
  async function propose({ agentId, experimentId, knobs, code, run }) {
    const agent = stats.get(agentId);
    if (!agent) return { admitted: false, reason: `unknown agent '${agentId}'` };
    agent.proposed++;

    const admission = dedup.propose({ experimentId, agent: agentId, knobs, code });
    if (!admission.allowed) {
      log.push({ at: Date.now(), agentId, experimentId, admitted: false, reason: admission.reason });
      return { admitted: false, reason: admission.reason, duplicateOf: admission.duplicateOf };
    }
    agent.admitted++;

    let outcome;
    try {
      outcome = await run();
    } catch (err) {
      dedup.release(experimentId); // crashed run does not own the direction
      log.push({ at: Date.now(), agentId, experimentId, admitted: true, verdict: 'crashed' });
      return { admitted: true, verdict: 'crashed', reason: String(err?.message ?? err) };
    }

    const { kept = false, metric = null } = outcome ?? {};
    const offer = frontier.offer(experimentId, metric);
    dedup.report(experimentId, { knobs, code }, { kept, metric });

    if (kept) agent.kept++;
    else agent.discarded++;
    if (Number.isFinite(metric) && (agent.bestMetric === null || metric < agent.bestMetric)) {
      agent.bestMetric = metric;
    }

    log.push({ at: Date.now(), agentId, experimentId, admitted: true, verdict: kept ? 'kept' : 'discarded', metric, advanced: offer.advanced });
    return { admitted: true, verdict: kept ? 'kept' : 'discarded', metric, frontier: offer };
  }

  return {
    frontier,
    dedup,
    propose,
    log: () => log.map((e) => ({ ...e })),
    agentStats: () => [...stats.values()].map((s) => ({ ...s })),
    summary() {
      const agents = this.agentStats();
      return {
        proposed: agents.reduce((s, a) => s + a.proposed, 0),
        admitted: agents.reduce((s, a) => s + a.admitted, 0),
        kept: agents.reduce((s, a) => s + a.kept, 0),
        duplicatesBlocked: agents.reduce((s, a) => s + (a.proposed - a.admitted), 0),
        frontier: frontier.snapshot(),
      };
    },
  };
}
