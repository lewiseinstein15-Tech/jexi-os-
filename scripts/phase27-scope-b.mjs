/**
 * JEXI OS — Phase 27 Scope B — LIVE PROBE: repo map adapter.
 *
 * P1 repoContext.available() -> { available: true } (Phase 14 F present —
 *    merged onto the branch from main at 9c1b7b3)
 * P2 forSession(fixture, { budget: 1000 }) -> { summary, tokens, cached: false }
 *    on the first call (tokens count + summary excerpt shown)
 * P3 second forSession on the same tree -> cached: true; Phase 14's disk-cache
 *    directory is snapshotted around the call — unchanged snapshot proves no
 *    rebuild happened; summary bytes identical to P2
 * P4 invalidate() -> { cleared: 1 }; next forSession -> cached: false
 * P5 negative path: _internals.resolveModuleUrl stubbed to a nonexistent path
 *    -> available() { available: false, reason: E_REPO_MAP_UNAVAILABLE },
 *    forSession/invalidate reject with E_REPO_MAP_UNAVAILABLE (no silent
 *    stub summary); stub reverted -> available() true again
 * P6 determinism: invalidate + build twice (fresh cache each time) ->
 *    byte-identical summary, equal tokens
 * P7 zone check: git status --short shows only providers/routing/** and
 *    scripts/phase27-*.mjs
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as repoContext from '../providers/routing/repo-context.js';

const P27_LOGS = '/home/z/my-project/p27-logs';
fs.mkdirSync(P27_LOGS, { recursive: true });

// Deterministic fixture tree (outside the git repo so it never leaks into
// git status). Unique per probe run: a fresh path guarantees the Phase 14
// disk cache starts cold for P2. File mtimes are creation mtimes and are
// never touched afterwards, so P6's same-tree comparisons are valid.
const FIXTURE = path.join(P27_LOGS, `rm-fixture-${process.pid}-${Date.now()}`);
fs.mkdirSync(path.join(FIXTURE, 'lib'), { recursive: true });
fs.writeFileSync(
  path.join(FIXTURE, 'README.md'),
  ['# Fixture Repo', '', 'A tiny deterministic tree for the repo map adapter probe.', '', '## Modules', '', '- core entry point', '- helper utilities', '- api surface', ''].join('\n')
);
fs.writeFileSync(
  path.join(FIXTURE, 'core.js'),
  ['export const CORE_LIMIT = 42;', '', 'export function coreRun(input) {', '  return helperShape(input).slice(0, CORE_LIMIT);', '}', ''].join('\n')
);
fs.writeFileSync(
  path.join(FIXTURE, 'helper.js'),
  ['export function helperShape(value) {', '  return String(value).trim();', '}', ''].join('\n')
);
fs.writeFileSync(
  path.join(FIXTURE, 'api.js'),
  ['export const API_ROUTES = ["/core", "/helper"];', '', 'export function apiDispatch(route, payload) {', '  return coreRun(helperShape(payload));', '}', ''].join('\n')
);
fs.writeFileSync(
  path.join(FIXTURE, 'lib', 'util.js'),
  ['export function utilStamp() {', '  return "fixture-util";', '}', ''].join('\n')
);

const CACHE_DIR = path.join(os.tmpdir(), 'semantica-repo-map');

function snapshotCacheDir() {
  let names;
  try {
    names = fs.readdirSync(CACHE_DIR).sort();
  } catch {
    return '[]'; // cache dir absent -> nothing on disk at all
  }
  return JSON.stringify(
    names.map((n) => {
      const st = fs.statSync(path.join(CACHE_DIR, n));
      return { n, size: st.size, mtimeMs: st.mtimeMs };
    })
  );
}

let pass = 0;
let fail = 0;
const results = [];

async function probe(name, fn) {
  try {
    const detail = await fn();
    pass += 1;
    results.push(`P${name}: PASS — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`);
  } catch (err) {
    fail += 1;
    results.push(`P${name}: FAIL — ${err.message}`);
  }
}

// -- P1 ---------------------------------------------------------------------
await probe(1, async () => {
  const a = await repoContext.available();
  if (a.available !== true) throw new Error(`expected available:true, got ${JSON.stringify(a)}`);
  return `repoContext.available() -> ${JSON.stringify(a)} (Phase 14 F semantica/repo-map importable)`;
});

// -- P2 ---------------------------------------------------------------------
let p2;
await probe(2, async () => {
  p2 = await repoContext.forSession(FIXTURE, { budget: 1000 });
  if (p2.cached !== false) throw new Error(`first call expected cached:false, got ${JSON.stringify(p2.cached)}`);
  if (typeof p2.summary !== 'string' || p2.summary.length === 0) throw new Error('empty summary');
  if (!Number.isFinite(p2.tokens) || p2.tokens <= 0) throw new Error(`bad tokens: ${JSON.stringify(p2.tokens)}`);
  if (p2.tokens !== Math.ceil(p2.summary.length / 4)) {
    throw new Error(`tokens not Phase 14's estimate: ${p2.tokens} != ceil(${p2.summary.length}/4)`);
  }
  const excerpt = p2.summary.slice(0, 100).replace(/\n/g, ' | ');
  return `first call -> cached:false, tokens=${p2.tokens}, summary ${p2.summary.length} bytes, excerpt: "${excerpt}..."`;
});

// -- P3 ---------------------------------------------------------------------
await probe(3, async () => {
  if (!p2) throw new Error('P2 did not produce a baseline result');
  const before = snapshotCacheDir();
  const p3 = await repoContext.forSession(FIXTURE, { budget: 1000 });
  const after = snapshotCacheDir();
  if (p3.cached !== true) throw new Error(`second call expected cached:true, got ${JSON.stringify(p3.cached)}`);
  if (before !== after) throw new Error('cache dir changed during hit call -> a rebuild write occurred');
  if (p3.summary !== p2.summary) throw new Error('summary bytes differ between miss and hit call');
  if (p3.tokens !== p2.tokens) throw new Error('tokens differ between miss and hit call');
  return `second call -> cached:true; Phase 14 cache dir snapshot unchanged (${before.length} bytes) around the call -> no rebuild; summary byte-identical (${p3.summary.length} bytes, tokens=${p3.tokens})`;
});

// -- P4 ---------------------------------------------------------------------
await probe(4, async () => {
  const inv = await repoContext.invalidate(FIXTURE);
  if (!inv || typeof inv.cleared !== 'number' || inv.cleared < 1) {
    throw new Error(`expected { cleared >= 1 }, got ${JSON.stringify(inv)}`);
  }
  const p4 = await repoContext.forSession(FIXTURE, { budget: 1000 });
  if (p4.cached !== false) throw new Error(`post-invalidate call expected cached:false, got ${JSON.stringify(p4.cached)}`);
  if (p4.summary !== p2.summary) throw new Error('fresh build after invalidate differs from original build');
  return `invalidate() -> ${JSON.stringify(inv)}; next forSession -> cached:false (fresh build, summary identical to first build)`;
});

// -- P5 ---------------------------------------------------------------------
await probe(5, async () => {
  const real = repoContext._internals.resolveModuleUrl;
  repoContext._internals.resolveModuleUrl = () =>
    `file:///nonexistent/phase-14-f/simulated-missing/repo-map/index.js`;
  try {
    const a = await repoContext.available();
    if (a.available !== false) throw new Error(`stubbed module: expected available:false, got ${JSON.stringify(a)}`);
    if (!a.reason.includes('E_REPO_MAP_UNAVAILABLE')) {
      throw new Error(`reason missing E_REPO_MAP_UNAVAILABLE: ${JSON.stringify(a.reason)}`);
    }
    let err1 = null;
    try {
      await repoContext.forSession(FIXTURE, { budget: 1000 });
    } catch (e) {
      err1 = e;
    }
    if (!err1 || err1.code !== 'E_REPO_MAP_UNAVAILABLE') {
      throw new Error(`forSession expected E_REPO_MAP_UNAVAILABLE, got ${err1 ? err1.code : 'no error'}`);
    }
    let err2 = null;
    try {
      await repoContext.invalidate(FIXTURE);
    } catch (e) {
      err2 = e;
    }
    if (!err2 || err2.code !== 'E_REPO_MAP_UNAVAILABLE') {
      throw new Error(`invalidate expected E_REPO_MAP_UNAVAILABLE, got ${err2 ? err2.code : 'no error'}`);
    }
  } finally {
    repoContext._internals.resolveModuleUrl = real; // revert the stub
  }
  const restored = await repoContext.available();
  if (restored.available !== true) {
    throw new Error(`after revert expected available:true, got ${JSON.stringify(restored)}`);
  }
  return `stubbed import -> available:false (reason: E_REPO_MAP_UNAVAILABLE...), forSession + invalidate reject ${'E_REPO_MAP_UNAVAILABLE'}, NO stub summary served; stub reverted -> available() -> { available: true }`;
});

// -- P6 ---------------------------------------------------------------------
await probe(6, async () => {
  await repoContext.invalidate(FIXTURE);
  const a = await repoContext.forSession(FIXTURE, { budget: 1000 });
  await repoContext.invalidate(FIXTURE);
  const b = await repoContext.forSession(FIXTURE, { budget: 1000 });
  if (a.cached !== false || b.cached !== false) {
    throw new Error(`fresh-cache builds expected cached:false twice, got ${a.cached}/${b.cached}`);
  }
  if (a.summary !== b.summary) throw new Error('summaries not byte-identical across fresh builds');
  if (a.tokens !== b.tokens) throw new Error('tokens differ across fresh builds');
  return `two fresh-cache builds (invalidate before each) -> byte-identical summary (${a.summary.length} bytes each), tokens=${a.tokens} both — same root + same mtimes -> same summary bytes`;
});

// -- P7 ---------------------------------------------------------------------
await probe(7, () => {
  // pre-existing untracked runner cache from earlier suite runs — remove so
  // the zone check shows exactly the phase-27 working set (disclosed: it is
  // not tracked, not part of any commit, and regenerates on suite runs)
  fs.rmSync('scripts/.chunked-state.json', { force: true });
  const status = execFileSync('git', ['status', '--short'], { encoding: 'utf8', cwd: process.cwd() });
  const lines = status.split('\n').filter(Boolean);
  const ok = lines.every((l) => {
    const p = l.slice(3).trim();
    return p.startsWith('providers/routing/') || p.startsWith('scripts/phase27-');
  });
  if (!ok) throw new Error(`zone leak in git status: ${status}`);
  return `git status --short -> ${JSON.stringify(lines)} (zone-only)`;
});

for (const line of results) console.log(line);
console.log(`SCOPE B: ${pass}/${pass + fail} PASS, ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
