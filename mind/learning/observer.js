/**
 * JEXI OS — Phase 7 Scope C: CONTINUOUS LEARNING — observer.
 *
 * Subscribes to the PreToolUse / PostToolUse hook points built in Phase 7(B)
 * (the kernel calls into this module from the permission gate and the
 * executor, via server/src/kernel/hooks/learning-seam.js). Records EVERY
 * tool call — name, args, result, duration, session, agent — into a rolling
 * per-session journal:
 *
 *   <repoRoot>/.jexi/learning/journal/<sessionId>.jsonl
 *
 * Rolling: when a journal passes JOURNAL_MAX_BYTES it rotates to `<file>.1`.
 * The observer is fail-soft by design: it can never crash the kernel path
 * it is called from.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { projectLearningRoot } from './store.js';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));

/** Rotate a journal after 512 KiB — keeps per-session files bounded. */
export const JOURNAL_MAX_BYTES = 512 * 1024;

/** Per-process turn counters (sessionId → next turn). */
const _turns = new Map();

export function journalDir(repoRoot) {
  return path.join(projectLearningRoot(repoRoot), 'journal');
}

export function journalPath(repoRoot, sessionId) {
  const safe = String(sessionId || 'session').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80) || 'session';
  return path.join(journalDir(repoRoot), `${safe}.jsonl`);
}

function truncate(v, n) {
  if (v == null) return null;
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  if (s == null) return null;
  return s.length > n ? s.slice(0, n) + '…' : s;
}

/**
 * Core record — one journal line per observation. Fail-soft: throws never
 * propagate (callers wrap anyway, belt and braces).
 */
export function record(repoRoot, obs) {
  try {
    const file = journalPath(repoRoot, obs.sessionId);
    const k = String(obs.sessionId || 'session');
    // Seed the process-local counter from the existing journal so turns stay
    // monotonic across process restarts that touch the same session id.
    if (!_turns.has(k)) _turns.set(k, countLines(file));
    const turn = (_turns.get(k) || 0) + 1;
    _turns.set(k, turn);
    const entry = {
      kind: 'tool_call',
      ts: new Date().toISOString(),
      phase: obs.phase,                      // 'pre' | 'post'
      event: obs.event,                      // 'PreToolUse' | 'PostToolUse'
      turn,
      tool: obs.tool ?? null,
      args: truncate(obs.args, 300),
      result: obs.phase === 'post'
        ? {
            ok: obs.result?.ok ?? null,
            durationMs: obs.result?.durationMs ?? null,
            error: truncate(obs.result?.error, 200) ?? null,
          }
        : { hookBlocked: Boolean(obs.hookBlocked) },
      sessionId: obs.sessionId ?? null,
      agentId: obs.agentId ?? null,
    };
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, JSON.stringify(entry) + '\n', 'utf8');
    rollIfNeeded(file);
    return entry;
  } catch {
    return null; // never crash the kernel path
  }
}

function countLines(file) {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    return raw.split('\n').filter((l) => l.trim()).length;
  } catch {
    return 0;
  }
}

function rollIfNeeded(file) {
  try {
    const st = fs.statSync(file);
    if (st.size > JOURNAL_MAX_BYTES) {
      fs.renameSync(file, `${file}.1`);
    }
  } catch { /* nothing to roll */ }
}

/** PreToolUse observation — called from the permission gate after hooks run. */
export function observePreToolUse(repoRoot, call, hookOut, ctx = {}) {
  return record(repoRoot, {
    phase: 'pre',
    event: 'PreToolUse',
    tool: call?.name ?? null,
    args: call?.arguments ?? {},
    hookBlocked: Boolean(hookOut?.blocked),
    sessionId: ctx?.sessionId ?? null,
    agentId: ctx?.agentId ?? null,
  });
}

/** PostToolUse observation — called from the executor after the engine returns. */
export function observePostToolUse(repoRoot, call, result, ctx = {}) {
  const err = result?.error;
  return record(repoRoot, {
    phase: 'post',
    event: 'PostToolUse',
    tool: call?.name ?? null,
    args: call?.arguments ?? {},
    result: {
      ok: result?.ok ?? null,
      durationMs: result?.meta?.durationMs ?? result?.durationMs ?? null,
      error: (err?.message ?? err) ?? null, // ClassifiedError instance → its message
    },
    sessionId: ctx?.sessionId ?? null,
    agentId: ctx?.agentId ?? null,
  });
}

/** Read a session journal (parses lines, skips junk). */
export function readJournal(repoRoot, sessionId) {
  const file = journalPath(repoRoot, sessionId);
  const entries = [];
  try {
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      const t = line.trim();
      if (!t) continue;
      try {
        const e = JSON.parse(t);
        if (e && e.kind === 'tool_call') entries.push(e);
      } catch { /* skip */ }
    }
  } catch { /* no journal yet */ }
  return entries;
}

/** List sessions that have journals: [{ sessionId, lines, bytes, mtime }]. */
export function listSessions(repoRoot) {
  const dir = journalDir(repoRoot);
  let files = [];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl'));
  } catch {
    return [];
  }
  return files.map((f) => {
    const file = path.join(dir, f);
    let lines = 0;
    try { lines = fs.readFileSync(file, 'utf8').split('\n').filter((l) => l.trim()).length; } catch { /* */ }
    let st = { size: 0, mtimeMs: 0 };
    try { st = fs.statSync(file); } catch { /* */ }
    return { sessionId: f.replace(/\.jsonl$/, ''), lines, bytes: st.size, mtime: new Date(st.mtimeMs).toISOString() };
  });
}

export { MODULE_DIR };
