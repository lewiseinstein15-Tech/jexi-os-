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

export function searchKnowledge(query) {
  const results = [];
  const q = query.toLowerCase().split(/\s+/).filter(w => w.length > 3);
  if (q.length === 0) return results;
  const walk = (dir, cat) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, cat || entry.name);
      else if (entry.isFile() && entry.name.endsWith('.md')) {
        try {
          const content = fs.readFileSync(full, 'utf-8');
          const score = q.reduce((acc, w) => acc + (content.toLowerCase().includes(w) ? 1 : 0), 0);
          if (score >= Math.min(2, q.length)) {
            results.push({ title: entry.name.replace('.md', ''), category: cat || 'general', content: content.slice(0, 20000), score });
          }
        } catch (e) {}
      }
    }
  };
  walk(KNOWLEDGE_DIR, null);
  results.sort((a, b) => b.score - a.score);
  return results;
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
