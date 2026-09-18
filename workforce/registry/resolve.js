/**
 * JEXI OS — WORKFORCE REGISTRY — two-stage resolver (Phase 7 I).
 *
 * The L6 two-stage request → worker resolution (router/README):
 *
 *   Stage 1 — runtime registry (hot-path coworkers, Phase 2D Director roster).
 *             Exact capability/role token match. RUNTIME WINS.
 *   Stage 2 — canonical specialist pool (canonical agents/ tree catalog).
 *             Scored token match over id/name/description/tools/division.
 *
 * resolveTwoStage(query) → { source, id, name, file, score, reason, query }
 *
 * Matching is deliberately token-exact in stage 1: "review my TypeScript"
 * must NOT be swallowed by the hot-path verification capability — it falls
 * through to the canonical typescript-reviewer specialist.
 */

import { buildIndex, runtimeRoster } from './catalog.js';

const STOPWORDS = new Set([
  'my', 'the', 'a', 'an', 'to', 'for', 'of', 'and', 'in', 'on', 'it', 'this',
  'that', 'is', 'are', 'was', 'be', 'me', 'i', 'we', 'you', 'please', 'can',
  'could', 'would', 'need', 'needs', 'want', 'wants', 'some', 'do', 'does',
]);

function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .split(/[^a-z0-9-]+/)
    .filter((t) => t && !STOPWORDS.has(t));
}

/** Stage 1 — exact token match over the runtime roster. */
async function resolveRuntime(tokens) {
  const roster = await runtimeRoster();
  for (const r of roster) {
    const fields = {
      capabilities: (r.capabilities || []).map((c) => String(c).toLowerCase()),
      role: String(r.role || '').toLowerCase(),
      id: String(r.agentId || '').toLowerCase(),
    };
    const hits = tokens.filter(
      (t) => fields.capabilities.includes(t) || fields.role.split(/\W+/).includes(t) || fields.id === t,
    );
    if (hits.length > 0) {
      return {
        source: 'runtime',
        id: r.agentId,
        name: r.displayName,
        role: r.role,
        capabilities: r.capabilities,
        score: hits.length,
        reason: `runtime capability match: ${hits.join(', ')}`,
      };
    }
  }
  return null;
}

/** Stage 2 — scored match over the canonical specialist catalog. */
function resolveCanonical(tokens) {
  const { byId } = buildIndex();
  let best = null;
  for (const a of byId.values()) {
    const idTokens = a.id.split('-');
    const nameTokens = String(a.name || '').toLowerCase().split(/\W+/);
    const descTokens = new Set(tokenize(a.description));
    const toolTokens = (a.tools || []).map((t) => String(t).toLowerCase());
    let score = 0;
    const reasons = [];
    for (const t of tokens) {
      if (idTokens.includes(t)) { score += 5; reasons.push(`id~${t}`); continue; }
      if (nameTokens.includes(t)) { score += 4; reasons.push(`name~${t}`); continue; }
      if (descTokens.has(t)) { score += 2; reasons.push(`description~${t}`); continue; }
      if (toolTokens.some((x) => x.split(/[.\-/]/).includes(t))) { score += 1; reasons.push(`tools~${t}`); continue; }
    }
    if (score > 0 && (!best || score > best.score)) {
      best = { source: 'canonical', id: a.id, name: a.name, division: a.division, file: a.file, score, reason: `canonical match: ${reasons.join(', ')}` };
    }
  }
  return best;
}

/** Two-stage resolution: runtime wins, canonical supplies the specialist pool. */
export async function resolveTwoStage(query) {
  const tokens = tokenize(query);
  if (!tokens.length) {
    return { source: 'none', id: null, name: null, file: null, score: 0, reason: 'no usable tokens in query', query, tokens };
  }
  const runtime = await resolveRuntime(tokens);
  if (runtime) return { ...runtime, query, tokens };

  const canonical = resolveCanonical(tokens);
  if (canonical) return { ...canonical, query, tokens };

  return { source: 'none', id: null, name: null, file: null, score: 0, reason: `no runtime capability and no canonical specialist matched tokens [${tokens.join(', ')}]`, query, tokens };
}
