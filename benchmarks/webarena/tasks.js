/**
 * JEXI OS — benchmarks/webarena/tasks.js
 *
 * wa.load({ split, fixturePath? }) -> tasks[]
 *
 * Split resolution:
 * - fixturePath undefined -> the bundled fixture for the requested split
 *   (scope 14: mini-tasks.json for split "mini");
 * - fixturePath given     -> that explicit fixture file;
 * - fixturePath === null  -> the REAL WebArena Verified task-set loader.
 *                           Fully implemented but gated behind an explicit
 *                           allowNetwork opt-in: in the scope 14 build-only
 *                           sandbox it reports NOT VERIFIED without any
 *                           network call. The live read (812 tasks across
 *                           5 self-hosted sites) is exercised in scope 17
 *                           against sites JEXI does not host here.
 *
 * Task shape (WebArena Verified, adapter view):
 * { task_id, intent, sites: string[], start_url, evaluator, source }
 *
 * The 5 sites are a frozen enum: shopping | cms | reddit | gitlab | map.
 * Malformed entries (missing/empty task_id, intent, start_url, sites; site
 * outside the frozen enum; missing/malformed evaluator) carry code
 * E_INVALID_TASK:
 * - load({ strict: true }) throws on the first rejected entry;
 * - default load() returns the VALID tasks only — rejections are never
 *   silent: loadDiagnostics() exposes them, and run()'s report carries a
 *   `rejected` section.
 *
 * Observations fixture handling lives here too: the tasks fixture declares
 * its sibling pre-recorded DOM-snapshot file ("observations" field), and
 * run() replays those snapshots through the injected agent.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateEvaluator } from './verifier.js';
import { observe as validateSnapshotShape } from './observation.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export const SITES = Object.freeze(['shopping', 'cms', 'reddit', 'gitlab', 'map']);

export const FIXTURES = {
  mini: path.join(HERE, '..', '_fixtures', 'webarena', 'mini-tasks.json'),
};

function invalidTask(reason, where) {
  const err = new Error(`E_INVALID_TASK — ${where}: ${reason}`);
  err.code = 'E_INVALID_TASK';
  err.reason = reason;
  return err;
}

export function validateTask(raw, where = 'task') {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw invalidTask('entry must be an object', where);
  }
  for (const key of ['task_id', 'intent', 'start_url']) {
    if (typeof raw[key] !== 'string' || raw[key].trim() === '') {
      throw invalidTask(`missing ${key} (expected non-empty string)`, where);
    }
  }
  if (!Array.isArray(raw.sites) || raw.sites.length === 0) {
    throw invalidTask('missing sites (expected non-empty array of site names)', where);
  }
  for (const s of raw.sites) {
    if (typeof s !== 'string' || !SITES.includes(s)) {
      throw invalidTask(`site ${JSON.stringify(s ?? null)} is outside the frozen enum (${SITES.join(' | ')})`, where);
    }
  }
  validateEvaluator(raw.evaluator, where); // throws E_INVALID_TASK
  return true;
}

function coerceTask(raw, where) {
  validateTask(raw, where);
  return {
    task_id: raw.task_id,
    intent: raw.intent,
    sites: [...raw.sites],
    start_url: raw.start_url,
    evaluator: raw.evaluator,
    source: 'fixture',
  };
}

async function readFixture(fixturePath, split) {
  let raw;
  try {
    raw = JSON.parse(await readFile(fixturePath, 'utf8'));
  } catch (e) {
    const err = new Error(`wa.load: cannot read fixture ${fixturePath}: ${e.message}`);
    err.code = 'WA_FIXTURE_UNREADABLE';
    throw err;
  }
  if (raw.split && split && raw.split !== split) {
    throw new Error(`wa.load: fixture "${raw.name ?? path.basename(fixturePath)}" carries split "${raw.split}", requested "${split}"`);
  }
  const entries = Array.isArray(raw.tasks) ? raw.tasks : [];
  if (!entries.length) {
    throw new Error(`wa.load: fixture ${fixturePath} contains no tasks`);
  }
  const label = path.basename(fixturePath);
  return { entries, label, observationsRef: typeof raw.observations === 'string' ? raw.observations : null };
}

function collectTasks(entries, label) {
  const tasks = [];
  const rejected = [];
  entries.forEach((entry, index) => {
    const where = `${label}[${index}]`;
    try {
      tasks.push(coerceTask(entry, where));
    } catch (err) {
      rejected.push({
        index,
        task_id: entry && typeof entry.task_id === 'string' ? entry.task_id : null,
        code: err.code,
        reason: err.reason,
      });
    }
  });
  return { tasks, rejected };
}

export async function load({ split = 'mini', fixturePath, strict = false } = {}) {
  if (fixturePath === null) {
    // Real task-set path — exercised only with an explicit network opt-in.
    return loadReal(split, { allowNetwork: false });
  }
  const resolved = fixturePath ?? FIXTURES[split];
  if (!resolved) {
    throw new Error(`wa.load: no bundled fixture registered for split "${split}" (pass fixturePath explicitly)`);
  }
  const { entries, label } = await readFixture(resolved, split);
  const { tasks, rejected } = collectTasks(entries, label);
  if (strict && rejected.length) {
    const first = rejected[0];
    const err = new Error(`E_INVALID_TASK — ${label}[${first.index}] (${first.task_id ?? 'unnamed'}): ${first.reason}`);
    err.code = 'E_INVALID_TASK';
    err.reason = first.reason;
    err.rejected = rejected;
    throw err;
  }
  return tasks;
}

/** Non-silent rejection surface: { tasks, rejected, fixture, split, observationsRef }. */
export async function loadDiagnostics({ split = 'mini', fixturePath } = {}) {
  if (fixturePath === null) {
    await loadReal(split, { allowNetwork: false }); // throws NOT VERIFIED
    return; // unreachable
  }
  const resolved = fixturePath ?? FIXTURES[split];
  if (!resolved) {
    throw new Error(`wa.loadDiagnostics: no bundled fixture registered for split "${split}"`);
  }
  const { entries, label, observationsRef } = await readFixture(resolved, split);
  const { tasks, rejected } = collectTasks(entries, label);
  return { tasks, rejected, fixture: resolved, split, observationsRef };
}

/* ---------------------------------------------------------------------- *
 * Pre-recorded DOM snapshots (observations fixture) — E_INVALID_OBSERVATION
 * ---------------------------------------------------------------------- */

export async function loadObservations(observationsPath) {
  let raw;
  try {
    raw = JSON.parse(await readFile(observationsPath, 'utf8'));
  } catch (e) {
    const err = new Error(`wa.run: cannot read observations fixture ${observationsPath}: ${e.message}`);
    err.code = 'WA_OBSERVATIONS_UNREADABLE';
    throw err;
  }
  validateObservations(raw, path.basename(observationsPath));
  return raw;
}

export function validateObservations(raw, where = 'observations') {
  const isPlain = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
  if (!isPlain(raw)) {
    throw new Error(`E_INVALID_OBSERVATION — ${where}: observations fixture must be an object { tasks: { [task_id]: { snapshots: [...] } } }`);
  }
  if (!isPlain(raw.tasks)) {
    throw new Error(`E_INVALID_OBSERVATION — ${where}: observations.tasks must be an object keyed by task_id`);
  }
  for (const [task_id, entry] of Object.entries(raw.tasks)) {
    const w = `${where}.tasks.${task_id}`;
    if (!isPlain(entry)) {
      throw new Error(`E_INVALID_OBSERVATION — ${w}: entry must be an object { snapshots }`);
    }
    if (!Array.isArray(entry.snapshots) || entry.snapshots.length === 0) {
      throw new Error(`E_INVALID_OBSERVATION — ${w}: snapshots must be a non-empty array of raw DOM snapshots`);
    }
    entry.snapshots.forEach((snap, i) => {
      try {
        validateSnapshotShape(snap);
      } catch (e) {
        throw new Error(`E_INVALID_OBSERVATION — ${w}.snapshots[${i}]: ${e.message.replace('E_INVALID_OBSERVATION — ', '')}`);
      }
    });
  }
  return true;
}

/* ---------------------------------------------------------------------- *
 * Real WebArena Verified loader (gated) — scope 17 only.
 * ---------------------------------------------------------------------- */

function notVerifiedError(split) {
  const err = new Error(
    'NOT VERIFIED — live WebArena Verified task-set read requested (fixturePath: null) but the ' +
    `network is gated off in the scope 14 build-only sandbox; the real loader for split "${split}" ` +
    'is present and ships with an allowNetwork opt-in for the scope 17 live run (read-only raw ' +
    'task JSON; the 5 sites are self-hosted by the harness, never from this adapter). No network ' +
    'call was issued.'
  );
  err.code = 'WA_NETWORK_NOT_VERIFIED';
  err.verified = false;
  return err;
}

// BEGIN WA LIVE PATH (network) — scope 17 only; never reached in scope 14.
const WA_RAW_BASE = 'https://raw.githubusercontent.com';
const WA_REPO = 'xlang-ai/WebArena';
const WA_REF = 'main'; // provisional: pin the evaluated revision when the live read is exercised in scope 17.
const WA_TASK_PATH = 'WebArena/test.raw.json'; // provisional path: confirm the exact raw task JSON location in scope 17.

function parseTaskRow(t, i) {
  // Provisional mapping: the real dataset rows carry task fields plus a
  // Python-side evaluator spec; the evaluator mapping is finalized when the
  // live read is exercised in scope 17 (this loader is unreachable before).
  return {
    task_id: String(t.task_id ?? t.id ?? `wa-${i}`),
    intent: String(t.intent ?? ''),
    sites: Array.isArray(t.sites) ? t.sites.map(String) : [],
    start_url: String(t.start_url ?? ''),
    evaluator: t.evaluator ?? null,
    source: 'webarena',
  };
}

/** Real WebArena Verified loader: single raw JSON read of the task set.
 *  Present in this scope, but it refuses to run without allowNetwork:true
 *  (no keys, no network in the build-only sandbox) and reports NOT
 *  VERIFIED instead. */
export async function loadReal(split = 'test', { allowNetwork = false } = {}) {
  if (!allowNetwork) throw notVerifiedError(split);
  const url = `${WA_RAW_BASE}/${WA_REPO}/${WA_REF}/${WA_TASK_PATH}`;
  const res = await fetch(url, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) {
    throw new Error(`wa.loadReal: raw GitHub returned HTTP ${res.status} for the task set`);
  }
  const rows = await res.json();
  if (!Array.isArray(rows)) {
    throw new Error('wa.loadReal: task-set payload is not an array');
  }
  return rows.map(parseTaskRow);
}
// END WA LIVE PATH
