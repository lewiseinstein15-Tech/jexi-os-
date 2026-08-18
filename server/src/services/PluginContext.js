/**
 * JEXI OS — Plugin Context (B97: the DeepSeek-Harness "everything is a
 * plugin" seam).
 *
 * dsh is built on Cordis: plugins contribute SERVICES, TYPED EVENTS and
 * REVERSIBLE EFFECTS to a shared context. There is no privileged core to
 * patch — you extend JEXI by mounting a plugin beside the others, and
 * registrations are effects that UNWIND when the plugin unloads.
 *
 * This module gives JEXI that seam:
 *
 *   - createPluginContext({ services }) — a ctx with:
 *       ctx.services   — injectable shared services (planner, orchestrator,
 *                         memory, generateContent, executeTool, ...)
 *       ctx.tools      — register({ slug, name, desc, args, handler }) →
 *                         unregister(); list(); get()
 *       ctx.skills     — register({ slug, name, desc, load }) → unregister()
 *       ctx.events     — on(type, fn) / emit(type, data); every emit also
 *                         lands in the durable EventLog (plugin/event)
 *   - loadPlugins({ dirs }) — scans plugin dirs for plugin.js/index.js
 *     manifests ({ name, version, inject, apply(ctx) }), calls apply(ctx)
 *     for each, and keeps the loaded registry. Unloading calls the
 *     apply() return value (the cleanup fn) — reversible effects.
 *
 * Runtime tool integration: ToolRuntime.runEngine consults getPluginTool()
 * so plugin tools execute through the SAME gated pipeline (permissions,
 * risk guard, approval, events) as built-ins.
 */

import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import { appendEvent } from './EventLog.js';

/* ------------------------------------------------------------------ */
/* The context                                                        */
/* ------------------------------------------------------------------ */

export function createPluginContext({ services = {} } = {}) {
  /** registries: name → Map<key, def> (reversible registrations) */
  const registries = { tools: new Map(), skills: new Map() };
  /** event handlers: type → Set<fn> */
  const handlers = new Map();

  const ctx = {
    services,

    events: {
      on(type, fn) {
        if (!handlers.has(type)) handlers.set(type, new Set());
        handlers.get(type).add(fn);
        return () => { const s = handlers.get(type); if (s) { s.delete(fn); if (!s.size) handlers.delete(type); } };
      },
      emit(type, data = {}) {
        const s = handlers.get(type);
        if (s) for (const fn of s) { try { fn(data); } catch { /* a handler must never break the bus */ } }
        try { appendEvent('plugin_event', { type: String(type).slice(0, 60), data: JSON.stringify(data).slice(0, 400) }); } catch { /* noop */ }
      },
    },

    tools: {
      register(def) {
        if (!def || !def.slug || typeof def.handler !== 'function') throw new Error('plugin tool needs slug + handler');
        if (registries.tools.has(def.slug)) throw new Error(`plugin tool "${def.slug}" already registered`);
        const stamped = { ...def, _plugin: currentPluginName };
        registries.tools.set(def.slug, stamped);
        return () => registries.tools.delete(def.slug);
      },
      list() { return [...registries.tools.values()]; },
      get(slug) { return registries.tools.get(slug); },
    },

    skills: {
      register(def) {
        if (!def || !def.slug) throw new Error('plugin skill needs slug');
        const stamped = { ...def, _plugin: currentPluginName };
        registries.skills.set(def.slug, stamped);
        return () => registries.skills.delete(def.slug);
      },
      list() { return [...registries.skills.values()]; },
      get(slug) { return registries.skills.get(slug); },
    },
  };

  return ctx;
}

/** The plugin currently being applied (stamped onto its registrations). */
let currentPluginName = null;

/** Set the plugin name during apply() so registrations carry their owner. */
export function setCurrentPluginName(name) {
  currentPluginName = name || null;
}

/* ------------------------------------------------------------------ */
/* Loading plugins from disk                                           */
/* ------------------------------------------------------------------ */

export const BUILTIN_PLUGIN_DIR = path.resolve(process.cwd(), 'plugins');
export const USER_PLUGIN_DIR = path.join(process.env.DATA_DIR || 'data', 'plugins');

/**
 * Find plugin manifests in a directory. A plugin is:
 *   <dir>/<name>/plugin.js (or index.js) exporting { name, version, inject, apply }
 */
function findPluginFiles(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    for (const fname of ['plugin.js', 'index.js']) {
      const fp = path.join(dir, entry.name, fname);
      if (fs.existsSync(fp)) { out.push(fp); break; }
    }
  }
  return out;
}

/**
 * Load every plugin from the given dirs into ONE shared context.
 * Returns { ctx, loaded, failed } where loaded = [{ name, version, tools,
 * skills, unload }]. apply(ctx) may return a cleanup function (reversible).
 */
export async function loadPlugins({ dirs = [BUILTIN_PLUGIN_DIR, USER_PLUGIN_DIR], services = {}, enabled = null } = {}) {
  const ctx = createPluginContext({ services });
  const loaded = [];
  const failed = [];
  const files = new Set();
  for (const d of dirs) for (const f of findPluginFiles(d)) files.add(f);

  for (const file of files) {
    try {
      const mod = await import(pathToFileURL(file).href);
      const manifest = mod.default || mod;
      if (!manifest || typeof manifest.apply !== 'function') continue;
      const name = manifest.name || path.basename(path.dirname(file));
      if (enabled && !enabled(name)) continue;
      setCurrentPluginName(name);
      let cleanup = null;
      try {
        cleanup = await manifest.apply(ctx, { dir: path.dirname(file) }) || null;
      } finally {
        setCurrentPluginName(null);
      }
      loaded.push({
        name,
        version: manifest.version || '1.0.0',
        file,
        tools: ctx.tools.list().filter((t) => t._plugin === name).length,
        skills: ctx.skills.list().length,
        unload: cleanup,
      });
      ctx.events.emit('plugin/loaded', { name });
    } catch (e) {
      failed.push({ file, error: (e && e.message) || String(e) });
    }
  }
  return { ctx, loaded, failed };
}


/* ------------------------------------------------------------------ */
/* Runtime integration with ToolRuntime                               */
/* ------------------------------------------------------------------ */

/** The boot-time plugin context (wired in index.js). */
let activeCtx = null;

export function setActivePluginContext(ctx) {
  activeCtx = ctx;
}

export function getActivePluginContext() {
  return activeCtx;
}

/** Look up a plugin-registered tool handler by slug. */
export function getPluginTool(slug) {
  return activeCtx && activeCtx.tools.get(slug);
}

/** All plugin-registered tools (for status endpoints). */
export function listPluginTools() {
  return activeCtx ? activeCtx.tools.list() : [];
}

/** All plugin-registered skills. */
export function listPluginSkills() {
  return activeCtx ? activeCtx.skills.list() : [];
}
