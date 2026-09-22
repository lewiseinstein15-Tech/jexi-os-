/**
 * Deterministic fact consolidation.
 * Bucket by (source_id, entity_slug), greedy head-vector cosine threshold 0.85,
 * promote clusters >=2, retain every fact, and stamp consolidated_into.
 */
import { createHash } from 'node:crypto';

export const name = 'consolidate';
export const CONSOLIDATION_THRESHOLD = 0.85;
export const MIN_CLUSTER_SIZE = 2;

const compareText = (a, b) => String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
const clone = (value) => JSON.parse(JSON.stringify(value));

export function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length === 0 || a.length !== b.length) return 0;
  let dot = 0; let normA = 0; let normB = 0;
  for (let index = 0; index < a.length; index += 1) {
    const av = Number(a[index]); const bv = Number(b[index]);
    if (!Number.isFinite(av) || !Number.isFinite(bv)) return 0;
    dot += av * bv; normA += av * av; normB += bv * bv;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export function clusterFacts(facts, threshold = CONSOLIDATION_THRESHOLD) {
  const sorted = [...facts].sort((a, b) =>
    (Number(b.op_seq ?? 0) - Number(a.op_seq ?? 0)) || compareText(a.id, b.id));
  const clusters = [];
  for (const fact of sorted) {
    if (!Array.isArray(fact.embedding)) {
      clusters.push([fact]);
      continue;
    }
    const target = clusters.find((cluster) =>
      Array.isArray(cluster[0].embedding) && cosineSimilarity(fact.embedding, cluster[0].embedding) >= threshold);
    if (target) target.push(fact);
    else clusters.push([fact]);
  }
  return clusters;
}

function takeId(sourceId, entitySlug, facts) {
  const ids = facts.map((fact) => fact.id).sort(compareText).join('\0');
  return 'take-' + createHash('sha256').update(`${sourceId}\0${entitySlug}\0${ids}`).digest('hex').slice(0, 16);
}

function bestFact(cluster) {
  return [...cluster].sort((a, b) =>
    (Number(b.confidence ?? 0) - Number(a.confidence ?? 0)) || compareText(a.id, b.id))[0];
}

export async function run({ state, index, dryRun = false }) {
  let embeddedFacts = 0;
  const unconsolidated = state.facts.filter((fact) =>
    fact.consolidated_into == null && fact.source_id && fact.entity_slug);
  const missing = unconsolidated.filter((fact) =>
    !Array.isArray(fact.embedding) && typeof fact.fact === 'string' && fact.fact !== '');
  if (missing.length > 0 && index && typeof index.embed === 'function') {
    const result = await index.embed(missing.map((fact) => ({ chunkId: fact.id, text: fact.fact })));
    const vectors = new Map((result?.vectors ?? []).map((item) => [item.chunkId, item.vector]));
    state.facts = state.facts.map((fact) => {
      const embedding = vectors.get(fact.id);
      if (!Array.isArray(embedding)) return fact;
      embeddedFacts += 1;
      return { ...fact, embedding: [...embedding] };
    });
  }

  const buckets = new Map();
  for (const fact of state.facts) {
    if (fact.consolidated_into != null || !fact.source_id || !fact.entity_slug) continue;
    const key = `${fact.source_id}\0${fact.entity_slug}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(fact);
  }
  const promotions = [];
  let clustersSeen = 0;
  for (const key of [...buckets.keys()].sort(compareText)) {
    const [sourceId, entitySlug] = key.split('\0');
    for (const cluster of clusterFacts(buckets.get(key))) {
      clustersSeen += 1;
      if (cluster.length < MIN_CLUSTER_SIZE) continue;
      const id = takeId(sourceId, entitySlug, cluster);
      const best = bestFact(cluster);
      const confidence = Number.isFinite(best.confidence) ? best.confidence : 1;
      promotions.push({
        take: {
          id,
          source_id: sourceId,
          entity_slug: entitySlug,
          claim: best.fact,
          kind: 'take',
          confidence: Number(confidence.toFixed(6)),
          fact_ids: cluster.map((fact) => fact.id).sort(compareText),
          threshold: CONSOLIDATION_THRESHOLD,
        },
        factIds: new Set(cluster.map((fact) => fact.id)),
      });
    }
  }

  if (!dryRun) {
    const existing = new Set(state.takes.map((take) => take.id));
    for (const promotion of promotions) {
      if (!existing.has(promotion.take.id)) {
        state.takes.push(clone(promotion.take));
        existing.add(promotion.take.id);
      }
      state.facts = state.facts.map((fact) => promotion.factIds.has(fact.id)
        ? { ...fact, consolidated_into: promotion.take.id }
        : fact);
      for (const factId of [...promotion.factIds].sort(compareText)) {
        state.consolidationAudit.push({
          event: 'fact_consolidated',
          factId,
          takeId: promotion.take.id,
          sourceId: promotion.take.source_id,
          entitySlug: promotion.take.entity_slug,
        });
      }
    }
    state.takes.sort((a, b) => compareText(a.id, b.id));
  }

  return {
    durationMs: 0,
    budgetUsed: 0,
    details: {
      threshold: CONSOLIDATION_THRESHOLD,
      embeddedFacts,
      clustersSeen,
      takesPromoted: promotions.length,
      factsConsolidated: promotions.reduce((sum, item) => sum + item.factIds.size, 0),
      factsRetained: state.facts.length,
      dryRun,
    },
  };
}

export default Object.freeze({ name, deterministic: true, run });
