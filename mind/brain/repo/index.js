/**
 * JEXI OS — Phase 28 Scope A — brain repo: public surface.
 *
 *   import { createRepo } from '../brain/repo/index.js';
 *   const repo = createRepo('/path/to/brain-root');
 *   repo.create(kind, slug, { title, compiledTruth, tags, now }) -> page
 *   repo.read(kind, slug) -> page
 *   repo.append(kind, slug, { entry, when }) -> page
 *   repo.compile(kind, slug) -> { compiledTruth, timeline }
 *   repo.list({ kind? }) -> pages[]
 *   repo.sync(repoPath?) -> { added, modified, removed }
 *
 * sync(): the DB/index is rebuildable FROM the repo — sync walks the tree and
 * diffs it against a manifest (.brain/manifest.json: path -> content sha256),
 * returning the delta { added, modified, removed } and rewriting the manifest.
 * Deterministic: sorted paths, stable JSON, no clocks (uses file content only).
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { SemanticaError } from '../../semantica/_internal.js';
import { KIND_DIRS, kindDir } from './layout.js';
import { createPage, readPage, appendToPage, updatePage, listPages } from './page.js';
import { compilePage } from './compiled-truth.js';

const MANIFEST_REL = '.brain/manifest.json';

function sha256(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }

function walkPages(root) {
  const files = [];
  for (const kind of Object.keys(KIND_DIRS)) {
    const dir = path.join(root, KIND_DIRS[kind]);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.md')).sort()) {
      files.push(`${KIND_DIRS[kind]}/${f}`);
    }
  }
  return files.sort();
}

export function createRepo(root) {
  if (typeof root !== 'string' || root.trim() === '') {
    throw new SemanticaError('E_INVALID_ARGUMENT', `brain root must be a non-empty string, got ${JSON.stringify(root)}`);
  }
  fs.mkdirSync(root, { recursive: true });

  return {
    root,
    create: (kind, slug, props) => createPage(root, kind, slug, props),
    read: (kind, slug) => readPage(root, kind, slug),
    append: (kind, slug, props) => appendToPage(root, kind, slug, props),
    update: (kind, slug, props) => updatePage(root, kind, slug, props),
    compile: (kind, slug) => compilePage(readPage(root, kind, slug)),
    list: (opts) => listPages(root, opts),
    /** Diff the on-disk repo against the manifest; returns the delta. */
    sync: (repoPath = root) => {
      const manifestFile = path.join(repoPath, MANIFEST_REL);
      let before = {};
      if (fs.existsSync(manifestFile)) {
        before = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
      }
      const after = {};
      const added = []; const modified = []; const removed = [];
      for (const rel of walkPages(repoPath)) {
        const hash = sha256(fs.readFileSync(path.join(repoPath, rel)));
        after[rel] = hash;
        if (!(rel in before)) added.push(rel);
        else if (before[rel] !== hash) modified.push(rel);
      }
      for (const rel of Object.keys(before).sort()) {
        if (!(rel in after)) removed.push(rel);
      }
      fs.mkdirSync(path.dirname(manifestFile), { recursive: true });
      fs.writeFileSync(manifestFile, JSON.stringify(after, Object.keys(after).sort(), 2) + '\n');
      return { added, modified, removed };
    },
  };
}

export { kindDir, KIND_DIRS };
export { serialize, parse, makePage } from './schema.js';
export { appendEntry, sortTimeline } from './timeline.js';
export { compilePage } from './compiled-truth.js';
