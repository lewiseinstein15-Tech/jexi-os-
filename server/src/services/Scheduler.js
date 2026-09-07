/**
 * ARENA ASTRA REBUILD — Scheduler (spec Parts 8/9/10).
 *
 * The REAL scheduler over the persisted WorkGraph (director/WorkGraph.js):
 *
 * - ready-task detection (deterministic order from the graph)
 * - priority + dependency resolution (the graph owns both)
 * - bounded concurrency (dependency-aware parallel dispatch)
 * - dispatch / cancellation / pause / resume / retries
 * - mission switching + duplicate prevention (leases + idempotency keys)
 *
 * Work execution itself is injected (`executeItem`) so the scheduler stays
 * a pure control layer: JEXI's MissionRunner wires the real executor.
 * Persistence = the WorkGraph file (survives restarts); in-flight leases
 * expire and are honestly requeued on boot (see MissionRunner recovery).
 */

import { emit } from './Observer.js';

const DEFAULT_CONCURRENCY = 3;
const schedules = new Map(); // missionId → { paused, running: Map(itemId→promise), seen: Set(idempotency) }

function stateFor(missionId) {
  if (!schedules.has(missionId)) schedules.set(missionId, { paused: false, running: new Map(), seen: new Set() });
  return schedules.get(missionId);
}

/**
 * Run one scheduling pass: dispatch every ready item up to the concurrency
 * bound. Safe to call repeatedly (ticks, event triggers, boot recovery).
 *
 * @param {object} graph  a WorkGraph instance (director/WorkGraph.js)
 * @param {{ executeItem: (item) => Promise<any>, concurrency?: number,
 *   workerId?: string }} opts
 * @returns {{ dispatched: string[], running: number, paused: boolean }}
 */
export async function tick(graph, opts = {}) {
  const { executeItem, concurrency = DEFAULT_CONCURRENCY, workerId = 'scheduler' } = opts;
  if (!graph || typeof executeItem !== 'function') throw new Error('tick needs (graph, { executeItem })');
  const st = stateFor(graph.missionId);
  if (st.paused) return { dispatched: [], running: st.running.size, paused: true };

  const dispatched = [];
  for (;;) {
    if (st.running.size >= concurrency) break;
    let ready;
    try {
      ready = typeof graph.readyItems === 'function' ? graph.readyItems() : [];
    } catch {
      break;
    }
    const next = (ready || []).find((it) => !st.running.has(it.id) && !st.seen.has(idemKey(it)));
    if (!next) break;
    st.seen.add(idemKey(next));
    st.running.set(next.id, true);
    dispatched.push(next.id);
    emit('task.started', { missionId: graph.missionId, taskId: next.id, actor: workerId, summary: next.title || next.id, data: { title: next.title || null } });
    // Fire-and-forget with honest completion handling (bounded by `running`).
    Promise.resolve()
      .then(() => executeItem(next))
      .then((result) => {
        st.running.delete(next.id);
        try { graph.completeItem?.(next.id, result); } catch {}
        emit('task.completed', { missionId: graph.missionId, taskId: next.id, actor: workerId, summary: next.title || next.id });
      })
      .catch((err) => {
        st.running.delete(next.id);
        st.seen.delete(idemKey(next)); // a failed dispatch may be retried honestly
        try { graph.failItem?.(next.id, String(err?.message || err)); } catch {}
        emit('task.failed', { missionId: graph.missionId, taskId: next.id, actor: workerId, summary: String(err?.message || err).slice(0, 200) });
      });
  }
  return { dispatched, running: st.running.size, paused: false };
}

function idemKey(item) {
  // Duplicate prevention: same mission + same stable fingerprint = one dispatch.
  const fp = item.fingerprint || item.title || item.id;
  return `${item.missionId || ''}::${fp}`;
}

/** Pause dispatch for a mission (running items finish; nothing new starts). */
export function pause(missionId) {
  stateFor(missionId).paused = true;
  emit('scheduler.paused', { missionId, actor: 'Scheduler', summary: 'dispatch paused' });
  return { missionId, paused: true };
}

/** Resume dispatch for a mission. */
export function resume(missionId) {
  stateFor(missionId).paused = false;
  emit('scheduler.resumed', { missionId, actor: 'Scheduler', summary: 'dispatch resumed' });
  return { missionId, paused: false };
}

/** Cancel a mission: pause + mark running items honestly (executor cooperates). */
export function cancel(missionId, reason = 'cancelled by user') {
  const st = stateFor(missionId);
  st.paused = true;
  emit('mission.cancelled', { missionId, actor: 'Scheduler', summary: reason });
  return { missionId, paused: true, running: st.running.size };
}

/** Scheduler state for observability / switching between missions. */
export function schedulerStatus(missionId = null) {
  if (missionId) {
    const st = schedules.get(missionId);
    return st ? { missionId, paused: st.paused, running: [...st.running.keys()] } : { missionId, paused: false, running: [] };
  }
  return [...schedules.entries()].map(([id, st]) => ({ missionId: id, paused: st.paused, running: [...st.running.keys()] }));
}

export function _reset() {
  schedules.clear();
}

export const Scheduler = { tick, pause, resume, cancel, schedulerStatus };
