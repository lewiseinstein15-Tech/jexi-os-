import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { DatabaseSync } from 'node:sqlite'; // Phase 3 — SQLite-backed memory core (built-in, no deps)
import { MEMORY_FILE, KNOWLEDGE_DIR, WORKSPACE_DIR, DATA_DIR } from '../config.js';
import { generateContent, resolveKeys, embedText } from './LLMClient.js';
import { appendEvent } from './EventLog.js'; // B78 — every compaction is a first-class event

/**
 * JEXI OS Memory Core
 * -------------------
 * Upgraded memory architecture (patterns from Mem0, MemGPT/Letta, Stanford
 * Generative Agents, Zep, A-MEM):
 *
 *   WRITE:   importance assigned by memory type (+ regex-gated user-fact
 *            extraction from every user message — Mem0-style, zero LLM cost)
 *   RETRIEVE: three-pillar score = 0.40·relevance (tf-idf cosine) +
 *            0.35·recency (0.99^hours) + 0.25·importance — instead of raw
 *            keyword counting
 *   CONSOLIDATE: near-duplicate memories merge on boot + when a store overflows
 *   FORGET:  every store is capped and prunes its lowest-value entries
 *
 * PERSISTENCE LAYERS (in order):
 *  1. Local JSON file (server/data/memory.json) — always used, fast
 *  2. Redis (REDIS_URL, e.g. Upstash) — optional, survives redeploys on Render
 */

const MEMORY_REDIS_KEY = 'jexi:memory';
const REDIS_BOOTSTAMPS_KEY = 'jexi:bootstamps';
const REDIS_BOOT_TTL = 60 * 60 * 24 * 30; // 30 days — same window as the memory mirror

const DEFAULT_MEMORY = {
  userProfile: { name: '', location: '', interests: [] },
  userFacts: [],            // { fact, label, importance, date, lastAccess, accessCount } — episodic→semantic
  chatHistory: [],          // { role, text, time }
  internetKnowledge: [],    // { topic, answer, sources[], date, importance, lastAccess, accessCount }
  codingKnowledge: [],      // { topic, language, solution, files[], date, importance, lastAccess, accessCount }
  learnedAnswers: [],       // { question, answer, date }  (distilled Q&A)
  bookLibrary: [],          // { name, file, chars, size, date, text } — the user's own books
  conversationSummary: '',  // rolling compressed summary of older turns (Context Manager)
  episodes: [],             // { ask, reply, time } — memorable exchanges across sessions (Archivist)
};

// ---------------------------------------------------------------------------
// Importance by memory type (1-5): profile/facts are the most precious,
// code solutions matter more than a one-off research answer.
// ---------------------------------------------------------------------------
const IMPORTANCE = { fact: 4, profile: 5, coding: 4, internet: 3, chat: 1 };

const CAPS = { internetKnowledge: 150, codingKnowledge: 100, learnedAnswers: 100, userFacts: 60 };

let cache = null;
let redisClient = null;
// Immutable intent: whether REDIS_URL was present in the environment at boot.
// `redisEnabled` can be flipped off if client init fails; `redisConfigured`
// stays true so health reports "configured but broken" instead of "unset".
const redisConfigured = Boolean(process.env.REDIS_URL);
let redisEnabled = redisConfigured;
// Real connection state (not "a client object exists"): 'unset' | 'connecting' |
// 'connected' | 'error'. Updated by every actual Redis command so /api/health
// and the persistence probe report what is really happening.
let redisStatus = redisEnabled ? 'connecting' : 'unset';
let redisLastError = '';
let consolidated = false; // run the merge pass once per process (on boot)

/* ------------------------------------------------------------------ */
/* B66 — per-session conversation memory (Orchestrator-Workers 3d).     */
/*                                                                      */
/* The global memory.json stays as the durable knowledge core, but chat  */
/* HISTORY is now scoped per conversation (session): each session gets   */
/* its own history file under DATA_DIR/sessions/, so two users (or two   */
/* devices) never see each other's threads, and a session survives       */
/* restarts within the same DATA_DIR.                                    */
/* ------------------------------------------------------------------ */
const SESSIONS_DIR = path.join(DATA_DIR, 'sessions');
let activeSession = null; // set per request by the chat handler

/** Hash a raw session id (may contain IPs/colons) into a safe filename. */
function sessionFile(id) {
  const safe = crypto.createHash('sha1').update(String(id || 'default')).digest('hex').slice(0, 24);
  return path.join(SESSIONS_DIR, `${safe}.json`);
}

/** Set the active session for the current request (chat handler). */
export function setActiveSession(id) {
  activeSession = id ? String(id).slice(0, 120) : null;
  return activeSession;
}

export function clearActiveSession() { activeSession = null; }
export function getActiveSession() { return activeSession; }

function loadSessionHistory() {
  if (!activeSession) return null;
  try {
    const p = sessionFile(activeSession);
    if (fs.existsSync(p)) {
      const parsed = JSON.parse(fs.readFileSync(p, 'utf-8'));
      return Array.isArray(parsed.history) ? parsed.history : [];
    }
  } catch (e) { /* fall back to global */ }
  return [];
}

function saveSessionHistory(history) {
  if (!activeSession) return;
  try {
    fs.mkdirSync(SESSIONS_DIR, { recursive: true });
    fs.writeFileSync(sessionFile(activeSession), JSON.stringify({ session: activeSession, history }, null, 2), 'utf-8');
  } catch (e) { /* memory must never break the chat */ }
}

/** Bound a Redis command with a hard timeout so a dead/slow server can never
 * hang the health probe. Returns the command's result or throws on timeout. */
function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`Redis command timed out after ${ms}ms`)), ms)),
  ]);
}

/**
 * B66+B68 — persistence probe: prove memory survives a restart/redeploy. Each
 * process stamps BOTH persistence layers — DATA_DIR on disk AND Redis (when
 * REDIS_URL is configured). The probe then reports whether stamps from
 * PREVIOUS boots are still present after a restart/redeploy:
 *   - disk stamps survived  => persistent disk mounted at DATA_DIR
 *   - Redis stamps survived => REDIS_URL is a fully valid persistence backend
 *     (memory survives redeploys even without a disk)
 * Async because it performs a real Redis ping + stamp round-trip.
 */
export async function memoryPersistenceProbe() {
  const id = process.env.RENDER_INSTANCE_ID || process.env.POD_NAME || `boot-${Math.random().toString(36).slice(2, 10)}`;
  const disk = { previousBootsSeen: [], persistent: false };
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const mine = path.join(DATA_DIR, `.jexi-boot-${String(id).replace(/[^a-zA-Z0-9_-]/g, '')}.json`);
    fs.writeFileSync(mine, JSON.stringify({ boot: new Date().toISOString(), instance: id }), 'utf-8');
    disk.previousBootsSeen = fs.readdirSync(DATA_DIR)
      .filter((f) => /^\.jexi-boot-/.test(f) && !f.endsWith(String(id).replace(/[^a-zA-Z0-9_-]/g, '') + '.json'))
      .map((f) => ({ file: f, mtime: fs.statSync(path.join(DATA_DIR, f)).mtime.toISOString() }));
    disk.persistent = disk.previousBootsSeen.length > 0;
  } catch (e) {
    disk.error = (e && e.message) || String(e);
  }
  const sessionCount = (() => {
    try { return fs.readdirSync(SESSIONS_DIR).filter((f) => f.endsWith('.json')).length; } catch (e) { return 0; }
  })();

  // --- Redis-backed persistence (B68): REDIS_URL is a first-class backend.
  // --- Stamp Redis on every probe so a redeploy can prove the stamps
  // --- survived — exactly the same evidence model as the disk stamps.
  const redis = { configured: redisConfigured, connected: false, error: '', previousBootsSeen: [] };
  if (redisConfigured) {
    const r = await getRedis();
    if (r) {
      try {
        await withTimeout(r.ping(), 5000);
        redis.connected = true;
        redisStatus = 'connected';
        redisLastError = '';
        const raw = await withTimeout(r.get(REDIS_BOOTSTAMPS_KEY), 5000);
        const stamps = (() => { try { return JSON.parse(raw || '[]'); } catch (e) { return []; } })();
        redis.previousBootsSeen = stamps
          .filter((s) => s && s.instance !== id)
          .map((s) => ({ instance: s.instance, boot: s.boot }));
        const next = [...stamps.filter((s) => s && s.instance !== id), { instance: id, boot: new Date().toISOString() }].slice(-20);
        await withTimeout(r.set(REDIS_BOOTSTAMPS_KEY, JSON.stringify(next), 'EX', REDIS_BOOT_TTL), 5000);
      } catch (e) {
        redis.error = (e && e.message) || String(e);
        redisStatus = 'error';
        redisLastError = redis.error;
      }
    } else if (redisLastError) {
      // Client init failed (invalid REDIS_URL shape, import failure): surface
      // the real reason instead of reporting a blank "not connected".
      redis.error = redisLastError;
    }
  }
  const redisPersistent = redis.connected && redis.previousBootsSeen.length > 0;
  const persistent = disk.persistent || redisPersistent;
  let note;
  if (redisPersistent) {
    note = 'Redis-backed persistence PROVEN: boot stamps from previous boots survived in Redis (REDIS_URL) — memory survives redeploys without a persistent disk';
  } else if (disk.persistent) {
    note = 'previous boot stamps survived — the memory directory is persistent across restarts';
  } else if (redis.connected) {
    note = 'Redis connected (REDIS_URL) but no previous boot stamps seen yet — Redis-backed persistence will be proven after the next restart/redeploy';
  } else if (redisConfigured && redis.error) {
    note = `REDIS_URL is configured but the Redis connection failed: ${redis.error}`;
  } else {
    note = 'no previous boot stamps found — disk persistence not yet proven (mount a persistent disk at DATA_DIR on Render, or set REDIS_URL for cross-restart memory)';
  }
  return {
    dataDir: DATA_DIR,
    instance: id,
    previousBootsSeen: disk.previousBootsSeen,
    persistentDisk: disk.persistent,
    persistent, // true when EITHER backend survived a restart
    sessionCount,
    redis: {
      configured: redisConfigured,
      connected: redis.connected,
      error: redis.error,
      previousBootsSeen: redis.previousBootsSeen,
    },
    note,
  };
}

function ensureDirs() {
  fs.mkdirSync(path.dirname(MEMORY_FILE), { recursive: true });
  fs.mkdirSync(KNOWLEDGE_DIR, { recursive: true });
}

/* ---------------- Redis (optional durable layer) ---------------- */

export async function getRedis() {
  if (!redisEnabled) return null;
  if (redisClient) return redisClient;
  try {
    // Normalize + validate the URL BEFORE constructing the client: ioredis
    // throws a bare "Invalid URL" TypeError for e.g. `redis://:6379` (empty
    // host) or leading whitespace — turn that into an actionable message the
    // probe/health endpoint can show. Never echo the value (it may contain a
    // password); only its shape/scheme is described.
    let rawUrl = String(process.env.REDIS_URL || '').trim();
    // Strip wrapping quotes ("rediss://…" / 'rediss://…' / `rediss://…`) — a
    // classic paste artifact from env files that makes the URL unparseable.
    rawUrl = rawUrl.replace(/^(['"`])([\s\S]*)\1$/, '$2').trim();
    if (!/^rediss?:\/\//i.test(rawUrl)) {
      const scheme = rawUrl.match(/^[a-zA-Z][a-zA-Z0-9+.-]*:/)?.[0] || '(the value is not a URL)'; // scheme only, never credentials
      throw new Error(`REDIS_URL does not start with redis:// or rediss:// — current value starts with "${scheme}" (expected redis://<user>:<password>@<host>:<port>)`);
    }
    if (!/^rediss?:\/\/.+/i.test(rawUrl) || rawUrl.includes('://:')) {
      throw new Error('REDIS_URL is missing its hostname — expected redis://<user>:<password>@<host>:<port>');
    }
    const { Redis } = await import('ioredis');
    redisClient = new Redis(rawUrl, {
      lazyConnect: true,
      maxRetriesPerRequest: 2,
      enableReadyCheck: true,
      connectTimeout: 8000,
      // Fail fast instead of retrying forever: a wrong/blocked URL should
      // surface in seconds, not hang the boot sequence.
      retryStrategy: (times) => Math.min(times * 200, 4000),
    });
    // ioredis emits 'error' for connection failures; without a listener it
    // throws uncaught and can crash the process. Track the real state instead.
    redisClient.on('error', (e) => {
      redisStatus = 'error';
      redisLastError = (e && e.message) || String(e);
    });
    return redisClient;
  } catch (e) {
    console.error('[Memory] Redis client failed to init, using local file only:', e.message);
    redisEnabled = false;
    redisStatus = 'error';
    redisLastError = (e && e.message) || String(e);
    return null;
  }
}

/** Load memory from Redis into the local cache (called once at boot). */
export async function hydrateFromRedis() {
  if (!redisEnabled) return false;
  const r = await getRedis();
  if (!r) return false;
  try {
    const raw = await r.get(MEMORY_REDIS_KEY);
    redisStatus = 'connected';
    redisLastError = '';
    if (raw) {
      const parsed = JSON.parse(raw);
      cache = { ...structuredClone(DEFAULT_MEMORY), ...parsed };
      migrate(cache);
      ensureDirs();
      writeMemoryFile(JSON.stringify(cache, null, 2));
      console.log('[Memory] ✓ Hydrated memory core from Redis.');
      consolidateMemory();
      return true;
    }
  } catch (e) {
    console.error('[Memory] Redis hydrate failed, using local file:', e.message);
    redisStatus = 'error';
    redisLastError = (e && e.message) || String(e);
  }
  return false;
}

async function redisPush(memory) {
  if (!redisEnabled) return;
  const r = await getRedis();
  if (!r) return;
  try {
    await r.set(MEMORY_REDIS_KEY, JSON.stringify(memory), 'EX', 60 * 60 * 24 * 30); // 30-day TTL
    redisStatus = 'connected';
    redisLastError = '';
  } catch (e) {
    console.error('[Memory] Redis write failed:', e.message);
    redisStatus = 'error';
    redisLastError = (e && e.message) || String(e);
  }
}

/** True only when Redis is configured AND a real command has succeeded. */
export function isRedisActive() {
  return redisEnabled && redisStatus === 'connected';
}

/** Diagnostic detail for /api/health and the persistence probe. */
export function redisConnectionInfo() {
  return { configured: redisConfigured, status: redisStatus, error: redisLastError };
}

/* ---------------- Local JSON store ---------------- */

/** Fill defaults on entries written by older versions (importance/recency). */
function migrate(mem) {
  const now = Date.now();
  for (const e of mem.internetKnowledge || []) {
    if (typeof e.importance !== 'number') e.importance = IMPORTANCE.internet;
    if (!e.lastAccess) { e.lastAccess = e.date || new Date(now).toISOString(); e.accessCount = 0; }
  }
  for (const e of mem.codingKnowledge || []) {
    if (typeof e.importance !== 'number') e.importance = IMPORTANCE.coding;
    if (!e.lastAccess) { e.lastAccess = e.date || new Date(now).toISOString(); e.accessCount = 0; }
  }
  for (const f of mem.userFacts || []) {
    if (typeof f.importance !== 'number') f.importance = IMPORTANCE.fact;
    if (!f.lastAccess) { f.lastAccess = f.date || new Date(now).toISOString(); f.accessCount = 0; }
  }
  if (!Array.isArray(mem.userFacts)) mem.userFacts = [];
  // Round-3 fields: conversation summary + episodes (written by older builds)
  if (typeof mem.conversationSummary !== 'string') mem.conversationSummary = '';
  if (!Array.isArray(mem.episodes)) mem.episodes = [];
}

/* ------------------------------------------------------------------ */
/* Phase 3 — SQLite backing store for the memory core.                 */
/*                                                                     */
/* The memory core (the whole JSON document) lives in a single-row key- */
/* value table in DATA_DIR/jexi-memory.db. SQLite gives us crash-safe,  */
/* atomic writes and instant start (no full-file JSON parse at boot is  */
/* required for correctness — the row read is O(1)). The legacy         */
/* memory.json file remains as (a) the one-time migration source and    */
/* (b) a mirror of every write, so downgrading or moving hosts loses    */
/* nothing. Every access goes through try/catch — memory must never     */
/* break the chat.                                                      */
/* ------------------------------------------------------------------ */

const SQLITE_FILE = path.join(DATA_DIR, 'jexi-memory.db');
const SQLITE_KEY = 'memory:core';
let db = null;

function getDb() {
  if (db) return db;
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    db = new DatabaseSync(SQLITE_FILE);
    db.exec('CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);');
    db.exec('PRAGMA journal_mode = WAL;');
    db.exec('PRAGMA synchronous = NORMAL;');
    return db;
  } catch (e) {
    console.error('[Memory] SQLite init error:', e.message);
    return null;
  }
}

function sqliteGet(key) {
  try {
    const row = getDb()?.prepare('SELECT value FROM kv WHERE key = ?').get(key);
    return row ? row.value : null;
  } catch (e) {
    console.error('[Memory] SQLite read error:', e.message);
    return null;
  }
}

function sqliteSet(key, value) {
  try {
    getDb()?.prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
    return true;
  } catch (e) {
    console.error('[Memory] SQLite write error:', e.message);
    return false;
  }
}

export function loadMemory() {
  ensureDirs();
  if (cache) return cache;

  // 1) Primary: SQLite row (fast, atomic, crash-safe).
  const sqliteRaw = sqliteGet(SQLITE_KEY);
  if (sqliteRaw) {
    try {
      const parsed = JSON.parse(sqliteRaw);
      cache = { ...structuredClone(DEFAULT_MEMORY), ...parsed };
      migrate(cache);
      if (!consolidated) consolidateMemory(); // merge near-duplicates once per boot
      return cache;
    } catch (e) {
      console.error('[Memory] SQLite parse error (falling back to file):', e.message);
    }
  }

  // 2) Migration source / fallback: the legacy JSON file. When found and the
  //    SQLite row is missing, migrate the file into SQLite once.
  try {
    if (fs.existsSync(MEMORY_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf-8'));
      cache = { ...structuredClone(DEFAULT_MEMORY), ...parsed };
      migrate(cache);
      if (!consolidated) consolidateMemory();
      sqliteSet(SQLITE_KEY, JSON.stringify(cache, null, 2)); // one-time migration
      return cache;
    }
  } catch (e) {
    console.error('[Memory] load error:', e.message);
  }
  cache = structuredClone(DEFAULT_MEMORY);
  return cache;
}

/**
 * Phase 2+3 — persistence: write to SQLite (primary) AND mirror to the
 * legacy JSON file via temp+fsync+rename (atomic, crash-safe, downgrade-safe).
 */
function writeMemoryFile(content) {
  ensureDirs();
  sqliteSet(SQLITE_KEY, content);
  const tmp = `${MEMORY_FILE}.tmp-${process.pid}-${Date.now().toString(36)}`;
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeSync(fd, content, null, 'utf-8');
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, MEMORY_FILE);
}

export function saveMemory() {
  ensureDirs();
  try {
    writeMemoryFile(JSON.stringify(loadMemory(), null, 2));
  } catch (e) {
    console.error('[Memory] save error:', e.message);
  }
  // Fire-and-forget Redis mirror — never blocks or throws
  redisPush(loadMemory()).catch(() => {});
}

export function resetCache() { cache = null; consolidated = false; }

/* ------------------------------------------------------------------ */
/* Similarity engine (pure JS tf-idf — no embeddings API needed)       */
/* ------------------------------------------------------------------ */

const STOP = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'from', 'your', 'you', 'have', 'are', 'was', 'were', 'what', 'which', 'when', 'where', 'who', 'how', 'about', 'into', 'than', 'then', 'them', 'they', 'will', 'would', 'could', 'should', 'there', 'their', 'been', 'being', 'very', 'just', 'some', 'each', 'more', 'most', 'other', 'over', 'under', 'also', 'because', 'before', 'after', 'while', 'during', 'such', 'only', 'both', 'between', 'build', 'builds', 'built', 'make', 'makes', 'made', 'app', 'apps', 'application', 'please', 'need', 'want', 'like', 'know']);

function tokenize(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w));
}

function termFreq(tokens) {
  const tf = new Map();
  for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1);
  return tf;
}

/** idf for each token across a corpus (pure JS, computed lazily per store). */
function buildIdf(docs) {
  const df = new Map();
  for (const d of docs) {
    const seen = new Set(tokenize(d));
    for (const t of seen) df.set(t, (df.get(t) || 0) + 1);
  }
  const N = Math.max(1, docs.length);
  const idf = new Map();
  for (const [t, n] of df) idf.set(t, Math.log((N + 1) / (n + 1)) + 1);
  return idf;
}

/** Cosine similarity of query vs doc, tf-idf weighted (0..1). */
export function cosineSimilarity(query, doc, idf) {
  const qTokens = tokenize(query);
  const dTokens = tokenize(doc);
  if (!qTokens.length || !dTokens.length) return 0;
  const qtf = termFreq(qTokens);
  const dtf = termFreq(dTokens);
  const idfMap = idf || buildIdf([doc]);
  let dot = 0, qn = 0, dn = 0;
  for (const [t, f] of qtf) {
    const w = idfMap.get(t) || 1;
    const qw = f * w;
    qn += qw * qw;
    const df = dtf.get(t);
    if (df) dot += qw * df * w;
  }
  for (const [t, f] of dtf) {
    const w = idfMap.get(t) || 1;
    const dw = f * w;
    dn += dw * dw;
  }
  if (!qn || !dn) return 0;
  return dot / (Math.sqrt(qn) * Math.sqrt(dn));
}

/**
 * The three-pillar score (Stanford Generative Agents):
 *   score = 0.40·relevance + 0.35·recency + 0.25·importance
 * recency = 0.99^(hours since last access) — fresh memories win.
 */
function hoursSince(iso) {
  try { return Math.max(0, (Date.now() - new Date(iso).getTime()) / 3600000); } catch (e) { return 0; }
}

export function memoryScore(query, entry, idf) {
  const relevance = cosineSimilarity(query, `${entry.topic || ''} ${entry.answer || entry.fact || ''}`, idf);
  const recency = Math.pow(0.99, hoursSince(entry.lastAccess || entry.date));
  const importance = Math.min(1, (entry.importance || IMPORTANCE.internet) / 5);
  return { score: 0.4 * relevance + 0.35 * recency + 0.25 * importance, relevance, recency, importance };
}

/* ------------------------------------------------------------------ */
/* Vector layer (TencentDB-Agent-Memory pattern: keyword BM25/tf-idf +  */
/* embedding vectors fused together, so recall is semantic not literal) */
/* ------------------------------------------------------------------ */

/** Cosine similarity of two embedding vectors (0..1 for normalized-ish vecs). */
export function vectorCosine(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || !a.length || a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (!na || !nb) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * TencentDB-style fusion of the two retrievers: 0.65·vector + 0.35·keyword.
 * Vector wins when an embedding exists; pure keyword otherwise.
 */
export function fuseScore(vector, keyword) {
  if (typeof vector !== 'number' || !Number.isFinite(vector)) return keyword || 0;
  return 0.65 * Math.max(0, vector) + 0.35 * (keyword || 0);
}

/** The canonical text to embed for a memory entry (topic + body). */
function entryText(entry) {
  return `${entry.topic || ''} ${entry.answer || entry.fact || entry.solution || ''}`.trim().slice(0, 2000);
}

/** Awaitable: embed an entry's text and store the vector on it (persisted). */
async function computeAndStoreEmb(entry, store) {
  if (entry.emb) return entry.emb;
  const text = entryText(entry);
  if (!text) return null;
  const vec = await embedText(text);
  if (!vec) return null;
  const mem = loadMemory();
  const idx = (mem[store] || []).findIndex((e) => e === entry);
  if (idx === -1) return null; // pruned or replaced meanwhile
  mem[store][idx].emb = vec;
  saveMemory();
  return vec;
}

/** Fire-and-forget wrapper — a failed embedding never breaks a save. */
function attachEmbedding(entry, store) {
  computeAndStoreEmb(entry, store).catch(() => {});
}

/**
 * Boot-time pass: attach embeddings to entries saved before the vector layer
 * existed (bounded to the first 50 per boot so startup stays instant).
 * Returns how many got an embedding. No-op without a Groq key.
 */
export async function backfillEmbeddings() {
  const { groqKey } = resolveKeys();
  if (!groqKey) return 0;
  const mem = loadMemory();
  const targets = [];
  for (const store of ['internetKnowledge', 'codingKnowledge', 'userFacts']) {
    for (const entry of mem[store] || []) if (!entry.emb) targets.push([entry, store]);
  }
  let done = 0;
  for (const [entry, store] of targets.slice(0, 50)) {
    try { if (await computeAndStoreEmb(entry, store)) done++; } catch (e) {}
  }
  return done;
}

/**
 * Pure ranker (no network): fuse keyword tf-idf relevance with vector cosine.
 * `qEmb` is the query embedding (or null → keyword-only). Exported so tests
 * can exercise the vector path without calling the embeddings API.
 */
export function hybridRank(list, query, qEmb, { relevanceFloor = 0.12, limit = 1 } = {}) {
  if (!Array.isArray(list) || !list.length) return [];
  const docs = list.map((e) => entryText(e));
  const idf = buildIdf(docs);
  const scored = [];
  for (let i = 0; i < list.length; i++) {
    const entry = list[i];
    const kw = memoryScore(query, { ...entry, answer: docs[i] }, idf);
    const vec = qEmb && Array.isArray(entry.emb) ? vectorCosine(qEmb, entry.emb) : 0;
    const score = qEmb && Array.isArray(entry.emb) ? fuseScore(vec, kw.relevance) : kw.relevance;
    if (score >= relevanceFloor) scored.push({ entry, score, relevance: kw.relevance, vector: vec });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

/** Hybrid search across a store: embedding (if available) fused with tf-idf. */
export async function hybridSearch(list, query, opts = {}) {
  const qEmb = await embedText(query);
  const top = hybridRank(list, query, qEmb, opts);
  for (const r of top) touch(r.entry);
  if (top.length) saveMemory();
  return top;
}

/** Mark an entry as accessed (boosts its recency for next time). */
function touch(entry) {
  entry.lastAccess = new Date().toISOString();
  entry.accessCount = (entry.accessCount || 0) + 1;
}

/** Prune a store to its cap, dropping the lowest-value (importance × recency) entries. */
function prune(mem, key) {
  const cap = CAPS[key];
  const list = mem[key];
  if (!list || list.length <= cap) return;
  list.sort((a, b) => {
    const va = (a.importance || 3) * Math.pow(0.99, hoursSince(a.lastAccess || a.date));
    const vb = (b.importance || 3) * Math.pow(0.99, hoursSince(b.lastAccess || b.date));
    return va - vb;
  });
  mem[key] = list.slice(list.length - cap);
}

/* ------------------------------------------------------------------ */
/* Consolidation — merge near-duplicate memories (run on boot + overflow) */
/* ------------------------------------------------------------------ */

/**
 * Merge entries whose topics/facts are near-identical (cosine >= threshold):
 * keeps the newer + higher-importance entry, combines sources, refreshes the
 * date. Pure JS — no LLM needed.
 */
export function consolidateMemory() {
  const mem = loadMemory();
  let changed = false;

  const merge = (key, threshold) => {
    const list = mem[key] || [];
    if (list.length < 2) return;
    const removed = new Set();
    for (let i = 0; i < list.length; i++) {
      if (removed.has(i)) continue;
      for (let j = i + 1; j < list.length; j++) {
        if (removed.has(j)) continue;
        const a = `${list[i].topic || list[i].fact || ''}`;
        const b = `${list[j].topic || list[j].fact || ''}`;
        if (a && b && cosineSimilarity(a, b) >= threshold) {
          const newer = new Date(list[j].date || 0) > new Date(list[i].date || 0) ? j : i;
          const older = newer === i ? j : i;
          const keep = { ...list[newer] };
          keep.importance = Math.max(list[i].importance || 3, list[j].importance || 3);
          keep.lastAccess = new Date(Math.max(new Date(list[i].lastAccess || 0), new Date(list[j].lastAccess || 0))).toISOString();
          if (Array.isArray(list[i].sources) || Array.isArray(list[j].sources)) {
            keep.sources = [...new Set([...(list[i].sources || []), ...(list[j].sources || [])])].slice(0, 10);
          }
          if (keep.answer && list[older].answer && String(list[older].answer).length > String(keep.answer).length) {
            keep.answer = list[older].answer;
          }
          list[newer] = keep;
          removed.add(older);
          changed = true;
        }
      }
    }
    if (removed.size) mem[key] = list.filter((_, idx) => !removed.has(idx));
  };

  merge('internetKnowledge', 0.78); // short topics: 2-of-3 shared words ≈ 0.82
  merge('codingKnowledge', 0.78);
  merge('userFacts', 0.85); // longer sentences, higher bar

  prune(mem, 'internetKnowledge');
  prune(mem, 'codingKnowledge');
  prune(mem, 'userFacts');
  prune(mem, 'learnedAnswers');

  if (changed) saveMemory();
  consolidated = true;
  return changed;
}

/* ------------------------------------------------------------------ */
/* Chat history (long conversations)                                   */
/* ------------------------------------------------------------------ */

// Mem0-style, zero-cost fact extraction: regex-gated patterns on user messages.
const FACT_PATTERNS = [
  { re: /\bmy (name|nickname|username)\s+(?:is|are)\s+["']?([^"'.,!?]{2,60})/i, build: (m) => `User's name is ${m[2]}`, label: 'name', importance: IMPORTANCE.profile },
  { re: /\bcall me\s+["']?([^"'.,!?]{2,40})/i, build: (m) => `User prefers to be called ${m[1]}`, label: 'name', importance: IMPORTANCE.profile },
  { re: /\bmy (favourite|favorite)\s+([a-z ]{2,40}?)\s+(?:is|are)\s+["']?([^"'.,!?]{2,80})/i, build: (m) => `User's favorite ${m[2]} is ${m[3]}`, label: 'preference', importance: IMPORTANCE.fact },
  { re: /\bmy (job|work|profession|business|startup|company|project|app|dream|goal|hobby|hobbies|city|town|school|university|email|phone|birthday|age)\s+(?:is|are|was)\s+["']?([^"'.,!?]{2,80})/i, build: (m) => `User's ${m[1]} is ${m[2]}`, label: 'profile', importance: IMPORTANCE.fact },
  { re: /\bi (?:live|work|study)\s+(?:in|at)\s+["']?([^"'.,!?]{2,80})/i, build: (m) => `User lives/works in ${m[1]}`, label: 'location', importance: IMPORTANCE.fact },
  { re: /\bi (?:love|like|hate|prefer|enjoy)\s+["']?([^"'.,!?]{2,80})/i, build: (m) => `User likes ${m[1]}`, label: 'preference', importance: IMPORTANCE.fact },
];

/** Skip fact extraction when the match sits inside a quoted third-party span
 * (someone else's statement must never become the user's learned fact). */
function insideQuotedSpan(s, idx) {
  let inSpan = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '"' || c === '\u201c' || c === '\u201d') {
      if (i > idx) return false;
      inSpan = !inSpan;
    }
    if (i === idx && inSpan) return true;
  }
  return false;
}

/**
 * Extract durable user facts — with anti-fabrication guards (Build 48, P2).
 * A learned "fact" that was only hypothetical, a question, or a quote is a
 * fabricated memory; err toward learning nothing over learning a lie.
 *   - hypotheticals / counterfactuals ("if my favorite color were teal…") → skip
 *   - questions ("is my favorite color teal?") → skip
 *   - quoted third-party statements ("she said 'my favorite color is teal'") → skip
 */
function extractFactsFromMessage(text) {
  const s = String(text || '').trim();
  const facts = [];
  if (s.length < 6) return facts;
  if (/\b(if|imagine|suppose|what if|let'?s say|for example|for instance|pretend|hypothetically|wish|maybe|could be|would be)\b/i.test(s)) return facts;
  if (/\?\s*$/.test(s) || /^(what|which|when|where|who|why|how|is|are|am|do|does|did|can|could|should|would)\b/i.test(s)) return facts;
  for (const p of FACT_PATTERNS) {
    const m = s.match(p.re);
    if (!m) continue;
    const idx = m.index || s.search(p.re);
    if (insideQuotedSpan(s, idx)) continue;
    const fact = p.build(m).replace(/\s+/g, ' ').trim();
    if (fact.length > 8) facts.push({ fact, label: p.label, importance: p.importance });
  }
  return facts;
}

export function addChat(role, text) {
  const mem = loadMemory();
  const entry = { role, text: String(text || '').slice(0, 20000), time: new Date().toISOString() };
  mem.chatHistory.push(entry);
  // Keep the last 200 exchanges so long conversations stay focused
  if (mem.chatHistory.length > 200) mem.chatHistory = mem.chatHistory.slice(-200);

  // B66 — per-session mirror: the active session's history file gets the
  // same entry, so each conversation thread is isolated and durable.
  const sessionHistory = loadSessionHistory();
  if (Array.isArray(sessionHistory)) {
    sessionHistory.push(entry);
    if (sessionHistory.length > 200) sessionHistory.splice(0, sessionHistory.length - 200);
    saveSessionHistory(sessionHistory);
  }

  // User messages may carry lasting facts — capture them into semantic memory
  if (role === 'user') {
    for (const f of extractFactsFromMessage(text)) rememberUserFact(f.fact, f.importance, f.label);
  }
  saveMemory();
}

export function getChatHistory(n = 20) {
  // B66 — session-scoped history wins when a session is active; the global
  // core remains the fallback (tests / non-session callers).
  if (activeSession) {
    const sessionHistory = loadSessionHistory();
    if (Array.isArray(sessionHistory) && sessionHistory.length) return sessionHistory.slice(-n);
  }
  return loadMemory().chatHistory.slice(-n);
}

/* ------------------------------------------------------------------ */
/* Conversational continuity — resolve follow-up messages against the  */
/* recent thread so JEXI never forgets what she was just discussing.   */
/* (Pattern from Conversational RAG / LlamaIndex condense_question:    */
/*  the current message is rewritten into a self-contained query using */
/*  the transcript BEFORE planning/retrieval — ChatGPT-style continuity.) */
/* ------------------------------------------------------------------ */

/** Words that signal a follow-up message depends on the prior conversation. */
const ANAPHORA_RE =
  /\b(this|that|these|those|it|its|it's|the (course|topic|subject|class|lesson|app|application|project|website|site|web ?page|roadmap|plan|schedule|code|script|program|design|theme|layout|article|paper|book|video|song|story|poem|recipe|meal|workout|routine|product|business|idea|concept|problem|bug|error|issue|feature|task|thing|one|same|above|following|question|chapter|field|industry|area|stuff|material|one you (made|built|wrote|said)|answer|solution|result|list|steps|outline|summary|details?)\b)|\b(continue|go on|keep going|keep working|keep it going|carry on|proceed|finish (it|this|that|the)|complete (it|this|that|the)|elaborate|expand|more detail|follow ?up|next step|go deeper|more (on|about|of|like)|what about|how about|and then|also (explain|tell|give|show|make|create|build|write|add)|but then|is that all|anything else|let's (continue|keep going|move on)|take it (further|from here)|pick (it|up) (from here|where we left off))\b/i;

/** True when the message looks like it depends on the conversation thread. */
export function hasConversationalReference(query) {
  const q = String(query || '').trim();
  if (!q) return false;
  if (q.length < 25) return true; // "continue", "go on", "more", "yes"…
  return ANAPHORA_RE.test(q);
}

/* ------------------------------------------------------------------ */
/* B55 P2 — never re-ask for details the user already gave.            */
/*                                                                     */
/* Root cause found: any message under 25 chars was treated as         */
/* conversational and REWRITTEN against the transcript by an LLM. A    */
/* short but complete message that already carried its own concrete    */
/* details ("remind me friday 3pm" = 21 chars) could come back from    */
/* the rewrite with the date dropped — the plan then ran without it,   */
/* and JEXI asked "what date?" for information already provided.      */
/*                                                                     */
/* Fix (minimal, targeted):                                            */
/*  1) short messages that already contain their own details AND have  */
/*     no pronoun/reference are never rewritten (already self-contained)
/*  2) ANY rewrite that drops a concrete detail token from the         */
/*     original (date, time, number, amount) is rejected — the user's  */
/*     original message wins, so no detail can be lost in translation. */
/* ------------------------------------------------------------------ */

const DETAIL_TOKEN_RE =
  /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|today|tomorrow|yesterday|tonight)\b|\b(next|this|last)\s+(week|month|weekend|year)\b|\b\d{1,2}(:\d{2})?\s*(am|pm|a\.?m\.?|p\.?m\.?|o'?clock)?\b|[$€£]\s?\d+(\.\d+)?|\b\d{1,2}[/-]\d{1,2}([/-]\d{2,4})?\b|\b\d+(\.\d+)?%/i;

/** True when the message carries its own concrete details (date/time/number/amount). */
export function hasOwnDetails(query) {
  return DETAIL_TOKEN_RE.test(String(query || ''));
}

function normDetail(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * True when the rewrite keeps every concrete detail the user originally gave
 * (dates, times, numbers, amounts — normalized). A rewrite that drops any of
 * them is rejected so the original message is used instead.
 */
export function rewritePreservesDetails(original, rewrite) {
  const s = String(original || '').toLowerCase();
  const rw = normDetail(rewrite);
  if (!s || !rw) return true; // nothing to compare → don't block
  const tokens = [];
  const re = /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|today|tomorrow|yesterday|tonight)\b|\b(next|this|last)\s+(week|month|weekend|year)\b|\b\d{1,2}(:\d{2})?\s*(am|pm|a\.?m\.?|p\.?m\.?|o'?clock)?\b|[$€£]\s?\d+(\.\d+)?|\b\d{1,2}[/-]\d{1,2}([/-]\d{2,4})?\b|\b\d+(\.\d+)?%/gi;
  let m;
  while ((m = re.exec(s))) {
    const t = normDetail(m[0]);
    if (t) tokens.push(t);
  }
  if (!tokens.length) return true;
  return tokens.every((t) => rw.includes(t));
}

/** Compact transcript of the last n turns (user + JEXI), truncated. */
export function conversationTranscript(n = 6, maxChars = 2400) {
  return getChatHistory(n)
    .map((h) => `${h.role === 'user' ? 'User' : 'JEXI'}: ${String(h.text).slice(0, 500)}`)
    .join('\n')
    .slice(0, maxChars);
}

/**
 * Turn a context-dependent message into a self-contained one by rewriting it
 * against the recent transcript (one cheap LLM call, only when needed).
 *
 * Returns { query, resolved, reason, original? }:
 *  - self-contained messages pass through untouched (zero cost)
 *  - "give me a roadmap for a beginner in this course" → "give me a roadmap
 *    for a beginner in computer science" (resolved against prior turns)
 *  - no API key or LLM failure → deterministic fallback: the message is
 *    anchored to the last topic discussed, so it never answers in the void.
 */
export async function resolveConversationalQuery(query) {
  const q = String(query || '').trim();
  const prior = getChatHistory(8).filter((h) => h.role === 'user');
  const transcript = conversationTranscript(6, 2000);
  if (!q || prior.length === 0 || transcript.trim().length < 20 || !hasConversationalReference(q)) {
    return { query: q, resolved: false, reason: 'self-contained' };
  }

  // B55 P2 — a short message that already carries its own concrete details
  // (date/time/number/amount) AND has no pronoun/reference is already
  // self-contained: never rewrite it against the transcript. A lossy rewrite
  // here is exactly what made JEXI re-ask for a date the user already gave.
  if (q.length < 25 && hasOwnDetails(q) && !ANAPHORA_RE.test(q)) {
    return { query: q, resolved: false, reason: 'self-contained — already carries its own details' };
  }

  // Deterministic topic anchor from the previous user turn (fallback path).
  const lastUser = [...prior].reverse()[0];
  const topic = String(lastUser.text || '').trim().replace(/\s+/g, ' ').slice(0, 120);

  try {
    const keys = resolveKeys();
    if (!keys.groqKey && !keys.geminiKey && !keys.openrouterKey) throw new Error('no key');
    const rewritten = await generateContent(
      `The user just said: "${q}"\n\nRecent conversation (most recent last):\n${transcript}\n\nRewrite ONLY the user's latest message into a single self-contained request that an AI with NO memory of this conversation could answer correctly. Resolve every pronoun and reference — "this course", "it", "the app", "that", "the roadmap", "continue", "go on", "more" — using the conversation. Keep the user's exact intent and tone, and do NOT add new instructions to the assistant. If the message is already self-contained, return it unchanged.\n\nNEGATIVE EXAMPLES — return these EXACTLY as written, unchanged (they are already self-contained):\n1. "What is the derivative of x squared?" → "What is the derivative of x squared?"\n2. "Explain quantum entanglement to me." → "Explain quantum entanglement to me."\n3. "Write a Python function to reverse a string." → "Write a Python function to reverse a string."\n\nReturn ONLY the rewritten text: no quotes, no labels, no markdown, no explanation. Your entire reply must be exactly the rewritten user message and nothing else.`,
      'You rewrite context-dependent chat messages into self-contained ones. Return ONLY the rewritten text and nothing else — no quotes, no labels, no commentary.',
      null,
      { temperature: 0.1 }
    );
    const out = String(rewritten || '').trim().replace(/^["'`]+|["'`]+$/g, '');
    if (out && out.length > 3 && out.length < 400 && !/^(rewritten|the rewritten|here('s| is))[:\s]/i.test(out)) {
      // B55 P2 — the rewrite must PRESERVE every concrete detail the user
      // already gave (date, time, number, amount). A rewrite that dropped one
      // is worse than no rewrite: keep the user's original message so the
      // plan still carries the date and JEXI never re-asks for it.
      if (rewritePreservesDetails(q, out)) {
        return { query: out, resolved: true, reason: 'rewritten with conversation context', original: q };
      }
    }
  } catch (e) { /* fall through to deterministic anchor */ }

  // Deterministic fallback: anchor the message to the last thing discussed.
  return { query: `${q} (about: ${topic})`, resolved: true, reason: 'anchored to previous topic', original: q };
}

/* ------------------------------------------------------------------ */
/* Conversation memory — rolling summary + episodic memory             */
/* (layered-memory pattern from Mem0 / DeepAgents / OpenAI sessions:    */
/*  recent turns verbatim → compressed running summary → long-term      */
/*  semantic retrieval, so JEXI never forgets the thread mid-conversation */
/* ------------------------------------------------------------------ */

// Keep this many most-recent turns verbatim; everything older is compressed.
const SUMMARY_RECENT_TURNS = 12;

// B78 — TOKEN-THRESHOLD COMPACTION (replaces the fixed 28-turn counter).
// The trigger is the ESTIMATED TOKEN count of the running conversation
// (summary + every turn, ~4 chars/token), so:
//   (a) a short but frequent chat no longer compacts too early and loses
//       detail unnecessarily (it never crosses the ceiling), and
//   (b) a few very long/dense turns blow past the ceiling and compact BEFORE
//       they exceed what the underlying models can actually handle.
// Default ceiling: 110,000 estimated tokens (within the 100k-135k band the
// models in use can handle well). Override with JEXI_COMPACTION_TOKENS.
const COMPACTION_TOKEN_THRESHOLD = Math.max(2000, Number(process.env.JEXI_COMPACTION_TOKENS) || 110000);

/** Rough token estimate: ~4 chars/token for mixed English (tokenizer ballpark). */
export function estimateTokens(text) {
  return Math.ceil(String(text || '').length / 4);
}

/** Cached rolling summary of the whole conversation ('' until it exists). */
export function getRollingSummary() {
  return loadMemory().conversationSummary || '';
}

/**
 * Async context compaction — compress the turns older than the recent window
 * into one dense running summary (Mem0/DeepAgents pattern). No AI keys → the
 * cached summary is returned untouched; failures never break a chat.
 *
 * B78 — the trigger is TOKEN usage, not turn count: when the estimated token
 * size of the running context (summary + every chat turn) crosses
 * COMPACTION_TOKEN_THRESHOLD, the old turns are compressed into the summary
 * and a `context_compaction` event is appended to the event log (what
 * triggered it, how many tokens were in play, what got summarized).
 *
 * Test seam: `__generate` overrides the LLM call (the same contract as
 * generateContent) so tests can fire a real compaction without network/keys.
 */
export async function rollingConversationSummary({ force = false, __generate } = {}) {
  const mem = loadMemory();
  const turns = mem.chatHistory || [];
  const old = turns.slice(0, Math.max(0, turns.length - SUMMARY_RECENT_TURNS));
  const gen = typeof __generate === 'function' ? __generate : generateContent;

  // B78 — token-threshold trigger: estimate the running context and compact
  // when it crosses the ceiling. `force` bypasses the check (manual refresh).
  const currentTokens =
    estimateTokens(mem.conversationSummary) +
    turns.reduce((sum, h) => sum + estimateTokens(h.text || ''), 0);
  const overThreshold = currentTokens >= COMPACTION_TOKEN_THRESHOLD;
  if (!force) {
    if (!overThreshold) return mem.conversationSummary || '';
    if (old.length === 0) return mem.conversationSummary || '';
  }

  const keys = resolveKeys();
  if (!keys.groqKey && !keys.geminiKey && !keys.openrouterKey && !force && typeof __generate !== 'function') return mem.conversationSummary || '';

  const prior = mem.conversationSummary ? `Previous running summary:\n${mem.conversationSummary}\n\n` : '';
  const text = old
    .map((h) => `${h.role === 'user' ? 'User' : 'JEXI'}: ${String(h.text).slice(0, 800)}`)
    .join('\n');
  if (!text.trim()) return mem.conversationSummary || '';

  try {
    const summary = await gen(
      `${prior}Compress this conversation into a dense running summary (max 400 words, bullet points). Keep: the user's goals, key decisions, facts about the user, open tasks, and anything JEXI promised or built. Drop small talk and repeats.\n\nCONVERSATION TO COMPRESS:\n${text.slice(0, 24000)}`,
      'You are JEXI OS\'s Context Manager. Output ONLY the compressed summary.'
    );
    const clean = String(summary || '').trim().slice(0, 2500);
    if (clean.length >= 20) {
      mem.conversationSummary = clean;
      saveMemory();
      // B78 — every compaction is a first-class event in the event log.
      try {
        appendEvent('context_compaction', {
          trigger: force ? 'manual' : 'token_threshold',
          threshold: COMPACTION_TOKEN_THRESHOLD,
          estimatedTokens: currentTokens,
          turnsCompressed: old.length,
          summaryLength: clean.length,
          reason: force
            ? 'forced by caller'
            : `running context (${currentTokens} est. tokens) crossed the ${COMPACTION_TOKEN_THRESHOLD} token ceiling`,
        });
      } catch (e) { /* the event log must never break the chat */ }
    }
    return mem.conversationSummary || '';
  } catch (e) {
    return mem.conversationSummary || '';
  }
}

/** Remember a notable exchange (episodic memory) — capped so it stays focused. */
export function rememberEpisode(ask, reply) {
  const mem = loadMemory();
  mem.episodes.push({
    ask: String(ask || '').slice(0, 500),
    reply: String(reply || '').slice(0, 1200),
    time: new Date().toISOString(),
  });
  if (mem.episodes.length > 30) mem.episodes = mem.episodes.slice(-30);
  saveMemory();
}

/** The most recent memorable exchanges (for conversation context). */
export function getRecentEpisodes(n = 4) {
  return loadMemory().episodes.slice(-n);
}

export function clearMemory() {
  cache = structuredClone(DEFAULT_MEMORY);
  consolidated = false;
  ensureDirs();
  try { writeMemoryFile(JSON.stringify(cache, null, 2)); } catch (e) {}
  if (redisEnabled) { getRedis().then(r => { if (r) r.del(MEMORY_REDIS_KEY).catch(() => {}); }).catch(() => {}); }
  // Also wipe generated workspace files
  try {
    if (fs.existsSync(WORKSPACE_DIR)) fs.readdirSync(WORKSPACE_DIR).forEach(f => fs.unlinkSync(path.join(WORKSPACE_DIR, f)));
  } catch (e) {}
}

/* ------------------------------------------------------------------ */
/* User profile + semantic facts                                       */
/* ------------------------------------------------------------------ */

export function updateUserProfile(patch) {
  const mem = loadMemory();
  mem.userProfile = { ...mem.userProfile, ...(patch || {}) };
  saveMemory();
}

/** Store a durable fact about the user (dedupes exact repeats, caps the store). */
export function rememberUserFact(fact, importance = IMPORTANCE.fact, label = 'fact') {
  const mem = loadMemory();
  const text = String(fact || '').trim().slice(0, 300);
  if (text.length < 8) return null;
  const existing = (mem.userFacts || []).find((f) => String(f.fact || '').toLowerCase() === text.toLowerCase());
  if (existing) {
    existing.date = new Date().toISOString();
    existing.importance = Math.max(existing.importance || 3, importance);
  } else {
    const entry = { fact: text, label: label || 'fact', importance, date: new Date().toISOString(), lastAccess: new Date().toISOString(), accessCount: 0 };
    mem.userFacts.push(entry);
    attachEmbedding(entry, 'userFacts'); // vector layer (TencentDB pattern)
  }
  prune(mem, 'userFacts');
  saveMemory();
  return mem.userFacts[mem.userFacts.length - 1];
}

/** Retrieve facts relevant to the current context (hybrid vector + keyword). */
export async function searchUserFacts(query, limit = 5) {
  const mem = loadMemory();
  const facts = mem.userFacts || [];
  if (!facts.length) return [];
  const hits = await hybridSearch(facts, query, { relevanceFloor: 0.15, limit });
  return hits.map((h) => h.entry);
}

/** Top facts by importance × recency — for always-on conversation context. */
export function topUserFacts(n = 4) {
  const mem = loadMemory();
  return (mem.userFacts || [])
    .map((f) => ({ f, v: (f.importance || 3) * Math.pow(0.99, hoursSince(f.lastAccess || f.date)) }))
    .sort((a, b) => b.v - a.v)
    .slice(0, n)
    .map((x) => x.f.fact);
}

/** Snapshot for diagnostics/self-check. */
export function getMemoryStats() {
  const mem = loadMemory();
  return {
    chatHistory: mem.chatHistory.length,
    userFacts: (mem.userFacts || []).length,
    internetKnowledge: mem.internetKnowledge.length,
    codingKnowledge: mem.codingKnowledge.length,
    learnedAnswers: mem.learnedAnswers.length,
    bookLibrary: (mem.bookLibrary || []).length,
    profileFilled: Boolean(mem.userProfile?.name || mem.userProfile?.location || (mem.userProfile?.interests || []).length),
  };
}

/* ------------------------------------------------------------------ */
/* Learned internet knowledge (JEXI's "mind" for research topics)      */
/* ------------------------------------------------------------------ */

export function saveInternetKnowledge(topic, answer, sources = []) {
  const mem = loadMemory();
  const entry = {
    topic: String(topic).slice(0, 300),
    answer: String(answer).slice(0, 30000),
    sources: sources.slice(0, 10),
    date: new Date().toISOString(),
    importance: IMPORTANCE.internet,
    lastAccess: new Date().toISOString(),
    accessCount: 0,
  };
  mem.internetKnowledge = mem.internetKnowledge.filter(e => e.topic.toLowerCase() !== topic.toLowerCase());
  mem.internetKnowledge.push(entry);
  // Also distil into learned answers for fast retrieval
  mem.learnedAnswers.unshift({ question: topic, answer: entry.answer, date: entry.date });
  prune(mem, 'internetKnowledge');
  prune(mem, 'learnedAnswers');
  saveMemory();
  attachEmbedding(entry, 'internetKnowledge'); // vector layer (TencentDB pattern)
  return entry;
}

export async function searchInternetKnowledge(query) {
  const mem = loadMemory();
  const list = mem.internetKnowledge;
  if (!list.length) return null;
  const hits = await hybridSearch(list, query, { relevanceFloor: 0.12, limit: 1 });
  return hits.length ? hits[0].entry : null;
}

/**
 * Same as searchInternetKnowledge, but only returns answers JEXI learned
 * recently (default: within the last 30 minutes). Used for instant repeat
 * answers — e.g. asking the same news question twice within minutes.
 * Returns the entry OBJECT (never an array) — callers must check it directly.
 */
export async function searchFreshInternetKnowledge(query, maxAgeMs = 30 * 60 * 1000) {
  const mem = loadMemory();
  const list = mem.internetKnowledge;
  if (!list.length) return null;
  const hits = await hybridSearch(list, query, { relevanceFloor: 0.12, limit: 1 });
  if (!hits.length) return null;
  const best = hits[0].entry;
  const age = Date.now() - new Date(best.date || 0).getTime();
  if (!Number.isFinite(age) || age > maxAgeMs) return null;
  return best;
}

/* ------------------------------------------------------------------ */
/* Coding solutions (JEXI's "mind" for code tasks)                     */
/* ------------------------------------------------------------------ */

export function saveCodingKnowledge(topic, language, solution, files = []) {
  const mem = loadMemory();
  const entry = {
    topic: String(topic).slice(0, 300),
    language,
    solution: String(solution).slice(0, 30000),
    files: files.slice(0, 10),
    date: new Date().toISOString(),
    importance: IMPORTANCE.coding,
    lastAccess: new Date().toISOString(),
    accessCount: 0,
  };
  mem.codingKnowledge = mem.codingKnowledge.filter(e => e.topic.toLowerCase() !== topic.toLowerCase());
  mem.codingKnowledge.push(entry);
  prune(mem, 'codingKnowledge');
  saveMemory();
  attachEmbedding(entry, 'codingKnowledge'); // vector layer (TencentDB pattern)
  return entry;
}

export async function searchCodingKnowledge(query) {
  const mem = loadMemory();
  const list = mem.codingKnowledge;
  if (!list.length) return null;
  const hits = await hybridSearch(list, query, { relevanceFloor: 0.25, limit: 1 });
  return hits.length ? hits[0].entry : null;
}

/* ------------------------------------------------------------------ */
/* Semantic recall + per-agent memory loadouts                         */
/* (TencentDB-Agent-Memory pattern: layered L1/L2 fusion on demand,     */
/*  and each specialist is "equipped" with the memory it needs)         */
/* ------------------------------------------------------------------ */

/**
 * Recall across ALL memory stores, fused and capped by a character budget
 * (TencentDB caps retrieval so memory never overwhelms the context window).
 * Returns [{ kind, label, text, score }].
 */
export async function semanticRecall(query, { limit = 3, maxChars = 1200, noCode = false } = {}) {
  // B53 P5 — MEMORY SCOPES: semantic recall is the cross-task store (facts,
  // preferences, researched topics). When noCode is set (planner + conversation
  // context) it EXCLUDES codingKnowledge — product source trees stay task-scoped
  // and never leak into an unrelated task's context.
  const mem = loadMemory();
  const q = String(query || '').trim();
  if (q.length < 4) return [];
  const results = [];
  const internet = await hybridSearch(mem.internetKnowledge || [], q, { relevanceFloor: 0.12, limit });
  for (const h of internet) results.push({ kind: 'research', label: String(h.entry.topic || '').slice(0, 120), text: String(h.entry.answer || '').slice(0, 600), score: h.score });
  if (!noCode) {
    const coding = await hybridSearch(mem.codingKnowledge || [], q, { relevanceFloor: 0.25, limit });
    for (const h of coding) results.push({ kind: 'code', label: String(h.entry.topic || '').slice(0, 120), text: String(h.entry.solution || '').slice(0, 600), score: h.score });
  }
  const facts = await hybridSearch(mem.userFacts || [], q, { relevanceFloor: 0.15, limit });
  for (const h of facts) results.push({ kind: 'fact', label: String(h.entry.fact || '').slice(0, 200), text: '', score: h.score });
  results.sort((a, b) => b.score - a.score);
  let budget = 0;
  const capped = [];
  for (const r of results) {
    if (budget >= maxChars) break;
    capped.push(r);
    budget += r.text.length + 60;
  }
  return capped.slice(0, limit);
}

/** Which memory stores each specialist is equipped with (TencentDB loadout). */
const AGENT_MEMORY_MAP = {
  coder: ['codingKnowledge'],
  engineer: ['codingKnowledge'],
  architect: ['codingKnowledge'],
  qa: ['codingKnowledge'],
  debugger: ['codingKnowledge'],
  reviewer: ['codingKnowledge'],
  'fact-checker': ['internetKnowledge'],
  researcher: ['internetKnowledge'],
  searcher: ['internetKnowledge'],
  synthesizer: ['internetKnowledge'],
  writer: ['internetKnowledge'],
  translator: ['internetKnowledge'],
  'data-analyst': ['internetKnowledge'],
  planner: ['userFacts', 'internetKnowledge'],
  reasoning: ['userFacts', 'internetKnowledge'],
};

/**
 * Equip an agent with its relevant past memories (TencentDB "agent loadout").
 * Returns [{ store, entry }]. No-op for agents with no loadout.
 */
export async function memoryForAgent(agentSlug, query, { limit = 2 } = {}) {
  const stores = AGENT_MEMORY_MAP[String(agentSlug || '').toLowerCase()] || [];
  const mem = loadMemory();
  const out = [];
  for (const store of stores) {
    const list = mem[store] || [];
    if (!list.length) continue;
    const hits = await hybridSearch(list, query, { relevanceFloor: 0.2, limit });
    for (const h of hits) out.push({ store, entry: h.entry });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Knowledge base (studied topics, saved as markdown files)            */
/* ------------------------------------------------------------------ */

export function saveKnowledgeFile(category, filename, content) {
  const safeCat = String(category || '07_GENERAL_KNOWLEDGE').replace(/[^\w-]/g, '_');
  const safeName = String(filename || 'topic').replace(/[^\w.-]/g, '_');
  const dir = path.join(KNOWLEDGE_DIR, safeCat);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, safeName), content, 'utf-8');
  return path.join(safeCat, safeName);
}

/** Find the densest cluster of keyword hits and return a window around it. */
function bestExcerpt(content, qwords, radius = 2600) {
  const lower = content.toLowerCase();
  const hits = [];
  for (const w of qwords) {
    let idx = lower.indexOf(w);
    while (idx !== -1) { hits.push(idx); idx = lower.indexOf(w, idx + 1); }
  }
  if (!hits.length) return null;
  hits.sort((a, b) => a - b);
  let bestStart = hits[0], bestCount = 1;
  for (let i = 0; i < hits.length; i++) {
    let count = 1;
    for (let j = i + 1; j < hits.length && hits[j] - hits[i] <= radius * 2; j++) count++;
    if (count > bestCount) { bestCount = count; bestStart = hits[i]; }
  }
  const start = Math.max(0, bestStart - radius);
  const end = Math.min(content.length, bestStart + radius);
  const excerpt = content.slice(start, end).trim();
  return `${start > 0 ? '…' : ''}${excerpt}${end < content.length ? '…' : ''}`;
}

// Fingerprinted index of the knowledge library files, so search doesn't re-read
// every file from disk on EVERY chat message (only re-reads when a file is
// added/changed — detected by name+size+mtime, so it self-heals).
let knowledgeIndex = { key: null, files: [] };

function indexKnowledgeFiles() {
  const files = [];
  const walk = (dir, cat) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, cat || entry.name);
      else if (entry.isFile() && entry.name.endsWith('.md')) {
        try {
          const st = fs.statSync(full);
          files.push({ cat: cat || 'general', name: entry.name, full, mtime: st.mtimeMs, size: st.size });
        } catch (e) {}
      }
    }
  };
  walk(KNOWLEDGE_DIR, null);
  const key = files.map(f => `${f.name}:${f.size}:${f.mtime}`).join('|');
  if (key === knowledgeIndex.key) return knowledgeIndex.files;
  const contents = [];
  for (const f of files) {
    try {
      contents.push({ cat: f.cat, name: f.name.replace('.md', ''), content: fs.readFileSync(f.full, 'utf-8') });
    } catch (e) {}
  }
  knowledgeIndex = { key, files: contents };
  return knowledgeIndex.files;
}

/**
 * Search the whole knowledge base: the user's uploaded books (kept in memory so
 * they survive redeploys via Redis) plus studied-topic files on disk.
 * Returns excerpts centered on the best match, not whole files.
 */
export function searchKnowledge(query, minScore = 2) {
  const results = [];
  const q = query.toLowerCase().split(/\s+/).filter(w => w.length > 3);
  if (q.length === 0) return results;
  const count = (hay) => q.reduce((acc, w) => acc + (hay.includes(w) ? 1 : 0), 0);

  // 1) The user's own books (memory-first: survives restarts via Redis mirror)
  for (const book of loadMemory().bookLibrary || []) {
    const text = book.text || '';
    const score = count(text.toLowerCase());
    if (score >= 1) {
      const excerpt = bestExcerpt(text, q);
      if (excerpt) results.push({ title: book.name, category: 'USER_BOOKS', content: excerpt, score, source: 'book' });
    }
  }

  // 2) Studied topic files on disk (indexed — read once per change, not per query)
  const skipBooks = loadMemory().bookLibrary.length > 0;
  const threshold = Math.min(minScore, q.length);
  for (const f of indexKnowledgeFiles()) {
    if (f.cat === 'USER_BOOKS' && skipBooks) continue;
    const score = count(f.content.toLowerCase());
    if (score >= threshold) {
      results.push({ title: f.name, category: f.cat, content: bestExcerpt(f.content, q) || f.content.slice(0, 20000), score });
    }
  }

  // De-dupe (memory book entries and their USER_BOOKS .md copies are the same book)
  const seen = new Set();
  const unique = [];
  for (const r of results) {
    const key = String(r.title).toLowerCase();
    if (!seen.has(key)) { seen.add(key); unique.push(r); }
  }
  unique.sort((a, b) => b.score - a.score);
  return unique;
}

/* ------------------------------------------------------------------ */
/* The user's own book library (uploaded PDFs, texts, markdown)        */
/* ------------------------------------------------------------------ */

export function saveBook(store) {
  const mem = loadMemory();
  mem.bookLibrary = (mem.bookLibrary || []).filter(b => b.name !== store.name);
  mem.bookLibrary.push(store);
  if (mem.bookLibrary.length > 6) mem.bookLibrary = mem.bookLibrary.slice(-6);
  saveMemory();
  return store;
}

export function listSavedBooks() {
  return loadMemory().bookLibrary || [];
}

export function removeSavedBook(name) {
  const mem = loadMemory();
  const idx = (mem.bookLibrary || []).findIndex(b => b.name === name);
  if (idx === -1) return null;
  const [removed] = mem.bookLibrary.splice(idx, 1);
  saveMemory();
  return removed;
}

export function getKnowledgeStructure() {
  const structure = {};
  const walk = (dir, cat) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, entry.name);
      else if (entry.isFile() && entry.name.endsWith('.md')) {
        const key = cat || 'GENERAL';
        if (!structure[key]) structure[key] = [];
        structure[key].push({ name: entry.name.replace('.md', ''), filled: true });
      }
    }
  };
  walk(KNOWLEDGE_DIR, null);
  return structure;
}

export function getKnowledgeStatus() {
  const structure = getKnowledgeStructure();
  const files = Object.values(structure).flat();
  return { total: files.length, filled: files.length, empty: 0 };
}
