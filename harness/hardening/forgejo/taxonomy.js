/**
 * JEXI OS — Phase 23 Scope B — forgejo-mcp 103-tool taxonomy.
 *
 * Assembles the five category files into ONE sorted, validated taxonomy.
 * The category files are data-only ({ short, description, params-tuples });
 * this module is the single place where full tool specs are constructed,
 * so every tool gets the same shape by construction:
 *
 *   { name: '<category>.<short>', category, params: [{ name, required, type, description? }], description }
 *
 * THE COUNT
 * 5 categories, 103 tools total: repo 33, issue 22, pr 20, org 16,
 * admin 12. The count is computed from the data (TAXONOMY_TOTAL), never
 * hard-coded — if the data drifts, the probe reports the actual number.
 *
 * DETERMINISM
 * list() order is the ASCII sort of tool names, fixed once at module
 * init: same data -> same order, byte for byte.
 *
 * Errors (SemanticaError from semantica/_internal.js, read-only reuse):
 *   E_UNKNOWN_CATEGORY   taxonomy.category() with a non-category
 *   E_UNKNOWN_TOOL       taxonomy.get() with an unknown name
 *   E_DUPLICATE_TOOL     two tools share a name (authoring bug, fail-fast at import)
 *   E_INVALID_TOOL_SPEC  a data entry violates the shape (fail-fast at import)
 */

import { SemanticaError } from '../../../semantica/_internal.js';
import { REPO_TOOLS } from './repo-tools.js';
import { ISSUE_TOOLS } from './issue-tools.js';
import { PR_TOOLS } from './pr-tools.js';
import { ORG_TOOLS } from './org-tools.js';
import { ADMIN_TOOLS } from './admin-tools.js';

/** Exactly five categories, per the forgejo-mcp split. */
export const CATEGORIES = Object.freeze(['repo', 'issue', 'pr', 'org', 'admin']);

/** Turn a params tuple [name, required, type, description?] into the contract object. */
function paramOf(tuple, owner) {
  if (!Array.isArray(tuple) || typeof tuple[0] !== 'string' || tuple[0].trim() === '') {
    throw new SemanticaError('E_INVALID_TOOL_SPEC', `${owner}: param must be a [name, required, type, description?] tuple, got ${JSON.stringify(tuple)}`);
  }
  const [name, required, type, description] = tuple;
  if (type !== undefined && !['string', 'number', 'boolean', 'array', 'object'].includes(type)) {
    throw new SemanticaError('E_INVALID_TOOL_SPEC', `${owner}: param "${name}" has unknown type ${JSON.stringify(type)}`);
  }
  const p = { name, required: Boolean(required), type: type || 'string' };
  if (description !== undefined) p.description = description;
  return p;
}

/** Turn a data entry { short, description, params } into a full tool spec. */
function normalize(category, raw) {
  if (!raw || typeof raw !== 'object' || typeof raw.short !== 'string' || raw.short.trim() === '') {
    throw new SemanticaError('E_INVALID_TOOL_SPEC', `${category}: every entry needs a non-empty "short" name`);
  }
  if (typeof raw.description !== 'string' || raw.description.trim() === '') {
    throw new SemanticaError('E_INVALID_TOOL_SPEC', `${category}.${raw.short}: every tool needs a description`);
  }
  if (raw.params !== undefined && !Array.isArray(raw.params)) {
    throw new SemanticaError('E_INVALID_TOOL_SPEC', `${category}.${raw.short}: params must be an array of tuples`);
  }
  const name = `${category}.${raw.short}`;
  return {
    name,
    category,
    params: (raw.params || []).map((t) => paramOf(t, name)),
    description: raw.description,
  };
}

const RAW = [
  ['repo', REPO_TOOLS],
  ['issue', ISSUE_TOOLS],
  ['pr', PR_TOOLS],
  ['org', ORG_TOOLS],
  ['admin', ADMIN_TOOLS],
];

for (const [cat] of RAW) {
  if (!CATEGORIES.includes(cat)) {
    throw new SemanticaError('E_UNKNOWN_CATEGORY', `category file registered under unknown category "${cat}"`);
  }
}

/** All 103 specs, sorted by name (ASCII, asc) once at init. */
const TOOLS = RAW
  .flatMap(([cat, list]) => list.map((r) => normalize(cat, r)))
  .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

const BY_NAME = new Map();
for (const t of TOOLS) {
  if (BY_NAME.has(t.name)) {
    throw new SemanticaError('E_DUPLICATE_TOOL', `duplicate tool name "${t.name}"`);
  }
  BY_NAME.set(t.name, t);
}

const BY_CATEGORY = new Map(CATEGORIES.map((c) => [c, TOOLS.filter((t) => t.category === c)]));

/** Total number of tools in the taxonomy (computed, not asserted to be 103). */
export const TAXONOMY_TOTAL = TOOLS.length;

/** Per-category tool counts, frozen. */
export const CATEGORY_COUNTS = Object.freeze(Object.fromEntries(
  CATEGORIES.map((c) => [c, BY_CATEGORY.get(c).length])
));

export const taxonomy = {
  /** [{ name, category }] — 103 entries, name-asc order. */
  list() {
    return TOOLS.map(({ name, category }) => ({ name, category }));
  },
  /** Full tool spec by name; E_UNKNOWN_TOOL otherwise. */
  get(name) {
    const tool = BY_NAME.get(name);
    if (!tool) {
      throw new SemanticaError('E_UNKNOWN_TOOL', `unknown tool "${String(name)}"; ${TOOLS.length} tools available across ${CATEGORIES.length} categories`);
    }
    return tool;
  },
  /** All specs of one category; E_UNKNOWN_CATEGORY otherwise. */
  category(cat) {
    if (!CATEGORIES.includes(cat)) {
      throw new SemanticaError('E_UNKNOWN_CATEGORY', `unknown category "${String(cat)}"; known: ${CATEGORIES.join(', ')}`);
    }
    return BY_CATEGORY.get(cat);
  },
  /** { repo, issue, pr, org, admin, total } — computed counts. */
  counts() {
    return { ...CATEGORY_COUNTS, total: TOOLS.length };
  },
};
