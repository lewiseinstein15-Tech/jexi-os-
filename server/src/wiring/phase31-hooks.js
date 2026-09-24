/**
 * JEXI OS — PHASE 31 SCOPE 6 — P30.A + P30.F consumer wiring (connect-only).
 *
 * P30.A — 30-hook catalog -> session lifecycle runtime. The Phase 30
 * catalog (harness/parity/hooks) is READ-ONLY: 5 events carry real Phase 7
 * registrations (PreToolUse, Stop, SessionStart, PreCompact, SessionEnd),
 * 25 are no-op stubs. This consumer mounts a runtime emitter on the boot
 * seam so catalog events actually FIRE at their lifecycle points:
 *   SessionStart fires at boot; SessionEnd fires at shutdown (the bootstrap
 *   shutdown handlers call fireSessionEnd); PreToolUse already fires on
 *   every executor dispatch through the shipped Phase 7(B) permission gate;
 *   Stop / PreCompact fire through the same emitter — their production call
 *   sites (agent turn end, session compaction) are outside this scope's
 *   named call sites and stay NOT WIRED (owner call, disclosed).
 * The 25 stub events get no-op stub handlers registered on the runtime side.
 *
 * P30.F — permission + command lifecycle hooks (PermissionDenied,
 * UserPromptExpansion, PostToolBatch). The shipped lifecycle primitives are
 * mounted with behavior-neutral default handlers (deny-no-retry / allow /
 * ok) and exposed through fail-soft globalThis seams so the browser-safe
 * consumers (ui/web/console/chat/approvals.js, commands/registry.js) can
 * fire them without importing server-only modules.
 *
 * WIRING RULE: connect, do not rebuild. Every primitive below is READ-ONLY;
 * log lines carry NO timestamps so P6 determinism holds.
 */

import hooks from '../../../harness/parity/hooks/index.js';
import { createLifecycle } from '../../../harness/parity/lifecycle/index.js';

/* ---------------- module state -------------------------------------------- */
const state = { mounted: null };

/** Mount the runtime hook emitter + lifecycle seams on the boot seam. */
export function initPhase31Hooks({ sessionId = 'boot' } = {}) {
  const catalogCount = hooks.count();
  if (catalogCount !== 30) {
    throw Object.assign(new Error(`hook catalog must declare 30 events; found ${catalogCount}`), { code: 'E_WIRING' });
  }
  const mappedEvents = hooks.mapped().map((spec) => spec.event);
  const stubEvents = hooks.stubs().map((spec) => spec.event);

  /* --- runtime handler registry (validated against the READ-ONLY catalog) - */
  const runtimeHandlers = new Map();
  const journal = [];
  const register = (event, handler) => {
    hooks.get(event); // throws E_UNKNOWN_HOOK_EVENT (shipped error class) on unknown
    if (typeof handler !== 'function') {
      throw Object.assign(new Error(`handler for ${event} must be a function`), { code: 'E_WIRING' });
    }
    const set = runtimeHandlers.get(event) ?? new Set();
    set.add(handler);
    runtimeHandlers.set(event, set);
    return () => set.delete(handler);
  };

  /* --- 25 stub events: no-op stub handlers registered on the runtime side - */
  for (const event of stubEvents) register(event, () => ({ stub: true, event }));

  /* --- 5 mapped events: runtime adapters that carry the Phase 7 mapping --- */
  for (const event of mappedEvents) {
    register(event, (payload) => {
      const spec = hooks.get(event);
      return { wired: true, event, phase7Handlers: spec.handlers.map((h) => h.id) };
    });
  }

  /* --- the emitter: validate + invoke every runtime handler, record it ---- */
  const emit = (event, payload = {}) => {
    const spec = hooks.get(event); // shipped E_UNKNOWN_HOOK_EVENT on unknown
    const receipts = [];
    for (const handler of runtimeHandlers.get(event) ?? []) {
      try { receipts.push(handler(payload)); }
      catch (error) { receipts.push({ error: String(error && error.message || error) }); }
    }
    const record = {
      event: spec.event,
      lifecycle: spec.lifecycle,
      stub: spec.stub,
      mappedHandlerCount: spec.handlers.length,
      runtimeHandlerCount: (runtimeHandlers.get(event) ?? []).size,
      receipts,
    };
    journal.push(record);
    return record;
  };

  /* --- real lifecycle point #1: SessionStart fires at boot ---------------- */
  emit('SessionStart', { source: 'startup', sessionId });

  /* --- real lifecycle point #2: SessionEnd fires at shutdown -------------- */
  const fireSessionEnd = (reason = 'shutdown') => emit('SessionEnd', { reason, sessionId });

  /* --- P30.F: shipped lifecycle primitives, behavior-neutral defaults ----- */
  const lifecycle = createLifecycle();
  lifecycle.PermissionDenied.register(() => ({ retry: false }));
  lifecycle.PromptExpansion.register(() => ({ block: false }));
  lifecycle.PostToolBatch.register(() => ({ ok: true }));

  /* --- fail-soft global seams for browser-safe consumers ------------------ */
  // ui/web/console/chat/approvals.js (denial path) and commands/registry.js
  // (resolve path) must stay importable from the browser bundle, so they
  // reach the mounted lifecycle through these optional seams (absent seam
  // => consumer behavior unchanged).
  globalThis.__jexiP30PermissionDenied = {
    decide: (request) => lifecycle.PermissionDenied.decide(request),
    handle: (request, opts) => lifecycle.PermissionDenied.handle(request, opts),
    register: (next) => lifecycle.PermissionDenied.register(next),
  };
  globalThis.__jexiP30PromptExpansion = {
    decide: (input) => lifecycle.PromptExpansion.decide(input),
    register: (next) => lifecycle.PromptExpansion.register(next),
  };

  const mounted = {
    emit,
    register,
    fireSessionEnd,
    journal: () => journal.map((entry) => JSON.parse(JSON.stringify(entry))),
    counts: () => ({ catalog: catalogCount, wired: mappedEvents.length, stubs: stubEvents.length }),
    wiredEvents: () => [...mappedEvents],
    stubEvents: () => [...stubEvents],
    lifecycle: {
      permissionDenied: {
        decide: (request) => lifecycle.PermissionDenied.decide(request),
        handle: (request, opts) => lifecycle.PermissionDenied.handle(request, opts),
        register: (next) => lifecycle.PermissionDenied.register(next),
      },
      promptExpansion: {
        decide: (input) => lifecycle.PromptExpansion.decide(input),
        register: (next) => lifecycle.PromptExpansion.register(next),
      },
      postToolBatch: {
        run: (tools, opts) => lifecycle.PostToolBatch.run(tools, opts),
        emitted: () => lifecycle.PostToolBatch.emitted(),
        register: (next) => lifecycle.PostToolBatch.register(next),
      },
    },
  };
  state.mounted = mounted;
  return mounted;
}

/** Probe/accessor read path (null before mount). */
export function hooksRuntime() {
  return state.mounted;
}
