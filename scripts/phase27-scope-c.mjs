/**
 * JEXI OS — Phase 27 Scope C — LIVE PROBE: smart routing.
 *
 * P1 classify 3 simple + 3 complex prompts -> correct class each (score + signals shown)
 * P2 route simple -> cheap model, complex -> strong model (model + class + reason)
 * P3 per-agent override 'reviewer' wins over the map
 * P4 unknown model in map / in overrides -> E_UNKNOWN_MODEL (configure is atomic)
 * P5 determinism: same prompt + same config -> byte-identical classify + route
 *    output across two runs AND a fresh separate node process
 * P6 zone check: git status --short shows only providers/routing/** and scripts/phase27-*.mjs
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { classify, route, configure, DEFAULT_MAP } from '../integrations/providers/routing/index.js';

// consolidation cleanup: the determinism child-script imports the routing
// module via a REPO-ANCHORED file URL (was a hardcoded foreign worktree path)
// and its scratch file now lives under os.tmpdir().
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROUTING_ENTRY = pathToFileURL(path.join(REPO_ROOT, 'integrations/providers/routing/index.js')).href;
const DET_CHILD = path.join(os.tmpdir(), 'p27-logs', 'phase27-c-detchild.mjs');

const P_SIMPLE_1 = 'hi';
const P_SIMPLE_2 = 'what is 2 + 2?';
const P_SIMPLE_3 = 'summarize this file in one sentence';
const P_COMPLEX_1 = `Refactor the ingestion pipeline: migrate the batch loader to the new scheduler, instrument the benchmark, and add a rollback path. Build and test after each step, then audit the diff and lint the result before the deploy.

\`\`\`
const loader = require('./loader');
loader.batch(files, { concurrency: 4 }, (err, rows) => { if (err) throw err; store.append(rows); });
\`\`\`

Keep the daemon alive across reloads and snapshot the workflow state before teardown.`;
const P_COMPLEX_2 =
  'Orchestrate the migration ((({a:{b:{c:{d:1}}}}))): the pipeline must spawn workers, benchmark throughput, deploy the artifacts, and audit every stage. ' +
  'The scheduler and the daemon keep their state across reloads; lint the whole workflow and snapshot the indices so a rollback stays possible. ' +
  'Provision the teardown path, compile the report, and scan the audit trail before the next deploy window opens.';
const P_COMPLEX_3 =
  'Review this architecture: is the scheduler safe to run multi-tenant? does the daemon leak file descriptors under load? ' +
  'which pipeline stages still need benchmark coverage? Also audit the deploy path and lint the workflow config so the build stays reproducible.';

const COMPLEX = [P_COMPLEX_1, P_COMPLEX_2, P_COMPLEX_3];
const SIMPLE = [P_SIMPLE_1, P_SIMPLE_2, P_SIMPLE_3];

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

function expectRoutingError(fn, code, label) {
  try {
    fn();
  } catch (err) {
    if (err && err.code === code) return `${label} -> ${code}`;
    throw new Error(`${label}: expected ${code}, got ${err && err.code ? err.code : String(err)}`);
  }
  throw new Error(`${label}: expected ${code}, but no error was thrown`);
}

// -- P1 ---------------------------------------------------------------------
await probe(1, () => {
  const lines = [];
  for (const p of SIMPLE) {
    const r = classify(p);
    if (r.class !== 'simple') throw new Error(`simple prompt misclassified: ${JSON.stringify(r)}`);
    lines.push(`${JSON.stringify(p.slice(0, 36))} -> simple score=${r.score} signals=${JSON.stringify(r.signals)}`);
  }
  for (const p of COMPLEX) {
    const r = classify(p);
    if (r.class !== 'strong') throw new Error(`complex prompt misclassified: ${JSON.stringify({ class: r.class, score: r.score, signals: r.signals })}`);
    lines.push(`${JSON.stringify(p.slice(0, 36))} -> strong score=${r.score} signals=${JSON.stringify(r.signals)}`);
  }
  return `3 simple + 3 complex all correct | ${lines.join(' | ')}`;
});

// -- P2 ---------------------------------------------------------------------
await probe(2, () => {
  configure({ map: { ...DEFAULT_MAP }, agentOverrides: {}, knownModels: [] });
  const cheap = route(P_SIMPLE_2);
  const strong = route(P_COMPLEX_1);
  if (cheap.model !== 'tier-cheap' || cheap.class !== 'simple') throw new Error(`simple routed wrong: ${JSON.stringify(cheap)}`);
  if (strong.model !== 'tier-strong' || strong.class !== 'strong') throw new Error(`complex routed wrong: ${JSON.stringify(strong)}`);
  return `route(simple) -> ${cheap.model} (${cheap.reason}) ; route(complex) -> ${strong.model} (${strong.reason})`;
});

// -- P3 ---------------------------------------------------------------------
await probe(3, () => {
  configure({ knownModels: ['review-model'], agentOverrides: { reviewer: 'review-model' } });
  const overridden = route(P_COMPLEX_1, { agentId: 'reviewer' });
  const mapped = route(P_COMPLEX_1);
  if (overridden.model !== 'review-model') throw new Error(`override not honored: ${JSON.stringify(overridden)}`);
  if (mapped.model !== 'tier-strong') throw new Error(`map path broken after configure: ${JSON.stringify(mapped)}`);
  return `agentId=reviewer -> ${overridden.model} (${overridden.reason}) ; no agentId -> ${mapped.model} (${mapped.reason})`;
});

// -- P4 ---------------------------------------------------------------------
await probe(4, () => {
  const m1 = expectRoutingError(() => configure({ map: { simple: 'ghost-model', strong: 'tier-strong' }, knownModels: [] }), 'E_UNKNOWN_MODEL', 'unknown model in map');
  const m2 = expectRoutingError(() => configure({ agentOverrides: { auditor: 'ghost-model' } }), 'E_UNKNOWN_MODEL', 'unknown model in agentOverrides');
  const still = route(P_COMPLEX_1, { agentId: 'reviewer' });
  if (still.model !== 'review-model') throw new Error(`rejected configure mutated state: ${JSON.stringify(still)}`);
  return `${m1} ; ${m2} ; config untouched after both rejections (reviewer still -> ${still.model})`;
});

// -- P5 ---------------------------------------------------------------------
const DET_CHILD_SCRIPT = `
import { classify, route, configure } from '${ROUTING_ENTRY}';
configure({ map: { simple: 'tier-cheap', strong: 'tier-strong' }, agentOverrides: {}, knownModels: [] });
const P_SIMPLE_2 = 'what is 2 + 2?';
const P_COMPLEX_2 =
  'Orchestrate the migration ((({a:{b:{c:{d:1}}}}))): the pipeline must spawn workers, benchmark throughput, deploy the artifacts, and audit every stage. ' +
  'The scheduler and the daemon keep their state across reloads; lint the whole workflow and snapshot the indices so a rollback stays possible. ' +
  'Provision the teardown path, compile the report, and scan the audit trail before the next deploy window opens.';
console.log(JSON.stringify([classify(P_SIMPLE_2), classify(P_COMPLEX_2), route(P_SIMPLE_2), route(P_COMPLEX_2)]));
`;

await probe(5, async () => {
  configure({ map: { ...DEFAULT_MAP }, agentOverrides: {}, knownModels: [] });
  const sequence = () =>
    JSON.stringify([
      classify(P_SIMPLE_2),
      classify(P_COMPLEX_2),
      route(P_SIMPLE_2),
      route(P_COMPLEX_2),
    ]);
  const a = sequence();
  const b = sequence();
  if (a !== b) throw new Error(`two in-process runs differ:\n${a}\n---\n${b}`);
  fs.mkdirSync(path.dirname(DET_CHILD), { recursive: true });
  fs.writeFileSync(DET_CHILD, DET_CHILD_SCRIPT);
  const c = execFileSync(process.execPath, [DET_CHILD], { encoding: 'utf8' }).trim();
  if (a !== c) throw new Error(`fresh-process run differs:\n${a}\n---\n${c}`);
  return `byte-identical classify+route output across two runs and a fresh node process (${a.length} bytes each)`;
});

// -- P6 ---------------------------------------------------------------------
await probe(6, () => {
  // pre-existing untracked runner cache from earlier suite runs — remove so
  // the zone check shows exactly the phase-27 working set (disclosed: it is
  // not tracked, not part of any commit, and regenerates on suite runs)
  fs.rmSync('scripts/.chunked-state.json', { force: true });
  const status = execFileSync('git', ['status', '--short'], { encoding: 'utf8', cwd: process.cwd() });
  const lines = status.split('\n').filter(Boolean);
  const ok = lines.every((l) => {
    const path = l.slice(3).trim();
    return path.startsWith('providers/routing/') || path.startsWith('scripts/phase27-');
  });
  if (!ok) throw new Error(`zone leak in git status: ${status}`);
  return `git status --short -> ${JSON.stringify(lines)} (zone-only)`;
});

for (const line of results) console.log(line);
console.log(`SCOPE C: ${pass}/${pass + fail} PASS, ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
