/**
 * B135 — LAUNCH ENVIRONMENT (DeepSeek Harness `packages/util/launch-environment`
 * mirror).
 *
 * Immutable launch-time environment snapshot that records which layer supplied
 * each value. Consumers resolve through it instead of a flattened
 * `process.env`. Layers, most trusted first:
 *   process      — the environment this process inherited
 *   project-env  — the invoking directory's `.env`
 *   user-env     — the JEXI home's `.env`
 */

import fs from 'fs';
import path from 'path';
import { resolveJexiHome } from './HomePaths.js';

/** Which layer supplied a value, from most to least trusted. */
export const SOURCE_ORDER = ['process', 'project-env', 'user-env'];

/** Parse a .env file into a plain record (simple, comment-tolerant). */
export function parseDotEnv(text) {
  const out = {};
  for (const rawLine of String(text || '').split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const name = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    // Strip surrounding quotes.
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (name) out[name] = value;
  }
  return out;
}

/** Load the `.env` layer from a directory if present. */
export function loadEnvLayer(dir) {
  try {
    const file = path.join(dir, '.env');
    if (!fs.existsSync(file)) return null;
    return { values: parseDotEnv(fs.readFileSync(file, 'utf-8')), path: file };
  } catch { return null; }
}

/**
 * Build the immutable launch-environment snapshot.
 * @param {Array<{source, path?, values}>} layers layers in any order; the
 *   result searches them by canonical trust order (process > project-env > user-env).
 * @returns {{
 *   get(name): {value, source, path?} | undefined,
 *   getFrom(name, sources): {value, source, path?} | undefined
 * }}
 */
export function createLaunchEnvironmentSnapshot(layers = []) {
  const bySource = new Map();
  for (const layer of layers) {
    bySource.set(layer.source, {
      ...(layer.path === undefined ? {} : { path: layer.path }),
      values: new Map(Object.entries(layer.values || {})),
    });
  }
  const getFrom = (name, sources) => {
    for (const source of SOURCE_ORDER) {
      if (!sources.includes(source)) continue;
      const layer = bySource.get(source);
      if (!layer) continue;
      const value = layer.values.get(name);
      if (value === undefined) continue;
      return { value, source, ...(layer.path === undefined ? {} : { path: layer.path }) };
    }
    return undefined;
  };
  return {
    get: (name) => getFrom(name, SOURCE_ORDER),
    getFrom,
  };
}

/** Build the boot snapshot: process env, then cwd `.env`, then JEXI home `.env`. */
export function buildLaunchEnvironment({ cwd = process.cwd(), jexiHome = null } = {}) {
  const layers = [{ source: 'process', values: process.env }];
  const project = loadEnvLayer(cwd);
  if (project) layers.push({ source: 'project-env', ...project });
  const home = loadEnvLayer(jexiHome || resolveJexiHome());
  if (home) layers.push({ source: 'user-env', ...home });
  return createLaunchEnvironmentSnapshot(layers);
}

/** The boot-time snapshot (filled once at server start; see index.js). */
let bootSnapshot = null;

/** Record the boot snapshot (called from index.js after buildLaunchEnvironment). */
export function setLaunchEnvironment(snapshot) {
  bootSnapshot = snapshot;
}

/** Return the boot snapshot, or a process-only fallback when none was set. */
export function launchEnvironmentOf() {
  return bootSnapshot ?? createLaunchEnvironmentSnapshot([{ source: 'process', values: process.env }]);
}
