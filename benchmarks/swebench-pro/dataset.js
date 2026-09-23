/**
 * JEXI OS — benchmarks/swebench-pro/dataset.js
 *
 * swepro.load({ split, fixturePath? }) -> instances[]
 *
 * Split resolution:
 * - fixturePath undefined -> the bundled fixture for the requested split
 *   (scope 12: mini-instances.json for split "mini");
 * - fixturePath given     -> that explicit fixture file;
 * - fixturePath === null  -> the REAL HuggingFace loader (SWE-bench Pro).
 *                           Fully implemented but gated behind an explicit
 *                           allowNetwork opt-in: in the scope 12 build-only
 *                           sandbox it reports NOT VERIFIED without touching
 *                           the network. The 731-instance set is large and
 *                           network-fetched; the live read is exercised in
 *                           scope 17.
 *
 * Instance shape (SWE-bench family):
 * { instance_id, repo, language, base_commit, problem_statement,
 *   FAIL_TO_PASS: string[], PASS_TO_PASS: string[], source }
 *
 * Malformed entries (missing/empty instance_id or problem_statement,
 * missing FAIL_TO_PASS or PASS_TO_PASS arrays) carry code
 * E_INVALID_INSTANCE:
 * - load({ strict: true }) throws on the first rejected entry;
 * - default load() returns the VALID instances only — rejections are
 *   never silent: loadDiagnostics() exposes them, and run()'s report
 *   carries a `rejected` section.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export const FIXTURES = {
  mini: path.join(HERE, '..', '_fixtures', 'swebench-pro', 'mini-instances.json'),
};

function invalidInstance(reason, where) {
  const err = new Error(`E_INVALID_INSTANCE — ${where}: ${reason}`);
  err.code = 'E_INVALID_INSTANCE';
  err.reason = reason;
  return err;
}

export function validateInstance(raw, where = 'instance') {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw invalidInstance('entry must be an object', where);
  }
  for (const key of ['instance_id', 'problem_statement']) {
    if (typeof raw[key] !== 'string' || raw[key].trim() === '') {
      throw invalidInstance(`missing ${key} (expected non-empty string)`, where);
    }
  }
  for (const key of ['FAIL_TO_PASS', 'PASS_TO_PASS']) {
    if (!Array.isArray(raw[key])) {
      throw invalidInstance(`missing ${key} (expected array of test names)`, where);
    }
  }
  return true;
}

function coerceInstance(raw, where) {
  validateInstance(raw, where);
  return {
    instance_id: raw.instance_id,
    repo: raw.repo ?? '',
    language: raw.language ?? '',
    base_commit: raw.base_commit ?? '',
    problem_statement: raw.problem_statement,
    FAIL_TO_PASS: [...raw.FAIL_TO_PASS],
    PASS_TO_PASS: [...raw.PASS_TO_PASS],
    source: 'fixture',
  };
}

async function readFixtureEntries(fixturePath, split) {
  let raw;
  try {
    raw = JSON.parse(await readFile(fixturePath, 'utf8'));
  } catch (e) {
    const err = new Error(`swepro.load: cannot read fixture ${fixturePath}: ${e.message}`);
    err.code = 'SWEBENCH_FIXTURE_UNREADABLE';
    throw err;
  }
  if (raw.split && split && raw.split !== split) {
    throw new Error(`swepro.load: fixture "${raw.name ?? path.basename(fixturePath)}" carries split "${raw.split}", requested "${split}"`);
  }
  const entries = Array.isArray(raw.instances) ? raw.instances : [];
  if (!entries.length) {
    throw new Error(`swepro.load: fixture ${fixturePath} contains no instances`);
  }
  const label = path.basename(fixturePath);
  return { entries, label };
}

function collectInstances(entries, label) {
  const instances = [];
  const rejected = [];
  entries.forEach((entry, index) => {
    const where = `${label}[${index}]`;
    try {
      instances.push(coerceInstance(entry, where));
    } catch (err) {
      rejected.push({
        index,
        instance_id: entry && typeof entry.instance_id === 'string' ? entry.instance_id : null,
        code: err.code,
        reason: err.reason,
      });
    }
  });
  return { instances, rejected };
}

export async function load({ split = 'mini', fixturePath, strict = false } = {}) {
  if (fixturePath === null) {
    // Real dataset path — exercised only with an explicit network opt-in.
    return loadHf(split, { allowNetwork: false });
  }
  const resolved = fixturePath ?? FIXTURES[split];
  if (!resolved) {
    throw new Error(`swepro.load: no bundled fixture registered for split "${split}" (pass fixturePath explicitly)`);
  }
  const { entries, label } = await readFixtureEntries(resolved, split);
  const { instances, rejected } = collectInstances(entries, label);
  if (strict && rejected.length) {
    const first = rejected[0];
    const err = new Error(`E_INVALID_INSTANCE — ${label}[${first.index}] (${first.instance_id ?? 'unnamed'}): ${first.reason}`);
    err.code = 'E_INVALID_INSTANCE';
    err.reason = first.reason;
    err.rejected = rejected;
    throw err;
  }
  return instances;
}

/** Non-silent rejection surface: { instances, rejected, fixture, split }. */
export async function loadDiagnostics({ split = 'mini', fixturePath } = {}) {
  if (fixturePath === null) {
    await loadHf(split, { allowNetwork: false }); // throws NOT VERIFIED
    return; // unreachable
  }
  const resolved = fixturePath ?? FIXTURES[split];
  if (!resolved) {
    throw new Error(`swepro.loadDiagnostics: no bundled fixture registered for split "${split}"`);
  }
  const { entries, label } = await readFixtureEntries(resolved, split);
  const { instances, rejected } = collectInstances(entries, label);
  return { instances, rejected, fixture: resolved, split };
}

function notVerifiedError(split) {
  const err = new Error(
    'NOT VERIFIED — live HuggingFace read requested (fixturePath: null) but network is ' +
    `gated off in the scope 12 build-only sandbox; the real SWE-bench Pro loader for ` +
    `split "${split}" is present and ships with an allowNetwork opt-in for the scope 17 ` +
    'live run (731-instance set, network-fetched). No fetch was issued.'
  );
  err.code = 'SWEBENCH_HF_NOT_VERIFIED';
  err.verified = false;
  return err;
}

// BEGIN HF LIVE PATH (network) — scope 17 only; never reached in scope 12.
const HF_DATASETS_SERVER = 'https://datasets-server.huggingface.co';
// Provisional HF repo id for SWE-bench Pro; confirm the exact id when the
// live read is exercised in scope 17.
const HF_DATASET_ID = 'ScaleAI/SWE-bench_Pro';

function parseTestList(value) {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === 'string' && value.trim() !== '') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.map(String);
    } catch { /* not JSON — keep as single entry */ }
    return [value];
  }
  return [];
}

function rowToInstance(entry) {
  const t = entry?.row ?? entry ?? {};
  return {
    instance_id: String(t.instance_id),
    repo: String(t.repo ?? ''),
    language: String(t.language ?? ''),
    base_commit: String(t.base_commit ?? ''),
    problem_statement: String(t.problem_statement ?? ''),
    FAIL_TO_PASS: parseTestList(t.FAIL_TO_PASS),
    PASS_TO_PASS: parseTestList(t.PASS_TO_PASS),
    source: 'huggingface',
  };
}

/** Real SWE-bench Pro loader: paginated read via the HuggingFace
 *  datasets-server rows API. Present in this scope, but it refuses to run
 *  without allowNetwork:true (no keys, no network in the build-only
 *  sandbox) and reports NOT VERIFIED instead. */
export async function loadHf(split = 'test', { allowNetwork = false, pageSize = 100 } = {}) {
  if (!allowNetwork) throw notVerifiedError(split);
  const rows = [];
  let offset = 0;
  for (;;) {
    const url =
      `${HF_DATASETS_SERVER}/rows?dataset=${encodeURIComponent(HF_DATASET_ID)}` +
      `&config=default&split=${encodeURIComponent(split)}&offset=${offset}&length=${pageSize}`;
    const res = await fetch(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) {
      throw new Error(`swepro.load: datasets-server returned HTTP ${res.status} for split "${split}"`);
    }
    const body = await res.json();
    const batch = Array.isArray(body.rows) ? body.rows.map(rowToInstance) : [];
    rows.push(...batch);
    offset += batch.length;
    if (!batch.length || offset >= (body.num_rows_total ?? rows.length)) break;
  }
  return rows;
}
// END HF LIVE PATH
