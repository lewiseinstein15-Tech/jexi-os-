/**
 * JEXI OS — Phase 14 Scope F — file ranking for the repo map.
 *
 *   scan(root) -> [{ path, mtime, size }]
 *   rank(root) -> ranked entries, highest score first
 *
 * score = 3*centrality + 1*refs + 2*recency
 *   centrality = number of DISTINCT other files whose content names
 *                this file's stem (its basename without extension)
 *   refs       = total occurrences of the stem in other files
 *   recency    = (mtime - min) / (max - min) in [0, 1]
 * Ties break by path ascending, so ranking is deterministic for the
 * same tree + same mtimes. node_modules / .git / hidden dirs are
 * never scanned.
 */
import fs from 'node:fs';
import path from 'node:path';

const SKIP_DIRS = new Set(['node_modules', '.git']);

export function scan(root) {
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      if (entry.name.startsWith('.') && entry.isDirectory()) continue;
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        walk(path.join(dir, entry.name));
      } else if (entry.isFile()) {
        const abs = path.join(dir, entry.name);
        const st = fs.statSync(abs);
        out.push({ path: path.relative(root, abs).split(path.sep).join('/'), mtime: Math.floor(st.mtimeMs), size: st.size });
      }
    }
  };
  walk(root);
  return out.sort((a, b) => (a.path < b.path ? -1 : 1));
}

const stemOf = (rel) => {
  const base = rel.split('/').pop();
  const i = base.lastIndexOf('.');
  return (i > 0 ? base.slice(0, i) : base).toLowerCase();
};

export function rank(root) {
  const entries = scan(root);
  const contents = new Map();
  for (const e of entries) {
    try { contents.set(e.path, fs.readFileSync(path.join(root, e.path), 'utf8')); }
    catch { contents.set(e.path, ''); }
  }
  const minT = Math.min(...entries.map((e) => e.mtime));
  const maxT = Math.max(...entries.map((e) => e.mtime));
  const span = maxT - minT || 1;
  const ranked = entries.map((e) => {
    const stem = stemOf(e.path);
    let refs = 0;
    let centrality = 0;
    for (const [other, text] of contents) {
      if (other === e.path || stem.length < 3) continue;
      const hits = text.split(stem).length - 1;
      if (hits > 0) { centrality += 1; refs += hits; }
    }
    const recency = (e.mtime - minT) / span;
    const score = 3 * centrality + refs + 2 * recency;
    return { ...e, centrality, refs, recency, score };
  });
  return ranked.sort((a, b) => (b.score !== a.score ? b.score - a.score : (a.path < b.path ? -1 : 1)));
}
