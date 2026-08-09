import fs from 'fs';
import path from 'path';
import { MEMORY_FILE, KNOWLEDGE_DIR, WORKSPACE_DIR } from '../config.js';

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
      migrate(cache);
      ensureDirs();
      fs.writeFileSync(MEMORY_FILE, JSON.stringify(cache, null, 2), 'utf-8');
      console.log('[Memory] ✓ Hydrated memory core from Redis.');
      consolidateMemory();
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

function extractFactsFromMessage(text) {
  const facts = [];
  for (const p of FACT_PATTERNS) {
    const m = String(text || '').match(p.re);
    if (!m) continue;
    const fact = p.build(m).replace(/\s+/g, ' ').trim();
    if (fact.length > 8) facts.push({ fact, label: p.label, importance: p.importance });
  }
  return facts;
}

export function addChat(role, text) {
  const mem = loadMemory();
  mem.chatHistory.push({ role, text: String(text || '').slice(0, 20000), time: new Date().toISOString() });
  // Keep the last 200 exchanges so long conversations stay focused
  if (mem.chatHistory.length > 200) mem.chatHistory = mem.chatHistory.slice(-200);

  // User messages may carry lasting facts — capture them into semantic memory
  if (role === 'user') {
    for (const f of extractFactsFromMessage(text)) rememberUserFact(f.fact, f.importance, f.label);
  }
  saveMemory();
}

export function getChatHistory(n = 20) {
  return loadMemory().chatHistory.slice(-n);
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
    mem.userFacts.push({ fact: text, label: label || 'fact', importance, date: new Date().toISOString(), lastAccess: new Date().toISOString(), accessCount: 0 });
  }
  prune(mem, 'userFacts');
  saveMemory();
  return mem.userFacts[mem.userFacts.length - 1];
}

/** Retrieve facts relevant to the current context (three-pillar scoring). */
export function searchUserFacts(query, limit = 5) {
  const mem = loadMemory();
  const facts = mem.userFacts || [];
  if (!facts.length) return [];
  const idf = buildIdf(facts.map((f) => `${f.fact} ${f.label || ''}`));
  const scored = facts
    .map((f) => {
      const { score, relevance } = memoryScore(query, { ...f, topic: f.fact, answer: f.label }, idf);
      return { fact: f, score, relevance };
    })
    .filter((r) => r.relevance >= 0.15)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
  for (const r of scored) touch(r.fact);
  return scored.map((r) => r.fact);
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
  return entry;
}

export function searchInternetKnowledge(query) {
  const mem = loadMemory();
  const list = mem.internetKnowledge;
  if (!list.length) return null;
  const idf = buildIdf(list.map((e) => `${e.topic} ${e.answer}`));
  let best = null, bestScore = 0;
  for (const entry of list) {
    const { score, relevance } = memoryScore(query, entry, idf);
    // Need a genuine topical match: at least some semantic overlap AND a solid composite
    if (relevance >= 0.12 && score > bestScore) { best = entry; bestScore = score; }
  }
  if (!best) return null;
  touch(best);
  saveMemory();
  return best;
}

/**
 * Same as searchInternetKnowledge, but only returns answers JEXI learned
 * recently (default: within the last 30 minutes). Used for instant repeat
 * answers — e.g. asking the same news question twice within minutes.
 */
export function searchFreshInternetKnowledge(query, maxAgeMs = 30 * 60 * 1000) {
  const mem = loadMemory();
  const list = mem.internetKnowledge;
  if (!list.length) return null;
  const idf = buildIdf(list.map((e) => `${e.topic} ${e.answer}`));
  let best = null, bestScore = 0;
  for (const entry of list) {
    const { score, relevance } = memoryScore(query, entry, idf);
    if (relevance >= 0.3 && score > bestScore) { best = entry; bestScore = score; }
  }
  if (!best) return null;
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
  return entry;
}

export function searchCodingKnowledge(query) {
  const mem = loadMemory();
  const list = mem.codingKnowledge;
  if (!list.length) return null;
  const idf = buildIdf(list.map((e) => `${e.topic} ${e.solution}`));
  let best = null, bestScore = 0;
  for (const entry of list) {
    const { score, relevance } = memoryScore(query, entry, idf);
    // Strict recall: only a genuinely SIMILAR build is reused — tf-idf relevance
    // floor of 0.28 stops a different app that merely shares a word (e.g. "dark
    // theme") from hijacking the pipeline. Then rank by the composite score.
    if (relevance >= 0.28 && score > bestScore) { best = entry; bestScore = score; }
  }
  if (!best) return null;
  touch(best);
  saveMemory();
  return best;
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
