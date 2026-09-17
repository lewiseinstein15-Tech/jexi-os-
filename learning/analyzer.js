/**
 * JEXI OS — Phase 7 Scope C: CONTINUOUS LEARNING — analyzer.
 *
 * Runs at Stop (turn end, via the kernel seam) or on demand. Reads the
 * observer journal for a session and extracts candidate instincts:
 *
 *   error_resolution       — error → fix → success triple (same tool recovered)
 *   workarounds            — same failure hit 2+ times, then resolved
 *                            DIFFERENTLY (success via another tool)
 *   debugging_techniques   — a read → hypothesis → run cycle that found the bug
 *   project_specific       — a repeated file/pattern that recurs in the session
 *   user_corrections       — user rephrases a request (needs conversation input)
 *
 * Confidence factors (see learning/instinct.js): how many times the pattern
 * was seen, how recent it was, whether it succeeded, whether the same pattern
 * failed before (previous store snapshot ended in outcome 'failed').
 *
 * Each session is analyzed ONCE — a marker file prevents double-counting
 * (bypass with { force: true }).
 */

import fs from 'node:fs';
import path from 'node:path';
import { readJournal, journalPath } from './observer.js';
import { projectStorePath } from './store.js';
import { evidenceEntry, instinctId } from './instinct.js';
import { recordCandidate, foldStore } from './store.js';

const READ_LIKE = /read|inspect|search|list|show|view|open/i;
const PATH_LIKE = /(\/[A-Za-z0-9._-]+){2,}|[A-Za-z0-9_-]+\.(js|json|ts|py|md|ya?ml|sh|css|html)/g;
const MAX_PER_ANALYSIS = 12;
const PATH_MIN_HITS = 3;

const STOP_TOKENS = new Set(['the','and','for','with','that','this','from','into','when','then','was','were','have','has','had','not','but','all','can','are','its','it\u2019s','out','you','your','run','running']);
function sigTokens(text) {
  return [...new Set(String(text).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
    .filter((t) => t.length >= 3 && !STOP_TOKENS.has(t)))];
}

function errHead(error) {
  const s = String(error || 'unknown error').replace(/\s+/g, ' ').trim();
  return s.slice(0, 60);
}

function argsOf(entry) {
  let a = entry?.args;
  if (typeof a === 'string') {
    try { a = JSON.parse(a); } catch { return { raw: a }; }
  }
  return (a && typeof a === 'object') ? a : {};
}

function isReadLike(entry) {
  const a = argsOf(entry);
  return READ_LIKE.test(String(entry.tool || '')) || ('path' in a || 'file' in a || 'raw' in a && READ_LIKE.test(String(a.raw)));
}

function argsHead(entry) {
  const a = argsOf(entry);
  return String(a.command || a.path || a.file || a.url || a.query || JSON.stringify(a)).slice(0, 80);
}

/** Extract candidate instincts from one session's journal. Pure — no writes. */
export function extractFromJournal(entries, { conversation = [], sessionId = null } = {}) {
  const posts = entries.filter((e) => e.phase === 'post');
  const maxTurn = entries.reduce((m, e) => Math.max(m, e.turn || 0), 0);
  const candidates = [];

  // ── 1. failure signatures: tool|errHead → failing posts ────────────────
  const fails = new Map(); // key → [entries]
  const successes = [];
  for (const e of posts) {
    const ok = e.result?.ok;
    if (ok === true) successes.push(e);
    else if (ok === false) {
      const key = `${e.tool}|${errHead(e.result?.error)}`;
      if (!fails.has(key)) fails.set(key, []);
      fails.get(key).push(e);
    }
  }

  const readTurns = entries.filter((e) => isReadLike(e) && e.phase === 'post').map((e) => e.turn);

  // ── 2. resolved cycles: for each signature, a LATER success ────────────
  const usedSuccessTurns = new Set();
  for (const [key, fEnts] of fails) {
    const [tool, eHead] = key.split('|');
    // same-tool recovery pairs each failure with the earliest unused success
    const cycles = [];
    for (const f of fEnts) {
      const succ = successes.find((s) => s.tool === tool && s.turn > f.turn && !usedSuccessTurns.has(s.turn));
      if (succ) { cycles.push({ fail: f, success: succ }); usedSuccessTurns.add(succ.turn); }
    }
    const recentBase = cycles.length ? cycles[cycles.length - 1].success.turn : fEnts[fEnts.length - 1].turn;
    const recent = maxTurn - recentBase <= 8;

    if (cycles.length) {
      // error → fix → success triple (same tool recovered)
      const ev = cycles.flatMap((c) => ([
        evidenceEntry({ turn: c.fail.turn, tool: c.fail.tool, result: `error: ${errHead(c.fail.result?.error)}`, sessionId }),
        evidenceEntry({ turn: c.success.turn, tool: c.success.tool, result: 'ok', sessionId }),
      ]));
      candidates.push({
        pattern: `${tool}: recover from "${eHead}"`,
        type: 'error_resolution',
        evidence: ev,
        succeeded: true,
        sightings: cycles.length,
        recent,
        failedBefore: false,
      });

      // ── 3. debugging cycle: read-like probes interleaved before success ──
      // "inspect → hypothesis → run": the read immediately before the failing
      // call (its post entry lands at fail.turn − 2 in pre/post journals) and
      // reads between failure and success both count as inspection.
      const readsBefore = readTurns.filter((t) => t >= cycles[0].fail.turn - 2 && t < cycles[cycles.length - 1].success.turn);
      if (readsBefore.length >= 2) {
        candidates.push({
          pattern: `debug cycle for "${eHead}": inspect → probe → fix (${readsBefore.length} reads)`,
          type: 'debugging_techniques',
          evidence: ev,
          succeeded: true,
          sightings: 1,
          recent,
          failedBefore: false,
        });
      }
    } else if (fEnts.length >= 2) {
      // same failure hit 2+ times — resolved DIFFERENTLY (another tool) or unresolved
      const alt = successes.find((s) => s.tool !== tool && s.turn > fEnts[fEnts.length - 1].turn && !usedSuccessTurns.has(s.turn));
      if (alt) {
        usedSuccessTurns.add(alt.turn);
        candidates.push({
          pattern: `workaround: ${tool} fails with "${eHead}" — ${alt.tool} works instead`,
          type: 'workarounds',
          evidence: [
            ...fEnts.map((f) => evidenceEntry({ turn: f.turn, tool: f.tool, result: `error: ${errHead(f.result?.error)}`, sessionId })),
            evidenceEntry({ turn: alt.turn, tool: alt.tool, result: 'ok', sessionId }),
          ],
          succeeded: true,
          sightings: fEnts.length,
          recent,
          failedBefore: false,
        });
      } else {
        candidates.push({
          pattern: `${tool}: fails with "${eHead}"`,
          type: 'error_resolution',
          evidence: fEnts.map((f) => evidenceEntry({ turn: f.turn, tool: f.tool, result: `error: ${errHead(f.result?.error)}`, sessionId })),
          succeeded: false,
          sightings: fEnts.length,
          recent,
          failedBefore: false,
        });
      }
    } else {
      // single unresolved failure — record the failure pattern (outcome failed)
      candidates.push({
        pattern: `${tool}: fails with "${eHead}"`,
        type: 'error_resolution',
        evidence: fEnts.map((f) => evidenceEntry({ turn: f.turn, tool: f.tool, result: `error: ${errHead(f.result?.error)}`, sessionId })),
        succeeded: false,
        sightings: fEnts.length,
        recent,
        failedBefore: false,
      });
    }
  }

  // ── 4. project_specific: a file path recurs 3+ times in the session ────
  const pathHits = new Map(); // p → [entries]
  for (const e of posts) {
    const hay = `${argsHead(e)}`;
    const matches = hay.match(PATH_LIKE) || [];
    for (const m of new Set(matches)) {
      if (m.length < 8) continue;
      if (!pathHits.has(m)) pathHits.set(m, []);
      pathHits.get(m).push(e);
    }
  }
  const topPaths = [...pathHits.entries()]
    .filter(([, ents]) => ents.length >= PATH_MIN_HITS)
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 3);
  for (const [p, ents] of topPaths) {
    candidates.push({
      pattern: `frequently works with ${p} (${ents.length} touches this session)`,
      type: 'project_specific',
      evidence: ents.slice(0, 4).map((e) => evidenceEntry({ turn: e.turn, tool: e.tool, result: e.result?.ok ? 'ok' : `error: ${errHead(e.result?.error)}`, sessionId })),
      succeeded: true,
      sightings: ents.length,
      recent: true,
      failedBefore: false,
    });
  }

  // ── 5. user_corrections: a rephrased request (needs conversation) ──────
  const CORRECTION = /\b(no|not that|instead|actually|wrong|don'?t|do not|stop|rather|prefer)\b/i;
  const users = conversation.filter((c) => String(c.role || c.speaker || '') === 'user');
  for (let i = 1; i < users.length; i++) {
    const prev = String(users[i - 1].text || users[i - 1].content || '');
    const cur = String(users[i].text || users[i].content || '');
    const shared = sigTokens(prev).filter((t) => sigTokens(cur).includes(t));
    if (CORRECTION.test(cur) && shared.length >= 1 && cur.length > 3) {
      candidates.push({
        pattern: `user prefers: ${cur.replace(/\s+/g, ' ').slice(0, 90)}`,
        type: 'user_corrections',
        evidence: [
          evidenceEntry({ turn: users[i - 1].turn ?? i, tool: 'user_message', result: prev.slice(0, 100), sessionId }),
          evidenceEntry({ turn: users[i].turn ?? i + 1, tool: 'user_message', result: 'correction', sessionId }),
        ],
        succeeded: true,
        sightings: 1,
        recent: true,
        failedBefore: false,
      });
    }
  }

  // deterministic ids + cap
  for (const c of candidates) c.id = instinctId(c.type, c.pattern);
  return candidates.slice(0, MAX_PER_ANALYSIS);
}

/**
 * Analyze one session: extract → record into the project store. Returns the
 * recorded instincts (full snapshots). Once per session unless force.
 */
export function analyzeSession(repoRoot, sessionId, { conversation = [], force = false, now = new Date().toISOString() } = {}) {
  const entries = readJournal(repoRoot, sessionId);
  if (!entries.length) return { sessionId, extracted: [], skipped: 'empty journal' };

  const marker = `${journalPath(repoRoot, sessionId)}.analyzed`;
  if (!force && fs.existsSync(marker)) {
    return { sessionId, extracted: [], skipped: 'already analyzed' };
  }

  const candidates = extractFromJournal(entries, { conversation, sessionId });
  const store = projectStorePath(repoRoot);
  const recorded = candidates.map((c) => recordCandidate(store, c, { scope: 'project', now }));

  try { fs.writeFileSync(marker, JSON.stringify({ at: now, extracted: recorded.length }) + '\n', 'utf8'); } catch { /* */ }

  return { sessionId, extracted: recorded, journalTurns: entries.length };
}

/** On-demand convenience: analyze every session with a journal. */
export function analyzeAllSessions(repoRoot, opts = {}) {
  const dir = path.dirname(journalPath(repoRoot, 'x'));
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')); } catch { return []; }
  const out = [];
  for (const f of files) {
    out.push(analyzeSession(repoRoot, f.replace(/\.jsonl$/, ''), opts));
  }
  return out;
}

/** Has this session already been folded into the store? */
export function wasAnalyzed(repoRoot, sessionId) {
  return fs.existsSync(`${journalPath(repoRoot, sessionId)}.analyzed`);
}

/** Promotion candidacy check (used by promoter + probes). */
export function meetsPromotionCriteria(instinct, { minConfidence = 0.8, minSessions = 3, types = ['error_resolution', 'debugging_techniques'] } = {}) {
  return Boolean(
    instinct
    && !instinct.promoted
    && instinct.scope === 'project'
    && types.includes(instinct.type)
    && (instinct.confidence ?? 0) >= minConfidence
    && (instinct.sessionIds?.length ?? 0) >= minSessions
  );
}

/** Read folded store without writing (probes + recall use this). */
export function readStore(repoRoot) {
  return foldStore(projectStorePath(repoRoot));
}
