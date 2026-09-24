/** JEXI OS — Phase 28 Scope K — static publisher public surface. */
import fs from 'node:fs';
import path from 'node:path';
import { SemanticaError } from '../../../services/semantica/_internal.js';
import { renderDocument, canonicalPageId, PRIVATE_ID_BEHAVIOR } from './html.js';

function pageCatalog(pages) {
  if (!Array.isArray(pages)) {
    throw new SemanticaError('E_INVALID_ARGUMENT', 'publisher page source must return an array');
  }
  const byId = new Map();
  const slugCounts = new Map();
  const add = (id, page) => {
    if (byId.has(id) && byId.get(id) !== page) {
      throw new SemanticaError('E_INVALID_ARGUMENT', `duplicate publisher page id ${JSON.stringify(id)}`);
    }
    byId.set(id, page);
  };
  for (const page of pages) {
    const full = canonicalPageId(page);
    if (full === '(unknown-page)') throw new SemanticaError('E_INVALID_ARGUMENT', 'publisher page has no id or kind/slug');
    add(full, page);
    if (typeof page?.kind === 'string' && typeof page?.slug === 'string') add(`${page.kind}/${page.slug}`, page);
    if (typeof page?.slug === 'string') slugCounts.set(page.slug, (slugCounts.get(page.slug) ?? 0) + 1);
  }
  for (const page of pages) {
    if (typeof page?.slug === 'string' && slugCounts.get(page.slug) === 1) byId.set(page.slug, page);
  }
  return byId;
}

function sourcePages(options, defaults) {
  if (options.pages !== undefined) return options.pages;
  if (defaults.pages !== undefined) return defaults.pages;
  const repo = options.repo ?? defaults.repo;
  if (repo && typeof repo.list === 'function') return repo.list();
  return null;
}

function resolvePages(pageIds, options, defaults) {
  if (!Array.isArray(pageIds) || pageIds.length === 0 || pageIds.some((id) => typeof id !== 'string' || id === '')) {
    throw new SemanticaError('E_INVALID_ARGUMENT', 'pageIds must be a non-empty array of page-id strings');
  }
  const resolver = options.resolvePage ?? defaults.resolvePage;
  const pages = sourcePages(options, defaults);
  const catalog = pages === null ? null : pageCatalog(pages);
  if (!resolver && !catalog) {
    throw new SemanticaError('E_INVALID_ARGUMENT', 'publisher requires a configured repo, pages, or resolvePage function');
  }
  const seen = new Set();
  const resolved = [];
  for (const id of pageIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    const page = resolver ? resolver(id) : catalog.get(id);
    if (page && typeof page.then === 'function') {
      throw new SemanticaError('E_INVALID_ARGUMENT', 'resolvePage must be synchronous');
    }
    if (!page) throw new SemanticaError('E_UNKNOWN_PAGE', `no page ${id}`);
    resolved.push(page);
  }
  return resolved;
}

export function createPublisher(defaults = {}) {
  if (!defaults || typeof defaults !== 'object' || Array.isArray(defaults)) {
    throw new SemanticaError('E_INVALID_ARGUMENT', 'createPublisher options must be an object');
  }
  return Object.freeze({
    privateIdBehavior: PRIVATE_ID_BEHAVIOR,
    html(pageIds, options = {}) {
      if (!options || typeof options !== 'object' || Array.isArray(options)) {
        throw new SemanticaError('E_INVALID_ARGUMENT', 'publish.html options must be an object');
      }
      if (typeof options.outPath !== 'string' || options.outPath.trim() === '') {
        throw new SemanticaError('E_INVALID_ARGUMENT', 'publish.html requires { outPath }');
      }
      const pages = resolvePages(pageIds, options, defaults);
      // renderDocument performs the fail-closed privacy check at render time.
      const output = renderDocument(pages, { title: options.title ?? defaults.title });
      const outPath = path.resolve(options.outPath);
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, output, 'utf8');
      return { path: outPath };
    },
  });
}

export const publish = createPublisher();
export const html = (pageIds, options) => publish.html(pageIds, options);
export default publish;
export { renderDocument, renderPage, renderInline, escapeHtml, isPrivate, PRIVATE_ID_BEHAVIOR } from './html.js';
