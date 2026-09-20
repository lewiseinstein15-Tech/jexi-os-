// prompt/sections/08-instructions.js
//
// JEXI OS Phase 25 — Scope M: nested AGENTS.md instruction loading.
//
// Pattern: CLAUDE.md-style nested instruction discovery. Walk the directory
// tree rooted at `root`, collect every file named AGENTS.md, and return them
// VERBATIM (no transformation, no escaping, no dedup) in deterministic tree
// order: depth-first pre-order, siblings sorted lexicographically by name.
// Every descendant is returned after its ancestors — the root AGENTS.md is
// first, the most specific (deepest) file of any chain is last.
//
// Contract:
//   walk(root, opts?) -> entries
//
//     entries: [ { path, content }, ... ]
//       path    — relative to `root`, POSIX-style separators, tree order
//       content — exact file text (utf8), byte-faithful to the file on disk
//
//     The return value IS the entries array (Array.isArray === true), and it
//     carries the result metadata required by the { entries, dropped,
//     reason } shape:
//       entries.dropped -> [ { path, reason, chars? }, ... ]
//       entries.reason  -> 'E_SIZE_LIMIT' | 'E_LOOP' | null
//       entries.entries -> self-reference (non-enumerable), so both
//                          const list = walk(root)  and
//                          const { entries, dropped, reason } = walk(root)
//                          work as documented.
//
// Behaviour:
//   - Missing root AGENTS.md (or missing / non-directory root)
//       -> entries: [], dropped: [], reason: null. Not an error.
//       The root file anchors the instruction set; without it nothing loads.
//   - Unreadable AGENTS.md (EACCES, EISDIR-class, broken symlink, special
//     file)
//       -> skipped, recorded in dropped as { path, reason: 'E_UNREADABLE' };
//       the walk continues.
//   - Total chars > ceiling (default 50_000, configurable via
//     opts.maxTotalChars or env JEXI_INSTRUCTIONS_MAX_CHARS, read at call
//     time)
//       -> keep the first (root) and last (leaf) entries, drop the middle;
//       each drop recorded as { path, reason: 'E_SIZE_LIMIT', chars } and
//       the top-level reason becomes 'E_SIZE_LIMIT'. Deterministic: same
//       tree twice -> same dropped list. If root + leaf alone still exceed
//       the ceiling they are kept anyway (nothing droppable remains).
//   - Symlink loop (a directory whose realpath is already a walk ancestor)
//       -> the whole walk is refused: entries: [], dropped: [],
//       reason: 'E_LOOP'. No infinite walk.
//
// Logging: every drop writes ONE stderr line with path + reason only.
// File content is never logged.
//
// Real filesystem walk over real files: fs.readdirSync / statSync /
// realpathSync / readFileSync. Zero dependencies. No LLM, no disk state
// outside the walked tree.

import fs from 'node:fs';
import path from 'node:path';

export const AGENTS_FILE = 'AGENTS.md';
export const DEFAULT_MAX_TOTAL_CHARS = 50_000;

function positiveInt(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function effectiveMaxChars(explicit) {
  const direct =
    explicit === undefined || explicit === null ? null : positiveInt(explicit);
  if (direct !== null) return direct;
  const env = process.env.JEXI_INSTRUCTIONS_MAX_CHARS; // read at call time
  const fromEnv = env === undefined || env === '' ? null : positiveInt(env);
  return fromEnv !== null ? fromEnv : DEFAULT_MAX_TOTAL_CHARS;
}

function result(entries, dropped, reason) {
  const arr = entries.slice();
  arr.dropped = dropped;
  arr.reason = reason;
  // Non-enumerable self-reference: makes the { entries, dropped, reason }
  // object shape work (const { entries, dropped } = walk(root)) while the
  // value itself stays the plain entries array required by the contract.
  // Non-enumerable keeps JSON.stringify and structural comparisons clean.
  Object.defineProperty(arr, 'entries', { value: arr, enumerable: false });
  return arr;
}

function logDrop(entryPath, reason) {
  // Paths only — never log file content.
  process.stderr.write(
    `[jexi:instructions] drop path=${entryPath} reason=${reason}\n`
  );
}

export function walk(root, opts = {}) {
  const maxTotalChars = effectiveMaxChars(opts.maxTotalChars);
  const rootAbs = path.resolve(root);

  // Root anchor. Missing or non-directory root behaves exactly like a
  // missing root AGENTS.md: empty result, not an error.
  let rootStat = null;
  try {
    rootStat = fs.statSync(rootAbs);
  } catch {
    rootStat = null;
  }
  if (!rootStat || !rootStat.isDirectory()) return result([], [], null);

  try {
    fs.statSync(path.join(rootAbs, AGENTS_FILE));
  } catch (err) {
    if (err && err.code === 'ENOENT') return result([], [], null);
    // Exists but stat failed for another reason: fall through — the read
    // step below records it as E_UNREADABLE and the walk continues.
  }

  const ancestors = new Set([fs.realpathSync(rootAbs)]);
  const collected = []; // { path, content } in tree order
  const dropped = []; // { path, reason, chars? } in drop order
  let loop = false;

  const descend = (dirAbs, relDir, ancestorSet) => {
    if (loop) return;
    let real;
    try {
      real = fs.realpathSync(dirAbs);
    } catch {
      return;
    }
    if (ancestorSet.has(real)) {
      loop = true; // symlink loop: refuse the walk
      return;
    }
    const next = new Set(ancestorSet);
    next.add(real);
    visit(dirAbs, relDir, next);
  };

  const visit = (dirAbs, relDir, ancestorSet) => {
    if (loop) return;
    let dirents;
    try {
      dirents = fs.readdirSync(dirAbs, { withFileTypes: true });
    } catch {
      return; // unreadable directory: skip the subtree
    }
    // Deterministic tree order: siblings sorted lexicographically.
    dirents.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const dirent of dirents) {
      if (loop) return;
      const name = dirent.name;
      const full = path.join(dirAbs, name);
      const rel = relDir ? `${relDir}/${name}` : name;

      if (name === AGENTS_FILE) {
        let st = null;
        try {
          st = fs.statSync(full);
        } catch {
          st = null;
        }
        if (st && st.isFile()) {
          try {
            collected.push({
              path: rel,
              content: fs.readFileSync(full, 'utf8'),
            });
          } catch {
            dropped.push({ path: rel, reason: 'E_UNREADABLE' });
            logDrop(rel, 'E_UNREADABLE');
          }
        } else {
          // Directory named AGENTS.md, broken symlink or special file.
          dropped.push({ path: rel, reason: 'E_UNREADABLE' });
          logDrop(rel, 'E_UNREADABLE');
        }
        continue; // an entry named AGENTS.md is never descended into
      }

      if (dirent.isDirectory()) {
        descend(full, rel, ancestorSet);
        continue;
      }

      if (dirent.isSymbolicLink()) {
        let st = null;
        try {
          st = fs.statSync(full); // follow: symlinked dirs are walked
        } catch {
          continue; // broken symlink outside the AGENTS.md name: ignore
        }
        if (st.isDirectory()) descend(full, rel, ancestorSet);
        continue; // symlink to a file with a non-AGENTS name: nothing to load
      }
      // Everything else (regular files, fifos, sockets): not instructions.
    }
  };

  visit(rootAbs, '', ancestors);

  if (loop) return result([], [], 'E_LOOP');

  let entries = collected;
  let reason = null;
  const totalChars = entries.reduce((sum, e) => sum + e.content.length, 0);
  if (totalChars > maxTotalChars && entries.length > 0) {
    // Overflow: keep the first (root) and last (leaf) entries, drop the
    // middle. Deterministic by construction — the kept/dropped split is a
    // pure function of the tree-order entry list.
    reason = 'E_SIZE_LIMIT';
    const kept = [];
    for (let i = 0; i < entries.length; i++) {
      const isEdge = i === 0 || i === entries.length - 1;
      if (isEdge) {
        kept.push(entries[i]);
        continue;
      }
      dropped.push({
        path: entries[i].path,
        reason: 'E_SIZE_LIMIT',
        chars: entries[i].content.length,
      });
      logDrop(entries[i].path, 'E_SIZE_LIMIT');
    }
    entries = kept;
  }

  return result(entries, dropped, reason);
}

const instructions = {
  id: 'instructions',
  walk,
  DEFAULT_MAX_TOTAL_CHARS,
  AGENTS_FILE,
};
export default instructions;
