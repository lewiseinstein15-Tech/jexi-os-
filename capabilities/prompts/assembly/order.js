// prompt/assembly/order.js
// Canonical 10-section order for JEXI prompts (Phase 25, Scope A).
//
// Derived from the lead's Phase 25 study (not re-derived here):
// - Anthropic Claude Code context-engineering pattern: a 10-section
//   assembly with a single cache boundary. Sections 01-05 are static
//   (cache-stable across turns); sections 06-10 are dynamic (rebuilt
//   every turn). Scope B (boundary.js) enforces that boundary.
// - Microsoft's five-section production framework (identity /
//   constraints / scope / escalation / output) informs the static
//   block's content contracts (Scope C), not the ordering.
//
// This module is DATA + a registration helper only — no assembly
// logic. Default build(ctx) functions are identity passthroughs:
// they render ctx[sectionId] when it is a string (or a {content}
// envelope) and '' otherwise. Scope-specific builders (e.g. Scope M
// for 08-instructions) replace the passthrough at their own layer
// without mutating these frozen specs.

import { createSectionRegistry } from './registry.js';

function ctxPassthrough(id) {
  return (ctx) => {
    if (ctx && typeof ctx[id] === 'string') return ctx[id];
    if (ctx && ctx[id] && typeof ctx[id].content === 'string') return ctx[id].content;
    return '';
  };
}

function spec(id, label, order, kind, maxChars, weight = 1) {
  return Object.freeze({
    id,
    label,
    order,
    kind,
    budget: Object.freeze({ maxChars, weight }),
    build: ctxPassthrough(id),
  });
}

export const CANONICAL_SECTIONS = Object.freeze([
  spec('identity',         'Identity & Role',      1,  'static',  4000),
  spec('output-style',     'Output Style',         2,  'static',  3000),
  spec('system-rules',     'System Rules',         3,  'static',  12000),
  spec('doing-tasks',      'Doing Tasks',          4,  'static',  10000),
  spec('actions',          'Actions & Tool Use',   5,  'static',  8000),
  spec('environment',      'Environment',          6,  'dynamic', 8000),
  spec('project-context',  'Project Context',      7,  'dynamic', 12000),
  spec('instructions',     'Nested Instructions',  8,  'dynamic', 50000),
  spec('runtime-config',   'Runtime Configuration', 9, 'dynamic', 4000),
  spec('session-guidance', 'Session Guidance',     10, 'dynamic', 4000),
]);

export const CANONICAL_IDS = CANONICAL_SECTIONS.map((s) => s.id);
export const STATIC_SECTION_IDS = CANONICAL_SECTIONS.filter((s) => s.kind === 'static').map((s) => s.id);
export const DYNAMIC_SECTION_IDS = CANONICAL_SECTIONS.filter((s) => s.kind === 'dynamic').map((s) => s.id);

/**
 * Register all 10 canonical sections into a registry.
 * @param {object} [registry] - defaults to a fresh isolated registry
 * @returns {object} the same registry, populated
 */
export function registerCanonical(registry = createSectionRegistry()) {
  for (const section of CANONICAL_SECTIONS) {
    registry.register(section);
  }
  return registry;
}
