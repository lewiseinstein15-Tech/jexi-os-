/**
 * B143 — CORDIS RUNNER (DeepSeek Harness `packages/extensions/cordis-host-runner`
 * mirror, JEXI-branded).
 *
 * Dynamic Cordis plugin lifecycle: the model can DEFINE a plugin package
 * (immutable metadata + host code), RUN it (evaluated against the live
 * plugin seam so its tool/skill registrations are real), STOP it (cleanup
 * runs, registrations are withdrawn), UNDEFINE it (forgotten), and INSPECT
 * the runner itself. Definitions persist to DATA_DIR/cordis-plugins.json.
 *
 * Host code contract: the body of an async function `(jexi, input) => …`
 * that returns a cleanup function (or { cleanup }). `jexi` exposes the live
 * seam: registerTool/registerSkill (stamped to the dynamic plugin),
 * services, and log. Evaluation is fail-closed: a code error surfaces as an
 * honest run failure; an undefined plugin is never runnable.
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { DATA_DIR } from '../config.js';
import { getActivePluginContext, setCurrentPluginName } from './PluginContext.js';

const STATE_FILE = path.join(DATA_DIR, 'cordis-plugins.json');
const NAME_RE = /^[a-z][a-z0-9_-]{1,48}$/;

/** One immutable package definition. */
export class DynamicCordisDefinition {
  constructor({ packageId, name, purpose, hostCode }) {
    this.packageId = packageId;
    this.name = name;
    this.purpose = purpose;
    this.hostCode = hostCode;
  }
}

/** One live plugin: immutable packages + optional active run. */
export class DynamicCordisPlugin {
  constructor({ pluginId, name, purpose }) {
    this.pluginId = pluginId;
    this.name = name;
    this.purpose = purpose;
    this.packages = new Map(); // packageId → definition
    this.run = null; // { runId, cleanup, startedAt }
  }
}

/** The dynamic plugin runner (singleton). */
export class CordisRunner {
  constructor({ stateFile = STATE_FILE } = {}) {
    this.stateFile = stateFile;
    this.plugins = new Map();
    this._load();
  }

  _load() {
    try {
      if (fs.existsSync(this.stateFile)) {
        const parsed = JSON.parse(fs.readFileSync(this.stateFile, 'utf-8'));
        for (const rec of parsed.plugins || []) {
          const plugin = new DynamicCordisPlugin({ pluginId: rec.pluginId, name: rec.name, purpose: rec.purpose });
          for (const pkg of rec.packages || []) {
            plugin.packages.set(pkg.packageId, new DynamicCordisDefinition(pkg));
          }
          this.plugins.set(plugin.pluginId, plugin);
        }
      }
    } catch { /* fresh */ }
  }

  _persist() {
    try {
      fs.mkdirSync(path.dirname(this.stateFile), { recursive: true });
      const payload = {
        plugins: [...this.plugins.values()].map((p) => ({
          pluginId: p.pluginId,
          name: p.name,
          purpose: p.purpose,
          packages: [...p.packages.values()].map((d) => ({ packageId: d.packageId, name: d.name, purpose: d.purpose, hostCode: d.hostCode })),
        })),
      };
      fs.writeFileSync(this.stateFile, JSON.stringify(payload, null, 2), 'utf-8');
    } catch { /* noop */ }
  }

  /** Define a new plugin package (dsh cordis_define). */
  define({ name, purpose, code }) {
    const n = String(name || '').trim();
    const p = String(purpose || '').trim();
    const host = code && typeof code.host === 'string' ? code.host.trim() : '';
    if (!NAME_RE.test(n)) return { ok: false, error: `cordis_define needs a name matching ${NAME_RE}` };
    if (p.length === 0) return { ok: false, error: 'cordis_define needs a non-empty purpose' };
    if (!host) return { ok: false, error: 'cordis_define needs code.host (or code.client — client halves are not evaluated host-side)' };

    const pluginId = `plg_${crypto.randomBytes(4).toString('hex')}`;
    const packageId = `pkg_${crypto.randomBytes(4).toString('hex')}`;
    const plugin = new DynamicCordisPlugin({ pluginId, name: n, purpose: p });
    plugin.packages.set(packageId, new DynamicCordisDefinition({ packageId, name: n, purpose: p, hostCode: host }));
    this.plugins.set(pluginId, plugin);
    this._persist();
    return { ok: true, pluginId, packageId, name: n, purpose: p, hasHostHalf: true, hasClientHalf: false };
  }

  /** Start (or update) the active run for one package (dsh cordis_run). */
  async run({ pluginId, packageId, input = {} }) {
    const plugin = this.plugins.get(String(pluginId || ''));
    if (!plugin) return { ok: false, error: `no dynamic plugin "${pluginId}"` };
    const def = plugin.packages.get(String(packageId || ''));
    if (!def) return { ok: false, error: `no package "${packageId}" on plugin "${pluginId}" (packages: ${[...plugin.packages.keys()].join(', ')})` };
    // Stop any prior run first (dsh run-updates semantics).
    if (plugin.run) {
      try { await plugin.run.cleanup(); } catch { /* noop */ }
      plugin.run = null;
    }
    let cleanup = null;
    try {
      const fn = new Function('jexi', 'input', `return (async () => {\n${def.hostCode}\n})();`);
      const seam = this._seam(plugin.pluginId, def.name);
      const result = await fn(seam, input || {});
      if (result && typeof result === 'function') cleanup = result;
      else if (result && typeof result.cleanup === 'function') cleanup = result.cleanup;
      else if (result && typeof result === 'object' && !result.cleanup) {
        // A non-cleanup object is treated as a successful side-effect-free run.
        cleanup = () => {};
      } else {
        cleanup = () => {};
      }
    } catch (e) {
      return { ok: false, error: `cordis_run failed: ${(e && e.message) || e}` };
    }
    const runId = `run_${crypto.randomBytes(4).toString('hex')}`;
    plugin.run = { runId, cleanup, startedAt: Date.now() };
    this._persist();
    return { ok: true, runId, pluginId, packageId };
  }

  /** Stop the active run (dsh cordis_stop). */
  async stop({ pluginId }) {
    const plugin = this.plugins.get(String(pluginId || ''));
    if (!plugin) return { ok: false, error: `no dynamic plugin "${pluginId}"` };
    if (!plugin.run) return { ok: true, pluginId, wasRunning: false };
    try { await plugin.run.cleanup(); } catch { /* noop */ }
    plugin.run = null;
    this._persist();
    return { ok: true, pluginId, wasRunning: true };
  }

  /** Remove a plugin and its active run (dsh cordis_undefine). */
  async undefine({ pluginId }) {
    const plugin = this.plugins.get(String(pluginId || ''));
    if (!plugin) return { ok: false, reason: 'plugin-missing', error: `no dynamic plugin "${pluginId}"` };
    const wasRunning = plugin.run !== null;
    if (wasRunning) { try { await plugin.run.cleanup(); } catch { /* noop */ } }
    this.plugins.delete(plugin.pluginId);
    this._persist();
    return { ok: true, pluginId, wasRunning };
  }

  /** Self-inspection (dsh cordis_inspect_self). */
  inspectSelf() {
    return {
      ok: true,
      plugins: [...this.plugins.values()].map((p) => ({
        pluginId: p.pluginId,
        name: p.name,
        purpose: p.purpose,
        packageCount: p.packages.size,
        running: !!p.run,
        runId: p.run ? p.run.runId : null,
        startedAt: p.run ? p.run.startedAt : null,
      })),
      stateFile: this.stateFile,
    };
  }

  /** The `jexi` seam handed to evaluated host code (fail-closed surface). */
  _seam(pluginId, name) {
    const ctx = getActivePluginContext();
    const services = (ctx && ctx.services) || {};
    const unregisters = [];
    const seam = {
      services,
      log: (...args) => { try { console.log(`[cordis:${name}]`, ...args); } catch { /* noop */ } },
      registerTool(def) {
        if (!ctx || !ctx.tools) throw new Error('plugin context not ready');
        setCurrentPluginName(`cordis:${name}`);
        try { unregisters.push(ctx.tools.register(def)); } finally { setCurrentPluginName(null); }
        return unregisters.length;
      },
      registerSkill(def) {
        if (!ctx || !ctx.skills) throw new Error('plugin context not ready');
        setCurrentPluginName(`cordis:${name}`);
        try { unregisters.push(ctx.skills.register(def)); } finally { setCurrentPluginName(null); }
        return unregisters.length;
      },
      unregisterAll() {
        for (const u of unregisters.splice(0)) { try { u(); } catch { /* noop */ } }
        return unregisters.length;
      },
      registered: () => unregisters.length,
    };
    return seam;
  }
}

/** Singleton + status for /api/cordis/runner. */
let runner = null;
export function cordisRunner() {
  if (!runner) runner = new CordisRunner();
  return runner;
}

export function cordisRunnerStatus() {
  try { return cordisRunner().inspectSelf(); } catch (e) { return { ok: false, error: (e && e.message) || String(e) }; }
}
