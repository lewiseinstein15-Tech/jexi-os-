/**
 * JEXI OS — KERNEL — commands seam (Phase 7 G).
 *
 * The commands subsystem (repo-root commands/, ECC layout) is imported
 * DYNAMICALLY and dual-depth so a missing or broken commands/ can never
 * take the brain down — mirroring the hud-seam (Phase 7 F) and
 * learning-seam (Phase 7 C) fail-soft philosophy.
 *
 *   dev        <root>/server/src/commands-seam.js → <root>/commands/index.js
 *   container  /app/src/commands-seam.js          → /app/commands/index.js
 *   (the docker workflow ships commands/ next to the server sources)
 *
 * Callers:
 *   server/index.js  /api/chat slash interception (before the legacy B133
 *                    CommandRegistry) + boot log
 *   server/cli.js    `node cli.js "/checkpoint"` runs the SAME dispatcher
 *   routes/surface.js GET /api/commands exposes the dispatcher registry
 */

import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url)); // …/server/src
const COMMANDS_CANDIDATES = [
  path.resolve(MODULE_DIR, '..', '..', 'commands', 'index.js'),   // dev: <root>/commands
  path.resolve(MODULE_DIR, '..', 'commands', 'index.js'),         // container: /app/commands
];

let _commands = null;
let _failed = false;

for (const c of COMMANDS_CANDIDATES) {
  try { _commands = await import(pathToFileURL(c).href); _failed = false; break; } catch { _commands = null; _failed = true; }
}

/** True when the commands subsystem loaded in this runtime. */
export function commandsAvailable() {
  return !!_commands;
}

/** Loader diagnostics (boot log / doctor). Never throws. */
export function commandsStatus() {
  if (_commands) return { ok: true, count: _commands.list().length, commands: _commands.registrySummary() };
  return { ok: false, failed: _failed, detail: 'commands/ not available in this runtime (fail-soft)' };
}

/**
 * Dispatch a slash-command through the Phase 7(G) subsystem.
 * Returns the dispatcher result object, or null when the input is not one
 * of OUR commands (caller falls through to legacy handling / the model).
 * Never throws.
 */
export async function dispatchCommand(raw, ctxOverrides = {}) {
  if (!_commands) return null;
  try {
    return await _commands.tryDispatch(String(raw ?? ''), ctxOverrides);
  } catch {
    return null;
  }
}

/**
 * Full dispatch result INCLUDING unknown-command / not-a-command reasons —
 * for callers (CLI) that want to fail loudly on a mistyped slash command
 * instead of sending it to the model. Never throws.
 */
export async function dispatchCommandStrict(raw, ctxOverrides = {}) {
  if (!_commands) return { handled: false, reason: 'subsystem-unavailable' };
  try {
    return await _commands.dispatch(String(raw ?? ''), ctxOverrides);
  } catch (e) {
    return { handled: false, reason: 'subsystem-error', error: String(e?.message || e) };
  }
}

/** Registry summary for /api/commands (fail-soft). */
export function registryForApi() {
  if (!_commands) return null;
  try {
    return { count: _commands.list().length, commands: _commands.registrySummary(), help: _commands.helpText() };
  } catch {
    return null;
  }
}
