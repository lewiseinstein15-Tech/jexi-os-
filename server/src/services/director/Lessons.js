/**
 * B211 B2 — OPERATIONAL LESSONS: failure → cause → strategy → lesson,
 * persisted ACROSS missions and retrievable at planning/steering time.
 *
 * Every lesson comes from a real event in a real mission (an item that
 * failed after the recovery ladder, a recovery that worked, a prediction
 * that deviated from reality). Nothing is written here that did not happen.
 *
 * Store: DATA_DIR/missions/lessons.json — the same missions store family,
 * one JSON file, atomic write (tmp + rename), capped at MAX_LESSONS newest.
 */

import fs from 'fs';
import path from 'path';
import { DATA_DIR } from '../../config.js';

export const MAX_LESSONS = 300;

const LESSONS_FILE = path.join(DATA_DIR, 'missions', 'lessons.json');

let __cache = null;
let __seq = 0;

function load() {
  if (__cache) return __cache;
  try {
    __cache = JSON.parse(fs.readFileSync(LESSONS_FILE, 'utf8'));
    if (!Array.isArray(__cache)) __cache = [];
  } catch {
    __cache = [];
  }
  return __cache;
}

function persist() {
  fs.mkdirSync(path.dirname(LESSONS_FILE), { recursive: true });
  const tmp = `${LESSONS_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(load(), null, 2));
  fs.renameSync(tmp, LESSONS_FILE);
}

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const STOP = new Set(['the', 'a', 'an', 'and', 'or', 'to', 'of', 'for', 'in', 'on', 'with', 'is', 'are', 'was', 'it', 'this', 'that', 'my', 'our', 'mission', 'item', 'work']);
const tokens = (s) => norm(s).split(' ').filter((t) => t.length > 2 && !STOP.has(t));

/**
 * Record one operational lesson. Dedupes on content hash; keeps the newest
 * MAX_LESSONS entries. Returns the stored entry (or the existing twin).
 */
export function recordLesson({ kind, missionId, objective, itemTitle, failure, cause, strategy, lesson }) {
  const all = load();
  const entry = {
    id: `lsn-${Date.now().toString(36)}-${String(++__seq).padStart(3, '0')}`,
    kind: ['failure', 'recovery', 'deviation'].includes(kind) ? kind : 'failure',
    missionId: String(missionId || '') || null,
    objective: String(objective || '').slice(0, 300),
    itemTitle: String(itemTitle || '') || null,
    failure: String(failure || '') || null,
    cause: String(cause || '') || null,
    strategy: String(strategy || '') || null,
    lesson: String(lesson || '').slice(0, 900),
    at: new Date().toISOString(),
  };
  const twin = all.find((l) => norm(l.lesson) === norm(entry.lesson));
  if (twin) { twin.lastSeenAt = entry.at; twin.times = (twin.times || 1) + 1; persist(); return twin; }
  all.push(entry);
  while (all.length > MAX_LESSONS) all.shift();
  persist();
  return entry;
}

/**
 * Retrieve lessons relevant to a query (objective, item title, failure
 * reason...). Token-overlap relevance; returns [] when nothing matches.
 */
export function retrieveLessons(query, limit = 3) {
  const q = tokens(query);
  if (!q.length) return [];
  const scored = load().map((l) => {
    const hay = tokens([l.objective, l.itemTitle, l.failure, l.cause, l.lesson].filter(Boolean).join(' '));
    if (!hay.length) return null;
    const hits = q.filter((t) => hay.includes(t)).length;
    return hits ? { l, score: hits / q.length + (l.times || 1) * 0.01 } : null;
  }).filter(Boolean);
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, Math.max(1, limit)).map((s) => s.l);
}

/** Prompt block for planners — empty string when there is nothing real to say. */
export function formatLessonsBlock(lessons) {
  if (!lessons || !lessons.length) return '';
  const lines = lessons.map((l) => {
    const scope = l.itemTitle ? ` (item: ${l.itemTitle.slice(0, 60)})` : '';
    const cause = l.cause ? ` — cause: ${l.cause.slice(0, 100)}` : '';
    return `- [${l.kind}${scope}] ${l.lesson}${cause}`;
  });
  return ['# OPERATIONAL LESSONS (from real past missions — learn, do not repeat)', ...lines].join('\n');
}

export function lessonCount() { return load().length; }
