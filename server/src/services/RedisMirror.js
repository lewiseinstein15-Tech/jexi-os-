/**
 * B217 — REDIS MIRROR: survive the free-tier ephemeral disk.
 *
 * The incident (2026-09-04): Render free hibernated the brain; the wake got a
 * FRESH container disk and every mission record, work graph, lesson, world
 * observation and chat transcript under DATA_DIR was gone. (Redis-backed
 * memory survived — the external store is the pattern that works.)
 *
 * This module mirrors the ephemeral store directories to Redis:
 *
 *   DATA_DIR/missions/**   (missions, work graphs, event logs, lessons)
 *   DATA_DIR/world/**      (B215 world state)
 *   DATA_DIR/conversations/** (chat transcripts)
 *
 * HOW (deliberately NON-INVASIVE — the B211 persistence cores are not touched):
 *   - a periodic SYNC (default 30s) pushes files whose mtime changed since
 *     the last sync (whole-file SET, TTL 45 days, refreshed on every sync);
 *   - on boot, HYDRATE writes back any mirrored file that is MISSING on disk
 *     (disk always wins when a file exists — hydrate never overwrites);
 *   - everything is best-effort: no Redis (local dev, tests without REDIS_URL)
 *     = honest no-op with a recorded reason, never a crash.
 *
 * RPO: at most one sync interval (30s) of writes. The mission runner
 * checkpoints on every mutation, so a wake restores to the last synced
 * checkpoint and boot recovery (B211) takes it from there.
 */

import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '../config.js';

const MIRRORED_DIRS = ['missions', 'world', 'conversations'];
const KEY_PREFIX = 'jexi:mirror:';
const TTL_SECONDS = 45 * 24 * 3600; // 45 days, refreshed on every sync
const SYNC_INTERVAL_DEFAULT = 30 * 1000;

let __synced = new Map();   // relPath → mtimeMs at last successful sync
let __timer = null;
let __clientGetter = null;  // test seam: async () => redisClient|null
const status = {
  active: false, reason: null, keys: 0, lastSyncAt: null, lastSyncFiles: 0,
  lastHydrateAt: null, lastHydrateFiles: 0, errors: 0,
};

/** Test seam + production wiring: inject the redis client getter. */
export function setRedisClientGetter(fn) { __clientGetter = fn; }

async function getClient() {
  if (__clientGetter) return __clientGetter();
  try {
    const mod = await import('./MemoryManager.js');
    return await mod.getRedis(); // returns null when REDIS_URL is unset/inactive
  } catch { return null; }
}

function relOf(absPath) { return path.relative(DATA_DIR, absPath).split(path.sep).join('/'); }

/** All mirrorable files (json/jsonl) under the mirrored dirs, with mtimes. */
function scanMirrorable() {
  const out = [];
  for (const dir of MIRRORED_DIRS) {
    const root = path.join(DATA_DIR, dir);
    if (!fs.existsSync(root)) continue;
    const walk = (d) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(json|jsonl)$/i.test(e.name)) out.push(p);
      }
    };
    walk(root);
  }
  return out;
}

/** Push every changed file. Returns the number of files pushed. */
export async function syncMirror({ force = false } = {}) {
  const client = await getClient();
  if (!client) { status.reason = status.reason || 'redis unavailable (no REDIS_URL or connection failed)'; return 0; }
  let pushed = 0;
  for (const file of scanMirrorable()) {
    const rel = relOf(file);
    const mtime = fs.statSync(file).mtimeMs;
    if (!force && __synced.get(rel) === mtime) continue; // unchanged since last sync
    try {
      await client.set(KEY_PREFIX + rel, fs.readFileSync(file, 'utf8'), 'EX', TTL_SECONDS);
      __synced.set(rel, mtime);
      pushed += 1;
    } catch (e) {
      status.errors += 1;
      status.reason = `sync error: ${String(e.message || e).slice(0, 120)}`;
    }
  }
  status.active = true;
  status.reason = null;
  status.lastSyncAt = new Date().toISOString();
  status.lastSyncFiles = pushed;
  status.keys = __synced.size;
  return pushed;
}

/** Boot-time restore: write back mirrored files that are MISSING on disk. */
export async function hydrateMirroredDirs() {
  const client = await getClient();
  if (!client) { status.reason = status.reason || 'redis unavailable (no REDIS_URL or connection failed)'; return 0; }
  let restored = 0;
  let cursor = '0';
  do {
    let page;
    if (typeof client.scan === 'function') {
      const r = await client.scan(cursor, 'MATCH', KEY_PREFIX + '*', 'COUNT', 200);
      cursor = r[0]; page = r[1];
    } else { // ioredis-style
      const r = await client.scan(cursor, 'MATCH', KEY_PREFIX + '*', 'COUNT', 200);
      cursor = String(r.cursor ?? r[0]); page = r.keys ?? r[1] ?? [];
    }
    for (const key of page) {
      const rel = String(key).startsWith(KEY_PREFIX) ? String(key).slice(KEY_PREFIX.length) : null;
      if (!rel || !MIRRORED_DIRS.some((d) => rel.startsWith(d + '/'))) continue;
      const abs = path.join(DATA_DIR, rel);
      try {
        if (fs.existsSync(abs)) continue; // disk wins — hydrate never overwrites
        const content = await client.get(key);
        if (content == null) continue;
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        const tmp = `${abs}.tmp-${Date.now()}`;
        fs.writeFileSync(tmp, content);
        fs.renameSync(tmp, abs);
        restored += 1;
      } catch (e) {
        status.errors += 1;
        status.reason = `hydrate error: ${String(e.message || e).slice(0, 120)}`;
      }
    }
  } while (cursor !== '0' && cursor !== 0);
  status.active = true;
  status.lastHydrateAt = new Date().toISOString();
  status.lastHydrateFiles = restored;
  return restored;
}

/** Start the periodic sync (idempotent). */
export function startMirrorLoop(intervalMs = SYNC_INTERVAL_DEFAULT) {
  if (__timer) return;
  const tick = async () => { try { await syncMirror(); } catch { /* recorded in status */ } };
  __timer = setInterval(tick, intervalMs);
  __timer.unref?.(); // never hold the process open on its own
  tick(); // immediate first sync
}

export function mirrorStatus() {
  return { ...status, dirs: MIRRORED_DIRS, syncedKeys: __synced.size };
}

/** Test helper: reset module state between cases. */
export function __resetForTests() {
  __synced = new Map();
  if (__timer) { clearInterval(__timer); __timer = null; }
  __clientGetter = null;
  Object.assign(status, { active: false, reason: null, keys: 0, lastSyncAt: null, lastSyncFiles: 0, lastHydrateAt: null, lastHydrateFiles: 0, errors: 0 });
}
