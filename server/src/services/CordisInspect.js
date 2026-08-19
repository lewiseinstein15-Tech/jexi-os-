/**
 * B142 — CORDIS INSPECT (DeepSeek Harness `packages/extensions/tool-cordis`
 * mirror, JEXI-branded).
 *
 * Model-facing runtime introspection: `cordis_inspect_list` lists every
 * inspect provider known to the host (the plugin seam + service registry),
 * and `cordis_inspect_query` runs a read-only query on a provider (plugins,
 * tools, skills, services, events). These are READ-ONLY surfaces: no
 * business service can be invoked, nothing is modified.
 */

import { TOOL_REGISTRY } from './ToolRegistry.js';
import { listPluginTools, listPluginSkills, getActivePluginContext } from './PluginContext.js';
import { pluginInventory } from './PluginInventory.js';

/** The inspect providers JEXI exposes (dsh hostInspectProviders). */
export function cordisInspectProviders() {
  const ctx = getActivePluginContext();
  const inventory = (() => { try { return pluginInventory(); } catch { return null; } })();
  return [
    {
      id: 'jexi:plugins',
      platform: 'host',
      purpose: 'The plugin seam: every mounted plugin, its tools and skills.',
      methods: ['listPlugins', 'getPlugin'],
      readonly: true,
    },
    {
      id: 'jexi:tools',
      platform: 'host',
      purpose: 'The full tool catalog (registry ∪ plugin tools) with origins.',
      methods: ['listTools', 'getTool'],
      readonly: true,
    },
    {
      id: 'jexi:skills',
      platform: 'host',
      purpose: 'Plugin-registered skills.',
      methods: ['listSkills'],
      readonly: true,
    },
    {
      id: 'jexi:services',
      platform: 'host',
      purpose: 'The services handed to the plugin context at boot.',
      methods: ['listServices'],
      readonly: true,
    },
    ...(inventory ? [{
      id: 'jexi:inventory',
      platform: 'host',
      purpose: 'Aggregated inventory snapshot (counts + merged tool list).',
      methods: ['getInventory'],
      readonly: true,
    }] : []),
  ];
}

/** List every inspect provider. */
export function cordisInspectList() {
  return { providers: cordisInspectProviders().map((p) => ({ id: p.id, platform: p.platform, purpose: p.purpose, methods: p.methods, readonly: p.readonly })) };
}

/** Run one read-only inspect query. Returns { ok, result } or { ok:false, error }. */
export function cordisInspectQuery({ provider = '', method = '', input = {} } = {}) {
  const prov = cordisInspectProviders().find((p) => p.id === String(provider || ''));
  if (!prov) return { ok: false, error: `no inspect provider "${provider}" — call cordis_inspect_list first` };
  if (!prov.methods.includes(String(method || ''))) {
    return { ok: false, error: `provider "${provider}" has no read-only method "${method}" (methods: ${prov.methods.join(', ')})` };
  }
  const tools = () => ({
    count: TOOL_REGISTRY.length + listPluginTools().length,
    registry: TOOL_REGISTRY.map((t) => ({ slug: t.slug, name: t.name, tier: t.tier || null })),
    plugins: listPluginTools().map((t) => ({ slug: t.slug, name: t.name || t.slug, plugin: t._plugin || null })),
  });
  const plugins = () => {
    const byPlugin = new Map();
    for (const t of listPluginTools()) {
      const name = t._plugin || 'unknown';
      if (!byPlugin.has(name)) byPlugin.set(name, { tools: [], skills: [] });
      byPlugin.get(name).tools.push(t.slug);
    }
    for (const sk of listPluginSkills()) {
      const name = sk._plugin || 'unknown';
      if (!byPlugin.has(name)) byPlugin.set(name, { tools: [], skills: [] });
      byPlugin.get(name).skills.push(sk.slug);
    }
    return [...byPlugin.entries()].map(([name, v]) => ({ name, toolCount: v.tools.length, skillCount: v.skills.length, tools: v.tools.slice(0, 30), skills: v.skills.slice(0, 30) }));
  };
  const skills = () => listPluginSkills().map((s) => ({ slug: s.slug, name: s.name || s.slug, plugin: s._plugin || null }));
  const services = () => {
    const ctx = getActivePluginContext();
    return ctx && ctx.services ? Object.keys(ctx.services).sort() : [];
  };
  const inventory = () => { try { return pluginInventory(); } catch { return null; } };

  const table = {
    'jexi:plugins': { listPlugins: plugins, getPlugin: ({ slug }) => listPluginTools().find((t) => t.slug === String(slug || '')) || { found: false, slug } },
    'jexi:tools': { listTools: tools, getTool: ({ slug }) => TOOL_REGISTRY.find((t) => t.slug === String(slug || '')) || listPluginTools().find((t) => t.slug === String(slug || '')) || { found: false, slug } },
    'jexi:skills': { listSkills: skills },
    'jexi:services': { listServices: services },
    'jexi:inventory': { getInventory: inventory },
  };
  try {
    const fn = table[provider] && table[provider][method];
    if (!fn) return { ok: false, error: `method "${method}" is not implemented on "${provider}"` };
    const result = fn(input || {});
    return { ok: true, provider, method, result: result === undefined ? null : result };
  } catch (e) {
    return { ok: false, error: (e && e.message) || String(e) };
  }
}

/** Status for /api/cordis/inspect. */
export function cordisInspectStatus() {
  return { ok: true, providers: cordisInspectProviders().map((p) => ({ id: p.id, methods: p.methods })) };
}
