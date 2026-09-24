/**
 * JEXI OS — Phase 28 Scope G — deterministic boundary context pack.
 *
 * DECLARED packing priority: entity cards -> facts -> open threads.
 * Within each arm: score/priority desc, op_seq desc, stable identity asc.
 * The lowest-ranked tail is removed until the token budget fits.
 * Visibility is world-only unless includePrivate === true.
 */
import { SemanticaError } from '../../../../services/semantica/_internal.js';
import { mergeEntities, normalizeEntity } from '../reflex/pointer.js';

export const PACK_PRIORITY = Object.freeze(['cards', 'facts', 'threads']);
export const DEFAULT_PACK_BUDGET_TOKENS = 1024;

export function estimatePackTokens(value) {
  return Math.ceil(String(value).length / 4);
}

const canonical = (value) => String(value ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
const clone = (value) => JSON.parse(JSON.stringify(value));
const visible = (item, includePrivate) => item?.visibility !== 'private' || includePrivate === true;
const stableKey = (item) => String(item.id ?? item.slug ?? item.fact ?? item.text ?? item.name ?? '');
const compareText = (a, b) => String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
const ranked = (a, b) =>
  ((Number(b.score ?? b.rank ?? b.priority ?? 0)) - (Number(a.score ?? a.rank ?? a.priority ?? 0))) ||
  ((Number(b.op_seq ?? 0)) - (Number(a.op_seq ?? 0))) || compareText(stableKey(a), stableKey(b));

function requestedEntities(input) {
  if (typeof input === 'string') return input.split(',').map((item) => item.trim()).filter(Boolean);
  if (!Array.isArray(input)) return [];
  return input.filter((item) => typeof item === 'string' || (item && typeof item === 'object'));
}

function cardLine(card) { return `CARD ${card.name} | ${card.slug} | ${card.summary}`; }
function factLine(fact) { return `FACT ${fact.kind ? `[${fact.kind}] ` : ''}${fact.fact ?? fact.text ?? ''}`; }
function threadLine(thread) { return `THREAD ${thread.text ?? thread.thread ?? thread.title ?? ''}`; }

export function createContextPack({ getEntities = () => [], getFacts = () => [], getThreads = () => [] } = {}) {
  return function pack({ entities = [], budgetTokens = DEFAULT_PACK_BUDGET_TOKENS, includePrivate = false } = {}) {
    if (!(budgetTokens === Infinity || (Number.isInteger(budgetTokens) && budgetTokens >= 0))) {
      throw new SemanticaError('E_INVALID_ARGUMENT', 'ambient.pack budgetTokens must be a non-negative integer or Infinity');
    }
    const catalog = getEntities().map(normalizeEntity).filter(Boolean);
    const requested = requestedEntities(entities);
    const cards = [];
    for (const request of requested) {
      const direct = typeof request === 'object' ? normalizeEntity(request) : null;
      const key = canonical(direct?.slug ?? direct?.name ?? request);
      const resolved = catalog.find((candidate) =>
        [candidate.slug, candidate.name, ...candidate.aliases, candidate.handle].filter(Boolean)
          .some((surface) => canonical(surface) === key));
      const entity = resolved && direct ? mergeEntities([resolved, direct])[0] : (resolved || direct);
      if (!entity || !visible(entity, includePrivate) || cards.some((card) => card.slug === entity.slug)) continue;
      cards.push({
        name: entity.name, slug: entity.slug, summary: entity.summary,
        visibility: entity.visibility,
      });
    }

    const requestedKeys = new Set(cards.flatMap((card) => [canonical(card.slug), canonical(card.name)]));
    const hasEntityRequest = requested.length > 0;
    const matchesRequest = (item) => !item.entity_slug || !hasEntityRequest || requestedKeys.has(canonical(item.entity_slug));
    const facts = getFacts()
      .filter((fact) => visible(fact, includePrivate) && fact.superseded_by == null)
      .filter(matchesRequest)
      .map(clone).sort(ranked);
    const threads = getThreads()
      .filter((thread) => visible(thread, includePrivate))
      .filter(matchesRequest)
      .map(clone).sort(ranked);

    const entries = [
      ...cards.map((item) => ({ arm: 'cards', item, cost: estimatePackTokens(cardLine(item)) })),
      ...facts.map((item) => ({ arm: 'facts', item, cost: estimatePackTokens(factLine(item)) })),
      ...threads.map((item) => ({ arm: 'threads', item, cost: estimatePackTokens(threadLine(item)) })),
    ];
    let budgetUsed = entries.reduce((sum, entry) => sum + entry.cost, 0);
    let droppedCount = 0;
    while (budgetUsed > budgetTokens && entries.length > 0) {
      const dropped = entries.pop();
      budgetUsed -= dropped.cost;
      droppedCount += 1;
    }

    return {
      cards: entries.filter((entry) => entry.arm === 'cards').map((entry) => clone(entry.item)),
      threads: entries.filter((entry) => entry.arm === 'threads').map((entry) => clone(entry.item)),
      facts: entries.filter((entry) => entry.arm === 'facts').map((entry) => clone(entry.item)),
      budgetUsed,
      droppedCount,
    };
  };
}
