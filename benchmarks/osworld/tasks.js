/**
 * JEXI OS — benchmarks/osworld/tasks.js
 *
 * osw.load({ split, fixturePath? }) -> tasks[]
 *
 * Split resolution:
 * - fixturePath undefined -> the bundled fixture for the requested split
 *   (scope 15: mini-tasks.json for split "mini");
 * - fixturePath given     -> that explicit fixture file;
 * - fixturePath === null  -> the REAL OSWorld task-set loader.
 *                           Fully implemented but gated behind an explicit
 *                           allowNetwork opt-in: in the scope 15 build-only
 *                           sandbox it reports NOT VERIFIED without any
 *                           network call. The live read (369 tasks across
 *                           the real desktop VM) is exercised in scope 17
 *                           against a VM JEXI does not host here.
 *
 * Task shape (OSWorld, adapter view):
 * { task_id, instruction, app, category, evaluator, source }
 *
 * The apps are a frozen enum mirroring the OSWorld domain set:
 * chrome | gimp | libreoffice_calc | libreoffice_impress | libreoffice_writer
 * | os | vlc | thunderbird | vs_code | multi_apps
 * `category` is a free-form grouping label (per-category reporting); when
 * the task omits it, it defaults to the app name (documented, deterministic).
 *
 * Malformed entries (missing/empty task_id, instruction, app; app outside
 * the frozen enum; missing/malformed evaluator) carry code E_INVALID_TASK:
 * - load({ strict: true }) throws on the first rejected entry;
 * - default load() returns the VALID tasks only — rejections are never
 *   silent: loadDiagnostics() exposes them, and run()'s report carries a
 *   `rejected` section.
 *
 * Observations fixture handling lives here too: the tasks fixture declares
 * its sibling pre-recorded screenshot+state file ("observations" field),
 * and run() replays those snapshots through the injected agent.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateEvaluator } from './evaluator.js';
import { observe as validateSnapshotShape } from './observation.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export const APPS = Object.freeze([
  'chrome',
  'gimp',
  'libreoffice_calc',
  'libreoffice_impress',
  'libreoffice_writer',
  'os',
  'vlc',
  'thunderbird',
  'vs_code',
  'multi_apps',
]);

export const FIXTURES = {
  mini: path.join(HERE, '..', '_fixtures', 'osworld', 'mini-tasks.json'),
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
  for (const key of ['task_id', 'instruction', 'app']) {
    if (typeof raw[key] !== 'string' || raw[key].trim() === '') {
      throw invalidTask(`missing ${key} (expected non-empty string)`, where);
    }
  }
  if (!APPS.includes(raw.app)) {
    throw invalidTask(
      `app ${JSON.stringify(raw.app)} is outside the frozen enum (${APPS.join(' | ')})`,
      where
    );
  }
  if (raw.category !== undefined && (typeof raw.category !== 'string' || raw.category.trim() === '')) {
    throw invalidTask('category must be a non-empty string when present', where);
  }
  validateEvaluator(raw.evaluator, where); // throws E_INVALID_TASK
  return true;
}

function coerceTask(raw, where) {
  validateTask(raw, where);
  return {
    task_id: raw.task_id,
    instruction: raw.instruction,
    app: raw.app,
    category: raw.category ?? raw.app,
    evaluator: raw.evaluator,
    source: 'fixture',
  };
}

async function readFixture(fixturePath, split) {
  let raw;
  try {
    raw = JSON.parse(await readFile(fixturePath, 'utf8'));
  } catch (e) {
    const err = new Error(`osw.load: cannot read fixture ${fixturePath}: ${e.message}`);
    err.code = 'OSW_FIXTURE_UNREADABLE';
    throw err;
  }
  if (raw.split && split && raw.split !== split) {
    throw new Error(`osw.load: fixture "${raw.name ?? path.basename(fixturePath)}" carries split "${raw.split}", requested "${split}"`);
  }
  const entries = Array.isArray(raw.tasks) ? raw.tasks : [];
  if (!entries.length) {
    throw new Error(`osw.load: fixture ${fixturePath} contains no tasks`);
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
    throw new Error(`osw.load: no bundled fixture registered for split "${split}" (pass fixturePath explicitly)`);
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
    throw new Error(`osw.loadDiagnostics: no bundled fixture registered for split "${split}"`);
  }
  const { entries, label, observationsRef } = await readFixture(resolved, split);
  const { tasks, rejected } = collectTasks(entries, label);
  return { tasks, rejected, fixture: resolved, split, observationsRef };
}

/* ---------------------------------------------------------------------- *
 * Pre-recorded screenshot+state snapshots (observations fixture) —
 * E_INVALID_OBSERVATION
 * ---------------------------------------------------------------------- */

export async function loadObservations(observationsPath) {
  let raw;
  try {
    raw = JSON.parse(await readFile(observationsPath, 'utf8'));
  } catch (e) {
    const err = new Error(`osw.run: cannot read observations fixture ${observationsPath}: ${e.message}`);
    err.code = 'OSW_OBSERVATIONS_UNREADABLE';
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
      throw new Error(`E_INVALID_OBSERVATION — ${w}: snapshots must be a non-empty array of raw VM-state snapshots`);
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
 * Real OSWorld loader (gated) — scope 17 only.
 * ---------------------------------------------------------------------- */

function notVerifiedError(split) {
  const err = new Error(
    'NOT VERIFIED — live OSWorld task-set read requested (fixturePath: null) but the ' +
    `network is gated off in the scope 15 build-only sandbox; the real loader for split "${split}" ` +
    'is present and ships with an allowNetwork opt-in for the scope 17 live run (read-only raw ' +
    'task JSON from the upstream OSWorld repo; the desktop VM is provisioned by the harness, ' +
    'never from this adapter). No network call was issued.'
  );
  err.code = 'OSW_NETWORK_NOT_VERIFIED';
  err.verified = false;
  return err;
}

// BEGIN OSW LIVE PATH (network) — scope 17 only; never reached in scope 15.
const OSW_RAW_BASE = 'https://raw.githubusercontent.com';
const OSW_REPO = 'xlang-ai/OSWorld';
const OSW_REF = 'main'; // provisional: pin the evaluated revision when the live read is exercised in scope 17.
const OSW_MANIFEST_PATH = 'evaluation_examples/test_all.json'; // provisional manifest: confirm at the live read.

function parseTaskRow(t, i) {
  // Provisional mapping: the real dataset rows carry instruction, related
  // apps and an evaluator config executed INSIDE the harness VM; the
  // evaluator mapping is finalized when the live read is exercised in
  // scope 17 (this loader is unreachable before).
  const apps = Array.isArray(t.related_apps) ? t.related_apps.map(String) : [];
  return {
    task_id: String(t.id ?? t.task_id ?? `osw-${i}`),
    instruction: String(t.instruction ?? ''),
    app: apps.length === 1 ? apps[0] : 'multi_apps',
    category: apps.length === 1 ? apps[0] : 'multi_app',
    evaluator: t.evaluator ?? null,
    source: 'osworld',
  };
}

/** Real OSWorld loader: manifest read + per-task raw JSON reads.
 *  Present in this scope, but it refuses to run without allowNetwork:true
 *  (no keys, no network in the build-only sandbox) and reports NOT
 *  VERIFIED instead. */
export async function loadReal(split = 'test', { allowNetwork = false } = {}) {
  if (!allowNetwork) throw notVerifiedError(split);
  const manifestUrl = `${OSW_RAW_BASE}/${OSW_REPO}/${OSW_REF}/${OSW_MANIFEST_PATH}`;
  const res = await fetch(manifestUrl, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) {
    throw new Error(`osw.loadReal: raw GitHub returned HTTP ${res.status} for the task manifest`);
  }
  const rows = await res.json();
  if (!Array.isArray(rows)) {
    throw new Error('osw.loadReal: task manifest payload is not an array');
  }
  const tasks = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const domain = typeof row.domain === 'string' ? row.domain : 'examples';
    const id = typeof row.id === 'string' ? row.id : null;
    if (!id) {
      tasks.push(parseTaskRow(row, i));
      continue;
    }
    const taskUrl = `${OSW_RAW_BASE}/${OSW_REPO}/${OSW_REF}/evaluation_examples/examples/${domain}/${id}.json`;
    const taskRes = await fetch(taskUrl, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(30000),
    });
    if (!taskRes.ok) {
      throw new Error(`osw.loadReal: raw GitHub returned HTTP ${taskRes.status} for task ${id}`);
    }
    tasks.push(parseTaskRow(await taskRes.json(), i));
  }
  return tasks;
}
// END OSW LIVE PATH
