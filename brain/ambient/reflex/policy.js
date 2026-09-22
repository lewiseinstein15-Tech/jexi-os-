/**
 * JEXI OS — Phase 28 Scope G — retrieval-reflex trigger policy.
 *
 * DECLARED JUDGMENT RULE:
 *   emit only when (a) the turn has >=6 word tokens, (b) carries substantive
 *   intent/question language, (c) is not a trivial greeting/FYI/ping, and
 *   (d) the resolved entity is not already loaded in caller context.
 * This precision-biased gate makes passing mentions silent.
 */
export const DEFAULT_MAX_POINTERS = 8;
export const MIN_SUBSTANTIVE_TOKENS = 6;
export const POINTER_INSTRUCTION = 'Open the page before relying on details.';

const TRIVIAL_RE = /^\s*(?:hi|hello|hey|thanks|thank you|fyi|cc|ping|noted|ok(?:ay)?)[,:!\s-]*(?:@[\w.-]+|[A-Z][\w'’-]*(?:\s+[A-Z][\w'’-]*){0,2})?[.!]?\s*$/i;
const INTENT_RE = /[?]|\b(?:about|compare|decide|review|explain|tell|status|history|relationship|plan|work|before|after|because|should|need|discuss|evaluate|verify|remember|prepare|research|meeting|decision|context)\b/i;

export const JUDGMENT_RULE = Object.freeze({
  minTokens: MIN_SUBSTANTIVE_TOKENS,
  requiresSubstantiveIntent: true,
  suppressTrivial: true,
  suppressAlreadyLoaded: true,
});

export function isSubstantiveTurn(text) {
  const value = String(text ?? '').trim();
  if (value === '' || TRIVIAL_RE.test(value)) return false;
  const tokens = value.match(/[\p{L}\p{N}@][\p{L}\p{N}@'_.-]*/gu) || [];
  return tokens.length >= MIN_SUBSTANTIVE_TOKENS && INTENT_RE.test(value);
}

export function alreadyInContext(entity, context = {}) {
  const items = [
    ...(Array.isArray(context.loadedSlugs) ? context.loadedSlugs : []),
    ...(Array.isArray(context.loadedEntities) ? context.loadedEntities : []),
    ...(Array.isArray(context.entities) ? context.entities : []),
    ...(Array.isArray(context.cards) ? context.cards : []),
    ...(Array.isArray(context.pointers) ? context.pointers : []),
    ...(Array.isArray(context.pack?.cards) ? context.pack.cards : []),
  ];
  const loadedSlugs = new Set(items.map((item) => String(item?.slug ?? item).toLowerCase()));
  const loadedEntities = new Set(items.map((item) => String(item?.name ?? item).toLowerCase()));
  const text = String(context.contextText ?? context.loadedText ?? '').toLowerCase();
  const slug = String(entity.slug).toLowerCase();
  const name = String(entity.name).toLowerCase();
  return loadedSlugs.has(slug) || loadedEntities.has(name) ||
    (text !== '' && (text.includes(slug) || text.includes(name)));
}

export function shouldPoint(text, entity, context = {}) {
  return isSubstantiveTurn(text) && !alreadyInContext(entity, context);
}
