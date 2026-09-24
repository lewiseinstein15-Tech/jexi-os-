/**
 * JEXI OS — benchmarks/swebench-pro/apply.js
 *
 * swepro.apply(patch, { repoPath, dryRun }) -> { applied, filesChanged, ... }
 *
 * Unified-diff parser + patch planner/applier.
 * - dryRun:true (default)  -> parse + plan ONLY: per-file hunk counts and
 *   +/- line tallies, target existence under repoPath (read-only). No disk
 *   write of any kind.
 * - dryRun:false           -> REAL file application. The SWE-bench harness
 *   applies patches inside per-instance Docker containers, so the real
 *   path is gated behind allowDocker:true (scope 17). In the build-only
 *   sandbox the gate refuses WITHOUT invoking Docker; this module never
 *   spawns any process.
 *
 * Malformed patches (bad file header, bad hunk header, hunk line counts
 * inconsistent with the header, unsafe target paths) throw
 * E_MALFORMED_PATCH — never a silent failure.
 */

import fs from 'node:fs';
import path from 'node:path';

function malformed(reason) {
  const err = new Error(`E_MALFORMED_PATCH — ${reason}`);
  err.code = 'E_MALFORMED_PATCH';
  err.reason = reason;
  return err;
}

function dockerNotVerified() {
  const err = new Error(
    'NOT VERIFIED — real patch application requested (dryRun: false) but the ' +
    'SWE-bench harness applies patches inside per-instance Docker containers, ' +
    'gated behind allowDocker:true for the scope 17 live run. No Docker call, ' +
    'no file writes were issued.'
  );
  err.code = 'SWEBENCH_DOCKER_NOT_VERIFIED';
  err.verified = false;
  return err;
}

function stripHeaderPath(raw, kind, lineNo) {
  const value = raw.split('\t')[0].trim(); // tolerate GNU's tab+timestamp suffix
  if (value === '/dev/null') return null;
  const prefix = kind === 'old' ? 'a/' : 'b/';
  if (!value.startsWith(prefix)) {
    throw malformed(`file header at line ${lineNo}: expected "${prefix}<path>" or "/dev/null", got "${value}"`);
  }
  const rel = value.slice(prefix.length);
  if (rel === '') throw malformed(`file header at line ${lineNo}: empty path`);
  if (path.isAbsolute(rel) || rel.split('/').includes('..')) {
    throw malformed(`file header at line ${lineNo}: unsafe target path "${value}"`);
  }
  return rel;
}

/** Strict unified-diff parser. Returns { files: [{ path, oldPath, newPath,
 *  hunks: [{ oldStart, oldCount, newStart, newCount, added, removed, lines }] }] }. */
export function parsePatch(patchText) {
  if (typeof patchText !== 'string') throw malformed('patch must be a string');
  const lines = patchText.split('\n');
  while (lines.length && lines[lines.length - 1] === '') lines.pop();

  const files = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line === '') { i++; continue; } // blank line between sections
    if (!line.startsWith('--- ')) {
      throw malformed(`expected "--- " file header at line ${i + 1}, got: ${line.slice(0, 60)}`);
    }
    const oldPath = stripHeaderPath(line.slice(4), 'old', i + 1);
    i++;
    if (i >= lines.length || !lines[i].startsWith('+++ ')) {
      throw malformed(`expected "+++ " file header at line ${i + 1}`);
    }
    const newPath = stripHeaderPath(lines[i].slice(4), 'new', i + 1);
    i++;
    if (oldPath !== null && newPath !== null && oldPath !== newPath) {
      throw malformed(`rename not supported in scope 12: "${oldPath}" -> "${newPath}"`);
    }
    if (oldPath === null && newPath === null) {
      throw malformed(`both sides /dev/null at file section starting line ${i - 1}`);
    }

    const hunks = [];
    while (i < lines.length && lines[i].startsWith('@@ ')) {
      const headerLine = i + 1;
      const m = lines[i].match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
      if (!m) throw malformed(`bad hunk header at line ${headerLine}: ${lines[i].slice(0, 60)}`);
      const oldStart = Number(m[1]);
      const oldCount = m[2] === undefined ? 1 : Number(m[2]);
      const newStart = Number(m[3]);
      const newCount = m[4] === undefined ? 1 : Number(m[4]);
      i++;
      const hunkLines = [];
      let del = 0, add = 0, ctx = 0;
      // Count-driven consumption: hunk body ends exactly when the header
      // counts are satisfied. This disambiguates a following "--- " file
      // header from a "-" deletion line (a "-" line of content "-- x" can
      // only be real content while counts are unmet in a well-formed patch).
      while (i < lines.length && (del + ctx < oldCount || add + ctx < newCount)) {
        const hl = lines[i];
        if (hl.startsWith('\\')) { hunkLines.push({ type: '\\', content: hl }); i++; continue; }
        if (hl === '') throw malformed(`unexpected empty line inside hunk at line ${i + 1}`);
        const t0 = hl[0];
        if (t0 === ' ') { ctx++; hunkLines.push({ type: ' ', content: hl.slice(1) }); }
        else if (t0 === '-') { del++; hunkLines.push({ type: '-', content: hl.slice(1) }); }
        else if (t0 === '+') { add++; hunkLines.push({ type: '+', content: hl.slice(1) }); }
        else throw malformed(`unexpected line inside hunk (header at line ${headerLine}) at line ${i + 1}: ${hl.slice(0, 60)}`);
        i++;
      }
      if (del + ctx !== oldCount) {
        throw malformed(`hunk header at line ${headerLine}: old-side line count ${del + ctx} != declared ${oldCount}`);
      }
      if (add + ctx !== newCount) {
        throw malformed(`hunk header at line ${headerLine}: new-side line count ${add + ctx} != declared ${newCount}`);
      }
      // trailing no-newline markers after the satisfied counts
      while (i < lines.length && lines[i].startsWith('\\')) {
        hunkLines.push({ type: '\\', content: lines[i] });
        i++;
      }
      hunks.push({ oldStart, oldCount, newStart, newCount, added: add, removed: del, lines: hunkLines });
    }
    if (!hunks.length) {
      throw malformed(`no hunks for file section "${newPath ?? oldPath}"`);
    }
    files.push({ path: newPath ?? oldPath, oldPath, newPath, hunks });
  }
  return { files };
}

/** Plan from a parsed patch: per-file tallies + existence under repoPath
 *  (existence check is read-only; dry-run never writes). */
function plan(parsed, repoPath) {
  const files = parsed.files.map((f) => {
    const abs = repoPath ? path.join(repoPath, f.path) : null;
    let exists = false;
    if (abs) {
      if (f.oldPath === null) exists = !fs.existsSync(abs); // new file: "exists" means creatable (not present)
      else exists = fs.existsSync(abs);
    }
    return {
      path: f.path,
      kind: f.oldPath === null ? 'add' : f.newPath === null ? 'delete' : 'modify',
      existsOk: exists,
      hunks: f.hunks.length,
      added: f.hunks.reduce((acc, h) => acc + h.added, 0),
      removed: f.hunks.reduce((acc, h) => acc + h.removed, 0),
    };
  });
  return {
    filesChanged: files.map((f) => f.path),
    files,
    hunksTotal: files.reduce((acc, f) => acc + f.hunks, 0),
  };
}

export function apply(patch, { repoPath = null, dryRun = true, allowDocker = false } = {}) {
  const parsed = parsePatch(patch); // throws E_MALFORMED_PATCH before anything else

  if (dryRun) {
    const p = plan(parsed, repoPath);
    return { applied: false, dryRun: true, ...p };
  }

  if (!allowDocker) throw dockerNotVerified();

  // ---- REAL APPLICATION (allowDocker:true, scope 17 harness context) ----
  // Plain fs applier with strict (no-fuzz) context verification. Runs inside
  // the per-instance container in the real harness; unverified in the
  // scope 12 build-only sandbox.
  if (!repoPath) {
    const err = new Error('swepro.apply: repoPath is required for real application');
    err.code = 'SWEBENCH_REPO_PATH_REQUIRED';
    throw err;
  }
  for (const f of parsed.files) {
    const abs = path.join(repoPath, f.path);
    if (f.oldPath === null) {
      const out = applyHunksToLines([], f.hunks, '');
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, out);
    } else if (f.newPath === null) {
      fs.rmSync(abs, { force: true });
    } else {
      const oldText = fs.readFileSync(abs, 'utf8');
      const endsNl = oldText === '' || oldText.endsWith('\n');
      const { lines } = splitForApply(oldText);
      const out = applyHunksToLines(lines, f.hunks, endsNl ? '\n' : '');
      fs.writeFileSync(abs, out);
    }
  }
  const p = plan(parsed, repoPath);
  return { applied: true, dryRun: false, ...p };
}

// -- helpers for the gated real applier (scope 17) --------------------------
function splitForApply(text) {
  const parts = text.split('\n');
  let trailingNl = true;
  if (parts[parts.length - 1] !== '') trailingNl = false;
  else parts.pop();
  return { lines: parts, trailingNl };
}

function applyHunksToLines(lines, hunks, trailingNlControl) {
  const result = lines.slice();
  let offset = 0;
  for (const h of hunks) {
    const aSide = h.lines.filter((l) => l.type === ' ' || l.type === '-').map((l) => l.content);
    const pos = h.oldCount === 0
      ? h.oldStart + offset // insert after 1-based line oldStart
      : h.oldStart - 1 + offset;
    if (h.oldCount > 0) {
      for (let k = 0; k < aSide.length; k++) {
        if (result[pos + k] !== aSide[k]) {
          const err = new Error(
            `E_PATCH_APPLY_FAILED — context mismatch in hunk at old line ${h.oldStart + k}: expected ${JSON.stringify(aSide[k])}, found ${JSON.stringify(result[pos + k] ?? null)}`
          );
          err.code = 'E_PATCH_APPLY_FAILED';
          throw err;
        }
      }
    }
    const newSide = h.lines.filter((l) => l.type === ' ' || l.type === '+');
    result.splice(pos, aSide.length, ...newSide.map((l) => l.content));
    offset += h.newCount - h.oldCount;
  }
  const lastMarker = hunks[hunks.length - 1]?.lines[hunks[hunks.length - 1]?.lines.length - 1];
  const endsNl = lastMarker && lastMarker.type === '\\' ? false : trailingNlControl !== '';
  return result.join('\n') + (endsNl ? '\n' : '');
}
