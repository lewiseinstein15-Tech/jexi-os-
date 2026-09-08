/**
 * JEXI CLI — local configuration (~/.jexi/config.json).
 *
 * The laptop product stores ONLY local operational state here:
 * backend port, the random local access key, workspace + data dirs, and the
 * user's ONE model credential (0600 file, same class as settings.json).
 * Nothing here is ever committed or uploaded.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const CLI_VERSION = '1.0.0';

export function jexiHome() {
  return process.env.JEXI_HOME || path.join(os.homedir(), '.jexi');
}

export function paths(home = jexiHome()) {
  return {
    home,
    config: path.join(home, 'config.json'),
    pid: path.join(home, 'backend.pid.json'),
    log: path.join(home, 'backend.log'),
    data: path.join(home, 'data'),
  };
}

export function defaultConfig() {
  return {
    version: 1,
    port: 3210,
    host: '127.0.0.1',
    accessKey: '',
    workspace: process.cwd(),
    createdAt: new Date().toISOString(),
    unified: null, // { provider, apiKey, model, baseUrl } — the ONE model credential
  };
}

/** Load config or null when never initialized. Never throws. */
export function loadConfig(home = jexiHome()) {
  try {
    const p = paths(home).config;
    if (!fs.existsSync(p)) return null;
    const cfg = JSON.parse(fs.readFileSync(p, 'utf-8'));
    if (!cfg || typeof cfg !== 'object') return null;
    return { ...defaultConfig(), ...cfg };
  } catch {
    return null;
  }
}

/** Save config (0600 — it holds the model key). Returns true/false. */
export function saveConfig(cfg, home = jexiHome()) {
  try {
    const ps = paths(home);
    fs.mkdirSync(ps.home, { recursive: true });
    fs.mkdirSync(ps.data, { recursive: true });
    fs.writeFileSync(ps.config, JSON.stringify(cfg, null, 2) + '\n', { mode: 0o600 });
    try { fs.chmodSync(ps.config, 0o600); } catch { /* best effort on windows */ }
    return true;
  } catch {
    return false;
  }
}

/**
 * Locate the backend server directory.
 * Order: JEXI_SERVER_DIR env → <cli-dir>/../server (repo checkout layout).
 */
export function findServerDir() {
  if (process.env.JEXI_SERVER_DIR && fs.existsSync(path.join(process.env.JEXI_SERVER_DIR, 'index.js'))) {
    return process.env.JEXI_SERVER_DIR;
  }
  try {
    const cliDir = path.dirname(fileURLToPath(import.meta.url));
    const candidate = path.resolve(cliDir, '..', '..', 'server');
    // cli/lib/config.js → cli/ → repo/ → repo/server
    const repoServer = path.resolve(path.dirname(cliDir), '..', 'server');
    void candidate;
    if (fs.existsSync(path.join(repoServer, 'index.js'))) return repoServer;
  } catch { /* fall through */ }
  return null;
}

/** Import a pure server module (catalog/validators) for CLI reuse. */
export async function importServerModule(serverDir, relPath) {
  const { pathToFileURL } = await import('node:url');
  return import(pathToFileURL(path.join(serverDir, relPath)).href);
}
