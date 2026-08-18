/**
 * B135 — HOME PATHS (DeepSeek Harness `packages/util/home-paths` mirror).
 *
 * Shared filesystem path helpers for JEXI user data. The harness keeps ALL
 * user data under one root, resolved with precedence (highest first):
 *   an explicit configured path → $JEXI_HOME → ~/.jexi
 *
 * An empty or whitespace-only $JEXI_HOME is treated as unset so a blank
 * override never resolves the home to the current working directory.
 */

import { opendir, realpath } from 'fs/promises';
import { homedir } from 'os';
import { basename, dirname, join, resolve } from 'path';

/** Directory name for the default JEXI home under the OS home. */
export const JEXI_HOME_DIR_NAME = '.jexi';

/** Stable user-facing display form for the default JEXI home. */
export const DEFAULT_JEXI_HOME_DISPLAY = `~/${JEXI_HOME_DIR_NAME}`;

/** Environment variable that overrides the default JEXI home. */
export const JEXI_HOME_ENV = 'JEXI_HOME';

/**
 * Give a native filesystem watcher one canonical spelling of a path, even
 * when its final components do not exist yet (deepest existing ancestor is
 * resolved through realpath).
 */
export async function canonicalizeWatchPath(p) {
  let current = resolve(p);
  const missing = [];
  for (;;) {
    try {
      const canonical = await realpath(current);
      if (missing.length > 0) {
        const directory = await opendir(canonical);
        await directory.close();
      }
      return join(canonical, ...missing.reverse());
    } catch (error) {
      if (error && error.code !== 'ENOENT') throw error;
      const parent = dirname(current);
      if (parent === current) throw error;
      missing.push(basename(current));
      current = parent;
    }
  }
}

/** Resolve the default JEXI home using Node's platform path rules. */
export function defaultJexiHome() {
  return join(homedir(), JEXI_HOME_DIR_NAME);
}

/** Expand supported tilde prefixes against the operating-system home. */
export function expandHomePath(p) {
  if (p === '~') return homedir();
  if (p.startsWith('~/') || p.startsWith('~\\')) return join(homedir(), p.slice(2));
  return p;
}

/**
 * Resolve the single-root JEXI home.
 * @param {string|undefined} configured explicit home override (highest precedence)
 * @param {Record<string,string|undefined>} env environment mapping (defaults to process.env)
 * @returns the normalized absolute harness home path
 */
export function resolveJexiHome(configured, env = process.env) {
  const fromEnv = env[JEXI_HOME_ENV];
  const selected = configured ?? (fromEnv !== undefined && String(fromEnv).trim().length > 0 ? fromEnv : defaultJexiHome());
  return resolve(expandHomePath(String(selected)));
}

/** Join path segments onto the resolved JEXI home. */
export function jexiHomePath(...segments) {
  return join(resolveJexiHome(), ...segments);
}

/**
 * Describe a resolved harness home symbolically for user-facing display:
 * the default home is labelled `~/.jexi`, any configured home `$JEXI_HOME`.
 */
export function jexiHomeDisplay(resolvedHome) {
  return resolvedHome === resolve(defaultJexiHome()) ? DEFAULT_JEXI_HOME_DISPLAY : `$${JEXI_HOME_ENV}`;
}
