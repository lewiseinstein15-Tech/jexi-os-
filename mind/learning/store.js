/**
 * JEXI OS — Phase 7 Scope C: CONTINUOUS LEARNING — store.
 *
 * Append-only JSONL, project-scoped and global-scoped:
 *   project: <repoRoot>/.jexi/learning/project.jsonl
 *   global:  $JEXI_HOME/learning/global.jsonl  (default JEXI_HOME = ~/.jexi)
 *
 * Never overwrite — a new sighting appends a NEW full snapshot line with the
 * same id; readers fold lines in order (last snapshot per id wins, evidence
 * accumulated by the writer before appending). Promotion events are recorded
 * as { kind: 'promotion' } lines. Malformed lines are skipped and counted,
 * never fatal — the store is data, not code.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInstinct, sightInstinct, validateInstinct } from './instinct.js';

/** Repo root = parent of this learning/ directory. */
export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export function projectLearningRoot(repoRoot = REPO_ROOT) {
  return path.join(repoRoot, '.jexi', 'learning');
}

export function projectStorePath(repoRoot = REPO_ROOT) {
  return path.join(projectLearningRoot(repoRoot), 'project.jsonl');
}

/** Global root honors $JEXI_HOME (trimmed, non-empty) else ~/.jexi — HomePaths convention. */
export function globalLearningRoot(env = process.env) {
  const raw = env.JEXI_HOME;
  const base = raw && String(raw).trim() ? String(raw).trim() : path.join(os.homedir(), '.jexi');
  return path.join(path.resolve(String(base)), 'learning');
}

export function globalStorePath(env = process.env) {
  return path.join(globalLearningRoot(env), 'global.jsonl');
}

function ensureDir(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
}

/** Append one record as a single JSON line. Returns the record. */
export function appendRecord(file, record) {
  ensureDir(file);
  fs.appendFileSync(file, JSON.stringify(record) + '\n', 'utf8');
  return record;
}

/** Read every parseable line. Returns { records, badLines }. */
export function readRecords(file) {
  const records = [];
  let badLines = 0;
  let raw = '';
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return { records, badLines };
  }
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try {
      records.push(JSON.parse(t));
    } catch {
      badLines++;
    }
  }
  return { records, badLines };
}

/**
 * Fold the store: instinct snapshots grouped by id (last wins) + promotion
 * events in order. Returns { instincts: Map<id, instinct>, events: [], badLines }.
 */
export function foldStore(file) {
  const { records, badLines } = readRecords(file);
  const instincts = new Map();
  const events = [];
  for (const r of records) {
    if (r && r.kind === 'promotion') { events.push(r); continue; }
    if (r && r.id && r.pattern && r.type) instincts.set(r.id, r); // last snapshot wins
  }
  return { instincts, events, badLines };
}

/**
 * Record with deterministic fold: resolve the candidate's id first, then
 * merge with any existing snapshot of that id. Appends ONE snapshot line —
 * the store is never overwritten.
 */
export function recordCandidate(file, candidate, { scope = 'project', now = new Date().toISOString() } = {}) {
  const { instincts } = foldStore(file);
  const provisional = createInstinct(candidate, { scope, now });
  const existing = instincts.get(provisional.id);
  const snapshot = existing ? sightInstinct(existing, candidate, { now }) : provisional;
  validateInstinct(snapshot);
  appendRecord(file, snapshot);
  return snapshot;
}

/** List instincts from a store, optionally filtered by scope, newest first. */
export function listInstincts(file, { scope = null } = {}) {
  const { instincts, badLines } = foldStore(file);
  const all = [...instincts.values()].filter((i) => (scope ? i.scope === scope : true));
  all.sort((a, b) => Date.parse(b.lastSeen) - Date.parse(a.lastSeen));
  return { instincts: all, badLines };
}

/** Promotion event record shape. */
export function promotionEvent(instinct, { at = new Date().toISOString(), reason = '' } = {}) {
  return {
    kind: 'promotion',
    at,
    instinctId: instinct.id,
    pattern: instinct.pattern,
    type: instinct.type,
    from: 'project',
    to: 'global',
    confidence: instinct.confidence,
    sessions: instinct.sessionIds?.length ?? 0,
    reason,
  };
}
