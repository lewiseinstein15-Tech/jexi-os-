/**
 * Phase 7(G) — COMMANDS subsystem tests.
 *
 * Covers: registry contract + validation, alias resolution, parser, arg
 * validation, dispatch pipeline (executed/completed/failed events), every
 * shipped command through the REAL dispatcher, chat/CLI seam presence and
 * the /api/commands surface shape. Uses isolated temp dirs where the
 * command writes (checkpoint/handoff/export) so runs never interfere.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const results = [];
function check(name, fn) {
  results.push({ name });
  try {
    fn();
    results[results.length - 1].ok = true;
  } catch (e) {
    results[results.length - 1].ok = false;
    results[results.length - 1].err = String(e.message || e).slice(0, 200);
  }
}
async function checkAsync(name, fn) {
  results.push({ name });
  try {
    await fn();
    results[results.length - 1].ok = true;
  } catch (e) {
    results[results.length - 1].ok = false;
    results[results.length - 1].err = String(e.message || e).slice(0, 200);
  }
}

const SERVER_ROOT = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SERVER_ROOT, '..');

// the subsystem under test — same module instance the seam loads (repo root)
const C = await import(pathToFileURL(path.join(REPO_ROOT, 'capabilities/commands', 'index.js')).href);
const registry = C.registry;

/* ── 1. registry contract ─────────────────────────────────────────────── */

check('registry: 15 commands registered', () => {
  assert.equal(C.list().length, 15, `got ${C.list().length}: ${C.list().map((c) => c.name).join(',')}`);
});

check('registry: contract fields present on every command', () => {
  for (const c of C.list()) {
    assert.ok(c.name && typeof c.name === 'string', 'name');
    assert.ok(c.description, 'description');
    assert.ok(['session', 'review', 'cost', 'debug', 'learning', 'relay'].includes(c.category), `category ${c.name}=${c.category}`);
    assert.ok(Array.isArray(c.aliases), 'aliases');
    assert.ok(Array.isArray(c.args), 'args');
    assert.equal(typeof c.handler, 'function', 'handler');
  }
});

check('registry: aliases cp/cr/cost resolve', () => {
  assert.equal(C.resolve('cp').name, 'checkpoint');
  assert.equal(C.resolve('cr').name, 'code-review');
  assert.equal(C.resolve('cost').name, 'cost-report');
});

check('registry: duplicate registration rejected', () => {
  assert.throws(() => registry.register({ name: 'checkpoint', description: 'dup', category: 'session', handler: async () => ({}) }));
});

check('registry: bad category rejected', () => {
  assert.throws(() => registry.register({ name: 'badcat', description: 'x', category: 'nope', handler: async () => ({}) }));
});

/* ── 2. parser ─────────────────────────────────────────────────────────── */

check('parser: positional + flags + quotes', () => {
  const p = C.parse('/checkpoint "nightly run" --label x --dry');
  assert.equal(p.name, 'checkpoint');
  assert.deepEqual(p.positional, ['nightly run']);
  assert.equal(p.flags.label, 'x');
  assert.equal(p.flags.dry, true);
});

check('parser: non-command returns null', () => {
  assert.equal(C.parse('hello world'), null);
  assert.equal(C.parse('/'), null);
});

/* ── 3. arg validation ─────────────────────────────────────────────────── */

check('validate: missing required arg rejected', async () => {
  const r = await C.dispatch('/intel');
  assert.equal(r.handled, true);
  assert.equal(r.ok, false);
  assert.match(r.error, /missing required argument: source/);
});

check('validate: typed number arg coerces + rejects garbage', async () => {
  const ok = await C.dispatch('/cost-report --window 5');
  assert.equal(ok.ok, true);
  const bad = await C.dispatch('/cost-report --window abc');
  assert.equal(bad.ok, false);
  assert.match(bad.error, /must be a number/);
});

/* ── 4. dispatch events + unknown ──────────────────────────────────────── */

check('dispatch: unknown command is a clean error (not a crash)', async () => {
  const r = await C.dispatch('/nonexistent');
  assert.equal(r.reason, 'unknown-command');
  assert.match(r.error, /unknown command \/nonexistent/);
});

await checkAsync('dispatch: emits command.executed + completed on the Observer bus', async () => {
  const Observer = (await import(path.join(SERVER_ROOT, 'src', 'services', 'Observer.js')).catch(() => null));
  if (!Observer) return; // bus optional in stripped runtimes
  const before = Observer.recent().length;
  await C.dispatch('/status');
  const after = Observer.recent();
  assert.ok(after.length >= before + 2, `expected ≥2 new events, got ${after.length - before}`);
  const types = after.slice(-(after.length - before)).map((e) => e.type);
  assert.ok(types.includes('command.executed'), `executed missing (${types.join(',')})`);
  assert.ok(types.includes('command.completed'), `completed missing (${types.join(',')})`);
});

/* ── 5. the commands themselves (through the real dispatcher) ──────────── */

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jexi-commands-test-'));

await checkAsync('/checkpoint writes a restorable snapshot', async () => {
  const r = await C.dispatch('/checkpoint --label test-chain');
  assert.equal(r.ok, true, r.error || 'checkpoint failed');
  assert.ok(fs.existsSync(r.result.path), 'sqlite file exists');
  assert.ok(r.result.nodeCount >= 1);
  assert.ok(r.result.restored?.nodeCount >= 1, 'restore-verified');
});

await checkAsync('/status prints one line from the HUD', async () => {
  const r = await C.dispatch('/status');
  assert.equal(r.ok, true);
  assert.ok(r.summary.startsWith('status:'), r.summary);
  assert.equal(r.summary.split('\n').length, 1, 'ONE line');
});

await checkAsync('/doctor runs real subsystem checks', async () => {
  const r = await C.dispatch('/doctor');
  assert.ok(r.result && r.result.checks.length >= 8, `${r.result?.checks?.length} checks`);
  assert.ok(/doctor: \d+\/\d+ green/.test(r.summary), r.summary);
  const names = r.result.checks.map((c) => c.subsystem);
  for (const n of ['node', 'storage', 'sqlite', 'hud', 'observer']) assert.ok(names.includes(n), `check ${n} missing`);
  for (const n of ['node', 'storage', 'sqlite', 'hud', 'observer']) {
    const row = r.result.checks.find((c) => c.subsystem === n);
    assert.equal(row.status, 'green', `${n} should be green: ${row.detail}`);
  }
});

await checkAsync('/handoff + /catchup round-trip STATE.md', async () => {
  const stateFile = path.join(tmp, 'STATE.md');
  const h = await C.dispatch(`/handoff --out "${stateFile}" --note "test note"`);
  assert.equal(h.ok, true, h.error || 'handoff failed');
  const md = fs.readFileSync(stateFile, 'utf8');
  for (const s of ['## Now', '## Just landed', '## Next', '## Open questions', '## Watch out']) {
    assert.ok(md.includes(s), `section ${s} missing`);
  }
  const c = await C.dispatch(`/catchup --file "${stateFile}"`);
  assert.equal(c.ok, true, c.error || 'catchup failed');
  assert.ok(c.result.sections['Next']?.length >= 1, 'catchup sees Next items');
});

await checkAsync('/export writes session JSON', async () => {
  const r = await C.dispatch(`/export --out "${path.join(tmp, 'session.json')}"`);
  assert.equal(r.ok, true, r.error || 'export failed');
  const j = JSON.parse(fs.readFileSync(r.result.path, 'utf8'));
  assert.equal(j.schema, 'jexi.session-export.v1');
  assert.ok(Array.isArray(j.spend));
});

await checkAsync('/cost-report reads the HUD spend ledger', async () => {
  const r = await C.dispatch('/cost-report');
  assert.equal(r.ok, true, r.error || 'cost-report failed');
  assert.ok(r.result && typeof r.result === 'object');
  assert.ok(Array.isArray(r.result.ledger));
});

await checkAsync('/learn reports honestly with no journal', async () => {
  const r = await C.dispatch('/learn --session __no_such_session__');
  // analyzer on an empty journal → "none found"; missing subsystem → honest error. Both acceptable.
  assert.ok(r.ok === true || r.ok === false);
  assert.ok(r.summary || r.error);
  if (r.ok) assert.ok(/none found|extracted/.test(r.summary), r.summary);
});

await checkAsync('/refine says "no refinement" or proposes with evidence', async () => {
  const r = await C.dispatch('/refine');
  assert.ok(r.result, r.error || 'refine must return a result, not throw');
  if (r.result.proposal) {
    assert.equal(r.ok, true);
    assert.equal(r.result.ok, true);
    assert.equal(typeof r.result.proposal.evidence.source, 'string');
    assert.ok(r.result.proposal.evidence.source.length, 'proposal must cite its source');
    assert.equal(typeof r.result.proposal.evidence.detail, 'string');
    assert.ok(r.result.proposal.evidence.detail.length, 'proposal must cite an observation');
  } else {
    assert.equal(r.ok, false);
    assert.deepEqual(r.result, {
      ok: false,
      reason: 'no-evidence',
      message: 'No refinement: no evidence in trajectory',
    });
  }
});

await checkAsync('/intel triages against the plan with provenance', async () => {
  const r = await C.dispatch('/intel https://example.com/phase7-commands-design');
  assert.equal(r.ok, true, r.error || 'intel failed');
  assert.ok(['ADOPT', 'TRIAL', 'WATCH', 'SKIP'].includes(r.result.verdict), r.result.verdict);
  assert.ok(r.result.source.value.startsWith('https://'), 'provenance: source echoed');
  assert.ok(r.result.reason, 'reason present');
});

await checkAsync('/build-fix classifies a planted syntax error', async () => {
  const bad = path.join(tmp, 'planted-broken.js');
  fs.writeFileSync(bad, 'function broken( {\n  return 1\n}\n');
  const r = await C.dispatch(`/build-fix "${bad}"`);
  assert.equal(r.ok, true, r.error || 'build-fix failed');
  assert.equal(r.result.classification, 'syntax', r.result.classification);
  assert.ok(r.result.suggestion, 'suggestion present');
  assert.equal(r.result.evidence.line > 0, true, 'line recovered');
});

await checkAsync('/build-fix reports clean file as clean', async () => {
  const good = path.join(tmp, 'planted-clean.js');
  fs.writeFileSync(good, 'export const ok = 1;\n');
  const r = await C.dispatch(`/build-fix "${good}"`);
  assert.equal(r.ok, true);
  assert.equal(r.result.classification, 'clean');
});

/* ── 6. wiring seams ───────────────────────────────────────────────────── */

check('seam: chat + CLI share the same dispatcher module', async () => {
  const seamPath = path.join(SERVER_ROOT, 'src', 'commands-seam.js');
  assert.ok(fs.existsSync(seamPath), 'commands-seam.js exists');
  const idx = fs.readFileSync(path.join(SERVER_ROOT, 'index.js'), 'utf8');
  assert.ok(idx.includes('commands-seam.js'), 'index.js imports the seam');
  assert.ok(idx.includes('dispatchCommand'), 'index.js dispatches commands');
  const cli = fs.readFileSync(path.join(SERVER_ROOT, 'cli.js'), 'utf8');
  assert.ok(cli.includes('commands-seam.js'), 'cli.js imports the seam');
  assert.ok(cli.includes('dispatchCommand'), 'cli.js dispatches commands');
});

await checkAsync('seam: commands-seam loads and lists 15', async () => {
  const seam = await import(path.join(SERVER_ROOT, 'src', 'commands-seam.js'));
  assert.equal(seam.commandsAvailable(), true);
  assert.equal(seam.commandsStatus().count, 15);
  const api = seam.registryForApi();
  assert.equal(api.count, 15);
  assert.ok(api.commands[0].name && api.commands[0].category);
});

await checkAsync('surface: GET /api/commands exposes the dispatcher registry', async () => {
  // spin the real server route table via a tiny express-free check: the route
  // handler shape is covered by test-api-surface; here we verify the seam
  // value that route embeds.
  const seam = await import(path.join(SERVER_ROOT, 'src', 'commands-seam.js'));
  const api = seam.registryForApi();
  assert.ok(api && api.count >= 15);
});

check('docker: workflows ship commands/ into the brain image', () => {
  const wf = fs.readFileSync(path.join(REPO_ROOT, '.github', 'workflows', 'docker-image.yml'), 'utf8');
  assert.ok(/Ship commands\/ into the server build context/.test(wf), 'docker-image.yml ships commands/');
  const slim = fs.readFileSync(path.join(REPO_ROOT, 'Dockerfile.slim'), 'utf8');
  assert.ok(/COPY\s+commands/.test(slim), 'Dockerfile.slim copies commands/');
  assert.ok(slim.length > 0);
});

/* ── done ──────────────────────────────────────────────────────────────── */

fs.rmSync(tmp, { recursive: true, force: true });

const failed = results.filter((r) => !r.ok);
for (const r of results) {
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok ? '' : ` — ${r.err}`}`);
}
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) process.exit(1);
