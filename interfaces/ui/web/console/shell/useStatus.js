import { useEffect, useState } from 'react';

/**
 * Premium shell — shared status probes.
 *
 * ONE poller per endpoint for the whole shell (module-level refcount):
 *  - /api/health           (2.5s timeout, 5s interval)  -> backend online/offline
 *  - /api/providers/active (30s interval)               -> unified model config
 *  - /api/settings/status  (piggybacks the model poll)  -> legacy key presence
 *
 * BUG 1 (ui-rebuild-premium-v2 fix) — the header chip used to read ONLY
 * /api/providers/active, which resolves the unified JEXI_MODEL_* contract.
 * A boot running on the LEGACY cascade (GROQ_API_KEY in env, or a legacy
 * settings key) chats perfectly while that route honestly reports
 * configured:false — the chip lied "model unresolved" while the model was
 * answering. Fix: the same poller also reads /api/settings/status (existing
 * route; reports WHERE each credential lives — env | settings | none, never
 * key material) and the UI state is derived:
 *
 *   1. turn-observed  — provider+model the last completed turn ACTUALLY used
 *                       (parsed from the done event's statistics.meter calls,
 *                       relayed by backendAgent + mount.js). Wins until the
 *                       unified config CHANGES, so the chip reflects the real
 *                       per-turn provider (lead requirement).
 *   2. unified config — /api/providers/active configured:true (Settings UI or
 *                       JEXI_MODEL_* env). Shows provider + model.
 *   3. legacy key     — any provider configured in /api/settings/status
 *                       (source env OR settings). Green + provider name; the
 *                       exact model id is only known after a turn (the legacy
 *                       cascade picks it per call) — shown honestly then.
 *   4. nothing        — "configure in Settings" (amber), honestly.
 *
 * Both consumers (Header chip, Sidebar indicator, TurnFooter) read THIS
 * signal, so the chip can never disagree with what chat is using.
 */

const healthListeners = new Set();
const modelListeners = new Set();
let healthTimer = null;
let modelTimer = null;
let healthInFlight = false;
let modelInFlight = false;
let healthState = { backend: 'checking' };
let modelState = { loading: true, configured: null, provider: null, model: null, keyPresent: null, error: null };

// ui-rebuild-premium-v2 BUG 1 — provider+model observed from the last real
// turn (done event -> statistics.meter.calls). Null until a turn completes.
let turnObserved = null; // { provider, model, at }
// Snapshot of the last-seen unified config signature — when it changes we
// drop turnObserved so a fresh Settings config is shown immediately.
let unifiedSig = null;
let lastUnified = null; // last raw unified payload from /api/providers/active

function notify(set) {
  for (const fn of set) {
    try { fn(); } catch { /* one bad subscriber never kills the poll */ }
  }
}

function deriveModelState(unified, legacy, error) {
  // 1. turn-observed wins — it is what the last completed turn actually used.
  if (turnObserved && turnObserved.provider) {
    return {
      loading: false,
      configured: true,
      provider: turnObserved.provider,
      model: turnObserved.model || null,
      keyPresent: true,
      source: 'last-turn',
      legacy,
      error: null,
    };
  }
  // 2. unified config (Settings UI or JEXI_MODEL_* env).
  if (unified && unified.configured === true) {
    return {
      loading: false,
      configured: true,
      provider: unified.provider || null,
      model: unified.model || null,
      keyPresent: unified.hasKey !== false,
      source: unified.source || 'unified',
      legacy,
      error: null,
    };
  }
  // 3. legacy cascade key present (env or settings file) — green, provider
  //    name now; the model id arrives with the first real turn.
  const first = (legacy || [])[0] || null;
  if (first) {
    return {
      loading: false,
      configured: true,
      provider: first.provider || null,
      model: null,
      keyPresent: true,
      source: first.source || 'legacy',
      legacy,
      error: null,
    };
  }
  // 4. honestly unresolved.
  return { loading: false, configured: false, provider: null, model: null, keyPresent: false, source: null, legacy, error: error || null };
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

/** Legacy cascade key presence — { provider, source } per configured slot. */
async function fetchLegacyKeys() {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 4000);
    const r = await fetch('/api/settings/status', { signal: ctrl.signal });
    clearTimeout(t);
    if (!r.ok) return [];
    const j = await r.json();
    const out = [];
    for (const [provider, st] of Object.entries(j || {})) {
      if (st && st.configured === true) out.push({ provider, source: st.source || 'unknown' });
    }
    return out;
  } catch { return []; }
}

async function pollModel() {
  if (modelInFlight) return;
  modelInFlight = true;
  try {
    const [activeRes, legacy] = await Promise.all([
      fetch('/api/providers/active').then(async (r) => ({ ok: r.ok, status: r.status, body: await r.json().catch(() => null) })),
      fetchLegacyKeys(),
    ]);
    const j = activeRes.body;
    const a = (j && j.active) || {};
    const unified = {
      configured: a.configured === true,
      provider: a.provider || null,
      model: a.model || null,
      hasKey: a.hasKey === true,
      source: a.source || null,
    };
    lastUnified = unified;
    // A CHANGED unified config drops the turn-observed override so a new
    // Settings save is visible immediately (same config -> turn truth stays).
    const sig = unified.configured ? `${unified.provider}|${unified.model}|${unified.source || ''}` : null;
    if (sig !== unifiedSig) {
      unifiedSig = sig;
      if (sig) turnObserved = null;
    }
    modelState = deriveModelState(unified, legacy, activeRes.ok ? null : `HTTP ${activeRes.status}`);
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

/**
 * ui-rebuild-premium-v2 BUG 1 — record the provider+model the last completed
 * turn ACTUALLY used (parsed from the done event's statistics.meter calls by
 * backendAgent.js and relayed through mount.js). Notifies every chip/footer/
 * sidebar subscriber so the UI reflects the real per-turn provider without a
 * page refresh.
 */
export function applyTurnProvider(provider, model) {
  const p = String(provider || '').trim();
  if (!p) return;
  turnObserved = { provider: p, model: String(model || '').trim() || null, at: Date.now() };
  modelState = deriveModelState(
    lastUnified || { configured: false },
    (modelState && modelState.legacy) || [],
    null,
  );
  notify(modelListeners);
}
