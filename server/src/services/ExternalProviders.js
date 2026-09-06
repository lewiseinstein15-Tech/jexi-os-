/**
 * EXTERNAL CAPABILITY PROVIDERS — Ultimate Architecture Upgrade §41 (Sept 2026).
 *
 * The ONE-WAY, AUTHENTICATED bridge shape for capabilities that live OUTSIDE
 * JEXI. Built per the architecture spec with NO real integration yet:
 *
 *   Main JEXI (initiator) ──authenticated request──▶ external provider
 *   External provider NEVER initiates. NEVER touches JEXI memory, tools,
 *   MCPs, agents or infra. Failures degrade gracefully — JEXI never depends
 *   on an external system to function (§41.4).
 *
 * The only registered entry is the future JEXI Market slot, with
 * configured:false — calling it returns an honest "not connected" answer,
 * never a fake success.
 */
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '../config.js';

const AUDIT_FILE = path.join(DATA_DIR, 'architecture', 'external-providers-audit.json');
const MAX_AUDIT = 300;

/* §19-style circuit breaker per provider */
const BREAKER_THRESHOLD = 3;
const BREAKER_COOLDOWN_MS = 5 * 60 * 1000;

const providers = new Map(); // id → provider record
const breakers = new Map(); // id → { fails, openedAt }
let auditLog = null;

function audit(entry) {
  try {
    if (!auditLog) {
      auditLog = [];
      try {
        if (fs.existsSync(AUDIT_FILE)) auditLog = JSON.parse(fs.readFileSync(AUDIT_FILE, 'utf8'));
      } catch { auditLog = []; }
    }
    auditLog.push({ t: new Date().toISOString(), ...entry });
    if (auditLog.length > MAX_AUDIT) auditLog.splice(0, auditLog.length - MAX_AUDIT);
    fs.mkdirSync(path.dirname(AUDIT_FILE), { recursive: true });
    fs.writeFileSync(AUDIT_FILE, JSON.stringify(auditLog, null, 1));
  } catch { /* audit is best-effort */ }
}

function breakerOpen(id) {
  const b = breakers.get(id);
  if (!b || !b.openedAt) return false;
  if (Date.now() - b.openedAt > BREAKER_COOLDOWN_MS) { breakers.delete(id); return false; }
  return true;
}
function breakerFail(id) {
  const b = breakers.get(id) || { fails: 0, openedAt: 0 };
  b.fails += 1;
  if (b.fails >= BREAKER_THRESHOLD && !b.openedAt) b.openedAt = Date.now();
  breakers.set(id, b);
}

/**
 * Register an external capability provider.
 * shape: { id, name, domain, capabilities[], endpoint, authType, timeoutMs, retry }
 * A provider without an endpoint + auth is registered as NOT CONFIGURED —
 * visible in listings, callable never (honest unavailability, §41.4).
 */
export function registerProvider(shape = {}) {
  const { id, name, domain = '', capabilities = [], endpoint = '', authType = 'authenticated-header', timeoutMs = 20_000, retry = { attempts: 2, backoffMs: 500 }, initiator = 'jexi-main' } = shape;
  if (!id || !/^[a-z0-9-]+$/.test(id)) throw new Error('provider id must be a kebab-case string');
  providers.set(id, {
    id, name: name || id, domain, capabilities,
    endpoint, authType, timeoutMs, retry, initiator,
    configured: Boolean(endpoint),
    registeredAt: new Date().toISOString(),
    calls: 0, failures: 0, lastError: null, lastSuccessAt: null,
  });
  audit({ type: 'PROVIDER_REGISTERED', provider: id, configured: Boolean(endpoint) });
  return providers.get(id);
}

/**
 * Call an external provider. MAIN JEXI INITIATES — always one-way. Unconfigured
 * providers, open circuits and every failure return honest, structured
 * unavailable answers; nothing ever throws at the caller.
 */
export async function callProvider(id, payload = {}, { timeoutMs, signal = null } = {}) {
  const p = providers.get(id);
  if (!p) return { ok: false, unavailable: true, reason: `provider '${id}' is not registered` };
  if (!p.configured) {
    audit({ type: 'PROVIDER_UNAVAILABLE', provider: id, reason: 'not configured (no endpoint) — placeholder per §41, no real integration' });
    return { ok: false, unavailable: true, reason: `provider '${id}' is registered but not connected (endpoint not configured). This is the honest answer — no real integration exists yet.` };
  }
  if (breakerOpen(id)) {
    audit({ type: 'PROVIDER_BREAKER_OPEN', provider: id });
    return { ok: false, unavailable: true, reason: `provider '${id}' is in a failure cooldown` };
  }
  p.calls += 1;
  const attempts = Math.max(1, p.retry.attempts || 1);
  const timeout = timeoutMs || p.timeoutMs;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const ctrl = new AbortController();
      const onAbort = () => ctrl.abort();
      if (signal) signal.addEventListener('abort', onAbort, { once: true });
      const timer = setTimeout(() => ctrl.abort(), timeout);
      try {
        // fetch is used lazily so tests never need a live endpoint
        const res = await fetch(p.endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-jexi-initiator': p.initiator },
          body: JSON.stringify({ domain: p.domain, capabilities: p.capabilities, payload }),
          signal: ctrl.signal,
        });
        if (!res.ok) throw new Error(`provider HTTP ${res.status}`);
        const data = await res.json();
        p.lastSuccessAt = new Date().toISOString();
        breakers.delete(id);
        audit({ type: 'PROVIDER_CALL', provider: id, attempt, ok: true });
        return { ok: true, data };
      } finally {
        clearTimeout(timer);
        if (signal) signal.removeEventListener('abort', onAbort);
      }
    } catch (e) {
      p.failures += 1;
      p.lastError = String(e && e.message).slice(0, 200);
      breakerFail(id);
      audit({ type: 'PROVIDER_CALL_FAILED', provider: id, attempt, error: p.lastError });
      if (attempt >= attempts) {
        return { ok: false, unavailable: true, reason: `provider '${id}' failed after ${attempt} attempt(s): ${p.lastError}`, circuitOpen: breakerOpen(id) };
      }
      await new Promise((r) => setTimeout(r, p.retry.backoffMs || 500));
    }
  }
  return { ok: false, unavailable: true, reason: 'unreachable' };
}

/** Listing + health view (§41.3): capability surface + honest connection state. */
export function listProviders() {
  return [...providers.values()].map((p) => ({
    id: p.id, name: p.name, domain: p.domain, capabilities: p.capabilities,
    configured: p.configured,
    connection: p.configured ? (breakerOpen(p.id) ? 'cooldown' : 'ready') : 'not-connected',
    initiator: p.initiator,
    calls: p.calls, failures: p.failures,
    lastSuccessAt: p.lastSuccessAt, lastError: p.lastError,
    registeredAt: p.registeredAt,
  }));
}

export function getProvider(id) { return providers.get(id) || null; }

export function externalProviderStats() {
  const list = listProviders();
  return {
    providers: list.length,
    connected: list.filter((p) => p.configured).length,
    placeholder: list.filter((p) => !p.configured).length,
    oneWayRule: 'Main JEXI initiates every call. External systems never initiate and never touch JEXI memory/tools/MCPs/agents.',
  };
}

/**
 * Boot default: the JEXI Market slot, registered but NOT connected (§41.5).
 * The Market repo (lewiseinstein15-Tech/daily_stock_analysis) is a SEPARATE
 * system — no code merged, no endpoint configured, nothing imported. This
 * entry only reserves the capability shape so the future bridge has a home.
 */
export function registerDefaults() {
  if (!providers.has('jexi-market')) {
    registerProvider({
      id: 'jexi-market',
      name: 'JEXI Market (external system)',
      domain: 'financial-market-intelligence',
      capabilities: ['market-research', 'fundamental-analysis', 'technical-analysis', 'macro-analysis', 'risk-assessment', 'paper-trading', 'backtesting'],
      endpoint: '', // deliberately empty — no real integration (separation rule)
      timeoutMs: 20_000,
      retry: { attempts: 2, backoffMs: 500 },
      initiator: 'jexi-main',
    });
  }
  return listProviders();
}

/* auto-register the default slot on first import (zero-config, honest) */
registerDefaults();
