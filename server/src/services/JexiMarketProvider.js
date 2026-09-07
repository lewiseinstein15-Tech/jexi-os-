/**
 * ARENA ASTRA REBUILD — JEXI Market external provider (spec Part 18).
 *
 *   JEXI → ExternalCapabilityProvider → Authenticated API → JEXI Market
 *        → Structured result → JEXI
 *
 * HARD BOUNDARIES (never violate):
 * - Main JEXI NEVER imports Market internals (no agents, memory, MCPs,
 *   infra, or source from the Market repo).
 * - The Market NEVER initiates, NEVER touches JEXI memory/tools/MCPs.
 * - Unconfigured → honest "not connected" (never a fake success).
 * - Failures degrade gracefully — JEXI never depends on the Market.
 *
 * Config:
 *   JEXI_MARKET_URL        base URL of the Market API (unset = not connected)
 *   JEXI_MARKET_API_KEY    bearer key for authentication
 *   JEXI_MARKET_TIMEOUT_MS default 20000
 *
 * Implemented on top of the existing ExternalProviders registry (the
 * one-way authenticated bridge shape) — this file adds the Market-specific
 * capability surface (analyze/quote/outlook) and response validation.
 */

import { emit } from './Observer.js';

const PROVIDER_ID = 'jexi-market';

export function marketConfig() {
  return {
    endpoint: (process.env.JEXI_MARKET_URL || '').replace(/\/+$/, ''),
    apiKey: process.env.JEXI_MARKET_API_KEY || '',
    timeoutMs: Number(process.env.JEXI_MARKET_TIMEOUT_MS || 20000),
  };
}

export function marketStatus() {
  const { endpoint, apiKey } = marketConfig();
  return {
    id: PROVIDER_ID,
    configured: Boolean(endpoint && apiKey),
    endpointSet: Boolean(endpoint),
    keySet: Boolean(apiKey),
    note: endpoint && apiKey ? 'connected (external, one-way, authenticated)' : 'not connected — set JEXI_MARKET_URL + JEXI_MARKET_API_KEY',
  };
}

async function ensureRegistered() {
  const { registerProvider, getProvider } = await import('./ExternalProviders.js');
  let existing = null;
  try { existing = getProvider?.(PROVIDER_ID); } catch {}
  if (existing) return existing;
  const { endpoint } = marketConfig();
  return registerProvider({
    id: PROVIDER_ID,
    name: 'JEXI Market',
    domain: 'market-analysis',
    capabilities: ['market_analysis', 'quote', 'outlook'],
    endpoint: endpoint || '',
    authType: 'bearer',
    timeoutMs: marketConfig().timeoutMs,
  });
}

function validateResult(body) {
  if (!body || typeof body !== 'object') throw new Error('market returned a non-object result');
  // Structured result contract: { ok, kind, summary, data?, asOf? }
  if (typeof body.summary !== 'string' || !body.summary.trim()) throw new Error('market result missing summary');
  return {
    ok: body.ok !== false,
    kind: String(body.kind || 'analysis').slice(0, 60),
    summary: String(body.summary).slice(0, 2000),
    data: body.data ?? null,
    asOf: body.asOf || null,
  };
}

/**
 * Call the Market for a capability. One-way, authenticated, validated.
 * @param {'analyze'|'quote'|'outlook'} capability
 * @param {object} params  e.g. { symbols: ['AAPL'], question: '…' }
 */
export async function callMarket(capability, params = {}) {
  const st = marketStatus();
  emit('market.requested', { actor: 'JexiMarketProvider', summary: `${capability}`, data: { capability } });
  if (!st.configured) {
    const msg = 'JEXI Market is not connected (set JEXI_MARKET_URL + JEXI_MARKET_API_KEY). I can still help with general market research from public sources.';
    emit('market.unavailable', { actor: 'JexiMarketProvider', summary: 'not connected' });
    return { ok: false, connected: false, kind: capability, summary: msg, data: null, asOf: null };
  }
  await ensureRegistered();
  const { endpoint, apiKey, timeoutMs } = marketConfig();
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${endpoint}/v1/${capability}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(params),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const out = validateResult(await res.json().catch(() => null));
    emit('market.completed', { actor: 'JexiMarketProvider', summary: out.summary.slice(0, 160), data: { capability } });
    return { ...out, connected: true };
  } catch (e) {
    const msg = e?.name === 'AbortError' ? 'Market request timed out' : String(e?.message || e).slice(0, 160);
    emit('market.failed', { actor: 'JexiMarketProvider', summary: msg, data: { capability } });
    return { ok: false, connected: true, kind: capability, summary: `Market call failed honestly: ${msg}. Falling back to built-in research.`, data: null, asOf: null };
  } finally {
    clearTimeout(t);
  }
}

export const JexiMarketProvider = { callMarket, marketStatus, marketConfig };
