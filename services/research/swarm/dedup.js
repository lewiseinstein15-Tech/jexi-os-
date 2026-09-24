// research/swarm/dedup.js
// PHASE 21 SCOPE H — dedup: no two agents run (or re-run) the same experiment.
//
// A proposal is keyed by its similarity signature: normalized knobs (sorted,
// whitespace-insensitive) + a coarse hash of the candidate code. In-flight
// claims expire with a TTL so a crashed agent's half-run doesn't block a
// direction forever. Completed records remember the verdict so an identical
// re-proposal is rejected with the old answer.
const DEFAULT_TTL_MS = 5 * 60_000;

function normalizeKnobs(knobs = {}) {
  const keys = Object.keys(knobs).sort();
  return keys
    .map((k) => `${k}=${String(knobs[k]).trim().toLowerCase().replace(/\s+/g, ' ')}`)
    .join('&');
}

function hashCode(code) {
  return String(code ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .split('')
    .reduce((h, c) => ((h << 5) - h + c.charCodeAt(0)) | 0, 0);
}

// CONTRACT
//   swarmDedup.propose({ experimentId, agent, knobs, code }) ->
//     { allowed, duplicateOf?, reason? }
export function createDedup({ ttlMs = DEFAULT_TTL_MS } = {}) {
  const inflight = new Map(); // signature -> { experimentId, agent, claimedAt }
  const completed = new Map(); // signature -> { experimentId, verdict, metric }

  function signatureOf({ knobs, code }) {
    return `${normalizeKnobs(knobs)}#${hashCode(code)}`;
  }

  function sweepExpired(now = Date.now()) {
    for (const [sig, entry] of inflight) {
      if (now - entry.claimedAt > ttlMs) inflight.delete(sig);
    }
  }

  return {
    propose(request) {
      sweepExpired();
      const sig = signatureOf(request);
      const running = inflight.get(sig);
      if (running) {
        return {
          allowed: false,
          duplicateOf: running.experimentId,
          reason: `in-flight on agent '${running.agent}' (${running.experimentId})`,
        };
      }
      const done = completed.get(sig);
      if (done) {
        return {
          allowed: false,
          duplicateOf: done.experimentId,
          reason: `already completed as ${done.experimentId} (verdict ${done.verdict}, metric ${done.metric ?? 'n/a'})`,
        };
      }
      inflight.set(sig, {
        experimentId: request.experimentId,
        agent: request.agent,
        claimedAt: Date.now(),
      });
      return { allowed: true };
    },
    // The agent reports the outcome; the claim converts into a completed record.
    report(experimentId, request, { kept, metric } = {}) {
      const sig = signatureOf(request);
      const claim = inflight.get(sig);
      if (claim?.experimentId === experimentId) inflight.delete(sig);
      completed.set(sig, { experimentId, verdict: kept ? 'kept' : 'discarded', metric });
    },
    // A crashed agent can release its claim so others may retry the direction.
    release(experimentId) {
      for (const [sig, entry] of inflight) {
        if (entry.experimentId === experimentId) inflight.delete(sig);
      }
    },
    inflightCount() {
      sweepExpired();
      return inflight.size;
    },
    completedCount() {
      return completed.size;
    },
  };
}
