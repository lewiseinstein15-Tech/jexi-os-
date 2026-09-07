/**
 * ARENA ASTRA REBUILD — Observer (spec Part 20).
 *
 * ONE unified runtime event bus. Every important event flows through here:
 *
 *   mission.created / mission.updated / mission.completed / mission.failed
 *   task.started / task.completed / task.failed
 *   model.requested / model.completed / model.failed
 *   tool.called / tool.completed / tool.failed
 *   agent.called / agent.completed
 *   browser.loaded / browser.action
 *   verification.started / verification.completed
 *   replan.started / replan.completed
 *   steering.received / steering.applied
 *
 * Powers: telemetry, UI (live feed), debugging, performance analysis, learning.
 *
 * Design:
 * - synchronous fan-out to in-memory subscribers (bounded, never throws)
 * - bounded ring buffer keeps the last N events for /api/observer/recent
 * - best-effort persistence hooks into the existing EventLog/Telemetry
 *   (dynamic import, never a hard dependency — observer must never break boot)
 * - event shape: { t, type, missionId?, taskId?, actor?, summary?, data? }
 */

const MAX_BUFFER = 500;
const MAX_SUBSCRIBERS = 100;

const buffer = []; // ring buffer (oldest-first)
const subscribers = new Set();
let seq = 0;

const VALID_RE = /^[a-z0-9]+(\.[a-z0-9_-]+)+$/i;

function safeClone(v) {
  try {
    return JSON.parse(JSON.stringify(v ?? null));
  } catch {
    return null;
  }
}

/**
 * Emit a typed runtime event. Never throws, never blocks.
 * @returns the stored event (or null if the type was invalid)
 */
export function emit(type, payload = {}) {
  try {
    if (typeof type !== 'string' || !VALID_RE.test(type)) return null;
    const evt = {
      id: `ev-${Date.now().toString(36)}-${String(++seq).padStart(4, '0')}`,
      t: new Date().toISOString(),
      type,
      missionId: payload.missionId ?? null,
      taskId: payload.taskId ?? null,
      actor: payload.actor ?? null,
      summary: typeof payload.summary === 'string' ? payload.summary.slice(0, 500) : '',
      data: safeClone(payload.data ?? null),
    };
    buffer.push(evt);
    if (buffer.length > MAX_BUFFER) buffer.splice(0, buffer.length - MAX_BUFFER);
    for (const fn of subscribers) {
      try { fn(evt); } catch { /* a bad subscriber never breaks the bus */ }
    }
    // best-effort persistence into the existing stores (fire-and-forget)
    persistBestEffort(evt).catch(() => {});
    return evt;
  } catch {
    return null;
  }
}

async function persistBestEffort(evt) {
  try {
    // EventLog is the durable chat/mission log; Telemetry is the metrics sink.
    // Both are optional here — missing modules must not fail the emit.
    const mod = await import('./EventLog.js').catch(() => null);
    const logFn = mod && (mod.logEvent || mod.appendEvent || mod.record);
    if (typeof logFn === 'function') {
      try { await logFn({ type: evt.type, summary: evt.summary, missionId: evt.missionId, taskId: evt.taskId, data: evt.data }); } catch {}
    }
  } catch {}
}

/** Subscribe to all events. Returns an unsubscribe function. */
export function subscribe(fn) {
  if (typeof fn !== 'function') return () => {};
  if (subscribers.size >= MAX_SUBSCRIBERS) return () => {};
  subscribers.add(fn);
  return () => { subscribers.delete(fn); };
}

/** Recent events, newest-first. Filter by type prefix and/or missionId. */
export function recent({ limit = 50, typePrefix = '', missionId = '' } = {}) {
  const n = Math.max(1, Math.min(Number(limit) || 50, MAX_BUFFER));
  let out = buffer;
  if (typePrefix) out = out.filter((e) => e.type.startsWith(typePrefix));
  if (missionId) out = out.filter((e) => e.missionId === missionId);
  return out.slice(-n).reverse();
}

/** Counts by top-level namespace (mission.*, model.*, tool.*, …). */
export function stats() {
  const byNamespace = {};
  for (const e of buffer) {
    const ns = e.type.split('.')[0];
    byNamespace[ns] = (byNamespace[ns] || 0) + 1;
  }
  return { buffered: buffer.length, subscribers: subscribers.size, byNamespace };
}

/** Clear the buffer (tests / maintenance). */
export function _clear() {
  buffer.length = 0;
}
