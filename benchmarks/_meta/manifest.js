/**
 * JEXI OS — benchmarks/_meta/manifest.js
 *
 * Run manifest + canonical JSON + sha256 — the reproducibility pin
 * shared by every _meta module.
 *
 * A manifest pins: benchmark name, adapter version, model name +
 * version, dataset revision, seed. The sha256 is taken over the
 * canonical (recursively key-sorted) JSON of the manifest object, so
 * ANY pin change — model version, dataset rev, seed, benchmark,
 * adapter version — produces a new hash.
 *
 * Timestamps: the manifest carries createdAt from an INJECTED clock
 * only. With no clock supplied the field is deterministically null and
 * the hash depends solely on the pinned inputs. There is no fallback
 * to the system clock anywhere in _meta.
 *
 * Errors ride the existing per-layer class (SemanticaError) with
 * stable codes — never bare messages.
 */

import { createHash } from 'node:crypto';
import { SemanticaError } from '../../semantica/_internal.js';

/**
 * Recursively key-sorted JSON — the canonical byte form for hashing
 * and for the disk trace sink. Array order is preserved (order is
 * data, naming is not). Undefined collapses to null so a partially
 * filled record can never corrupt the byte stream.
 */
export function canonicalJson(value) {
  if (value === undefined) return 'null';
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v)).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function sha256Hex(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

/**
 * Injected-clock resolution — the ONLY time source in _meta.
 * A function is invoked and must return an ISO-8601 string, a string
 * must be ISO-8601 and is taken verbatim, null/undefined resolves to
 * null. Anything else is refused. Without an injected clock every
 * timestamp in the layer is deterministically null.
 */
export function resolveClock(clock) {
  if (clock === undefined || clock === null) return null;
  if (typeof clock === 'function') {
    const v = clock();
    if (typeof v !== 'string' || !ISO_RE.test(v)) {
      throw new SemanticaError('E_INVALID_ARGUMENT', `meta clock function must return an ISO-8601 string, got ${JSON.stringify(v)}`);
    }
    return v;
  }
  if (typeof clock === 'string' && ISO_RE.test(clock)) return clock;
  throw new SemanticaError('E_INVALID_ARGUMENT', `meta clock must be a function or an ISO-8601 string, got ${JSON.stringify(clock)}`);
}

function nonEmptyString(v, what) {
  if (typeof v !== 'string' || v.trim() === '') {
    throw new SemanticaError('E_INVALID_ARGUMENT', `meta.manifest: ${what} must be a non-empty string, got ${JSON.stringify(v)}`);
  }
  return v;
}

function normalizeSeed(seed) {
  if (typeof seed === 'number' && Number.isFinite(seed)) return seed;
  if (typeof seed === 'string' && seed.trim() !== '') return seed;
  throw new SemanticaError('E_INVALID_ARGUMENT', `meta.manifest: seed must be a finite number or a non-empty string, got ${JSON.stringify(seed)}`);
}

/**
 * meta.manifest({ benchmark, adapterVersion, model, datasetRev, seed }, { clock }?)
 *   -> { manifest, sha256 }
 *
 * manifest = {
 *   adapterVersion, benchmark, createdAt,   // createdAt: injected clock or null
 *   datasetRev, model: { name, version }, seed
 * }
 *
 * The hash covers the WHOLE canonical manifest — model name + version,
 * dataset rev, seed, benchmark, adapter version, createdAt (when
 * clocked). Change any pin, change the hash.
 */
export function buildManifest(input = {}, deps = {}) {
  const i = input ?? {};
  const d = deps ?? {};
  if (typeof i !== 'object' || Array.isArray(i)) {
    throw new SemanticaError('E_INVALID_ARGUMENT', `meta.manifest: input must be a plain object, got ${Array.isArray(i) ? 'array' : typeof i}`);
  }
  const model = i.model;
  if (!model || typeof model !== 'object' || Array.isArray(model)) {
    throw new SemanticaError('E_INVALID_ARGUMENT', `meta.manifest: model must be a plain object { name, version }, got ${JSON.stringify(model)}`);
  }
  const manifest = {
    adapterVersion: nonEmptyString(i.adapterVersion, 'adapterVersion'),
    benchmark: nonEmptyString(i.benchmark, 'benchmark'),
    createdAt: resolveClock(d.clock ?? null),
    datasetRev: nonEmptyString(i.datasetRev, 'datasetRev'),
    model: { name: nonEmptyString(model.name, 'model.name'), version: nonEmptyString(model.version, 'model.version') },
    seed: normalizeSeed(i.seed),
  };
  return { manifest, sha256: sha256Hex(canonicalJson(manifest)) };
}
