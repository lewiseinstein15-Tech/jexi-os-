/**
 * JEXI OS — Phase 15 Scope A — code graph (Graphify pattern).
 *
 * Walks a repo read-only via the Phase 14 repo-map scanner, parses
 * relative import/require specifiers, and emits file nodes +
 * `imports` edges. Deterministic: scan order is sorted and edge
 * triples are de-duplicated in scan order.
 */
import fs from 'node:fs';
import path from 'node:path';
import { scan } from '../../semantica/repo-map/rank.js';

const SPEC_RE = /(?:from\s+['"]|import\s+['"]|require\(\s*['"])(\.[^'"]+)['"]/g;

export function codeGraph(root) {
  const files = scan(root);
  const known = new Set(files.map((f) => f.path));
  const nodes = files.map((f) => ({ id: f.path, kind: 'file', size: f.size }));
  const edges = [];
  const seen = new Set();
  for (const f of files) {
    let text = '';
    try { text = fs.readFileSync(path.join(root, f.path), 'utf8'); } catch { continue; }
    let m = null;
    while ((m = SPEC_RE.exec(text)) !== null) {
      const resolved = path.normalize(path.join(path.dirname(f.path), m[1])).split(path.sep).join('/');
      if (!known.has(resolved) || resolved === f.path) continue;
      const key = f.path + '\u0000' + resolved;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ from: f.path, to: resolved, kind: 'imports' });
    }
  }
  return { nodes, edges };
}
