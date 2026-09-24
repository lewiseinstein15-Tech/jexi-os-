// prompt/versioning/diff.js
// Phase 25 — Scope K: line-level, per-section diff between two snapshots.
//
// diff(v1, v2) walks the UNION of section ids (v1 order first, then
// sections that only exist in v2) and compares section hashes:
//   - equal hash            -> { id, changed: false }            (RULE 2)
//   - different hash        -> { id, changed: true, delta }
//   - only in v2            -> { id, changed: true, delta: kind 'added' }
//   - only in v1            -> { id, changed: true, delta: kind 'removed' }
// delta is a LINE-LEVEL diff: added/removed lines with their 1-based line
// numbers in the NEW (v2) / OLD (v1) section text respectively, computed
// with a longest-common-subsequence walk (common prefix/suffix trimmed
// first so typical prompt edits stay cheap). Unchanged sections carry no
// delta at all — the contract's `delta?`.
//
// Inputs: versionId strings (resolved from disk) or snapshot records.
// Deterministic: same two snapshots -> same diff, byte for byte (RULE 7).

import { loadSnapshot } from './snapshot.js';

/**
 * LCS line diff of aText -> bText.
 * Returns { added: [{n, text}], removed: [{n, text}] } where `n` is the
 * 1-based line number in bText (added) / aText (removed).
 */
export function lineDiff(aText, bText) {
  const a = String(aText).split('\n');
  const b = String(bText).split('\n');

  // Trim common prefix/suffix — cheap for typical edits, and bounds the DP.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length - 1;
  let endB = b.length - 1;
  while (endA >= start && endB >= start && a[endA] === b[endB]) {
    endA--;
    endB--;
  }
  const midA = a.slice(start, endA + 1);
  const midB = b.slice(start, endB + 1);

  // LCS DP over the trimmed middle.
  const n = midA.length;
  const m = midB.length;
  const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] =
        midA[i] === midB[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const added = [];
  const removed = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (midA[i] === midB[j]) {
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      removed.push({ n: start + i + 1, text: midA[i] });
      i++;
    } else {
      added.push({ n: start + j + 1, text: midB[j] });
      j++;
    }
  }
  while (i < n) {
    removed.push({ n: start + i + 1, text: midA[i] });
    i++;
  }
  while (j < m) {
    added.push({ n: start + j + 1, text: midB[j] });
    j++;
  }
  return { added, removed };
}

/**
 * versioning.diff(v1, v2) -> { sections: [{ id, changed, delta? }] }
 * v1, v2: versionId strings or snapshot records.
 */
export function diff(v1, v2) {
  const r1 = loadSnapshot(v1);
  const r2 = loadSnapshot(v2);
  const order = [];
  const seen = new Set();
  for (const id of r1.sectionOrder || []) {
    if (!seen.has(id)) {
      order.push(id);
      seen.add(id);
    }
  }
  for (const id of r2.sectionOrder || []) {
    if (!seen.has(id)) {
      order.push(id);
      seen.add(id);
    }
  }
  const sections = order.map((id) => {
    const h1 = Object.prototype.hasOwnProperty.call(r1.sectionHashes, id)
      ? r1.sectionHashes[id]
      : null;
    const h2 = Object.prototype.hasOwnProperty.call(r2.sectionHashes, id)
      ? r2.sectionHashes[id]
      : null;
    if (h1 !== null && h2 !== null && h1 === h2) {
      return { id, changed: false };
    }
    let delta;
    if (h1 === null) {
      const lines = (r2.sections.find((s) => s.id === id)?.content ?? '').split('\n');
      delta = {
        kind: 'added',
        added: lines.map((text, idx) => ({ n: idx + 1, text })),
        removed: [],
        addedCount: lines.length,
        removedCount: 0,
      };
    } else if (h2 === null) {
      const lines = (r1.sections.find((s) => s.id === id)?.content ?? '').split('\n');
      delta = {
        kind: 'removed',
        added: [],
        removed: lines.map((text, idx) => ({ n: idx + 1, text })),
        addedCount: 0,
        removedCount: lines.length,
      };
    } else {
      const c1 = r1.sections.find((s) => s.id === id)?.content ?? '';
      const c2 = r2.sections.find((s) => s.id === id)?.content ?? '';
      const { added, removed } = lineDiff(c1, c2);
      delta = {
        kind: 'modified',
        added,
        removed,
        addedCount: added.length,
        removedCount: removed.length,
      };
    }
    return { id, changed: true, delta };
  });
  return { sections };
}
