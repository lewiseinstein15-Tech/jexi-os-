#!/usr/bin/env node
/**
 * JEXI OS — Phase 7(B) hook — pre-commit-quality (PreToolUse, BLOCKING).
 *
 * Fires when a `git commit` is about to run. Lints the staged .js files:
 *   1. `node --check` syntax pass on every staged .js file.
 *   2. ESLint (repo config: server/eslint.config.js) on staged .js files
 *      inside server/ — error-level rules block, warnings do not.
 * Any error → exit 2 → the kernel blocks the commit with the lint output.
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

const raw = await new Promise((resolve) => {
  let buf = '';
  process.stdin.on('data', (c) => { buf += c; });
  process.stdin.on('end', () => resolve(buf));
});

let ctx = {};
try { ctx = JSON.parse(raw || '{}'); } catch { /* empty context */ }
const cmd = String(ctx?.args?.command ?? '');

const GIT_COMMIT = /\bgit\b[^|;]*\bcommit\b/;
if (!GIT_COMMIT.test(cmd)) {
  console.log('[pre-commit-quality] not a commit — nothing to lint.');
  process.exit(0);
}

const toplevel = (spawnSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).stdout || '').trim();
if (!toplevel) {
  console.log('[pre-commit-quality] not inside a git repo — fail-open.');
  process.exit(0);
}

const staged = (spawnSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACMR'],
  { encoding: 'utf8', cwd: toplevel }).stdout || '').split('\n').map((s) => s.trim()).filter(Boolean);
const jsFiles = staged.filter((f) => f.endsWith('.js'));

if (!jsFiles.length) {
  console.log('[pre-commit-quality] no staged .js files — pass.');
  process.exit(0);
}

const problems = [];

// 1. Syntax pass (node --check) — respects package.json "type": "module".
for (const f of jsFiles) {
  const abs = path.join(toplevel, f);
  if (!existsSync(abs)) continue; // deleted/renamed in this commit
  const c = spawnSync(process.execPath, ['--check', abs], { encoding: 'utf8' });
  if (c.status !== 0) {
    const first = String(c.stderr || '').trim().split('\n').filter(Boolean).pop() || 'syntax error';
    problems.push(`${f}: syntax error — ${first}`);
  }
}

// 2. ESLint pass on staged files under server/ (repo lint scope).
const serverDir = path.join(toplevel, 'server');
const eslintBin = path.join(serverDir, 'node_modules', '.bin', 'eslint');
if (existsSync(eslintBin)) {
  const relToServer = jsFiles
    .map((f) => path.relative(serverDir, path.join(toplevel, f)))
    .filter((f) => !f.startsWith('..'));
  if (relToServer.length) {
    const e = spawnSync(eslintBin, ['--no-color', '--no-warn-ignored', ...relToServer],
      { encoding: 'utf8', cwd: serverDir, timeout: 25000 });
    if (e.status === 1) {
      // eslint exit 1 = rule violations at error level → block.
      const lines = String(e.stdout || '').split('\n').filter((l) => /error/.test(l)).slice(0, 20);
      for (const l of lines) problems.push(`eslint: ${l.trim()}`);
      if (!lines.length) problems.push('eslint reported errors (no detail parsed)');
    } else if (e.status === 0) {
      // clean
    } else {
      // eslint exit 2 / timeout = tooling failure → fail-open (warn, never block).
      console.log(`[pre-commit-quality] eslint infra failure (status ${e.status}) — fail-open.`);
    }
  }
}

if (problems.length) {
  console.log(`[pre-commit-quality] BLOCKED — ${problems.length} lint problem(s) in staged files:`);
  for (const p of problems) console.log(`[pre-commit-quality]   ${p}`);
  process.exit(2); // nonzero + exitBehavior:block → kernel blocks the commit
}

console.log(`[pre-commit-quality] ${jsFiles.length} staged .js file(s) clean — pass.`);
process.exit(0);
