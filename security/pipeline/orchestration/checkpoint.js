/**
 * JEXI OS — Phase 8 Scope A: CHECKPOINT STORE (durable state I/O).
 *
 *   Every artifact the pipeline produces lives under:
 *     security/pipeline/.state/<engagementId>/
 *     ├── checkpoints/<seq>-<phaseId>.json   one per phase attempt
 *     ├── events.jsonl                       append-only event log
 *     ├── artifacts/<phase>.json|.md         phase deliverables
 *     └── run.json                           run-level terminal state
 *
 * Durability model: a checkpoint is written with status "running" BEFORE a
 * phase starts, and flipped to "complete" only after its artifact is on disk.
 * If the process dies mid-phase, the next process finds status "running" and
 * resumes the phase (re-attempt, partial progress preserved in cp.partial).
 *
 * All writes are atomic (tmp file + rename). No dependencies outside stdlib.
 */

import fs from 'node:fs';
import path from 'node:path';

const ATOMIC_LIMIT = 8 * 1024 * 1024; // refuse absurd atomic writes

export function stateDir(stateRoot, engagementId) {
  return path.join(stateRoot, '.state', sanitize(engagementId));
}

export function checkpointsDir(stateRoot, engagementId) {
  return path.join(stateDir(stateRoot, engagementId), 'checkpoints');
}

export function artifactsDir(stateRoot, engagementId) {
  return path.join(stateDir(stateRoot, engagementId), 'artifacts');
}

export function checkpointPath(stateRoot, engagementId, cp) {
  return path.join(checkpointsDir(stateRoot, engagementId), `${cp.seq}-${cp.phaseId}.json`);
}

function sanitize(id) {
  return String(id).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80) || 'unnamed';
}

function atomicWrite(file, data) {
  if (data.length > ATOMIC_LIMIT) throw new Error(`atomicWrite: ${file} too large`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

export function newCheckpoint(engagementId, phaseId, seq) {
  return {
    checkpointId: `${engagementId}:${phaseId}`,
    engagementId,
    phaseId,
    seq,
    status: 'running',
    attempt: 1,
    startedAt: new Date().toISOString(),
    completedAt: null,
    partial: {},
    outputs: [],
  };
}

export function saveCheckpoint(stateRoot, engagementId, cp) {
  const file = checkpointPath(stateRoot, engagementId, cp);
  atomicWrite(file, JSON.stringify(cp, null, 2) + '\n');
  return file;
}

/** Latest checkpoint for a phaseId, or null. */
export function loadCheckpoint(stateRoot, engagementId, phaseId) {
  const dir = checkpointsDir(stateRoot, engagementId);
  if (!fs.existsSync(dir)) return null;
  const hits = fs.readdirSync(dir)
    .filter((f) => f.endsWith(`-${phaseId}.json`))
    .sort();
  if (!hits.length) return null;
  const raw = fs.readFileSync(path.join(dir, hits[hits.length - 1]), 'utf8');
  try {
    return JSON.parse(raw);
  } catch {
    return null; // torn write should be impossible (atomic rename) — treat as absent
  }
}

export function listCheckpoints(stateRoot, engagementId) {
  const dir = checkpointsDir(stateRoot, engagementId);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.json') && !f.includes('.tmp-'))
    .sort()
    .map((f) => {
      try {
        return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

export function appendEvents(stateRoot, engagementId, events) {
  const file = path.join(stateDir(stateRoot, engagementId), 'events.jsonl');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const lines = events.map((e) => JSON.stringify(e)).join('\n') + (events.length ? '\n' : '');
  fs.appendFileSync(file, lines);
  return file;
}

export function readEvents(stateRoot, engagementId) {
  const file = path.join(stateDir(stateRoot, engagementId), 'events.jsonl');
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => {
    try { return JSON.parse(l); } catch { return { type: 'corrupt-line', raw: l }; }
  });
}

export function writeArtifact(stateRoot, engagementId, name, content) {
  const file = path.join(artifactsDir(stateRoot, engagementId), name);
  atomicWrite(file, typeof content === 'string' ? content : JSON.stringify(content, null, 2) + '\n');
  return path.relative(stateRoot, file);
}

export function readArtifact(stateRoot, engagementId, name) {
  const file = path.join(artifactsDir(stateRoot, engagementId), name);
  if (!fs.existsSync(file)) return null;
  const raw = fs.readFileSync(file, 'utf8');
  return name.endsWith('.json') ? JSON.parse(raw) : raw;
}

export function markRunComplete(stateRoot, engagementId, extra = {}) {
  const file = path.join(stateDir(stateRoot, engagementId), 'run.json');
  atomicWrite(file, JSON.stringify({
    engagementId,
    status: 'complete',
    finishedAt: new Date().toISOString(),
    ...extra,
  }, null, 2) + '\n');
  return file;
}

export function readRun(stateRoot, engagementId) {
  const file = path.join(stateDir(stateRoot, engagementId), 'run.json');
  if (!fs.existsSync(file)) return null;
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

/** Fresh run: wipe a single engagement's state (never wipes others). */
export function wipeEngagement(stateRoot, engagementId) {
  fs.rmSync(stateDir(stateRoot, engagementId), { recursive: true, force: true });
}
