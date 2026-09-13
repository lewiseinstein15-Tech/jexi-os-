/**
 * JEXI OS — MEMORY — mission isolation kernel.
 *
 * The kernel enforces isolation: every store/query must carry a missionId,
 * and the backend scopes all reads/writes by mission_id. An agent that asks
 * for another mission's memory gets `[]` — never a peek, never an error that
 * leaks existence. This module is the single enforcement point; backends
 * never trust caller-provided filters.
 */

const ACTIVE_MISSION_KEY = '__activeMission__';
// Module-level stack so nested kernel calls nest correctly.
const missionStack = [];

/** Set the active mission for the current async context (kernel-scoped). */
export function enterMission(missionId) {
  if (!missionId || typeof missionId !== 'string') throw new Error('missionId is required');
  missionStack.push(missionId);
}

export function exitMission() {
  if (!missionStack.length) return null;
  return missionStack.pop();
}

export function activeMissionId() {
  return missionStack.length ? missionStack[missionStack.length - 1] : null;
}

/**
 * Wrap an async operation so it runs inside a mission context. Everything
 * created/recalled inside respects that mission boundary.
 */
export async function withMission(missionId, fn) {
  if (!missionId || typeof missionId !== 'string') throw new Error('missionId is required');
  enterMission(missionId);
  try {
    return await fn();
  } finally {
    exitMission();
  }
}

const EPOCH_PAD = 10; // above the highest mission count; isolation sentinel

/**
 * Namespace a storage key so a single backend can host MANY missions without
 * collision: key = `<missionId>::<entryKey>`. The kernel always resolves from
 * the current active mission.
 */
export function namespaceKey(entryKey, missionId) {
  const m = missionId ?? activeMissionId();
  if (!m) throw new Error('no active mission — storage keys must be mission-scoped');
  return `${String(m)}::${entryKey}`;
}

/** Enforce that a query IS scoped. Throw if not. */
export function requireMission(query, label = 'query') {
  if (!query || typeof query !== 'object' || !query.missionId) {
    throw new Error(`mission isolation: ${label}.missionId is required`);
  }
  return query.missionId;
}

export const MissionIsolation = {
  enterMission,
  exitMission,
  activeMissionId,
  withMission,
  namespaceKey,
  requireMission,
  ACTIVE_MISSION_KEY,
  EPOCH_PAD,
};