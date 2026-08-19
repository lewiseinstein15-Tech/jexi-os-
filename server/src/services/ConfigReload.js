/**
 * B138 — CONFIG RELOAD (DeepSeek Harness `packages/boot/app-boot` config-reload
 * mirror, JEXI-branded).
 *
 * Boot-config hot reload: derived flags (key lock, allow-unlocked, feature
 * toggles from env + settings) are folded into one snapshot. Subscribers are
 * notified when a reload produces a DIFFERENT snapshot, so long-lived
 * surfaces (the key-lock middleware, the gateway) can react without a
 * restart. Reload is fail-open: a broken settings file keeps the previous
 * snapshot.
 */

const listeners = new Set();

let snapshot = null;
let lastReloadAt = 0;
let lastDiff = null;

/** Fold the current config snapshot from env + settings (values only). */
export function foldConfigSnapshot({ env = process.env, settings = {} } = {}) {
  const s = settings && typeof settings === 'object' ? settings : {};
  return {
    keyLocked: !!env.JEXI_API_KEY && env.JEXI_ALLOW_UNLOCKED !== '1',
    allowUnlocked: env.JEXI_ALLOW_UNLOCKED === '1',
    hasApiKey: !!env.JEXI_API_KEY,
    hasRedis: !!env.REDIS_URL,
    hasFirebase: !!env.FIREBASE_SERVICE_ACCOUNT_B64,
    preset: typeof s.agentPresets === 'object' && s.agentPresets ? (s.agentPresets.default || null) : null,
    defaultPersona: typeof s.persona === 'object' && s.persona ? (s.persona.default || null) : null,
    foldedAt: Date.now(),
  };
}

/** Record the initial snapshot (called at boot). */
export function initConfigSnapshot({ env = process.env, settings = {} } = {}) {
  snapshot = foldConfigSnapshot({ env, settings });
  lastReloadAt = Date.now();
  return snapshot;
}

/** Reload and notify on change. Returns { changed, snapshot, diff }. */
export function reloadConfig({ env = process.env, settings = {} } = {}) {
  const next = foldConfigSnapshot({ env, settings });
  lastReloadAt = Date.now();
  const diff = {};
  if (snapshot) {
    for (const key of Object.keys(next)) {
      if (key === 'foldedAt') continue; // a timestamp, never config
      if (next[key] !== snapshot[key]) diff[key] = { from: snapshot[key], to: next[key] };
    }
  }
  const changed = Object.keys(diff).length > 0;
  if (snapshot && changed) {
    lastDiff = diff;
    for (const fn of listeners) { try { fn({ diff, snapshot: next }); } catch { /* a listener must never break reload */ } }
  }
  snapshot = next;
  return { changed, snapshot: next, diff };
}

/** Subscribe to config-change events. */
export function onConfigChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Current snapshot + reload stats. */
export function configStatus() {
  return {
    snapshot: snapshot ? { ...snapshot, foldedAt: undefined } : null,
    foldedAt: snapshot ? snapshot.foldedAt : null,
    lastReloadAt,
    lastDiff,
    listenerCount: listeners.size,
  };
}
