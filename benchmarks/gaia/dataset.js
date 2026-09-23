/**
 * JEXI OS — benchmarks/gaia/dataset.js
 *
 * gaia.load({ split, fixturePath? }) -> tasks[]
 *
 * Split resolution:
 * - fixturePath undefined  -> the bundled fixture for the requested split
 *                            (scope 11: mini-validation.json for "validation");
 * - fixturePath given      -> that explicit fixture file;
 * - fixturePath === null   -> the REAL HuggingFace loader (gaia-benchmark/GAIA).
 *                            This is the live path: it is fully implemented but
 *                            gated behind an explicit allowNetwork opt-in, and in
 *                            the scope 11 build-only sandbox it reports
 *                            NOT VERIFIED without touching the network.
 *                            Live HF read is exercised in scope 17.
 *
 * Task shape (mirrors the GAIA validation split):
 * { task_id, question, level: 1|2|3, final_answer, file_name, annotator_metadata, source }
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export const FIXTURES = {
  validation: path.join(HERE, '..', '_fixtures', 'gaia', 'mini-validation.json'),
};

const VALID_LEVELS = [1, 2, 3];

function coerceTask(raw, where) {
  const missing = ['task_id', 'question', 'level', 'final_answer'].filter(
    (k) => raw?.[k] === undefined || raw?.[k] === null
  );
  if (missing.length) {
    throw new Error(`gaia dataset (${where}): task missing fields: ${missing.join(', ')}`);
  }
  const level = Number(raw.level);
  if (!VALID_LEVELS.includes(level)) {
    throw new Error(`gaia dataset (${where}): task level must be 1, 2 or 3, got ${JSON.stringify(raw.level)}`);
  }
  return {
    task_id: String(raw.task_id),
    question: String(raw.question),
    level,
    final_answer: String(raw.final_answer),
    file_name: raw.file_name ?? '',
    annotator_metadata: raw.annotator_metadata ?? '',
    source: 'fixture',
  };
}

export async function loadFixture(fixturePath, split = 'validation') {
  let raw;
  try {
    raw = JSON.parse(await readFile(fixturePath, 'utf8'));
  } catch (e) {
    const err = new Error(`gaia.load: cannot read fixture ${fixturePath}: ${e.message}`);
    err.code = 'GAIA_FIXTURE_UNREADABLE';
    throw err;
  }
  if (raw.split && split && raw.split !== split) {
    throw new Error(`gaia.load: fixture "${raw.name ?? path.basename(fixturePath)}" carries split "${raw.split}", requested "${split}"`);
  }
  const tasks = Array.isArray(raw.tasks) ? raw.tasks : [];
  if (!tasks.length) {
    throw new Error(`gaia.load: fixture ${fixturePath} contains no tasks`);
  }
  return tasks.map((t, i) => coerceTask(t, `${path.basename(fixturePath)}[${i}]`));
}

function notVerifiedError(split) {
  const err = new Error(
    'NOT VERIFIED — live HuggingFace read requested (fixturePath: null) but network is ' +
    `gated off in the scope 11 build-only sandbox; the real gaia-benchmark/GAIA loader for ` +
    `split "${split}" is present and ships with an allowNetwork opt-in for the scope 17 live run. ` +
    'No fetch was issued.'
  );
  err.code = 'GAIA_HF_NOT_VERIFIED';
  err.verified = false;
  return err;
}

export async function load({ split = 'validation', fixturePath, allowNetwork = false } = {}) {
  if (fixturePath === null) {
    // Real dataset path — exercised only with an explicit network opt-in.
    return loadHf(split, { allowNetwork });
  }
  const resolved = fixturePath ?? FIXTURES[split];
  if (!resolved) {
    throw new Error(`gaia.load: no bundled fixture registered for split "${split}" (pass fixturePath explicitly)`);
  }
  return loadFixture(resolved, split);
}

// BEGIN HF LIVE PATH (network) — scope 17 only; never reached in scope 11.
const HF_DATASETS_SERVER = 'https://datasets-server.huggingface.co';
const HF_DATASET_ID = 'gaia-benchmark/GAIA';

function rowFromHf(entry) {
  const t = entry?.row ?? entry ?? {};
  return {
    task_id: String(t.task_id),
    question: String(t.question),
    level: Number(t.level),
    final_answer: String(t.final_answer),
    file_name: t.file_name ?? '',
    annotator_metadata: t.annotator_metadata ?? '',
    source: 'huggingface',
  };
}

/** Real GAIA loader: paginated read of gaia-benchmark/GAIA via the
 *  HuggingFace datasets-server rows API. Present in this scope, but it
 *  refuses to run without allowNetwork:true (no keys, no network in the
 *  build-only sandbox) and reports NOT VERIFIED instead. */
export async function loadHf(split = 'validation', { allowNetwork = false, pageSize = 100 } = {}) {
  if (!allowNetwork) throw notVerifiedError(split);
  const rows = [];
  let offset = 0;
  for (;;) {
    const url =
      `${HF_DATASETS_SERVER}/rows?dataset=${encodeURIComponent(HF_DATASET_ID)}` +
      `&config=default&split=${encodeURIComponent(split)}&offset=${offset}&length=${pageSize}`;
    const res = await fetch(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) {
      throw new Error(`gaia.load: HF datasets-server returned HTTP ${res.status} for split "${split}"`);
    }
    const body = await res.json();
    const batch = Array.isArray(body.rows) ? body.rows.map(rowFromHf) : [];
    rows.push(...batch);
    offset += batch.length;
    if (!batch.length || offset >= (body.num_rows_total ?? rows.length)) break;
  }
  return rows;
}
// END HF LIVE PATH
