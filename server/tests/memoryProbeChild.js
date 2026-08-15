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
import { memoryPersistenceProbe, isRedisActive } from '../src/services/MemoryManager.js';

const probe = await memoryPersistenceProbe();
probe._isRedisActive = isRedisActive();
fs.writeSync(1, JSON.stringify(probe) + '\n');
process.exit(0);
