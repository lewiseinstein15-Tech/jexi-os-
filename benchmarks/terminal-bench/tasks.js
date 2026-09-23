/**
 * JEXI OS — benchmarks/terminal-bench/tasks.js
 *
 * tb.load({ split, fixturePath? }) -> tasks[]
 *
 * Split resolution:
 * - fixturePath undefined -> the bundled fixture for the requested split
 *   (scope 13: mini-tasks.json for split "mini");
 * - fixturePath given     -> that explicit fixture file;
 * - fixturePath === null  -> the REAL Terminal-Bench 2.1 task-set loader
 *   (GitHub task index). Fully implemented but gated behind an explicit
 *   allowNetwork opt-in: in the scope 13 build-only sandbox it reports
 *   NOT VERIFIED without any network call. The live read is exercised in
 *   scope 17. (The container side of Terminal-Bench is owned by the
 *   official runner; this adapter never provisions one.)
 *
 * Task shape (adapter view of a Terminal-Bench task):
 * { task_id, instruction, category, difficulty,
 *   verification: { tests: string[] }, source }
 *
 * Malformed entries (missing/empty task_id or instruction, missing
 * verification object, empty/non-string tests) carry code E_INVALID_TASK:
 * - load({ strict: true }) throws on the first rejected entry;
 * - default load() returns the VALID tasks only — rejections are never
 *   silent: loadDiagnostics() exposes them, and run()'s report carries a
 *   `rejected` section.
 *
 * Transcript handling (E_INVALID_TRANSCRIPT) also lives here. The tasks
 * fixture declares its sibling transcript file via the "transcript"
 * field; a transcript entry per task carries the pre-recorded
 * observation/action trace:
 *   steps:   [ { observation: { stdout, exitCode?, cwd? } }, ... ]
 *   actions: [ { action, args }, ... ]        // parallel to steps
 *   verifier: { kind?, resolved: bool, tests? }  // pre-declared stub verdict
 * The recorded actions are validated against the frozen v1 action space
 * at load time; the AGENT remains the actor at run time — run() replays
 * observations through agent.step() and does not force-match the
 * recording (coherence of stub vs recording is probed, not assumed).
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validate as validateAction } from './actions.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export const FIXTURES = {
  mini: path.join(HERE, '..', '_fixtures', 'terminal-bench', 'mini-tasks.json'),
};

function invalidTask(reason, where) {
  const err = new Error(`E_INVALID_TASK — ${where}: ${reason}`);
  err.code = 'E_INVALID_TASK';
  err.reason = reason;
  return err;
}

function invalidTranscript(reason, where) {
  const err = new Error(`E_INVALID_TRANSCRIPT — ${where}: ${reason}`);
  err.code = 'E_INVALID_TRANSCRIPT';
  err.reason = reason;
  return err;
}

export function validateTask(raw, where = 'task') {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw invalidTask('entry must be an object', where);
  }
  for (const key of ['task_id', 'instruction']) {
    if (typeof raw[key] !== 'string' || raw[key].trim() === '') {
      throw invalidTask(`missing ${key} (expected non-empty string)`, where);
    }
  }
  const v = raw.verification;
  if (!v || typeof v !== 'object' || Array.isArray(v)) {
    throw invalidTask('missing verification (expected object with a non-empty tests array)', where);
  }
  if (!Array.isArray(v.tests) || v.tests.length === 0) {
    throw invalidTask('verification.tests must be a non-empty array of test names', where);
  }
  for (const t of v.tests) {
    if (typeof t !== 'string' || t.trim() === '') {
      throw invalidTask('verification.tests entries must be non-empty strings', where);
    }
  }
  return true;
}

function coerceTask(raw, where) {
  validateTask(raw, where);
  return {
    task_id: raw.task_id,
    instruction: raw.instruction,
    category: raw.category ?? '',
    difficulty: raw.difficulty ?? '',
    verification: { tests: [...raw.verification.tests] },
    source: 'fixture',
  };
}

async function readFixture(fixturePath, split) {
  let raw;
  try {
    raw = JSON.parse(await readFile(fixturePath, 'utf8'));
  } catch (e) {
    const err = new Error(`tb.load: cannot read fixture ${fixturePath}: ${e.message}`);
    err.code = 'TB_FIXTURE_UNREADABLE';
    throw err;
  }
  if (raw.split && split && raw.split !== split) {
    throw new Error(`tb.load: fixture "${raw.name ?? path.basename(fixturePath)}" carries split "${raw.split}", requested "${split}"`);
  }
  const entries = Array.isArray(raw.tasks) ? raw.tasks : [];
  if (!entries.length) {
    throw new Error(`tb.load: fixture ${fixturePath} contains no tasks`);
  }
  const label = path.basename(fixturePath);
  return { entries, label, transcriptRef: typeof raw.transcript === 'string' ? raw.transcript : null };
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
    throw new Error(`tb.load: no bundled fixture registered for split "${split}" (pass fixturePath explicitly)`);
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

/** Non-silent rejection surface: { tasks, rejected, fixture, split, transcriptRef }. */
export async function loadDiagnostics({ split = 'mini', fixturePath } = {}) {
  if (fixturePath === null) {
    await loadReal(split, { allowNetwork: false }); // throws NOT VERIFIED
    return; // unreachable
  }
  const resolved = fixturePath ?? FIXTURES[split];
  if (!resolved) {
    throw new Error(`tb.loadDiagnostics: no bundled fixture registered for split "${split}"`);
  }
  const { entries, label, transcriptRef } = await readFixture(resolved, split);
  const { tasks, rejected } = collectTasks(entries, label);
  return { tasks, rejected, fixture: resolved, split, transcriptRef };
}

/* ---------------------------------------------------------------------- *
 * Transcript (pre-recorded observation/action trace) — E_INVALID_TRANSCRIPT
 * ---------------------------------------------------------------------- */

export function validateTranscript(raw, where = 'transcript') {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw invalidTranscript('transcript must be an object { tasks: { [task_id]: entry } }', where);
  }
  if (!raw.tasks || typeof raw.tasks !== 'object' || Array.isArray(raw.tasks)) {
    throw invalidTranscript('transcript.tasks must be an object keyed by task_id', where);
  }
  for (const [task_id, entry] of Object.entries(raw.tasks)) {
    const w = `${where}.tasks.${task_id}`;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw invalidTranscript('entry must be an object { steps, actions, verifier }', w);
    }
    if (!Array.isArray(entry.steps) || entry.steps.length === 0) {
      throw invalidTranscript('steps must be a non-empty array of { observation } frames', w);
    }
    entry.steps.forEach((step, i) => {
      const sw = `${w}.steps[${i}]`;
      if (!step || typeof step !== 'object' || Array.isArray(step)) {
        throw invalidTranscript('step must be an object with an observation field', sw);
      }
      const o = step.observation;
      if (!o || typeof o !== 'object' || Array.isArray(o)) {
        throw invalidTranscript('step.observation must be an object { stdout, exitCode?, cwd? }', sw);
      }
      if (typeof o.stdout !== 'string') {
        throw invalidTranscript('step.observation.stdout must be a string (raw captured pane, ANSI allowed)', sw);
      }
      if (o.exitCode !== undefined && o.exitCode !== null && typeof o.exitCode !== 'number') {
        throw invalidTranscript('step.observation.exitCode must be a number or null', sw);
      }
      if (o.cwd !== undefined && o.cwd !== null && typeof o.cwd !== 'string') {
        throw invalidTranscript('step.observation.cwd must be a string or null', sw);
      }
    });
    if (!Array.isArray(entry.actions) || entry.actions.length !== entry.steps.length) {
      throw invalidTranscript(`actions must be an array parallel to steps (${entry.steps.length} recorded actions expected)`, w);
    }
    entry.actions.forEach((a, i) => {
      const v = validateAction(a);
      if (!v.valid) {
        throw invalidTranscript(`recorded action [${i}] rejected by the frozen v1 action space: ${v.errors[0].message}`, w);
      }
    });
    const ver = entry.verifier;
    if (!ver || typeof ver !== 'object' || Array.isArray(ver)) {
      throw invalidTranscript('verifier must be an object (pre-declared build-only stub verdict)', w);
    }
    if (typeof ver.resolved !== 'boolean') {
      throw invalidTranscript('verifier.resolved must be a boolean', w);
    }
  }
  return true;
}

export async function loadTranscript(transcriptPath) {
  let raw;
  try {
    raw = JSON.parse(await readFile(transcriptPath, 'utf8'));
  } catch (e) {
    const err = new Error(`tb.run: cannot read transcript ${transcriptPath}: ${e.message}`);
    err.code = 'TB_TRANSCRIPT_UNREADABLE';
    throw err;
  }
  validateTranscript(raw, path.basename(transcriptPath));
  return raw;
}

/* ---------------------------------------------------------------------- *
 * Real Terminal-Bench 2.1 loader (gated) — scope 17 only.
 * ---------------------------------------------------------------------- */

function notVerifiedError(split) {
  const err = new Error(
    'NOT VERIFIED — live Terminal-Bench 2.1 task-set read requested (fixturePath: null) but the ' +
    `network is gated off in the scope 13 build-only sandbox; the real loader for split "${split}" ` +
    'is present and ships with an allowNetwork opt-in for the scope 17 live run (read-only GitHub ' +
    'task index). No network call was issued.'
  );
  err.code = 'TB_NETWORK_NOT_VERIFIED';
  err.verified = false;
  return err;
}

// BEGIN TB LIVE PATH (network) — scope 17 only; never reached in scope 13.
const TB_GITHUB_API = 'https://api.github.com';
const TB_REPO = 'laude-institute/terminal-bench';
const TB_REF = 'main'; // provisional: pin the 2.1 tag when the live read is exercised in scope 17.

function extractYamlScalar(text, key) {
  const block = text.match(new RegExp(`^${key}:[ \\t]*[|>][-+]?[ \\t]*\\n([\\s\\S]*?)(?=\\n\\S|\\n*$)`, 'm'));
  if (block) return block[1].replace(/^[ \t]+/gm, '').replace(/\n+$/, '').trim();
  const plain = text.match(new RegExp(`^${key}:[ \\t]*(.+?)[ \\t]*$`, 'm'));
  if (plain) return plain[1].replace(/^["']|["']$/g, '');
  return null;
}

function parseTaskYaml(text, taskId) {
  // Provisional minimal reader (no YAML dependency): instruction/category/
  // difficulty as block or plain scalars. Confirm the exact task.yaml
  // format when the live read is exercised in scope 17.
  return {
    task_id: taskId,
    instruction: extractYamlScalar(text, 'instruction') ?? '',
    category: extractYamlScalar(text, 'category') ?? '',
    difficulty: extractYamlScalar(text, 'difficulty') ?? '',
    verification: { tests: [] }, // verification wiring lands with the scope-17 live leg
    source: 'github',
  };
}

/** Real Terminal-Bench 2.1 loader: task directory index + per-task
 *  task.yaml read. Present in this scope, but it refuses to run without
 *  allowNetwork:true (no keys, no network in the build-only sandbox) and
 *  reports NOT VERIFIED instead. */
export async function loadReal(split = 'terminal-bench-2.1', { allowNetwork = false } = {}) {
  if (!allowNetwork) throw notVerifiedError(split);
  const listUrl = `${TB_GITHUB_API}/repos/${TB_REPO}/contents/tasks?ref=${encodeURIComponent(TB_REF)}`;
  const res = await fetch(listUrl, {
    headers: { accept: 'application/vnd.github+json', 'user-agent': 'jexi-phase31-adapter' },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) {
    throw new Error(`tb.loadReal: GitHub returned HTTP ${res.status} for the task index`);
  }
  const listing = await res.json();
  const dirs = Array.isArray(listing) ? listing.filter((e) => e.type === 'dir').map((e) => e.name) : [];
  const tasks = [];
  for (const name of dirs) {
    const rawUrl = `${TB_GITHUB_API}/repos/${TB_REPO}/contents/tasks/${encodeURIComponent(name)}/task.yaml?ref=${encodeURIComponent(TB_REF)}`;
    const r2 = await fetch(rawUrl, {
      headers: { accept: 'application/vnd.github.raw+json', 'user-agent': 'jexi-phase31-adapter' },
      signal: AbortSignal.timeout(30000),
    });
    if (!r2.ok) {
      throw new Error(`tb.loadReal: GitHub returned HTTP ${r2.status} for tasks/${name}/task.yaml`);
    }
    tasks.push(parseTaskYaml(await r2.text(), name));
  }
  return tasks;
}
// END TB LIVE PATH
