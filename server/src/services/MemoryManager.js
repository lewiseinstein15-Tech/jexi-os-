import fs from 'fs';
import path from 'path';
import { MEMORY_FILE, KNOWLEDGE_DIR, WORKSPACE_DIR } from '../config.js';

/**
 * JEXI OS Memory Core
 * -------------------
 * Persists everything JEXI learns so she can:
 *   - run very long conversations without losing focus
 *   - remember the user across sessions
 *   - retrieve previously learned answers from "her mind" instead of re-searching
 *   - keep a structured knowledge library of studied topics
 *
 * PERSISTENCE LAYERS (in order):
 *  1. Local JSON file (server/data/memory.json) — always used, fast
 *  2. Redis (REDIS_URL, e.g. Upstash) — optional, survives redeploys/restarts on Render
 */

const MEMORY_REDIS_KEY = 'jexi:memory';

const DEFAULT_MEMORY = {
  userProfile: { name: '', location: '', interests: [] },
  chatHistory: [],          // { role, text, time }
  internetKnowledge: [],    // { topic, answer, sources[], date }
  codingKnowledge: [],      // { topic, language, solution, files[], date }
  learnedAnswers: [],       // { question, answer, date }  (distilled Q&A)
  bookLibrary: [],          // { name, file, chars, size, date, text } — the user's own books
};

let cache = null;
let redisClient = null;
let redisEnabled = Boolean(process.env.REDIS_URL);

function ensureDirs() {
  fs.mkdirSync(path.dirname(MEMORY_FILE), { recursive: true });
  fs.mkdirSync(KNOWLEDGE_DIR, { recursive: true });
}

/* ---------------- Redis (optional durable layer) ---------------- */

async function getRedis() {
  if (!redisEnabled) return null;
  if (redisClient) return redisClient;
  try {
    const { Redis } = await import('ioredis');
    redisClient = new Redis(process.env.REDIS_URL, {
      lazyConnect: true,
      maxRetriesPerRequest: 2,
      enableReadyCheck: true,
    });
    return redisClient;
  } catch (e) {
    console.error('[Memory] Redis client failed to init, using local file only:', e.message);
    redisEnabled = false;
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
    if (raw) {
      const parsed = JSON.parse(raw);
      cache = { ...structuredClone(DEFAULT_MEMORY), ...parsed };
      ensureDirs();
      fs.writeFileSync(MEMORY_FILE, JSON.stringify(cache, null, 2), 'utf-8');
      console.log('[Memory] ✓ Hydrated memory core from Redis.');
      return true;
    }
  } catch (e) {
    console.error('[Memory] Redis hydrate failed, using local file:', e.message);
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

/* ---------------- Local JSON store ---------------- */

export function loadMemory() {
  ensureDirs();
  if (cache) return cache;
  try {
    if (fs.existsSync(MEMORY_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf-8'));
      cache = { ...structuredClone(DEFAULT_MEMORY), ...parsed };
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

export function resetCache() { cache = null; }

/* ------------------------------------------------------------------ */
/* Chat history (long conversations)                                   */
/* ------------------------------------------------------------------ */

export function addChat(role, text) {
  const mem = loadMemory();
  mem.chatHistory.push({ role, text: String(text || '').slice(0, 20000), time: new Date().toISOString() });
  // Keep the last 200 exchanges so long conversations stay focused
  if (mem.chatHistory.length > 200) mem.chatHistory = mem.chatHistory.slice(-200);
  saveMemory();
}

export function getChatHistory(n = 20) {
  return loadMemory().chatHistory.slice(-n);
}

export function clearMemory() {
  cache = structuredClone(DEFAULT_MEMORY);
  ensureDirs();
  try { fs.writeFileSync(MEMORY_FILE, JSON.stringify(cache, null, 2), 'utf-8'); } catch (e) {}
  if (redisEnabled) { getRedis().then(r => { if (r) r.del(MEMORY_REDIS_KEY).catch(() => {}); }).catch(() => {}); }
  // Also wipe generated workspace files
  try {
    if (fs.existsSync(WORKSPACE_DIR)) fs.readdirSync(WORKSPACE_DIR).forEach(f => fs.unlinkSync(path.join(WORKSPACE_DIR, f)));
  } catch (e) {}
}

/* ------------------------------------------------------------------ */
/* User profile                                                        */
/* ------------------------------------------------------------------ */

export function updateUserProfile(patch) {
  const mem = loadMemory();
  mem.userProfile = { ...mem.userProfile, ...(patch || {}) };
  saveMemory();
}

/* ------------------------------------------------------------------ */
/* Learned internet knowledge (JEXI's "mind" for research topics)      */
/* ------------------------------------------------------------------ */

export function saveInternetKnowledge(topic, answer, sources = []) {
  const mem = loadMemory();
  const entry = { topic: String(topic).slice(0, 300), answer: String(answer).slice(0, 30000), sources: sources.slice(0, 10), date: new Date().toISOString() };
  mem.internetKnowledge = mem.internetKnowledge.filter(e => e.topic.toLowerCase() !== topic.toLowerCase());
  mem.internetKnowledge.push(entry);
  // Also distil into learned answers for fast retrieval
  mem.learnedAnswers.unshift({ question: topic, answer: entry.answer, date: entry.date });
  if (mem.learnedAnswers.length > 100) mem.learnedAnswers = mem.learnedAnswers.slice(0, 100);
  saveMemory();
  return entry;
}

export function searchInternetKnowledge(query) {
  const mem = loadMemory();
  const q = query.toLowerCase().split(/\s+/).filter(w => w.length > 3);
  if (q.length === 0) return null;
  const scored = mem.internetKnowledge
    .map(entry => {
      const hay = `${entry.topic} ${entry.answer}`.toLowerCase();
      const score = q.reduce((acc, w) => acc + (hay.includes(w) ? 1 : 0), 0);
      return { entry, score };
    })
    .filter(r => r.score >= Math.min(2, q.length))
    .sort((a, b) => b.score - a.score);
  return scored[0]?.entry || null;
}

/**
 * Same as searchInternetKnowledge, but only returns answers JEXI learned
 * recently (default: within the last 30 minutes). Used for instant repeat
 * answers — e.g. asking the same news question twice within minutes.
 */
export function searchFreshInternetKnowledge(query, maxAgeMs = 30 * 60 * 1000) {
  const entry = searchInternetKnowledge(query);
  if (!entry?.date) return null;
  const age = Date.now() - new Date(entry.date).getTime();
  if (!Number.isFinite(age) || age > maxAgeMs) return null;
  return entry;
}

/* ------------------------------------------------------------------ */
/* Coding solutions (JEXI's "mind" for code tasks)                     */
/* ------------------------------------------------------------------ */

export function saveCodingKnowledge(topic, language, solution, files = []) {
  const mem = loadMemory();
  const entry = { topic: String(topic).slice(0, 300), language, solution: String(solution).slice(0, 30000), files: files.slice(0, 10), date: new Date().toISOString() };
  mem.codingKnowledge = mem.codingKnowledge.filter(e => e.topic.toLowerCase() !== topic.toLowerCase());
  mem.codingKnowledge.push(entry);
  saveMemory();
  return entry;
}

export function searchCodingKnowledge(query) {
  const mem = loadMemory();
  const q = query.toLowerCase().split(/\s+/).filter(w => w.length > 3);
  if (q.length === 0) return null;
  const scored = mem.codingKnowledge
    .map(entry => {
      const hay = `${entry.topic} ${entry.solution}`.toLowerCase();
      const score = q.reduce((acc, w) => acc + (hay.includes(w) ? 1 : 0), 0);
      return { entry, score };
    })
    .filter(r => r.score >= 1)
    .sort((a, b) => b.score - a.score);
  return scored[0]?.entry || null;
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
