/**
 * JEXI OS — HUD STATUS CONTRACT — consumer (Phase 7 F).
 *
 * The read side of the contract. The producer publishes; the consumer is
 * what the UI reads:
 *
 *   GET  /api/hud        → currentPayload()   (builds + publishes once if cold)
 *   SSE  /api/hud/stream → subscribe()        (pushed on EVERY change)
 *
 * The consumer REFUSES payloads that fail validation or carry a foreign
 * version — a refused payload is never handed to a panel (probe P10).
 * This module is transport-free on purpose: the Express wiring lives in
 * server/src/routes/hud.js, so the same consumer serves tests, probes,
 * and any future surface without dragging a web framework in here.
 */

import { validateHud, acceptHudOrThrow } from './validator.js';
import { HUD_VERSION } from './schema.js';
import * as producer from './producer.js';

const MAX_SUBSCRIBERS = 100;
const subscribers = new Set();
let wired = false;

/**
 * Wire the producer to the Observer bus (idempotent). Every bus event is
 * a potential state change; verification.* events also drive checks.local,
 * and mission failures raise risk attention. Returns a status object.
 */
export async function wireHud() {
  if (wired) return hudInfo();
  wired = true;
  try {
    const obs = await import('../../server/src/services/Observer.js');
    obs.subscribe((evt) => {
      try {
        const type = String(evt?.type || '');
        if (type === 'hud.updated') return; // never react to our own emission (publish loop guard)
        if (type === 'verification.started') producer.noteCheck('local', 'running');
        else if (type === 'verification.completed') {
          const verdict = String(evt?.data?.verdict || evt?.data?.result || '').toLowerCase();
          producer.noteCheck('local', verdict === 'pass' ? 'pass' : verdict === 'fail' ? 'fail' : 'pass');
        } else if (type === 'mission.failed') producer.noteRisk('mission.failed', 'critical');
        else if (type === 'mission.completed') producer.noteRisk('mission.completed', 'info');
        producer.schedulePublish(`bus:${type || 'event'}`);
      } catch { /* a bad event never breaks the bus */ }
    });
  } catch { /* standalone probe without the server — checks stay manual */ }
  // first payload so GET /api/hud never cold-starts
  await producer.publish('boot').catch(() => { /* build may fail without the server; GET retries */ });
  return hudInfo();
}

/**
 * The current HUD payload. Cold path builds + publishes once; warm path
 * returns the last published payload. Throws only if the freshly built
 * payload fails validation (P10) — the route turns that into an error.
 */
export async function currentPayload() {
  await wireHud();
  const snap = producer.snapshot();
  if (snap.payload) return snap.payload;
  const { payload } = await producer.publish('cold-read');
  return payload;
}

/** Subscribe to every published payload (SSE fan-out). Returns unsubscribe. */
export function subscribe(fn) {
  if (typeof fn !== 'function' || subscribers.size >= MAX_SUBSCRIBERS) return () => {};
  subscribers.add(fn);
  return () => { subscribers.delete(fn); };
}

/** Internal: producer → consumer bridge (called by the route on boot). */
export function bindProducer() {
  producer.onPublish((revision, payload) => {
    for (const fn of subscribers) {
      try { fn(revision, payload); } catch { /* never break the fan-out */ }
    }
  });
}

/**
 * Consumer-side acceptance: validate + version-pin, then hand over.
 * Refusal THROWS with code HUD_REFUSED — the transport renders nothing.
 */
export function consume(payload) {
  return acceptHudOrThrow(payload);
}

/** Diagnostics for /api/hud and tests. */
export function hudInfo() {
  const snap = producer.snapshot();
  return {
    version: HUD_VERSION,
    wired,
    revision: snap.revision,
    publishedAt: snap.publishedAt,
    reason: snap.reason,
    subscribers: subscribers.size,
    hasPayload: Boolean(snap.payload),
  };
}

/** Test/diagnostic reset. */
export function _reset() {
  subscribers.clear();
  wired = false;
  producer._reset();
}

export { validateHud };
