/**
 * B136 — WORKSPACE ENTITY (DeepSeek Harness `packages/workspace/workspace`
 * mirror, JEXI-branded).
 *
 * The single workspace entity: a `.jexi/workspace.json` record inside the
 * workspace root carrying { name, createdAt, updatedAt, roots, sessions },
 * mutated in place with updatedAt stamping. Paths resolve canonically;
 * `pathInWorkspace` is the canonical containment check used by the fs
 * sandbox seam.
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

export const WORKSPACE_META_DIR = '.jexi';
export const WORKSPACE_ENTITY_FILE = path.join(WORKSPACE_META_DIR, 'workspace.json');

function entityFile(workspaceRoot) {
  return path.join(path.resolve(workspaceRoot), WORKSPACE_ENTITY_FILE);
}

function defaultRecord(workspaceRoot, name) {
  return {
    id: `ws-${crypto.randomUUID().slice(0, 12)}`,
    name: String(name || path.basename(path.resolve(workspaceRoot))).slice(0, 60),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    roots: [path.resolve(workspaceRoot)],
    sessions: [],
  };
}

/** Create (or re-read) the workspace entity. Returns the record. */
export function initWorkspaceEntity(workspaceRoot, { name = null } = {}) {
  try {
    const file = entityFile(workspaceRoot);
    if (fs.existsSync(file)) {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf-8'));
      if (parsed && parsed.id) return parsed;
    }
    const rec = defaultRecord(workspaceRoot, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(rec, null, 2), 'utf-8');
    return rec;
  } catch (e) {
    return { ok: false, error: (e && e.message) || String(e) };
  }
}

/** Read the workspace entity (null when absent). */
export function readWorkspaceEntity(workspaceRoot) {
  try {
    const file = entityFile(workspaceRoot);
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch { return null; }
}

/** Mutate the entity durably (updatedAt stamped exactly once). */
export function updateWorkspaceEntity(workspaceRoot, patch) {
  const existing = readWorkspaceEntity(workspaceRoot) || defaultRecord(workspaceRoot);
  const next = { ...existing, ...(patch || {}), updatedAt: Date.now() };
  try {
    fs.mkdirSync(path.dirname(entityFile(workspaceRoot)), { recursive: true });
    fs.writeFileSync(entityFile(workspaceRoot), JSON.stringify(next, null, 2), 'utf-8');
    return { ok: true, entity: next };
  } catch (e) {
    return { ok: false, error: (e && e.message) || String(e) };
  }
}

/** Register a session id on the entity (bounded list). */
export function attachSession(workspaceRoot, sessionId) {
  const existing = readWorkspaceEntity(workspaceRoot) || defaultRecord(workspaceRoot);
  const sessions = (existing.sessions || []).filter((s) => s !== sessionId);
  sessions.push(sessionId);
  return updateWorkspaceEntity(workspaceRoot, { sessions: sessions.slice(-200) });
}

/** Canonical containment: is `p` inside the workspace root? */
export function pathInWorkspace(workspaceRoot, p) {
  const root = path.resolve(workspaceRoot);
  const target = path.resolve(String(p || ''));
  if (target === root) return true;
  const prefix = root.endsWith(path.sep) ? root : root + path.sep;
  return target.startsWith(prefix);
}

/** Full status for /api/workspace/entity. */
export function workspaceEntityStatus(workspaceRoot) {
  const entity = readWorkspaceEntity(workspaceRoot);
  return {
    ok: true,
    workspaceRoot: path.resolve(workspaceRoot),
    entity: entity ? { id: entity.id, name: entity.name, createdAt: entity.createdAt, updatedAt: entity.updatedAt, roots: entity.roots, sessionCount: (entity.sessions || []).length } : null,
  };
}
