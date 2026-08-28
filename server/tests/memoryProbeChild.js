/**
 * JEXI OS — memory persistence probe child (Build 68).
 *
 * Runs `memoryPersistenceProbe()` in a FRESH process = a fresh "boot".
 * The parent test spawns this once per boot with a different
 * RENDER_INSTANCE_ID (and optionally REDIS_URL + DATA_DIR), so restart/
 * redeploy survival can be PROVEN: a later boot must see stamps left by an
 * earlier boot in the persistence backend (disk and/or Redis).
 *
 * Env vars read by the parent:
 *   REDIS_URL           → optional; when set the real ioredis path is exercised
 *   RENDER_INSTANCE_ID  → this boot's identity (what the probe stamps)
 *   DATA_DIR            → where disk stamps land (fresh tmp per child)
 *
 * Output: the full probe JSON as the LAST line of stdout (imports may log
 * earlier), plus `_isRedisActive` so the parent can assert the real status.
 */
import fs from 'fs';
import { memoryPersistenceProbe, redisBootProbe, hydrateFromRedis, isRedisActive } from '../src/services/MemoryManager.js';

const probe = await memoryPersistenceProbe();
// B158 — the Redis side of the durability proof: boot-stamps + previous-boot
// evidence from a real (throwaway) ioredis connection.
probe.redis = await redisBootProbe();
// Exercise the REAL app path too (hydrate initializes the app client).
try { await hydrateFromRedis(); } catch { /* probe still reports honestly */ }
probe._isRedisActive = isRedisActive();
const redisProven = Boolean(probe.redis && probe.redis.configured && probe.redis.connected && probe.redis.previousBootsSeen.length > 0);
probe.persistent = Boolean(probe.persistentDisk) || redisProven;
if (redisProven) probe.note = `Redis-backed persistence PROVEN — ${probe.redis.previousBootsSeen.length} previous boot stamp(s) survived in Redis across processes. ${probe.note || ''}`;
// B158 — a configured-but-broken Redis is reported BY NAME, never as a
// generic "not proven" (the operator must see the actual failure).
if (probe.redis && probe.redis.configured && !probe.redis.connected) {
  probe.note = `Redis connection failed: ${probe.redis.error || 'unknown error'} — ${probe.note || ''}`;
}
fs.writeSync(1, JSON.stringify(probe) + '\n');
process.exit(0);
