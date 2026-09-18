/**
 * JEXI OS — CROSS-HARNESS ADAPTERS — registry facade (Phase 7 H).
 *
 *   import { list, get, detect, convert, convertAll, install, installAll }
 *     from './harness/adapters/index.js';
 *
 *   node -e "console.log(require('./harness/adapters').list().map(a=>a.id).join('\n'))"
 *
 * Every adapter is validated against the shared contract (see
 * _base.adapter.js) at load time — a malformed adapter fails fast here,
 * never mid-install.
 */

import { collectCanonical, filterRules } from './_convert.js';
import claudeCode from './claude-code.adapter.js';
import codex from './codex.adapter.js';
import cursor from './cursor.adapter.js';
import gemini from './gemini.adapter.js';
import opencode from './opencode.adapter.js';
import openclaw from './openclaw.adapter.js';
import aider from './aider.adapter.js';
import windsurf from './windsurf.adapter.js';
import copilot from './copilot.adapter.js';
import kimi from './kimi.adapter.js';
import hermes from './hermes.adapter.js';
import osaurus from './osaurus.adapter.js';
import antigravity from './antigravity.adapter.js';
import mistralVibe from './mistral-vibe.adapter.js';

const ADAPTERS = [
  claudeCode,
  codex,
  cursor,
  gemini,
  opencode,
  openclaw,
  aider,
  windsurf,
  copilot,
  kimi,
  hermes,
  osaurus,
  antigravity,
  mistralVibe,
];

const byId = new Map(ADAPTERS.map((a) => [a.id, a]));

/** All registered adapters (contract-validated at load). */
export function list() {
  return ADAPTERS;
}

/** One adapter by id, or undefined. */
export function get(id) {
  return byId.get(String(id));
}

/** Detection snapshot: [{ id, displayName, detected }] in registry order. */
export function detect() {
  return ADAPTERS.map((a) => ({ id: a.id, displayName: a.displayName, detected: !!a.detected() }));
}

/** Canonical input (agents/rules/skills/hooks/commands/mcp + errors). */
export async function canonical() {
  return collectCanonical();
}

/** Convert one adapter (by id). Returns { adapter, converted, canonical }. */
export async function convert(id, opts = {}) {
  const adapter = get(id);
  if (!adapter) throw new Error(`unknown adapter: "${id}" (have: ${[...byId.keys()].join(', ')})`);
  const input = opts.canonical || (await collectCanonical());
  return { adapter, converted: adapter.convert(input, opts), canonical: input };
}

/** Convert every adapter. Returns per-adapter results (errors carried, not thrown). */
export async function convertAll(opts = {}) {
  const input = opts.canonical || (await collectCanonical());
  return ADAPTERS.map((adapter) => {
    try {
      return { id: adapter.id, adapter, ok: true, converted: adapter.convert(input, opts), canonical: input };
    } catch (e) {
      return { id: adapter.id, adapter, ok: false, error: String(e.message), canonical: input };
    }
  });
}

/** Convert + install one adapter into its config dir (or opts.root override). */
export async function install(id, opts = {}) {
  const { adapter, converted, canonical: input } = await convert(id, opts);
  if (!opts.force && !adapter.detected()) {
    return { id, detected: false, skipped: true };
  }
  const result = adapter.install(converted, opts);
  return { id, detected: true, skipped: false, install: result, files: converted.files };
}

/** Convert + install every adapter. Undetected harnesses skip cleanly.
 *  opts.only restricts the install to a single adapter id — undetected-or-
 *  filtered harnesses must NOT be touched (P6 relies on a clean skip). */
export async function installAll(opts = {}) {
  const input = opts.canonical || (await collectCanonical());
  const targets = opts.only ? ADAPTERS.filter((a) => a.id === opts.only) : ADAPTERS;
  const results = [];
  for (const adapter of targets) {
    try {
      if (!opts.force && !adapter.detected()) {
        results.push({ id: adapter.id, detected: false, skipped: true });
        continue;
      }
      const converted = adapter.convert(input, opts);
      const result = adapter.install(converted, opts);
      results.push({ id: adapter.id, detected: true, skipped: false, install: result, files: converted.files });
    } catch (e) {
      results.push({ id: adapter.id, detected: !!adapter.detected(), skipped: false, error: String(e.message) });
    }
  }
  return results;
}

export { filterRules };

export default { list, get, detect, canonical, convert, convertAll, install, installAll, filterRules };
