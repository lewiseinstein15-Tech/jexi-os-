/**
 * JEXI OS — Plugin Manager.
 *
 * Discovers, validates and loads external skill/tool packages at runtime.
 * A plugin manifest must declare: { name, version, skills?, tools? } with
 * sane schema rules. Loaded plugins are kept in a versioned in-memory
 * registry so the Planner can dynamically include their capabilities; no
 * plugin code is ever executed (manifests are declarative only), so a bad
 * package can be rejected safely.
 */

const loaded = new Map(); // name -> { version, skills, tools, loadedAt }
const REGISTRY_VERSION = 1;

const PLUGIN_NAMES = /^[a-z0-9][a-z0-9-_]{1,63}$/;
const VERSION_RE = /^\d+\.\d+\.\d+$/;

/** Validate a plugin manifest without loading it. Returns { ok, errors? }. */
export function validatePluginManifest(manifest = {}) {
  const errors = [];
  if (!manifest || typeof manifest !== 'object') return { ok: false, errors: ['manifest must be an object'] };
  if (!PLUGIN_NAMES.test(String(manifest.name || ''))) errors.push('name must be 2-64 chars: letters, digits, dash, underscore');
  if (!VERSION_RE.test(String(manifest.version || ''))) errors.push('version must be semver (e.g. 1.0.0)');
  if (manifest.skills !== undefined && !Array.isArray(manifest.skills)) errors.push('skills must be an array of skill slugs');
  if (manifest.tools !== undefined && !Array.isArray(manifest.tools)) errors.push('tools must be an array of tool slugs');
  if (manifest.skills?.some((s) => typeof s !== 'string' || !s.trim())) errors.push('each skill must be a non-empty string');
  if (manifest.tools?.some((t) => typeof t !== 'string' || !t.trim())) errors.push('each tool must be a non-empty string');
  return errors.length ? { ok: false, errors } : { ok: true };
}

/** Load a validated plugin into the registry. Returns { ok, plugin }. */
export function loadPlugin(manifest = {}) {
  const check = validatePluginManifest(manifest);
  if (!check.ok) return { ok: false, errors: check.errors };
  const name = String(manifest.name);
  const existing = loaded.get(name);
  if (existing && existing.version === manifest.version) {
    return { ok: false, error: `plugin '${name}@${manifest.version}' already loaded` };
  }
  const plugin = {
    name,
    version: String(manifest.version),
    skills: (manifest.skills || []).map(String),
    tools: (manifest.tools || []).map(String),
    loadedAt: new Date().toISOString(),
    registryVersion: REGISTRY_VERSION,
  };
  loaded.set(name, plugin);
  return { ok: true, plugin, addedSkills: plugin.skills, addedTools: plugin.tools };
}

/** Unload a plugin (by name) and remove its capabilities. */
export function unloadPlugin(name) {
  if (!loaded.has(String(name || ''))) return { ok: false, error: `plugin '${name}' not loaded` };
  const p = loaded.get(String(name));
  loaded.delete(String(name));
  return { ok: true, removed: String(name), version: p.version };
}

/** List loaded plugins (metadata only). */
export function listPlugins() {
  return [...loaded.values()].map((p) => ({ name: p.name, version: p.version, skills: p.skills, tools: p.tools, loadedAt: p.loadedAt }));
}

/** All skill slugs contributed by loaded plugins (for Planner enrichment). */
export function pluginSkillSlugs() {
  return [...loaded.values()].flatMap((p) => p.skills);
}

/** All tool slugs contributed by loaded plugins. */
export function pluginToolSlugs() {
  return [...loaded.values()].flatMap((p) => p.tools);
}

/** Reset the registry (test helper). */
export function resetPlugins() {
  loaded.clear();
}
