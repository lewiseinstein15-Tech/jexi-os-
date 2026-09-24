/**
 * JEXI OS — Phase 28 Scope G — deterministic zero-LLM retrieval pointers.
 *
 * Scans known entity names/aliases/@handles in textual order, resolves exact
 * catalog entries, applies the judgment gate + world visibility, and emits a
 * compact pointer. The entire point() path is fail-open: any error -> [].
 */
import { SemanticaError } from '../../../semantica/_internal.js';
import { extract as extractEdges } from '../../kg/index.js';
import {
  DEFAULT_MAX_POINTERS, POINTER_INSTRUCTION, shouldPoint,
} from './policy.js';

const canonical = (value) => String(value ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
const escapeRe = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const clone = (value) => JSON.parse(JSON.stringify(value));
const compareText = (a, b) => String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;

function oneLine(text, max = 160) {
  const line = String(text ?? '').replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s+/)[0] || '';
  return line.length <= max ? line : line.slice(0, max - 1).trimEnd() + '…';
}

export function normalizeEntity(entity) {
  if (!entity || typeof entity !== 'object') return null;
  const name = entity.name ?? entity.title;
  const slug = entity.slug ?? entity.pageId;
  if (typeof name !== 'string' || name.trim() === '' || typeof slug !== 'string' || slug.trim() === '') return null;
  const aliases = Array.isArray(entity.aliases) ? entity.aliases.filter((a) => typeof a === 'string' && a.trim()) : [];
  const handle = typeof entity.handle === 'string' && entity.handle.trim() ? entity.handle.trim() : null;
  const summary = oneLine(entity.summary ?? entity.compiledTruth ?? entity.page?.compiledTruth ?? '') ||
    `Entity page for ${name.trim()}.`;
  const visibility = entity.visibility === 'private' || entity.tags?.includes?.('private') ? 'private' : 'world';
  return {
    name: name.trim(), slug: slug.trim(), summary, visibility,
    aliases, handle,
    ...(entity.page ? { page: entity.page } : {}),
  };
}

/** Merge metadata without ever allowing a later source to downgrade private. */
export function mergeEntities(inputs) {
  const merged = [];
  const bySlug = new Map();
  for (const input of inputs) {
    const entity = normalizeEntity(input);
    if (!entity) continue;
    const key = canonical(entity.slug);
    const existing = bySlug.get(key);
    if (!existing) {
      bySlug.set(key, entity);
      merged.push(entity);
      continue;
    }
    existing.visibility = existing.visibility === 'private' || entity.visibility === 'private' ? 'private' : 'world';
    existing.aliases = [...new Set([...existing.aliases, ...entity.aliases])];
    if (!existing.handle && entity.handle) existing.handle = entity.handle;
    if (!existing.page && entity.page) existing.page = entity.page;
  }
  return merged;
}

function repoEntities(repo) {
  if (!repo || typeof repo.list !== 'function') return [];
  return repo.list().map((page) => normalizeEntity({
    name: page.title,
    slug: `${page.kind}/${page.slug}`,
    summary: page.compiledTruth,
    tags: page.tags,
    page,
  })).filter(Boolean);
}

function mentionIndex(text, surface) {
  const value = surface.startsWith('@') ? surface : surface.trim();
  const boundary = surface.startsWith('@')
    ? new RegExp(`(^|[^\\w])(${escapeRe(value)})(?=$|[^\\w])`, 'i')
    : new RegExp(`(^|[^\\p{L}\\p{N}])(${escapeRe(value)})(?=$|[^\\p{L}\\p{N}])`, 'iu');
  const match = boundary.exec(text);
  if (!match) return -1;
  const mentioned = match[2];
  if (!surface.startsWith('@') && !/^\p{Lu}/u.test(mentioned)) return -1;
  return match.index + match[1].length;
}

function catalogLookup(all, pointer) {
  const key = canonical(pointer.slug);
  return all.find((entity) => canonical(entity.slug) === key) ||
    all.find((entity) => canonical(entity.name) === canonical(pointer.name));
}

function readRepoPage(repo, slug) {
  if (!repo || typeof repo.read !== 'function') return null;
  const slash = slug.indexOf('/');
  if (slash <= 0) return null;
  return repo.read(slug.slice(0, slash), slug.slice(slash + 1));
}

function edgeCatalog(repo, supplied) {
  if (typeof supplied === 'function') return supplied();
  if (Array.isArray(supplied)) return supplied;
  if (!repo || typeof repo.list !== 'function') return [];
  return repo.list().flatMap((page) => extractEdges(page).edges);
}

export function createPointerLayer({ repo, catalog = [], edges, maxPointers = DEFAULT_MAX_POINTERS, catalogSource } = {}) {
  const getCatalog = (context = {}) => {
    const injected = typeof catalogSource === 'function' ? catalogSource(context) : [];
    const contextual = Array.isArray(context.catalog) ? context.catalog : [];
    // Scope A pages are authoritative; later sources may enrich aliases and
    // handles or tighten visibility, but can never downgrade a private page.
    return mergeEntities([...repoEntities(repo), ...catalog, ...injected, ...contextual]);
  };

  return {
    point(turn, context = {}) {
      try {
        const text = typeof turn === 'string' ? turn : turn?.text;
        if (typeof text !== 'string') return [];
        const includePrivate = context.includePrivate === true;
        const cap = Number.isInteger(context.maxPointers) && context.maxPointers >= 0
          ? Math.min(context.maxPointers, maxPointers) : maxPointers;
        const found = [];
        for (const entity of getCatalog(context)) {
          if (entity.visibility === 'private' && !includePrivate) continue;
          const surfaces = [entity.name, ...entity.aliases, ...(entity.handle ? [entity.handle] : [])];
          let first = Infinity;
          for (const surface of surfaces) {
            const index = mentionIndex(text, surface);
            if (index >= 0 && index < first) first = index;
          }
          if (first !== Infinity && shouldPoint(text, entity, context)) found.push({ entity, index: first });
        }
        found.sort((a, b) => (a.index - b.index) || compareText(a.entity.slug, b.entity.slug));
        return found.slice(0, cap).map(({ entity }) => ({
          name: entity.name,
          slug: entity.slug,
          summary: entity.summary,
          visibility: entity.visibility,
          instruction: POINTER_INSTRUCTION,
        }));
      } catch {
        return [];
      }
    },

    escalate(pointer, { level = 1, includePrivate = false } = {}) {
      if (!pointer || typeof pointer !== 'object' || ![1, 2, 3].includes(level)) {
        throw new SemanticaError('E_INVALID_ARGUMENT', 'reflex.escalate requires a pointer and level 1, 2, or 3');
      }
      const pointerCopy = clone(pointer);
      if (level === 1) return { level: 1, pointer: pointerCopy };

      // Visibility is checked again at every widening step. Possessing or
      // fabricating a private pointer is not itself an opt-in to private data.
      const fullCatalog = getCatalog({ includePrivate: true });
      const unresolvedEntity = catalogLookup(fullCatalog, pointer);
      if ((pointer.visibility === 'private' || unresolvedEntity?.visibility === 'private') && includePrivate !== true) {
        return level === 2
          ? { level: 2, pointer: pointerCopy, page: null }
          : { level: 3, pointer: pointerCopy, page: null, neighbors: [] };
      }
      const all = fullCatalog.filter((item) => item.visibility !== 'private' || includePrivate === true);
      const entity = catalogLookup(all, pointer);
      let page = entity?.page ? clone(entity.page) : null;
      if (!page) {
        try { page = readRepoPage(repo, pointer.slug); } catch { page = null; }
      }
      if (level === 2) return { level: 2, pointer: pointerCopy, page };

      const identities = new Set([
        canonical(pointer.slug), canonical(pointer.slug.split('/').pop()), canonical(pointer.name),
      ]);
      const catalogByIdentity = new Map();
      for (const item of all) {
        for (const key of [canonical(item.slug), canonical(item.slug.split('/').pop()), canonical(item.name)]) {
          if (!catalogByIdentity.has(key)) catalogByIdentity.set(key, item);
        }
      }
      const privateIdentities = new Set(fullCatalog
        .filter((item) => item.visibility === 'private')
        .flatMap((item) => [canonical(item.slug), canonical(item.slug.split('/').pop()), canonical(item.name)]));
      const neighbors = [];
      try {
        for (const edge of edgeCatalog(repo, edges)) {
          const from = canonical(edge.from);
          const to = canonical(edge.to);
          let direction;
          let surface;
          if (identities.has(from)) { direction = 'outbound'; surface = edge.to; }
          else if (identities.has(to)) { direction = 'inbound'; surface = edge.from; }
          else continue;
          const surfaceKey = canonical(surface);
          if (includePrivate !== true && privateIdentities.has(surfaceKey)) continue;
          const target = catalogByIdentity.get(surfaceKey);
          neighbors.push({
            name: target?.name ?? String(surface),
            slug: target?.slug ?? null,
            verb: edge.verb,
            direction,
            evidence: edge.evidence,
          });
        }
      } catch {
        // Level 3 is fail-soft: page still returns when KG extraction/read fails.
      }
      const seen = new Set();
      const unique = neighbors.filter((neighbor) => {
        const key = `${neighbor.direction}\0${neighbor.slug ?? neighbor.name}\0${neighbor.verb}\0${neighbor.evidence}`;
        if (seen.has(key)) return false;
        seen.add(key); return true;
      }).sort((a, b) =>
        (compareText(a.direction, b.direction) ||
         compareText(a.slug ?? a.name, b.slug ?? b.name) ||
         compareText(a.verb, b.verb) || compareText(a.evidence, b.evidence)));
      return { level: 3, pointer: pointerCopy, page, neighbors: unique };
    },
  };
}
