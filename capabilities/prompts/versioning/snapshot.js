// prompt/versioning/snapshot.js
// Phase 25 — Scope K: immutable prompt snapshots (versioning like code).
//
// A prompt is built from sections (Scope A registry). Every build can be
// SNAPSHOTTED: hashed as a whole, hashed per section, and stored on real
// disk so any later process can diff against it or roll back to it —
// byte-identical.
//
// Immutability model (RULE 1):
// - Snapshots are CONTENT-ADDRESSED (like git): versionId is derived from
//   a canonical hash of the section content. Snapshotting identical
//   content twice returns the SAME stored record — never a second copy,
//   never a rewritten one. A record file is written once and never
//   modified afterwards.
// - RULE 3 (no deletion): rollback and diffing never remove records. The
//   store only ever gains files.
//
// Storage (RULE 6): .jexi/prompt-versions/
//   versions/<versionId>.json  — one immutable snapshot record per file
//   current.json               — rollback pointer (active version)
//   tests/registry.json        — prompt-test catalog (see prompt/testing)
//   Covered by the existing `.jexi/` gitignore rule. Override the root
//   with env JEXI_PROMPT_VERSIONS_ROOT for probes/tests (read at CALL
//   time, same pattern as memory-fs's store root and incidents root).
//
// Determinism (RULE 7): versionId and sha256 are pure functions of the
// content; the same input sequence produces the same store paths and the
// same hashes. Only createdAt varies (masked when comparing across runs).
//
// Zone discipline: prompt/assembly, prompt/constitution, prompt/tools,
// prompt/memory-fs, and prompt/incidents are NOT modified by this scope.
// No LLM calls anywhere (RULE 7 of the test framework; none here either).

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
// snapshot.js lives at <projectRoot>/prompt/versioning/snapshot.js
export const PROJECT_ROOT = path.resolve(MODULE_DIR, '..', '..', '..');

/** Machine-readable codes for the versioning zone (Scope K). */
export const VERSIONING_CODES = Object.freeze({
  INVALID_PROMPT: 'E_INVALID_PROMPT',
  NO_SUCH_VERSION: 'E_NO_SUCH_VERSION',
  INVALID_DIFF_INPUT: 'E_INVALID_DIFF_INPUT',
});

/** Store root. Read at CALL time (probe isolation via env). */
export function versioningRoot() {
  const override = process.env.JEXI_PROMPT_VERSIONS_ROOT;
  if (typeof override === 'string' && override.trim() !== '') {
    return path.resolve(override);
  }
  return path.join(PROJECT_ROOT, '.jexi', 'prompt-versions');
}

export function versionsDir() {
  return path.join(versioningRoot(), 'versions');
}

export function sha256Text(s) {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}

/** Atomic JSON write: temp file + rename, so a crash never leaves a half record. */
export function writeJsonAtomic(file, obj) {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(file)}.tmp-${process.pid}`);
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, file);
}

/**
 * Normalize a built prompt into { sections: [{id, content}], text }.
 * Accepted shapes:
 *   - a string                      -> one section with id 'prompt'
 *   - an array of {id, content}     -> ordered sections (Scope-A built output)
 *   - { sections: [...] } envelope  -> the array inside
 * The rendered text is sections' content joined by a blank line; for a
 * string input the text IS the string (byte-exact).
 */
export function normalizeBuiltPrompt(builtPrompt) {
  let arr = null;
  if (typeof builtPrompt === 'string') {
    if (builtPrompt.trim() === '') return { error: 'builtPrompt string must be non-empty' };
    arr = [{ id: 'prompt', content: builtPrompt }];
  } else if (Array.isArray(builtPrompt)) {
    arr = builtPrompt;
  } else if (builtPrompt && typeof builtPrompt === 'object' && Array.isArray(builtPrompt.sections)) {
    arr = builtPrompt.sections;
  } else {
    return {
      error:
        'builtPrompt must be a non-empty string, an array of {id, content}, or { sections: [...] }',
    };
  }
  if (!Array.isArray(arr) || arr.length === 0) {
    return { error: 'builtPrompt must contain at least one section' };
  }
  const sections = [];
  const seen = new Set();
  for (const s of arr) {
    if (!s || typeof s !== 'object' || Array.isArray(s)) {
      return { error: 'every section must be a plain object {id, content}' };
    }
    if (typeof s.id !== 'string' || s.id.trim() === '') {
      return { error: 'every section needs a non-empty string id' };
    }
    if (typeof s.content !== 'string') {
      return { error: `section "${s.id}" content must be a string` };
    }
    if (seen.has(s.id)) {
      return { error: `duplicate section id "${s.id}"` };
    }
    seen.add(s.id);
    sections.push({ id: s.id, content: s.content });
  }
  const text = sections.map((s) => s.content).join('\n\n');
  return { sections, text };
}

/** Canonical envelope hashed into the versionId (structure-aware id). */
function canonicalEnvelope(sections) {
  return JSON.stringify({
    format: 1,
    kind: 'jexi-prompt-snapshot',
    sections: sections.map((s) => [s.id, s.content]),
  });
}

function versionIdFor(sections) {
  return `pv-${createHash('sha256').update(canonicalEnvelope(sections), 'utf8').digest('hex').slice(0, 16)}`;
}

function recordPath(versionId) {
  return path.join(versionsDir(), `${versionId}.json`);
}

/** Read one snapshot record from disk, or null. */
export function readRecord(versionId) {
  try {
    return JSON.parse(fs.readFileSync(recordPath(versionId), 'utf8'));
  } catch {
    return null;
  }
}

/**
 * versioning.snapshot(builtPrompt) ->
 *   { versionId, sha256, sectionHashes, createdAt }
 *
 * builtPrompt: string | [{id, content}, ...] | { sections: [...] }
 * sectionHashes: { [sectionId]: sha256(sectionContent) }
 * sha256: hash of the rendered prompt text (the byte-identical rollback unit)
 * versionId: 'pv-' + first 16 hex of the canonical section-content hash
 *
 * Content-addressed (RULE 1): if this exact content was snapshotted before,
 * the EXISTING immutable record is returned unchanged (same versionId, same
 * createdAt). A record file is written exactly once and never rewritten.
 */
export function snapshot(builtPrompt) {
  const norm = normalizeBuiltPrompt(builtPrompt);
  if (norm.error) {
    const err = new Error(`snapshot refused: ${norm.error}`);
    err.code = VERSIONING_CODES.INVALID_PROMPT;
    throw err;
  }
  const { sections, text } = norm;
  const versionId = versionIdFor(sections);
  const existing = readRecord(versionId);
  if (existing) {
    // Immutable replay: identical content -> the same stored record.
    return {
      versionId: existing.versionId,
      sha256: existing.sha256,
      sectionHashes: existing.sectionHashes,
      createdAt: existing.createdAt,
    };
  }
  const sectionHashes = {};
  for (const s of sections) sectionHashes[s.id] = sha256Text(s.content);
  const record = {
    versionId,
    sha256: sha256Text(text),
    createdAt: new Date().toISOString(),
    sectionOrder: sections.map((s) => s.id),
    sectionHashes,
    sections,
    text,
  };
  // O_EXCL would be belt-and-braces; writeJsonAtomic + the read-first check
  // above keeps records immutable in every flow this module exposes.
  writeJsonAtomic(recordPath(versionId), record);
  return {
    versionId: record.versionId,
    sha256: record.sha256,
    sectionHashes: record.sectionHashes,
    createdAt: record.createdAt,
  };
}

/**
 * Resolve a diff/rollback input: a versionId string (loaded from disk) or
 * an already-shaped snapshot record (must carry versionId + sectionHashes).
 */
export function loadSnapshot(v) {
  if (typeof v === 'string' && v.trim() !== '') {
    const rec = readRecord(v.trim());
    if (!rec) {
      const err = new Error(`no such snapshot: ${v}`);
      err.code = VERSIONING_CODES.NO_SUCH_VERSION;
      throw err;
    }
    return rec;
  }
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    if (typeof v.versionId === 'string' && v.sectionHashes && typeof v.sectionHashes === 'object') {
      return v;
    }
    const err = new Error(
      'snapshot object must carry versionId (string) and sectionHashes (object)'
    );
    err.code = VERSIONING_CODES.INVALID_DIFF_INPUT;
    throw err;
  }
  const err = new Error('expected a versionId string or a snapshot record');
  err.code = VERSIONING_CODES.INVALID_DIFF_INPUT;
  throw err;
}

/** All stored snapshot records, sorted by versionId (deterministic order). */
export function listVersions() {
  const dir = versionsDir();
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    const rec = readRecord(f.slice(0, -'.json'.length));
    if (rec) out.push(rec);
  }
  out.sort((a, b) => (a.versionId < b.versionId ? -1 : a.versionId > b.versionId ? 1 : 0));
  return out;
}
