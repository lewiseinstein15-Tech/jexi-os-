import { generateContent, resolveKeys } from './LLMClient.js';
import { rememberUserFact, loadMemory } from './MemoryManager.js';
import { cosineSimilarity } from './MemoryManager.js';

/**
 * Preference Learner — Mem0-style memory for JEXI.
 * -------------------------------------------------
 * The regex extractor in MemoryManager catches "my name is…" / "I like…", but
 * real preferences are usually stated freely: "always write tests first",
 * "keep your answers short", "I build apps with React". Mem0's trick is to let
 * the LLM extract durable memories from every exchange. This module does the
 * same with JEXI's existing AI keys (Groq first — fast & free) and stores the
 * results in the same userFacts store, so all the existing scoring, pruning
 * and consolidation apply unchanged.
 *
 *   EXTRACT → parse (defensive JSON) → dedupe (exact + tf-idf cosine) → store
 *   RECALL  → top preferences by importance × recency → injected into every
 *             agent system prompt + conversation context.
 *
 * Everything is fire-and-forget and never throws: a failed extraction is just
 * a skipped memory, never a broken chat.
 */

const EXTRACTION_INTERVAL_MS = 2 * 60 * 1000; // at most one extraction per 2 min
const MIN_QUERY_LEN = 8;                       // skip "yes", "ok", "thanks" noise
const MAX_MEMORIES_PER_PASS = 4;

const IMPORTANCE_BY_TYPE = { preference: 5, identity: 5, fact: 4 };
const VALID_TYPES = new Set(['preference', 'fact', 'identity']);

let lastExtractionAt = 0;

/* ------------------------------------------------------------------ */
/* Defensive JSON parsing (LLMs wrap arrays in ```json fences, etc.)   */
/* ------------------------------------------------------------------ */

export function parseMemoriesJson(raw) {
  let text = String(raw || '').trim();
  if (!text) return [];
  // Strip ```json ... ``` fences and any surrounding prose
  text = text.replace(/```(?:json)?/gi, '');
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start === -1 || end === -1 || end <= start) return [];
  try {
    const parsed = JSON.parse(text.slice(start, end + 1));
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((m) => ({
        type: VALID_TYPES.has(String(m.type || '').toLowerCase()) ? String(m.type).toLowerCase() : 'fact',
        content: String(m.content || m.fact || '').trim().slice(0, 300),
      }))
      .filter((m) => m.content.length >= 8)
      .slice(0, MAX_MEMORIES_PER_PASS);
  } catch (e) {
    return [];
  }
}

/* ------------------------------------------------------------------ */
/* Dedupe — exact match or tf-idf cosine >= 0.85 (same bar as the       */
/* existing consolidation pass, so repeats never pile up).              */
/* ------------------------------------------------------------------ */

export function dedupeMemory(text, existingFacts) {
  const t = String(text || '').trim().toLowerCase();
  if (t.length < 8) return true; // too short to be worth storing
  for (const f of existingFacts) {
    const other = String(f.fact || '').trim().toLowerCase();
    if (!other) continue;
    if (other === t) return true;
    if (cosineSimilarity(t, other) >= 0.85) return true;
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* LLM extraction                                                       */
/* ------------------------------------------------------------------ */

const EXTRACTION_PROMPT = (userQuery) => `Read the user's message and extract up to 4 DURABLE memories worth remembering long-term.

Extract ONLY:
- "preference" — how the user likes things done (communication style, code style, tools, design, workflow rules, likes/dislikes)
- "fact"      — stable personal facts (job, projects, skills, goals, family, location)
- "identity"  — who the user is (name, role, profession)

Rules:
- ONLY extract what the USER stated about THEMSELVES — never the assistant, never generic advice.
- Skip greetings, thanks, one-off tasks, requests for help, and anything temporary.
- Phrase each memory as a complete statement, e.g. "User always writes tests first", "User prefers short, direct answers", "User is building a multi-agent AI app called JEXI".
- Return ONLY a JSON array, no prose, no markdown:
[{"type": "preference", "content": "..."}]

NEGATIVE EXAMPLES — extract NOTHING from these (they are NOT durable preferences):
1. "Can you help me write a Python script today?" → [] (a one-off task request, not a stable preference)
2. "If I ever built a startup, I would focus on retention." → [] (a hypothetical, not a real fact about the user)
3. "My friend says React is better than Vue." → [] (a quoted third-party statement, not the user's own preference)
4. "This calculator is really slow." → [] (a one-off complaint about the moment, not a durable preference)

User message: "${String(userQuery).slice(0, 1500)}"`;

async function extractPreferences(userQuery) {
  const { groqKey, geminiKey } = resolveKeys();
  if (!groqKey && !geminiKey) return [];
  try {
    const raw = await generateContent(
      EXTRACTION_PROMPT(userQuery),
      'You are JEXI\'s memory extraction engine. You only ever output a JSON array of memories. Nothing else.',
      null,
      { temperature: 0.1 }
    );
    return parseMemoriesJson(raw);
  } catch (e) {
    console.error('[PreferenceLearner] extraction failed:', e.message);
    return [];
  }
}

/* ------------------------------------------------------------------ */
/* Recall — top preferences by importance × recency                     */
/* ------------------------------------------------------------------ */

function hoursSince(iso) {
  try { return Math.max(0, (Date.now() - new Date(iso).getTime()) / 3600000); } catch (e) { return 0; }
}

/** Top stored preferences for context injection (importance × recency). */
export function recallPreferences(n = 3) {
  const mem = loadMemory();
  return (mem.userFacts || [])
    .filter((f) => f.label === 'preference' || (f.importance || 0) >= 4)
    .map((f) => ({ f, v: (f.importance || 3) * Math.pow(0.99, hoursSince(f.lastAccess || f.date)) }))
    .sort((a, b) => b.v - a.v)
    .slice(0, n)
    .map((x) => x.f.fact);
}

/** Markdown block appended to system prompts so EVERY agent follows the user's preferences. */
export function preferencesBlock(limit = 3) {
  const prefs = recallPreferences(limit);
  if (!prefs.length) return '';
  return `\n\n# USER PREFERENCES (learned from past conversations — follow these)\n${prefs.map((p) => `- ${p}`).join('\n')}`;
}

/* ------------------------------------------------------------------ */
/* Orchestration — called fire-and-forget after each chat exchange      */
/* ------------------------------------------------------------------ */

/**
 * Learn from a user message. Never throws, never blocks the response.
 * Budget-guarded: skips short messages and runs at most once per 2 min.
 */
export async function learnFromExchange(userQuery) {
  const query = String(userQuery || '').trim();
  if (query.length < MIN_QUERY_LEN) return;
  const now = Date.now();
  if (now - lastExtractionAt < EXTRACTION_INTERVAL_MS) return;
  const { groqKey, geminiKey } = resolveKeys();
  if (!groqKey && !geminiKey) return;

  const memories = await extractPreferences(query);
  if (!memories.length) { lastExtractionAt = now; return; }

  const existing = (loadMemory().userFacts || []).filter(Boolean);
  let stored = 0;
  for (const m of memories) {
    if (dedupeMemory(m.content, existing)) continue;
    rememberUserFact(m.content, IMPORTANCE_BY_TYPE[m.type] || 4, m.type);
    existing.push({ fact: m.content });
    stored++;
  }
  if (stored) console.log(`[PreferenceLearner] stored ${stored} new memor${stored === 1 ? 'y' : 'ies'} from this exchange`);
  lastExtractionAt = now;
}
