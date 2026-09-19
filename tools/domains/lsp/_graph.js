// Phase 11 Scope B — shared context for the 15 CBM tools.
// Lazy store opener + repo-root resolution + source-file walker reused by
// search-code and check-index-coverage.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openGraphStore } from '../../../capability/code/graph/store.js';
import { isIndexableSource } from '../../../capability/code/graph/pipeline/tree-sitter.js';

const REPO_ROOT = path.resolve(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..'));

export class ToolInputError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

export function repoRoot(override) {
  const root = override ? path.resolve(String(override)) : REPO_ROOT;
  if (!fs.existsSync(root)) throw new ToolInputError('ROOT_NOT_FOUND', `root does not exist: ${root}`);
  const st = fs.statSync(root);
  if (!st.isDirectory()) throw new ToolInputError('ROOT_NOT_DIRECTORY', `root is not a directory: ${root}`);
  return root;
}

let _store = null;
/** Open (once) the Scope A graph store against this repo's db dir. */
export async function getStore() {
  if (!_store) {
    _store = await openGraphStore(path.join(REPO_ROOT, 'capability/code/graph/db'), { project: 'jexi-os' });
  }
  return _store;
}

/** Close the cached store (probe teardown). */
export async function closeStore() {
  if (_store) {
    _store.close();
    _store = null;
  }
}

const SKIP_DIRS = new Set([
  '.git', 'node_modules', 'dist', 'build', 'out', '.venv', 'coverage',
  '__pycache__', '.next', '.cache', 'target', '.turbo', '.pytest_cache',
]);
const SKIP_EXT = /\.(ya?ml|json|md|txt|html|css|wasm|lock|png|jpg|svg)$/i;
const MAX_FILE_BYTES = 512 * 1024;

/** All indexable source files under root (same rules as the indexer). */
export function walkSourceFiles(root) {
  const out = [];
  const walk = (abs, rel) => {
    let entries;
    try {
      entries = fs.readdirSync(abs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      const r = rel ? `${rel}/${ent.name}` : ent.name;
      if (ent.isSymbolicLink()) continue;
      if (ent.isDirectory()) {
        if (SKIP_DIRS.has(ent.name) || ent.name.startsWith('.')) continue;
        walk(path.join(abs, ent.name), r);
      } else if (ent.isFile() && isIndexableSource(r) && !SKIP_EXT.test(r)) {
        out.push(r);
      }
    }
  };
  walk(root, '');
  return out;
}

export function readSource(root, rel) {
  const abs = path.join(root, rel);
  try {
    const st = fs.statSync(abs);
    if (!st.isFile() || st.size > MAX_FILE_BYTES) return null;
    return fs.readFileSync(abs, 'utf8');
  } catch {
    return null;
  }
}

/** Truncate helper for tool outputs (probes + token efficiency). */
export function clip(value, max = 400) {
  const s = typeof value === 'string' ? value : JSON.stringify(value);
  return s.length <= max ? s : `${s.slice(0, max)}…(+${s.length - max} chars)`;
}
