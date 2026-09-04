import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { MEMORY_FILE, KNOWLEDGE_DIR, WORKSPACE_DIR, DATA_DIR } from '../config.js';
import { generateContent, resolveKeys, embedText } from './LLMClient.js';
import { appendEvent } from './EventLog.js'; // B78/B158 — context_compaction events (dsh compaction/* mirror)
import { clearEventLog } from './EventLog.js'; // B162d — deep clear
import { clearAllConversations } from './SessionConversations.js'; // B162d — deep clear

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
let redisEnabled = Boolean(process.env.REDIS_URL);
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

/**
 * B66 — persistence probe: prove memory survives a restart/redeploy. Each
 * process stamps DATA_DIR with its own instance id; the probe reports whether
 * stamps from PREVIOUS boots are still present (=> the disk is persistent).
 * On Render this depends on a persistent disk being mounted at DATA_DIR —
 * ephemeral containers lose it, exactly as the probe will report.
 */
export function memoryPersistenceProbe() {
  const id = process.env.RENDER_INSTANCE_ID || process.env.POD_NAME || `boot-${Math.random().toString(36).slice(2, 10)}`;
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const mine = path.join(DATA_DIR, `.jexi-boot-${String(id).replace(/[^a-zA-Z0-9_-]/g, '')}.json`);
    fs.writeFileSync(mine, JSON.stringify({ boot: new Date().toISOString(), instance: id }), 'utf-8');
    const previous = fs.readdirSync(DATA_DIR)
      .filter((f) => /^\.jexi-boot-/.test(f) && !f.endsWith(String(id).replace(/[^a-zA-Z0-9_-]/g, '') + '.json'))
      .map((f) => ({ file: f, mtime: fs.statSync(path.join(DATA_DIR, f)).mtime.toISOString() }));
    const sessionCount = (() => {
      try { return fs.readdirSync(SESSIONS_DIR).filter((f) => f.endsWith('.json')).length; } catch (e) { return 0; }
    })();
    const redisConfigured = Boolean(process.env.REDIS_URL);
    return {
      dataDir: DATA_DIR,
      instance: id,
      previousBootsSeen: previous,
      persistentDisk: previous.length > 0, // evidence-based, not assumed
      persistent: previous.length > 0, // B158 — disk-only summary (the child probe ORs in Redis proof)
      redisConfigured, // B68 — a free-tier alternative: REDIS_URL survives restarts without a disk
      // B158 — sync summary (the async boot-stamp probe enriches this to
      // { configured, connected, previousBootsSeen } in the probe child).
      redis: { configured: redisConfigured },
      sessionCount,
      note: previous.length > 0
        ? 'previous boot stamps survived — the memory directory is persistent across restarts'
        : redisConfigured
          ? 'no disk stamps found, but REDIS_URL is configured — memory persists via Redis across restarts (see the redis field in /api/health/memory)'
          : 'no previous boot stamps found — disk persistence not yet proven (mount a persistent disk at DATA_DIR on Render, or set REDIS_URL for cross-restart memory)',
    };
  } catch (e) {
    return { dataDir: DATA_DIR, error: (e && e.message) || String(e), persistentDisk: false };
  }
}

/**
 * B158 — normalize a REDIS_URL pasted with whitespace or wrapping quotes
 * (classic env-file mis-pastes). Returns '' when nothing usable remains.
 */
export function normalizeRedisUrl(raw) {
  let u = String(raw || '').trim();
  if ((u.startsWith('"') && u.endsWith('"')) || (u.startsWith("'") && u.endsWith("'"))) u = u.slice(1, -1).trim();
  return u;
}

/**
 * B158 — validate a Redis connection string BEFORE handing it to ioredis so
 * misconfigurations get actionable errors (naming the scheme/hostname) instead
 * of bare TypeErrors. Allowed: redis:// rediss:// or a bare host:port.
 */
function validateRedisUrl(url) {
  const scheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\//.exec(url);
  if (scheme && !['redis', 'rediss'].includes(scheme[1].toLowerCase())) {
    throw new Error(`REDIS_URL scheme "${scheme[1]}:" is not a Redis scheme — use redis:// or rediss:// (the value starts with ${scheme[1]}:)`);
  }
  if (scheme) {
    let u;
    try { u = new URL(url); } catch { throw new Error('Invalid REDIS_URL — could not parse a hostname from it'); }
    if (!u.hostname) throw new Error('Invalid REDIS_URL — no hostname could be parsed from it');
  } else if (!/^[^:\s]+:\d+$/.test(url)) {
    throw new Error('Invalid REDIS_URL — expected redis://host:port, rediss://host:port or host:port');
  }
  return true;
}

/**
 * B68/B158 — REDIS BOOT-STAMP PROBE (the durability proof the B68 test always
 * wanted): connects a THROWAWAY client (never the app client), stamps this
 * boot under `jexi:boot:<id>`, and reports every stamp from PREVIOUS boots
 * still present in Redis — evidence that memory survives restarts/redeploys
 * even without a persistent disk (Render free tier).
 */
export async function redisBootProbe() {
  const url = normalizeRedisUrl(process.env.REDIS_URL);
  if (!url) return { configured: false, connected: false, previousBootsSeen: [] };
  const id = process.env.RENDER_INSTANCE_ID || process.env.POD_NAME || `boot-${Math.random().toString(36).slice(2, 10)}`;
  let r = null;
  try {
    validateRedisUrl(url); // throws an actionable error naming the cause
    const { Redis } = await import('ioredis');
    r = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 1, enableReadyCheck: true, connectTimeout: 3000, commandTimeout: 5000 });
    // Bounded: an unresponsive server must never hang a boot (withTimeout).
    await Promise.race([
      r.connect(),
      new Promise((_, rej) => setTimeout(() => rej(new Error('Redis probe timed out after 6500 ms (unresponsive server)')), 6500)),
    ]);
    const mine = `jexi:boot:${String(id).replace(/[^a-zA-Z0-9_-]/g, '')}`;
    const keys = await r.keys('jexi:boot:*');
    const previousBootsSeen = [];
    for (const k of keys || []) {
      if (k === mine) continue;
      try {
        const v = JSON.parse(String(await r.get(k) || '{}'));
        previousBootsSeen.push({ instance: v.instance || k.replace(/^jexi:boot:/, ''), at: v.boot || null });
      } catch { /* corrupt stamp — ignore */ }
    }
    await r.set(mine, JSON.stringify({ boot: new Date().toISOString(), instance: id }), 'EX', 60 * 60 * 24 * 7);
    return { configured: true, connected: true, previousBootsSeen, error: undefined };
  } catch (e) {
    return { configured: true, connected: false, previousBootsSeen: [], error: (e && e.message) || String(e) };
  } finally {
    try { if (r) await r.disconnect(); } catch { /* best-effort */ }
  }
}

/**
 * B68 — live Redis durability probe: configured + actually reachable. Returns
 * { configured, active, error? }. `active: true` means memory hydrates from /
 * pushes to Redis and therefore survives restarts even on Render's free plan
 * (which has no persistent disks).
 */
export async function probeRedis() {
  if (!process.env.REDIS_URL) return { configured: false, active: false };
  const r = await getRedis();
  if (!r) return { configured: true, active: false, error: 'Redis client failed to init' };
  try {
    const pong = await r.ping();
    return { configured: true, active: pong === 'PONG' };
  } catch (e) {
    return { configured: true, active: false, error: (e && e.message) || String(e) };
  }
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
    const { Redis } = await import('ioredis');
    redisClient = new Redis(normalizeRedisUrl(process.env.REDIS_URL), { // B158 — tolerate whitespace/quoted mis-pastes
      lazyConnect: true,
      maxRetriesPerRequest: 2,
      enableReadyCheck: true,
      commandTimeout: 3000, // B158 — an unresponsive Redis must never hang a boot/hydrate
    });
    return redisClient;
  } catch (e) {
    console.error('[Memory] Redis client failed to init, using local file only:', e.message);
    redisEnabled = false;
    return null;
  }
}

/**
 * Load memory from Redis into the local cache (called once at boot).
 *
 * B218 — RETRY WITH BACKOFF: on 2026-09-04 a single ~3s Upstash latency
 * spike at boot permanently disabled the Redis layer for the whole process
 * (memory stopped persisting, the B217 mirror silently no-opped, health
 * showed redis:false until a manual restart). One slow moment must not cost
 * a boot its durable layer: each retry builds a FRESH client (the old one
 * may be wedged mid-command), and the layer is only disabled (B158
 * semantics: health must stay honest) after ALL attempts fail — ~55s of
 * proven-unreachable Redis, not one timeout.
 * Delays are overridable via JEXI_HYDRATE_RETRY_DELAYS_MS for tests.
 */
function hydrateRetryDelays() {
  return String(process.env.JEXI_HYDRATE_RETRY_DELAYS_MS || '10000,45000')
    .split(',').map((s) => parseInt(s, 10)).filter((n) => Number.isFinite(n) && n >= 0);
}

export async function hydrateFromRedis() {
  if (!redisEnabled) return false;
  const delays = hydrateRetryDelays();
  const maxAttempts = 1 + delays.length;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const r = await getRedis();
    if (!r) return false; // client init failed — already logged, layer off
    try {
      const raw = await r.get(MEMORY_REDIS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        cache = { ...structuredClone(DEFAULT_MEMORY), ...parsed };
        migrate(cache);
        ensureDirs();
        fs.writeFileSync(MEMORY_FILE, JSON.stringify(cache, null, 2), 'utf-8');
        console.log('[Memory] ✓ Hydrated memory core from Redis.');
        consolidateMemory();
        return true;
      }
      return false; // reachable but empty — settled, nothing to hydrate
    } catch (e) {
      // B218 — kill THIS client so the next attempt reconnects cleanly.
      try { if (redisClient === r) { r.disconnect(); redisClient = null; } } catch { /* best-effort */ }
      if (attempt < maxAttempts) {
        console.error(`[Memory] Redis hydrate failed (attempt ${attempt}/${maxAttempts}), retrying in ${delays[attempt - 1]}ms: ${e.message}`);
        await new Promise((res) => setTimeout(res, delays[attempt - 1]));
        continue;
      }
      console.error(`[Memory] Redis hydrate failed after ${maxAttempts} attempts, using local file: ${e.message}`);
      // B158 — a proven-dead Redis must not keep reporting "active" in health
      // checks: close the client and disable the layer (process is honest, and
      // disk/JSON remains the source of truth).
      try { if (redisClient) redisClient.disconnect(); } catch { /* best-effort */ }
      redisClient = null;
      redisEnabled = false;
    }
  }
  return false;
}

async function redisPush(memory) {
  if (!redisEnabled) return;
  const r = await getRedis();
  if (!r) return;
  try { await r.set(MEMORY_REDIS_KEY, JSON.stringify(memory), 'EX', 60 * 60 * 24 * 30); } // 30-day TTL
  catch (e) { console.error('[Memory] Redis write failed:', e.message); }
}

/** True when a Redis layer is configured (used by the load-balancer health check). */
export function isRedisActive() {
  return redisEnabled && !!redisClient;
}

/**
 * B218 — cleanly close the shared Redis client (tests + graceful shutdown:
 * Render sends SIGTERM on deploys; an open client keeps the event loop alive).
 */
export function closeRedis() {
  try { if (redisClient) redisClient.disconnect(); } catch { /* best-effort */ }
  redisClient = null;
}

/**
 * B68/B158 — truthful health summary for /api/health/memory and the LB:
 *   { configured, status: 'unset'|'ready'|'connecting'|'down'|'off', error? }
 * 'unset' = no REDIS_URL at all; 'off' = configured but disabled after a
 * proven failure; 'down' = configured but the client is not connected.
 */
export function redisConnectionInfo() {
  if (!process.env.REDIS_URL) return { configured: false, status: 'unset' };
  if (!redisEnabled) return { configured: true, status: 'off', error: 'disabled after a connection failure this process' };
  if (!redisClient) return { configured: true, status: 'connecting' };
  const st = String(redisClient.status || 'unknown');
  if (st === 'ready') return { configured: true, status: 'ready' };
  if (st === 'connecting' || st === 'connect' || st === 'reconnecting' || st === 'wait') return { configured: true, status: 'connecting' };
  return { configured: true, status: 'down', error: `client status: ${st}` };
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

export function loadMemory() {
  ensureDirs();
  if (cache) return cache;
  try {
    if (fs.existsSync(MEMORY_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf-8'));
      cache = { ...structuredClone(DEFAULT_MEMORY), ...parsed };
      migrate(cache);
      if (!consolidated) consolidateMemory(); // merge near-duplicates once per boot
      return cache;
    }
  } catch (e) {
    console.error('[Memory] load error:', e.message);
  }
  cache = structuredClone(DEFAULT_MEMORY);
  return cache;
}

export function saveMemory() {
  ensureDirs();
  try {
    fs.writeFileSync(MEMORY_FILE, JSON.stringify(loadMemory(), null, 2), 'utf-8');
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
// Only start compressing once the history is comfortably past the verbatim window.
const SUMMARY_THRESHOLD = 28;

/** Cached rolling summary of the whole conversation ('' until it exists). */
export function getRollingSummary() {
  return loadMemory().conversationSummary || '';
}

/**
 * Async context compaction — compress the turns older than the recent window
 * into one dense running summary (Mem0/DeepAgents pattern). No AI keys → the
 * cached summary is returned untouched; failures never break a chat.
 */
export async function rollingConversationSummary({ force = false, __generate = null } = {}) {
  const mem = loadMemory();
  const turns = mem.chatHistory || [];
  // B78/B158 — token-pressure estimate (chars/4 ≈ tokens) + optional explicit
  // threshold (JEXI_COMPACTION_TOKENS). Compaction fires on EITHER the turn
  // count threshold or token pressure — mirrors dsh compaction triggers.
  const estimatedTokens = Math.ceil(turns.reduce((a, h) => a + String(h.text || '').length, 0) / 4);
  const tokenThreshold = Number(process.env.JEXI_COMPACTION_TOKENS || 0) || null;
  if (!force && turns.length < SUMMARY_THRESHOLD && !(tokenThreshold && estimatedTokens >= tokenThreshold)) {
    return mem.conversationSummary || '';
  }

  const old = turns.slice(0, Math.max(0, turns.length - SUMMARY_RECENT_TURNS));
  if (!force && old.length === 0) return mem.conversationSummary || '';

  // B78 — __generate is the TEST SEAM (a deterministic generator so tests
  // prove the compaction path without any key). Production keeps the
  // provider router.
  const gen = typeof __generate === 'function' ? __generate : null;
  const keys = gen ? { groqKey: true } : resolveKeys();
  if (!keys.groqKey && !keys.geminiKey && !keys.openrouterKey) return mem.conversationSummary || '';

  const prior = mem.conversationSummary ? `Previous running summary:\n${mem.conversationSummary}\n\n` : '';
  const text = old
    .map((h) => `${h.role === 'user' ? 'User' : 'JEXI'}: ${String(h.text).slice(0, 800)}`)
    .join('\n');
  if (!text.trim()) return mem.conversationSummary || '';

  try {
    const prompt = `${prior}Compress this conversation into a dense running summary (max 400 words, bullet points). Keep: the user's goals, key decisions, facts about the user, open tasks, and anything JEXI promised or built. Drop small talk and repeats.\n\nCONVERSATION TO COMPRESS:\n${text.slice(0, 24000)}`;
    const system = 'You are JEXI OS\'s Context Manager. Output ONLY the compressed summary.';
    const summary = await (gen ? gen() : generateContent(prompt, system)); // await BOTH — the seam is async too
    const clean = String(summary || '').trim().slice(0, 2500);
    if (clean.length >= 20) {
      mem.conversationSummary = clean;
      saveMemory();
      // B78/B158 — the durable event log records the compaction (dsh
      // compaction/* events) with the real trigger + metrics.
      try {
        appendEvent('context_compaction', {
          trigger: force ? 'manual' : 'token_threshold',
          ...(force ? {} : { threshold: tokenThreshold || SUMMARY_THRESHOLD, estimatedTokens }),
          turnsCompressed: old.length,
        });
      } catch { /* the event log must never break a compaction */ }
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
  try { fs.writeFileSync(MEMORY_FILE, JSON.stringify(cache, null, 2), 'utf-8'); } catch (e) {}
  if (redisEnabled) { getRedis().then(r => { if (r) r.del(MEMORY_REDIS_KEY).catch(() => {}); }).catch(() => {}); }
  // Also wipe generated workspace files
  try {
    if (fs.existsSync(WORKSPACE_DIR)) fs.readdirSync(WORKSPACE_DIR).forEach(f => fs.unlinkSync(path.join(WORKSPACE_DIR, f)));
  } catch (e) {}
  // B162d — a memory clear must be COMPLETE: conversation logs (chat
  // history), their pinned titles and the durable event log go too, so
  // nothing from before the wipe can resurface in a later prompt.
  try { clearAllConversations(); } catch { /* sessions best-effort */ }
  try { clearEventLog(); } catch { /* events best-effort */ }
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

/* B199 — failure notices must never become "learned knowledge". A failed
   retrieval sentinel ("I could not find enough information…"), a degraded
   no-key synthesis notice, or an explicit source refusal is NOT knowledge —
   but it WAS being saved to internetKnowledge and then served instantly
   from memory on the next identical ask ("she remembers failing and refuses
   to retry"). One shared detector protects every save + recall path. */
const NON_ANSWER_PATTERNS = [
  /could not find enough information in my retrieved sources/i,
  /was unavailable \(no api key/i,
  /no readable summary/i,
  /\b(does not contain|do not contain|doesn't contain|don't contain|no information (?:about|on|regarding)|cannot compile|can't compile|cannot answer|can't answer|not covered|doesn't cover|does not cover|no relevant (?:information|content|passage|details?|material)|unable to (?:answer|provide|compile))\b/i,
];
export function isNonAnswerText(text) {
  const t = String(text || '').trim();
  if (!t) return true;
  const head = t.slice(0, 400).replace(/[’‘]/g, "'");
  return NON_ANSWER_PATTERNS.some((re) => re.test(head));
}

/** B199 — remove previously-poisoned entries (self-heal at boot). */
export function purgeNonAnswerKnowledge() {
  const mem = loadMemory();
  const before = (mem.internetKnowledge || []).length + (mem.learnedAnswers || []).length;
  mem.internetKnowledge = (mem.internetKnowledge || []).filter((e) => !isNonAnswerText(e.answer));
  mem.learnedAnswers = (mem.learnedAnswers || []).filter((e) => !isNonAnswerText(e.answer));
  const removed = before - (mem.internetKnowledge.length + mem.learnedAnswers.length);
  if (removed > 0) {
    saveMemory();
    console.log(`[Memory] purged ${removed} non-answer entr${removed === 1 ? 'y' : 'ies'} (failed retrievals must never pose as knowledge)`);
  }
  return removed;
}

export function saveInternetKnowledge(topic, answer, sources = []) {
  // B199 — a failure notice is not knowledge: refuse to store it.
  if (isNonAnswerText(answer)) return null;
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
  const list = (mem.internetKnowledge || []).filter((e) => !isNonAnswerText(e.answer)); // B199 — never recall a failure notice
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
  const list = (mem.internetKnowledge || []).filter((e) => !isNonAnswerText(e.answer)); // B199
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
  // B189 — PRECISION GATE (the wrong-app bug): 'give me the preview link'
  // matched an old expense-tracker solution at a loose 0.25 floor and she
  // delivered the WRONG app. Reuse now requires (a) a much higher search
  // score AND (b) real word overlap between the stored goal and THIS ask.
  const hits = await hybridSearch(list, query, { relevanceFloor: 0.55, limit: 3 });
  if (!hits.length) return null;
  const qWords = new Set(String(query || '').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3));
  for (const h of hits) {
    const goal = String(h.entry?.goal || h.entry?.query || '');
    const gWords = new Set(goal.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3));
    if (!qWords.size || !gWords.size) continue;
    let overlap = 0;
    for (const w of qWords) if (gWords.has(w)) overlap += 1;
    if (overlap >= Math.max(2, Math.floor(qWords.size * 0.4))) return h.entry;
  }
  return null; // nothing genuinely matches — build fresh
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
/* B199 — stop-words for knowledge-library matching. Generic English and
   programming words must NEVER score a library "match" on their own. Before
   this, a question about African countries matched a JavaScript tips book
   because ordinary words like "list", "table", "with", "columns", "year"
   appear in every text — the books path then HIJACKED the answer and shipped
   the model's "this book has nothing about that" reply as the FINAL answer
   ("mission complete", 95% confidence, zero real content). */
const KNOWLEDGE_STOPWORDS = new Set(('about,above,after,again,against,all,also,although,always,among,another,any,anyone,'
  + 'are,around,back,been,before,being,below,best,better,between,both,bring,build,built,came,can,cannot,come,could,'
  + 'create,does,doing,done,down,during,each,early,either,else,enough,even,every,exactly,example,explain,find,'
  + 'first,for,from,give,given,going,good,got,had,has,have,having,help,here,how,information,into,just,keep,kind,know,'
  + 'last,late,later,least,less,let,like,list,little,long,look,make,making,many,matter,more,most,much,must,'
  + 'need,never,next,nice,none,not,note,nothing,now,off,often,once,one,only,open,other,others,out,over,own,'
  + 'part,people,please,point,pretty,put,question,quite,read,really,right,same,search,see,seem,show,some,'
  + 'something,soon,still,stop,such,take,tell,than,that,their,them,then,there,these,they,thing,things,think,'
  + 'this,those,through,time,today,together,told,too,took,toward,turn,under,until,use,used,using,want,was,'
  + 'way,well,went,were,what,when,where,which,while,who,why,will,with,within,without,would,write,yes,yet,you,your,'
  // generic technical words that appear in almost every programming note
  + 'code,data,file,files,page,pages,table,tables,year,years,number,numbers,value,values,item,items,name,names,text,content').split(','));

export function searchKnowledge(query, minScore = 2) {
  const results = [];
  // B199 — score on DISTINCTIVE terms only: stop-words are removed before any
  // counting, and a match must hit at least one distinctive term. When the
  // question carries several distinctive terms (a real topical question), a
  // single stray hit is not enough — require two.
  const qAll = query.toLowerCase().split(/\s+/).filter(w => w.length > 3);
  const q = qAll.filter(w => !KNOWLEDGE_STOPWORDS.has(w));
  if (q.length === 0) return results; // nothing distinctive to match on — no library hit
  const count = (hay) => q.reduce((acc, w) => acc + (hay.includes(w) ? 1 : 0), 0);
  const minDistinctive = q.length >= 4 ? 2 : 1;

  // 1) The user's own books (memory-first: survives restarts via Redis mirror)
  for (const book of loadMemory().bookLibrary || []) {
    const text = book.text || '';
    const score = count(text.toLowerCase());
    if (score >= minDistinctive) {
      const excerpt = bestExcerpt(text, q);
      if (excerpt) results.push({ title: book.name, category: 'USER_BOOKS', content: excerpt, score, source: 'book' });
    }
  }

  // 2) Studied topic files on disk (indexed — read once per change, not per query)
  const skipBooks = loadMemory().bookLibrary.length > 0;
  const threshold = Math.max(Math.min(minScore, q.length), minDistinctive);
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
