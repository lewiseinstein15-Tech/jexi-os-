/**
 * JEXI OS — benchmarks/swebench-pro/patch.js
 *
 * patchFromEdits({ edits, before, after }) -> unifiedDiff (string)
 *
 * Converts JEXI edit-tool output into a REAL unified diff. Byte-format
 * follows GNU `diff -u`:
 *   - 3 context lines, ' ' / '-' / '+' prefixes
 *   - GNU hunk headers: counts omitted when == 1, 0-count ranges keep
 *     ",0" and use the line BEFORE the gap as start (0 allowed)
 *   - "\ No newline at end of file" markers
 *   - file headers `--- a/<path>` / `+++ b/<path>` (git-style labels;
 *     `/dev/null` for adds/deletes)
 * WITHOUT wall-clock timestamps: plain `diff -u` embeds mtimes in the
 * headers, which would break determinism. Byte-equality is proven
 * against `diff -u --label=a/<path> --label=b/<path>` (see probe P2);
 * the probe also shows that the ONLY delta vs plain `diff -u` is the
 * timestamp suffix.
 *
 * Edits drive path selection and ordering; byte content comes from the
 * before/after snapshots (the agent runtime's source of truth):
 *   edits:  [{ path, find?, replace? | content? }]   (intent record)
 *   before: [{ path, content }]  (pre-edit snapshot)
 *   after:  [{ path, content }]  (post-edit snapshot)
 *
 * Deterministic: pure functions, no I/O, no clock, no randomness.
 */

const CONTEXT = 3;
/** LCS DP cell cap for the (prefix/suffix-trimmed) middle region. */
const MAX_DP_CELLS = 16 * 1024 * 1024;

function malformed(reason) {
  const err = new Error(`E_MALFORMED_PATCH — ${reason}`);
  err.code = 'E_MALFORMED_PATCH';
  err.reason = reason;
  return err;
}

function invalidEdits(reason) {
  const err = new Error(`E_INVALID_EDITS — ${reason}`);
  err.code = 'E_INVALID_EDITS';
  err.reason = reason;
  return err;
}

function splitLines(text) {
  if (text === '') return { lines: [], endsWithNewline: true };
  const parts = String(text).split('\n');
  const endsWithNewline = parts[parts.length - 1] === '';
  if (endsWithNewline) parts.pop();
  return { lines: parts, endsWithNewline };
}

/** Minimal line edit script. Returns ops in document order:
 *  {t:'=', an, bn} | {t:'-', an} | {t:'+', bn} with ORIGINAL indices.
 *  Common prefix/suffix is trimmed first (stable anchors), the middle
 *  goes through an LCS DP (ties: prefer match, then deletion). */
function diffOps(aLines, bLines) {
  // prefix
  let pre = 0;
  while (pre < aLines.length && pre < bLines.length && aLines[pre] === bLines[pre]) pre++;
  // suffix
  let suf = 0;
  while (
    suf < aLines.length - pre &&
    suf < bLines.length - pre &&
    aLines[aLines.length - 1 - suf] === bLines[bLines.length - 1 - suf]
  ) suf++;

  const ops = [];
  for (let i = 0; i < pre; i++) ops.push({ t: '=', an: i, bn: i });

  const n = aLines.length - pre - suf;
  const m = bLines.length - pre - suf;
  if (n === 0 && m === 0) {
    // fully covered by prefix/suffix (or both empty)
  } else if (n === 0) {
    for (let j = 0; j < m; j++) ops.push({ t: '+', bn: pre + j });
  } else if (m === 0) {
    for (let i = 0; i < n; i++) ops.push({ t: '-', an: pre + i });
  } else {
    if ((n + 1) * (m + 1) > MAX_DP_CELLS) {
      throw malformed(
        `middle region ${n}x${m} exceeds the build-scope diff emitter cap (${MAX_DP_CELLS} cells); ` +
        'large-horizon patches are exercised through the real harness in scope 17'
      );
    }
    // lcs[i][j] = LCS length of A[i..n) vs B[j..m)
    const W = m + 1;
    const lcs = new Uint32Array((n + 1) * W);
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        lcs[i * W + j] =
          aLines[pre + i] === bLines[pre + j]
            ? lcs[(i + 1) * W + (j + 1)] + 1
            : Math.max(lcs[(i + 1) * W + j], lcs[i * W + (j + 1)]);
      }
    }
    let i = 0, j = 0;
    while (i < n && j < m) {
      if (aLines[pre + i] === bLines[pre + j]) {
        ops.push({ t: '=', an: pre + i, bn: pre + j });
        i++; j++;
      } else if (lcs[(i + 1) * W + j] >= lcs[i * W + (j + 1)]) {
        ops.push({ t: '-', an: pre + i });
        i++;
      } else {
        ops.push({ t: '+', bn: pre + j });
        j++;
      }
    }
    while (i < n) { ops.push({ t: '-', an: pre + i }); i++; }
    while (j < m) { ops.push({ t: '+', bn: pre + j }); j++; }
  }

  for (let s = 0; s < suf; s++) {
    ops.push({ t: '=', an: aLines.length - suf + s, bn: bLines.length - suf + s });
  }
  return ops;
}

/** Group changed ops into hunks (GNU rule: changes merge into one hunk
 *  when the unchanged run between them is <= 2*context lines). */
function buildHunks(ops, aLines, bLines, aEndsNl, bEndsNl) {
  const changed = [];
  ops.forEach((o, idx) => { if (o.t !== '=') changed.push(idx); });
  if (!changed.length) return [];

  const groups = [];
  let gStart = changed[0], gEnd = changed[0];
  for (const ci of changed.slice(1)) {
    let eqBetween = 0;
    for (let i = gEnd + 1; i < ci; i++) if (ops[i].t === '=') eqBetween++;
    if (eqBetween <= 2 * CONTEXT) gEnd = ci;
    else { groups.push([gStart, gEnd]); gStart = ci; gEnd = ci; }
  }
  groups.push([gStart, gEnd]);

  return groups.map(([from, to]) => {
    // expand with up to CONTEXT equal ops on each side
    let lo = from;
    let taken = 0;
    while (lo > 0 && taken < CONTEXT && ops[lo - 1].t === '=') { lo--; taken++; }
    let hi = to;
    taken = 0;
    while (hi < ops.length - 1 && taken < CONTEXT && ops[hi + 1].t === '=') { hi++; taken++; }

    const slice = ops.slice(lo, hi + 1);
    let oldCount = 0, newCount = 0;
    for (const o of slice) {
      if (o.t !== '+') oldCount++;
      if (o.t !== '-') newCount++;
    }
    const firstOld = slice.find((o) => o.t !== '+');
    const firstNew = slice.find((o) => o.t !== '-');
    const lastOldBefore = (() => {
      for (let i = lo - 1; i >= 0; i--) if (ops[i].t !== '+') return ops[i];
      return null;
    })();
    const lastNewBefore = (() => {
      for (let i = lo - 1; i >= 0; i--) if (ops[i].t !== '-') return ops[i];
      return null;
    })();

    const oldStart = oldCount > 0 ? firstOld.an + 1 : (lastOldBefore ? lastOldBefore.an + 1 : 0);
    const newStart = newCount > 0 ? firstNew.bn + 1 : (lastNewBefore ? lastNewBefore.bn + 1 : 0);

    const body = [];
    for (const o of slice) {
      if (o.t === '=') {
        body.push({ marker: ' ', content: aLines[o.an] });
        const aLast = o.an === aLines.length - 1 && !aEndsNl;
        const bLast = o.bn === bLines.length - 1 && !bEndsNl;
        if (aLast || bLast) body.push({ marker: '\\', content: 'No newline at end of file' });
      } else if (o.t === '-') {
        body.push({ marker: '-', content: aLines[o.an] });
        if (o.an === aLines.length - 1 && !aEndsNl) body.push({ marker: '\\', content: 'No newline at end of file' });
      } else {
        body.push({ marker: '+', content: bLines[o.bn] });
        if (o.bn === bLines.length - 1 && !bEndsNl) body.push({ marker: '\\', content: 'No newline at end of file' });
      }
    }
    return { oldStart, oldCount, newStart, newCount, body };
  });
}

function hunkHeader(h) {
  const oc = h.oldCount === 1 ? '' : `,${h.oldCount}`;
  const nc = h.newCount === 1 ? '' : `,${h.newCount}`;
  return `@@ -${h.oldStart}${oc} +${h.newStart}${nc} @@`;
}

/** Unified diff for ONE file pair; '' when identical. */
export function fileDiff(oldText, newText, oldLabel, newLabel) {
  if (oldText === newText) return '';
  const a = splitLines(oldText);
  const b = splitLines(newText);
  const ops = diffOps(a.lines, b.lines);
  const hunks = buildHunks(ops, a.lines, b.lines, a.endsWithNewline, b.endsWithNewline);
  if (!hunks.length) return '';
  const out = [`--- ${oldLabel}`, `+++ ${newLabel}`];
  for (const h of hunks) {
    out.push(hunkHeader(h));
    for (const l of h.body) out.push(l.marker === '\\' ? `\\ ${l.content}` : `${l.marker}${l.content}`);
  }
  return out.join('\n') + '\n';
}

function snapshotMap(files, side) {
  const map = new Map();
  if (files === undefined || files === null) return map;
  if (!Array.isArray(files)) throw invalidEdits(`${side} snapshot must be an array of {path, content}`);
  for (const f of files) {
    if (!f || typeof f.path !== 'string' || f.path === '') throw invalidEdits(`${side} snapshot entry needs a non-empty string path`);
    if (typeof f.content !== 'string') throw invalidEdits(`${side} snapshot entry "${f.path}" needs string content`);
    map.set(f.path, f.content);
  }
  return map;
}

/** patchFromEdits({ edits, before, after }) -> unified diff string.
 *  Empty edits -> '' (no-op patch). Identical paths are skipped. */
export function patchFromEdits({ edits, before, after } = {}) {
  if (!Array.isArray(edits)) throw invalidEdits('edits must be an array');
  const beforeMap = snapshotMap(before, 'before');
  const afterMap = snapshotMap(after, 'after');

  const paths = [];
  const seen = new Set();
  for (const e of edits) {
    if (!e || typeof e.path !== 'string' || e.path === '') throw invalidEdits('every edit needs a non-empty string path');
    if (!seen.has(e.path)) { seen.add(e.path); paths.push(e.path); }
  }

  const sections = [];
  for (const p of paths) {
    const inB = beforeMap.has(p);
    const inA = afterMap.has(p);
    if (!inB && !inA) {
      throw invalidEdits(`edit path "${p}" not found in before/after snapshots`);
    }
    const oldText = inB ? beforeMap.get(p) : '';
    const newText = inA ? afterMap.get(p) : '';
    if (inB && inA && oldText === newText) continue; // no-op edit
    const oldLabel = inB ? `a/${p}` : '/dev/null';
    const newLabel = inA ? `b/${p}` : '/dev/null';
    const section = fileDiff(oldText, newText, oldLabel, newLabel);
    if (section) sections.push(section);
  }
  return sections.join('');
}
