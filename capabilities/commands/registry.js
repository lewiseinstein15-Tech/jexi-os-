/**
 * JEXI OS — COMMANDS — registry (Phase 7 G).
 *
 * Registration + lookup + alias resolution. Every command registers the full
 * contract:
 *
 *   {
 *     name:        'checkpoint',
 *     aliases:     ['cp'],
 *     description: 'Save a work-graph checkpoint',
 *     category:    'session' | 'review' | 'cost' | 'debug' | 'learning' | 'relay',
 *     args:        [{ name, required, type, default }],
 *     handler:     async (args, ctx) => ({ ok, summary, ... })
 *   }
 *
 * Validation happens at REGISTRATION time (a bad contract fails fast, not at
 * 2am mid-mission). Names are lowercase [a-z0-9-]; aliases may not collide
 * with any other name or alias.
 */

export const CATEGORIES = Object.freeze(['session', 'review', 'cost', 'debug', 'learning', 'relay']);
export const ARG_TYPES = Object.freeze(['string', 'number', 'boolean', 'path']);

const NAME_RE = /^[a-z][a-z0-9-]*$/;

const commands = new Map();   // name → def
const aliases = new Map();    // alias → name
const expansionBlocks = [];   // P30.F — UserPromptExpansion block journal (deterministic, no timestamps)

/** Register a command. Returns an unregister fn (reversible). */
export function register(def) {
  const name = String(def?.name || '').trim().toLowerCase();
  if (!NAME_RE.test(name)) throw new TypeError(`command name invalid: "${name}" (lowercase [a-z][a-z0-9-]*)`);
  if (!String(def?.description || '').trim()) throw new TypeError(`command "${name}" description must not be empty`);
  if (!CATEGORIES.includes(def?.category)) throw new TypeError(`command "${name}" category must be one of ${CATEGORIES.join(' | ')} (got "${def?.category}")`);
  if (typeof def?.handler !== 'function') throw new TypeError(`command "${name}" handler must be a function`);
  if (commands.has(name)) throw new TypeError(`command "${name}" already registered`);
  if (aliases.has(name)) throw new TypeError(`command "${name}" collides with an existing alias`);

  const argList = Array.isArray(def?.args) ? def.args : [];
  const seen = new Set();
  for (const a of argList) {
    if (!a || !String(a.name || '').trim()) throw new TypeError(`command "${name}" has an arg without a name`);
    if (seen.has(a.name)) throw new TypeError(`command "${name}" has duplicate arg "${a.name}"`);
    seen.add(a.name);
    if (a.type && !ARG_TYPES.includes(a.type)) throw new TypeError(`command "${name}" arg "${a.name}" type must be one of ${ARG_TYPES.join(' | ')}`);
  }

  const aliasList = (Array.isArray(def?.aliases) ? def.aliases : []).map((x) => String(x || '').trim().toLowerCase()).filter(Boolean);
  for (const al of aliasList) {
    if (!NAME_RE.test(al)) throw new TypeError(`command "${name}" alias invalid: "${al}"`);
    if (commands.has(al) || aliases.has(al)) throw new TypeError(`command "${name}" alias "${al}" already taken`);
  }

  const entry = Object.freeze({
    name,
    aliases: Object.freeze(aliasList),
    description: String(def.description).trim(),
    category: def.category,
    args: Object.freeze(argList.map((a) => Object.freeze({
      name: a.name,
      required: a.required === true,
      type: a.type || 'string',
      default: a.default,
      description: a.description ? String(a.description) : '',
    }))),
    handler: def.handler,
  });

  commands.set(name, entry);
  for (const al of aliasList) aliases.set(al, name);

  return () => unregister(name);
}

/** Remove a command (and its aliases). Returns true when it existed. */
export function unregister(name) {
  const n = String(name || '').trim().toLowerCase();
  const def = commands.get(n);
  if (!def) return false;
  for (const al of def.aliases) aliases.delete(al);
  commands.delete(n);
  return true;
}

/** Resolve a name OR alias → the command def (or undefined). */
export function resolve(nameOrAlias) {
  const n = String(nameOrAlias || '').trim().toLowerCase();
  const def = commands.get(n) || commands.get(aliases.get(n) || '');
  if (!def) return undefined;
  // P30.F — UserPromptExpansion fires before a slash-command expansion
  // reaches the model (fail-soft; the seam is mounted by server boot —
  // scope 6 — with a behavior-neutral allow default). A blocking verdict
  // prevents the command: resolve yields undefined and the block is
  // journaled (read via expansionJournal()).
  try {
    const seam = globalThis.__jexiP30PromptExpansion;
    if (seam && typeof seam.decide === 'function') {
      const verdict = seam.decide({ command: def.name, arguments: null });
      if (verdict && verdict.block) {
        expansionBlocks.push({ command: def.name, reason: verdict.reason ?? null });
        return undefined;
      }
    }
  } catch { /* fail-soft: resolution continues */ }
  return def;
}

/** P30.F probe/ops surface: blocked expansion verdicts, in block order. */
export function expansionJournal() {
  return expansionBlocks.map((entry) => ({ ...entry }));
}

/** All registered commands, sorted by name. */
export function list() {
  return [...commands.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Registry summary (safe for API surface / listing). */
export function describe() {
  return list().map((c) => ({
    name: c.name,
    aliases: c.aliases,
    description: c.description,
    category: c.category,
    args: c.args.map((a) => ({ name: a.name, required: a.required, type: a.type, default: a.default })),
  }));
}

/** Test/ops helper: wipe everything (used by isolated test runs). */
export function _reset() {
  commands.clear();
  aliases.clear();
}
