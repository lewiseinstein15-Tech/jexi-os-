/**
 * ARENA ASTRA REBUILD — Reasoning Engine (spec Part 6).
 *
 * The provider-independent reasoning layer:
 *
 *   ReasoningEngine → ModelRouter → ModelProvider
 *       ├── LocalProvider (keyless on-machine backend — via providers/)
 *       ├── RemoteProvider (the free-tier ladder in LLMClient)
 *       └── FutureProvider (registered at runtime, same interface)
 *
 * Rules:
 * - NOBODY outside this module + LLMClient touches provider APIs directly.
 * - Every call is budget-capped (AbortSignal + timeout) so no provider can
 *   eat minutes (proven failure mode: a stalled rung cost 130s before the
 *   airtight budget landed).
 * - Every call is metered (RequestMeter) and observed (Observer events:
 *   model.requested / model.completed / model.failed).
 * - Failures walk the ladder; the caller gets either a real answer or an
 *   honest error — never a fabricated completion.
 */

import { emit } from './Observer.js';

const providers = new Map(); // id → { id, kind, generate, health?, isPreferred? }

/** Register a provider (Ollama / remote / future). Idempotent. */
export function registerProvider(p) {
  if (!p || !p.id || typeof p.generate !== 'function') throw new Error('provider needs { id, generate }');
  providers.set(p.id, p);
  return p;
}

export function listProviders() {
  return [...providers.values()].map((p) => ({ id: p.id, kind: p.kind || 'remote' }));
}

/** Ensure the built-in providers are registered (lazy, import-cycle safe). */
async function ensureBuiltins() {
  const { hasLocalCapability, resolveLocalProvider, localProviderPreferred } = await import('../providers/index.js');
  if (!providers.has('local') && hasLocalCapability('reasoning')) {
    try {
      const local = resolveLocalProvider();
      if (local) {
        registerProvider({
          id: 'local',
          kind: 'local',
          config: () => ({ preferred: localProviderPreferred() }),
          generate: async ({ messages, model, signal, timeoutMs }) => {
            const t0 = Date.now();
            const r = await local.chat({ messages, model, timeoutMs, signal });
            const text = r?.content ?? '';
            return { text, model: model || 'local', ms: Date.now() - t0, provider: 'local' };
          },
          health: async () => {
            try {
              return local.health ? await local.health({ timeoutMs: 8000 }) : { ok: true };
            } catch (e) {
              return { ok: false, error: String(e?.message || e).slice(0, 140) };
            }
          },
          isPreferred: () => localProviderPreferred(),
        });
      }
    } catch {}
  }
  if (!providers.has('remote')) {
    try {
      const llm = await import('../providers/runtime/LLMClient.js');
      registerProvider({
        id: 'remote',
        kind: 'remote',
        generate: async ({ messages, signal, timeoutMs, prefer, model }) => {
          const t0 = Date.now();
          const text = await llm.generateContent(messages, { signal, timeoutMs, prefer, model });
          return { text, model: model || prefer || 'auto', ms: Date.now() - t0, provider: 'remote' };
        },
        health: async () => {
          try {
            const snap = await llm.testAllProviders?.();
            return { ok: true, snapshot: snap };
          } catch (e) {
            return { ok: false, error: String(e?.message || e).slice(0, 140) };
          }
        },
      });
    } catch {}
  }
}

/** Ladder order: an operator-preferred provider first, then the rest. */
function ladderOrder() {
  const preferred = (process.env.MODEL_PROVIDER || '').toLowerCase();
  const ids = [...providers.keys()];
  const isPreferred = (id) => {
    if (preferred && id === preferred) return true;
    try { return !!(providers.get(id)?.isPreferred && providers.get(id).isPreferred()); } catch { return false; }
  };
  ids.sort((a, b) => (isPreferred(a) ? -1 : 0) - (isPreferred(b) ? -1 : 0));
  // The explicitly-preferred provider goes first; otherwise remote first.
  if (!preferred && !ids.some((id) => isPreferred(id)) && providers.has('remote')) {
    return ['remote', ...ids.filter((x) => x !== 'remote')];
  }
  return ids;
}

/**
 * Reason once. Walks the provider ladder with a per-call budget.
 *
 * @param {Array<{role: string, content: string}>} messages
 * @param {{ timeoutMs?: number, signal?: AbortSignal, prefer?: string,
 *   model?: string, missionId?: string, taskId?: string, stage?: string }} opts
 * @returns {{ text, provider, model, ms, attempts }}
 */
export async function reason(messages, opts = {}) {
  await ensureBuiltins();
  const { timeoutMs = 60000, signal, prefer, model, missionId = null, taskId = null, stage = 'reason' } = opts;
  try {
    const { meterLap } = await import('./RequestMeter.js').catch(() => ({}));
    if (typeof meterLap === 'function') meterLap(`reason:${stage}`);
  } catch {}

  emit('model.requested', { missionId, taskId, actor: 'ReasoningEngine', summary: stage, data: { prefer: prefer || null } });

  const order = prefer && providers.has(prefer) ? [prefer, ...ladderOrder().filter((x) => x !== prefer)] : ladderOrder();
  const errors = [];
  let attempts = 0;
  for (const id of order) {
    const p = providers.get(id);
    if (!p) continue;
    if (signal?.aborted) break;
    attempts += 1;
    const t0 = Date.now();
    try {
      const ctrl = new AbortController();
      const onAbort = () => ctrl.abort();
      if (signal) signal.addEventListener('abort', onAbort, { once: true });
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const out = await p.generate({ messages, signal: ctrl.signal, timeoutMs, prefer, model });
        const ms = Date.now() - t0;
        try {
          const { noteMeterModelCall } = await import('./RequestMeter.js').catch(() => ({}));
          if (typeof noteMeterModelCall === 'function') noteMeterModelCall(id, out.model || null, ms, true);
        } catch {}
        emit('model.completed', { missionId, taskId, actor: 'ReasoningEngine', summary: `${id} answered in ${(ms / 1000).toFixed(1)}s`, data: { provider: id, ms } });
        return { text: out.text, provider: id, model: out.model || null, ms, attempts };
      } finally {
        clearTimeout(timer);
        if (signal) signal.removeEventListener('abort', onAbort);
      }
    } catch (e) {
      const ms = Date.now() - t0;
      const msg = e?.name === 'AbortError' ? 'timeout/budget' : String(e?.message || e).slice(0, 140);
      errors.push(`${id}: ${msg}`);
      try {
        const { noteMeterModelCall } = await import('./RequestMeter.js').catch(() => ({}));
        if (typeof noteMeterModelCall === 'function') noteMeterModelCall(id, null, ms, false);
      } catch {}
      emit('model.failed', { missionId, taskId, actor: 'ReasoningEngine', summary: `${id} failed (${msg})`, data: { provider: id } });
      // fall through to the next rung
    }
  }
  const err = new Error(errors.length ? `all providers failed: ${errors.join(' | ').slice(0, 400)}` : 'no providers registered');
  err.attempts = attempts;
  throw err;
}

/** Health snapshot across registered providers (best-effort, honest). */
export async function reasoningHealth() {
  await ensureBuiltins();
  const out = {};
  for (const [id, p] of providers) {
    try {
      out[id] = typeof p.health === 'function' ? await p.health() : { ok: true, note: 'no health probe' };
    } catch (e) {
      out[id] = { ok: false, error: String(e?.message || e).slice(0, 140) };
    }
  }
  return { ladder: ladderOrder(), providers: out };
}

export const ReasoningEngine = { reason, registerProvider, listProviders, health: reasoningHealth };
