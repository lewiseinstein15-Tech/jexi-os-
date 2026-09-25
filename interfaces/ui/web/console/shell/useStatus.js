import { useEffect, useState } from 'react';

/**
 * Premium shell — shared status probes.
 *
 * ONE poller per endpoint for the whole shell (module-level refcount):
 *  - /api/health      (2.5s timeout, 5s interval) -> backend online/offline
 *  - /api/providers/active (30s interval)        -> unified model config
 *
 * Both consume REAL backend payloads; no fixture data anywhere. When the
 * brain is unreachable the hooks say so and keep the last truth cached —
 * the UI renders "offline"/"unresolved" honestly instead of guessing.
 */

const healthListeners = new Set();
const modelListeners = new Set();
let healthTimer = null;
let modelTimer = null;
let healthInFlight = false;
let modelInFlight = false;
let healthState = { backend: 'checking' };
let modelState = { loading: true, configured: null, provider: null, model: null, error: null };

function notify(set) {
  for (const fn of set) {
    try { fn(); } catch { /* one bad subscriber never kills the poll */ }
  }
}

async function pollHealth() {
  if (healthInFlight) return;
  healthInFlight = true;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 2500);
  try {
    const r = await fetch('/api/health', { signal: ctrl.signal });
    const next = { backend: r.ok ? 'online' : 'offline' };
    if (next.backend !== healthState.backend || !healthState.seen) {
      healthState = { ...next, seen: true };
      notify(healthListeners);
    }
  } catch {
    if (healthState.backend !== 'offline') {
      healthState = { backend: 'offline', seen: true };
      notify(healthListeners);
    }
  } finally {
    clearTimeout(t);
    healthInFlight = false;
  }
}

function startHealth() {
  if (healthTimer) return;
  void pollHealth();
  healthTimer = setInterval(pollHealth, 5000);
}
function stopHealth() {
  if (healthTimer) { clearInterval(healthTimer); healthTimer = null; }
}

async function pollModel() {
  if (modelInFlight) return;
  modelInFlight = true;
  try {
    const r = await fetch('/api/providers/active');
    const j = await r.json();
    const a = (j && j.active) || {};
    modelState = {
      loading: false,
      configured: a.configured === true,
      provider: a.provider || null,
      model: a.model || null,
      hasKey: a.hasKey === true,
      error: r.ok ? null : `HTTP ${r.status}`,
    };
  } catch (e) {
    modelState = { ...modelState, loading: false, error: String((e && e.message) || e) };
  }
  notify(modelListeners);
}

function startModel() {
  if (modelTimer) return;
  void pollModel();
  modelTimer = setInterval(pollModel, 30000);
}
function stopModel() {
  if (modelTimer) { clearInterval(modelTimer); modelTimer = null; }
}

/** Backend liveness: { backend: 'checking'|'online'|'offline' }. */
export function useBackendStatus() {
  const [state, setState] = useState(healthState);
  useEffect(() => {
    const fn = () => setState(healthState);
    healthListeners.add(fn);
    startHealth();
    fn();
    return () => {
      healthListeners.delete(fn);
      if (healthListeners.size === 0) stopHealth();
    };
  }, []);
  return state;
}

/** Unified model config (GET /api/providers/active), masked server-side. */
export function useModelStatus() {
  const [state, setState] = useState(modelState);
  useEffect(() => {
    const fn = () => setState(modelState);
    modelListeners.add(fn);
    startModel();
    fn();
    return () => {
      modelListeners.delete(fn);
      if (modelListeners.size === 0) stopModel();
    };
  }, []);
  return state;
}

/** Force-refresh the model status (used by Settings after saving a config). */
export function refreshModelStatus() {
  void pollModel();
}
