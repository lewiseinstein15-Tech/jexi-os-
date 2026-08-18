/**
 * B136 — PLUGIN INVENTORY (DeepSeek Harness `packages/host/plugin-inventory`
 * mirror, JEXI-branded).
 *
 * Inventory view of everything the plugin seam holds: plugins (with tool and
 * skill counts), the full tool list (registry ∪ plugins), the skill list,
 * event-handler counts, and load diagnostics — the "what is actually running"
 * surface for /api/plugins/inventory.
 */

import { TOOL_REGISTRY } from './ToolRegistry.js';
import { getActivePluginContext, listPluginTools, listPluginSkills } from './PluginContext.js';
import { listPlugins as listRegistryPlugins } from './PluginRegistry.js';

/** Full inventory snapshot. */
export function pluginInventory() {
  const ctx = getActivePluginContext();
  const pluginTools = listPluginTools();
  const pluginSkills = listPluginSkills();

  // Count tools/skills per plugin by the registration stamp.
  const perPlugin = new Map();
  for (const t of pluginTools) {
    const name = t._plugin || 'unknown';
    if (!perPlugin.has(name)) perPlugin.set(name, { tools: 0, skills: 0 });
    perPlugin.get(name).tools += 1;
  }
  for (const s of pluginSkills) {
    const name = s._plugin || 'unknown';
    if (!perPlugin.has(name)) perPlugin.set(name, { tools: 0, skills: 0 });
    perPlugin.get(name).skills += 1;
  }

  const registryPluginNames = (() => { try { return listRegistryPlugins().map((p) => p.name); } catch { return []; } })();

  const plugins = [
    ...new Set([...perPlugin.keys(), ...registryPluginNames, ...pluginTools.map((t) => t._plugin || '').filter(Boolean)]),
  ].map((name) => ({
    name,
    tools: perPlugin.get(name)?.tools || 0,
    skills: perPlugin.get(name)?.skills || 0,
    inRegistry: registryPluginNames.includes(name),
  }));

  return {
    ok: true,
    pluginContextActive: !!ctx,
    plugins,
    counts: {
      registryTools: TOOL_REGISTRY.length,
      pluginTools: pluginTools.length,
      pluginSkills: pluginSkills.length,
      totalTools: TOOL_REGISTRY.length + pluginTools.length,
    },
    tools: [
      ...TOOL_REGISTRY.map((t) => ({ slug: t.slug, name: t.name, origin: 'registry' })),
      ...pluginTools.map((t) => ({ slug: t.slug, name: t.name || t.slug, origin: 'plugin' })),
    ].sort((a, b) => a.slug.localeCompare(b.slug)),
    skills: pluginSkills.map((s) => ({ slug: s.slug, name: s.name || s.slug, origin: 'plugin' })).sort((a, b) => a.slug.localeCompare(b.slug)),
  };
}
