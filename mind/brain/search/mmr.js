/**
 * JEXI OS — Phase 28 Scope D — hybrid retrieval: MMR-lite session
 * diversification.
 *
 * Results with an explicit sessionId/sessionPrefix, or a session-shaped page
 * id (chat/session marker or YYYY-MM-DD prefix), form a cluster. The highest
 * scorer is the representative and keeps its score; every other member is
 * demoted exactly x0.95 ONCE. Ordinary entity/type directories are not
 * clusters (people/alice + people/bob must not demote each other).
 */
export const MMR_LITE_DEMOTE = 0.95;
const DATE_PREFIX_RE = /^(\d{4}-\d{2}-\d{2})/;
const SESSION_MARKERS = new Set(['chat', 'session', 'sessions']);

/** Return a session/prefix cluster key, or null for a non-session result. */
export function clusterKey(cand) {
  if (cand.sessionId) return `session:${cand.sessionId}`;
  if (cand.sessionPrefix) return `prefix:${cand.sessionPrefix}`;
  const parts = String(cand.pageId).split('/');
  for (let i = 0; i < parts.length; i += 1) {
    if (SESSION_MARKERS.has(parts[i])) {
      const end = Math.min(i + 1, parts.length - 1);
      return `prefix:${parts.slice(0, end + 1).join('/')}`;
    }
    const date = parts[i].match(DATE_PREFIX_RE);
    if (date) return `prefix:${parts.slice(0, i).concat(date[1]).join('/')}`;
  }
  return null;
}

/**
 * applyMMRLite(cands, { topK? }) -> new candidates with auditable reasons.
 * Input must already be sorted score-desc; only the score-ranked top-K takes
 * part when topK is supplied, matching the post-fusion graph-signal window.
 */
export function applyMMRLite(cands, { topK = cands.length } = {}) {
  const window = cands.slice(0, topK);
  const groups = new Map();
  for (const c of window) {
    const key = clusterKey(c);
    if (key === null) continue;
    const group = groups.get(key) || [];
    group.push(c);
    groups.set(key, group);
  }
  const representative = new Map();
  for (const [key, members] of groups) {
    if (members.length < 2) continue;
    const ranked = [...members].sort((a, b) => (b.score - a.score) || (a.chunkId < b.chunkId ? -1 : 1));
    representative.set(key, ranked[0].chunkId);
  }

  return cands.map((c, i) => {
    if (i >= topK) return { ...c, reasons: [...c.reasons, 'mmr-lite: outside top-K signal window'] };
    const key = clusterKey(c);
    if (key === null || !representative.has(key)) {
      return { ...c, reasons: [...c.reasons, 'mmr-lite: no repeated session/prefix cluster'] };
    }
    if (representative.get(key) === c.chunkId) {
      return { ...c, reasons: [...c.reasons, `mmr-lite cluster "${key}" representative — no demote`] };
    }
    return {
      ...c,
      score: c.score * MMR_LITE_DEMOTE,
      reasons: [...c.reasons, `mmr-lite-demote x${MMR_LITE_DEMOTE} (cluster "${key}")`],
    };
  });
}
