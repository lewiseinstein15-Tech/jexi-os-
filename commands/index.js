/**
 * JEXI OS — COMMANDS — facade (Phase 7 G).
 *
 * Imports every command module, registers the full set and exports the one
 * API callers use:
 *
 *   import { dispatch, parse, list, registrySummary } from './commands/index.js';
 *
 * Registering is idempotent per process: a second import re-uses the
 * already-registered set (the module instance is the singleton).
 */

import * as registry from './registry.js';
import { dispatch, parse, tryDispatch } from './dispatcher.js';

const MODULES = [
  './checkpoint.command.js',
  './code-review.command.js',
  './cost-report.command.js',
  './build-fix.command.js',
  './learn.command.js',
  './refine.command.js',
  './handoff.command.js',
  './catchup.command.js',
  './intel.command.js',
  './doctor.command.js',
  './status.command.js',
  './export.command.js',
];

/** Register every shipped command. Returns the registry (for chaining). */
export function registerAll() {
  for (const rel of MODULES) {
    // sync imports of static siblings — resolved at module init
    const mod = moduleCache.get(rel);
    if (!mod) continue;
    try { registry.register(mod.default); } catch { /* already registered */ }
  }
  return registry;
}

const moduleCache = new Map();
for (const rel of MODULES) {
  moduleCache.set(rel, await import(rel)); // top-level await — ESM, Node 22
}
registerAll();

/* ── public facade ─────────────────────────────────────────────────────── */

/** Full dispatch pipeline (parse → resolve → validate → execute → emit). */
export { dispatch, parse, tryDispatch };

/** Registry listing (command defs). */
export const list = registry.list;

/** Safe registry summary for APIs / help text. */
export const registrySummary = registry.describe;

/** Resolve a name or alias. */
export const resolve = registry.resolve;

/** Help text (all commands, grouped by category). */
export function helpText() {
  const byCat = new Map();
  for (const c of registry.list()) {
    if (!byCat.has(c.category)) byCat.set(c.category, []);
    byCat.get(c.category).push(c);
  }
  const lines = [];
  for (const [cat, cmds] of byCat) {
    lines.push(`${cat}:`);
    for (const c of cmds) lines.push(`  /${c.name}${c.aliases.length ? ` (/${c.aliases.join(', /')})` : ''} — ${c.description}`);
  }
  return lines.join('\n');
}

export default { dispatch, parse, tryDispatch, list, registrySummary, resolve, helpText, registry };
