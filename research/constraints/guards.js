// research/constraints/guards.js
// Runtime enforcement. Every research-agent write goes through guardEdit —
// there is no path to disk that bypasses it (guardedWriteFile below is the
// only writer the loop should use).
//
//   guardEdit(filePath, ctx) -> { allowed: boolean, reason?: string }
//
// Order of evaluation:
//   0. outside the repository root          -> BLOCKED (fail closed)
//   1. READ_ONLY hit (explicit or default)  -> BLOCKED
//   2. not in the mutable set               -> BLOCKED (fail closed: new files)
//   3. otherwise                            -> ALLOWED
//
// Path discipline: policy patterns are repo-relative, so ABSOLUTE paths inside
// the repo are relativized before matching. This closes the bypass where
// `/abs/research/fixtures/toy-target/train.js` would miss the READ_ONLY list
// while an `extraMutable: ['**/*']` grant matched it.
import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { READ_ONLY, globMatch } from './read-only.js';
import { isMutablePath } from './mutable.js';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// Repo-relative for absolute paths inside the repo; null for anything outside.
function toRepoRelative(p) {
  let s = String(p);
  if (s.startsWith('file://')) {
    try {
      s = fileURLToPath(s);
    } catch {
      return null;
    }
  }
  const isAbs = s.startsWith('/') || /^[A-Za-z]:[\\/]/.test(s);
  if (!isAbs) return s.replace(/\\/g, '/').replace(/^\.\//, '');
  const norm = s.replace(/\\/g, '/');
  const rootNorm = REPO_ROOT.replace(/\\/g, '/');
  if (norm === rootNorm) return '';
  if (norm.startsWith(rootNorm + '/')) return norm.slice(rootNorm.length + 1);
  return null; // outside the repository root — fail closed
}

// CONTRACT
//   guardEdit(filePath, ctx) -> { allowed: boolean, reason?: string }
// ctx: { operation?: 'edit'|'create'|'delete', extraMutable?: string[] }
export function guardEdit(filePath, ctx = {}) {
  const op = ctx.operation ?? 'edit';
  const norm = toRepoRelative(filePath);
  if (norm === null) {
    return {
      allowed: false,
      reason: `outside-repo-root: ${filePath} resolves outside the repository; the research agent cannot touch it (${op})`,
    };
  }
  if (globMatch(READ_ONLY, norm)) {
    return {
      allowed: false,
      reason: `read-only: ${norm} is protected from the research agent (${op})`,
    };
  }
  if (!isMutablePath(norm, { extra: ctx.extraMutable ?? [] })) {
    return {
      allowed: false,
      reason: `outside-mutable-set: ${norm} is not in the agent's editable set; new files fail closed (${op})`,
    };
  }
  return { allowed: true, reason: `mutable: ${norm} is in the agent's editable set (${op})` };
}

// The only writer the research agent gets. Throws before touching disk on any
// disallowed path — a blocked attempt leaves the target byte-identical.
export async function guardedWriteFile(filePath, data, ctx = {}) {
  const verdict = guardEdit(filePath, { operation: 'edit', ...ctx });
  if (!verdict.allowed) {
    const err = new Error(`BLOCKED: ${verdict.reason}`);
    err.code = 'EDIT_BLOCKED';
    err.verdict = verdict;
    throw err;
  }
  await writeFile(filePath, data, 'utf8');
  return verdict;
}

export function assertEditAllowed(filePath, ctx = {}) {
  const verdict = guardEdit(filePath, ctx);
  if (!verdict.allowed) {
    const err = new Error(`BLOCKED: ${verdict.reason}`);
    err.code = 'EDIT_BLOCKED';
    err.verdict = verdict;
    throw err;
  }
  return verdict;
}
