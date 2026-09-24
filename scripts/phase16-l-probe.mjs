#!/usr/bin/env node
// Phase 16 Scope L — Terminal Inline Artifacts Panel probe (P1–P9)
import fs from 'node:fs';
import { artifacts } from '../interfaces/ui/web/console/chat/artifacts.js';
import { toolcards } from '../interfaces/ui/web/console/chat/toolcards.js';
import { runtime } from '../interfaces/ui/web/console/chat/runtime.js';
import { router } from '../interfaces/ui/web/console/chat/router.js';
import { modes } from '../interfaces/ui/web/console/chat/modes.js';
import { approvals } from '../interfaces/ui/web/console/chat/approvals.js';
import { draft } from '../interfaces/ui/web/console/chat/progress-draft.js';
import { taxonomy } from '../runtime/events/chat/taxonomy.js';

let pass = 0, fail = 0;
const ok = (c, msg) => { c ? pass++ : fail++; console.log(`  ${c ? '✅' : '❌'} ${msg}`); };
const j = (v) => JSON.stringify(v);

console.log('=== Phase 16 L — Terminal Inline Artifacts Panel ===');

// Real files live OUTSIDE the repo so P9's `git status --short` stays clean.
const DISK = '/tmp/scopeL-files';
fs.rmSync(DISK, { recursive: true, force: true });
fs.mkdirSync(DISK, { recursive: true });

/**
 * Host-supplied content source. This is the injected I/O seam: artifacts.js
 * never imports node:fs. 'file' artifacts are read from the real filesystem
 * (so P7 staleness is real); 'patch' artifacts are served from the turn's own
 * store, because a patch's content is the patch text, not the bytes at `path`.
 */
const patchStore = new Map();
artifacts.useSource({
  read(path, entry) {
    if (entry.kind === 'patch') return patchStore.has(path) ? patchStore.get(path) : null;
    try { return fs.readFileSync(path, 'utf8'); } catch { return null; }
  },
});

const hardReset = () => {
  artifacts._reset();
  toolcards._reset();
  runtime._reset();
  router._reset();
  modes._reset();
  approvals._reset();
  draft._reset();
  patchStore.clear();
};

/** Run a real Scope J turn, build its Scope K cards, return { turnId, cards }. */
async function runTurn(sess, userInput, tools, modePatch) {
  hardReset();
  runtime.attach(sess);
  if (modePatch) runtime.mode(sess, modePatch);
  const agent = () => (async function* a() { for (const t of tools) yield { kind: 'tool', ...t }; })();
  const { turnId, stream } = runtime.send(sess, userInput, { agent });
  for await (const e of stream) {
    // A destructive tool parks the turn on Scope G's gate before tool.started
    // is emitted; approve it so the turn proceeds (and, in plan mode, so Scope
    // H can then refuse it at tool.started — which is what P4 needs).
    if (e.type === 'approval.requested') {
      runtime.approve(sess, e.event.payload.approvalId, 'yes');
      continue;
    }
    if (toolcards.isToolEvent(e)) toolcards.build(e);
  }
  return { turnId, cards: toolcards.list().map((s) => toolcards.get(s.cardId)) };
}

// ─────────────────────────────────────────────────────────────────────────────
// P1 — panel from a 3-tool turn (bash, edit, search): entries has the edit's
//      artifact, countsByKind, empty:false. Panel JSON carries no content.
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n════ P1 — panel from a 3-tool turn (bash, edit, search) ════');
let p1Panel;
{
  const sess = 'sess-p1';
  const patch = '@@ -1,3 +1,4 @@\n-const a = 1;\n+const a = 2;\n+const b = 3;';
  const { turnId, cards } = await runTurn(sess, 'fix the constants', [
    { name: 'bash', args: { command: 'ls -la | grep foo' }, destructive: false, result: 'app.js\ntest.js' },
    // destructive:false keeps Scope G's approval gate out of the way; artifact
    // extraction keys off args, not the flag.
    { name: 'edit_file', args: { path: '/src/app.js', patch }, destructive: false, result: 'patched' },
    { name: 'read_file', args: { path: '/src/app.js' }, destructive: false, result: 'const a = 2;' },
  ]);
  // Populated after runTurn: hardReset() clears the store.
  patchStore.set('/src/app.js', patch);
  console.log(`  turnId -> ${turnId}`);
  console.log(`  cards -> ${j(cards.map((c) => ({ cardType: c.cardType, tool: c.tool.name, status: c.status, artifacts: c.body.artifacts })))}`);

  const p = artifacts.panel(turnId);
  p1Panel = p;
  console.log(`  artifacts.panel(${turnId}) ->\n${JSON.stringify(p, null, 2)}`);

  ok(p.panelId === `panel:${turnId}`, `P1 panelId is panel:<turnId> (got ${j(p.panelId)})`);
  ok(p.turnId === turnId, 'P1 panel echoes its turnId');
  ok(p.empty === false, `P1 empty is false (got ${j(p.empty)})`);
  ok(p.entries.length === 1, `P1 exactly one entry — bash and search produce none (got ${p.entries.length})`);
  ok(p.entries[0].path === '/src/app.js', `P1 the entry is the edit's artifact (got ${j(p.entries[0].path)})`);
  ok(p.entries[0].kind === 'patch', `P1 kind patch (got ${j(p.entries[0].kind)})`);
  ok(p.entries[0].toolName === 'edit_file', `P1 entry records its producing tool (got ${j(p.entries[0].toolName)})`);
  ok(typeof p.entries[0].cardId === 'string' && p.entries[0].cardId.length > 0, 'P1 entry records its Scope K cardId');
  ok(p.entries[0].hash === toolcards.fingerprint(patch), 'P1 hash matches Scope K fingerprint of the patch');
  ok(p.entries[0].size === patch.length, `P1 size is the recorded byte size (got ${p.entries[0].size})`);
  ok(p.entries[0].expanded === false, 'P1 nothing expanded by default');
  ok(j(p.countsByKind) === j({ patch: 1 }), `P1 countsByKind -> ${j(p.countsByKind)}`);

  // No content anywhere in the panel model.
  ok(!JSON.stringify(p).includes(patch), 'P1 panel JSON contains no artifact content');
  ok(p.entries.every((e) => !('content' in e)), 'P1 no entry carries a content field');
  ok(artifacts.holdsContent(p.panelId) === false, 'P1 holdsContent() is false');
  ok(artifacts.stats().reads === 0, `P1 panel() performed no reads (reads=${artifacts.stats().reads})`);
}

// ─────────────────────────────────────────────────────────────────────────────
// P2 — open() returns content + hash; close() drops it from memory.
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n════ P2 — open() loads content lazily, close() drops it ════');
{
  const panelId = p1Panel.panelId;

  const opened = artifacts.open(panelId, '/src/app.js');
  console.log(`  artifacts.open(${panelId}, '/src/app.js') -> ${j(opened)}`);
  ok(typeof opened.content === 'string' && opened.content.length > 0, 'P2 open() returns the content');
  ok(opened.content.startsWith('@@ -1,3 +1,4 @@'), 'P2 content is the patch body');
  ok(opened.hash === toolcards.fingerprint(opened.content), 'P2 hash matches the content it returned');
  ok(opened.stale === undefined, 'P2 not stale when the recorded hash matches');
  ok(artifacts.stats().reads === 1, `P2 exactly one read happened (reads=${artifacts.stats().reads})`);
  ok(j(artifacts.openPaths(panelId)) === j(['/src/app.js']), 'P2 panel now reports the artifact expanded');

  const closed = artifacts.close(panelId, '/src/app.js');
  console.log(`  artifacts.close(...) -> ${j(closed)}`);
  ok(closed.path === '/src/app.js' && closed.expanded === false, 'P2 close() returns { path, expanded:false }');
  ok(closed.dropped === true, 'P2 close() dropped cached content');
  ok(j(artifacts.openPaths(panelId)) === j([]), 'P2 no artifact remains expanded');
  ok(artifacts.holdsContent(panelId) === false, 'P2 panel model has no content field after close');
  ok(!artifacts.list(panelId).some((e) => 'content' in e), 'P2 list() entries carry no content');
  console.log(`  artifacts.list(${panelId}) -> ${j(artifacts.list(panelId))}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// P3 — empty turn: empty:true, entries:[], not an error.
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n════ P3 — empty turn ════');
{
  const { turnId } = await runTurn('sess-p3', 'what time is it', [
    { name: 'bash', args: { command: 'date' }, destructive: false, result: 'Mon Sep 21 09:00:00 EAT 2026' },
    { name: 'read_file', args: { path: '/etc/hostname' }, destructive: false, result: 'jexi' },
  ]);
  const p = artifacts.panel(turnId);
  console.log(`  artifacts.panel(${turnId}) -> ${j(p)}`);
  ok(p.empty === true, `P3 empty is true (got ${j(p.empty)})`);
  ok(j(p.entries) === j([]), `P3 entries is [] (got ${j(p.entries)})`);
  ok(j(p.countsByKind) === j({}), `P3 countsByKind is {} (got ${j(p.countsByKind)})`);
  ok(j(artifacts.list(p.panelId)) === j([]), 'P3 list() is []');
}

// ─────────────────────────────────────────────────────────────────────────────
// P4 — refused tool card: excluded, no phantom artifact.
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n════ P4 — refused tool card produces no artifact ════');
{
  const content = 'SECRET = "should never appear";\n';
  const { turnId, cards } = await runTurn('sess-p4', 'write the secret', [
    { name: 'edit_file', args: { path: '/src/secret.js', content }, destructive: true, result: 'written' },
  ], { interactionMode: 'plan' });
  console.log(`  cards -> ${j(cards.map((c) => ({ cardType: c.cardType, tool: c.tool.name, status: c.status, error: c.footer.error, artifacts: c.body.artifacts })))}`);

  const refusedCard = cards.find((c) => c.status === 'refused');
  ok(!!refusedCard, 'P4 the write was refused in plan mode');
  ok(refusedCard && refusedCard.footer.error === 'E_PLAN_MODE_READONLY', 'P4 refusal carries E_PLAN_MODE_READONLY');
  // Observed, and NOT fixable here (toolcards.js is out of zone): Scope K runs
  // extractArtifacts() ahead of its refusal branch, so a refused card really
  // does carry the intended write's path/size/hash even though the tool never
  // ran. That makes the explicit refusal exclusion below load-bearing rather
  // than decorative — without it the panel would show a phantom artifact.
  console.log(`  refused card artifacts (Scope K stamps these anyway) -> ${j(refusedCard.body.artifacts)}`);
  ok(refusedCard && refusedCard.body.artifacts.length > 0,
    'P4 Scope K stamps artifact metadata on a refused card, so L must filter it out');

  const p = artifacts.panel(turnId);
  console.log(`  artifacts.panel(${turnId}) -> ${j(p)}`);
  ok(p.empty === true, `P4 panel is empty (got ${j(p.empty)})`);
  ok(p.entries.length === 0, `P4 no phantom artifact entry (got ${p.entries.length})`);
  ok(!JSON.stringify(p).includes('SECRET'), 'P4 panel JSON contains none of the refused content');
  ok(j(p.countsByKind) === j({}), `P4 countsByKind is {} (got ${j(p.countsByKind)})`);

  let threw = null;
  try { artifacts.open(p.panelId, '/src/secret.js'); } catch (e) { threw = e.code; }
  ok(threw === 'E_UNKNOWN_ARTIFACT', `P4 opening the refused path -> E_UNKNOWN_ARTIFACT (got ${j(threw)})`);
}

// ─────────────────────────────────────────────────────────────────────────────
// P5 — E_UNKNOWN_TURN / E_UNKNOWN_PANEL / E_UNKNOWN_ARTIFACT
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n════ P5 — error codes ════');
{
  const { turnId } = await runTurn('sess-p5', 'list things', [
    { name: 'bash', args: { command: 'ls' }, destructive: false, result: 'a.txt' },
  ]);
  const p = artifacts.panel(turnId);

  const codes = [];
  try { artifacts.panel('turn-does-not-exist'); } catch (e) { codes.push(['panel(unknown turnId)', e.code]); }
  try { artifacts.list('panel:turn-does-not-exist'); } catch (e) { codes.push(['list(unknown panelId)', e.code]); }
  try { artifacts.open('panel:turn-does-not-exist', '/x'); } catch (e) { codes.push(['open(unknown panelId)', e.code]); }
  try { artifacts.close('panel:turn-does-not-exist', '/x'); } catch (e) { codes.push(['close(unknown panelId)', e.code]); }
  try { artifacts.open(p.panelId, '/nope/missing.js'); } catch (e) { codes.push(['open(unknown path)', e.code]); }
  try { artifacts.close(p.panelId, '/nope/missing.js'); } catch (e) { codes.push(['close(unknown path)', e.code]); }
  try { artifacts.panel(''); } catch (e) { codes.push(['panel(empty turnId)', e.code]); }

  for (const [label, code] of codes) console.log(`  ${label} -> ${code}`);
  ok(codes.find((c) => c[0] === 'panel(unknown turnId)')?.[1] === 'E_UNKNOWN_TURN', 'P5 unknown turnId -> E_UNKNOWN_TURN');
  ok(codes.filter((c) => c[1] === 'E_UNKNOWN_PANEL').length === 3, 'P5 unknown panelId -> E_UNKNOWN_PANEL (list/open/close)');
  ok(codes.filter((c) => c[1] === 'E_UNKNOWN_ARTIFACT').length === 2, 'P5 unknown path -> E_UNKNOWN_ARTIFACT (open/close)');
  ok(codes.find((c) => c[0] === 'panel(empty turnId)')?.[1] === 'E_UNKNOWN_TURN', 'P5 empty turnId -> E_UNKNOWN_TURN');

  // No content source -> loud failure, never fabricated content. Needs a turn
  // that actually has an entry, or open() fails earlier with E_UNKNOWN_ARTIFACT.
  const p5patch = '@@ -1,1 +1,2 @@\n-q\n+q\n+r';
  const withArtifact = await runTurn('sess-p5b', 'patch it', [
    { name: 'edit_file', args: { path: '/src/nosrc.js', patch: p5patch }, destructive: false, result: 'patched' },
  ]);
  patchStore.set('/src/nosrc.js', p5patch);
  const pB = artifacts.panel(withArtifact.turnId);
  console.log(`  panel for the no-source turn -> ${j({ panelId: pB.panelId, entries: pB.entries.length })}`);

  const saved = artifacts.stats();
  artifacts.useSource(null);
  let noSrc = null;
  try { artifacts.open(pB.panelId, '/src/nosrc.js'); } catch (e) { noSrc = e.code; }
  console.log(`  open() with no content source -> ${noSrc}`);
  ok(noSrc === 'E_NO_CONTENT_SOURCE', 'P5 no content source -> E_NO_CONTENT_SOURCE');
  artifacts.useSource({ read: (path, entry) => (entry.kind === 'patch' ? (patchStore.get(path) ?? null) : fs.readFileSync(path, 'utf8')) });
  ok(artifacts.stats().reads === saved.reads, 'P5 the failed open performed no read');
}

// ─────────────────────────────────────────────────────────────────────────────
// P6 — duplicate open() is idempotent and does not re-read.
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n════ P6 — duplicate open() is idempotent, no re-read ════');
{
  const patch = '@@ -1,2 +1,3 @@\n-old\n+new\n+more';
  const { turnId } = await runTurn('sess-p6', 'patch it', [
    { name: 'edit_file', args: { path: '/src/dupe.js', patch }, destructive: false, result: 'patched' },
  ]);
  patchStore.set('/src/dupe.js', patch);
  const p = artifacts.panel(turnId);

  const before = artifacts.stats();
  console.log(`  stats before -> ${j(before)}`);
  const first = artifacts.open(p.panelId, '/src/dupe.js');
  const afterFirst = artifacts.stats();
  const second = artifacts.open(p.panelId, '/src/dupe.js');
  const afterSecond = artifacts.stats();
  const third = artifacts.open(p.panelId, '/src/dupe.js');
  const afterThird = artifacts.stats();

  console.log(`  stats after open #1 -> ${j(afterFirst)}`);
  console.log(`  stats after open #2 -> ${j(afterSecond)}`);
  console.log(`  stats after open #3 -> ${j(afterThird)}`);
  ok(afterFirst.reads === before.reads + 1, `P6 first open read once (reads ${before.reads} -> ${afterFirst.reads})`);
  ok(afterSecond.reads === afterFirst.reads, `P6 second open did NOT re-read (reads stayed ${afterSecond.reads})`);
  ok(afterThird.reads === afterFirst.reads, `P6 third open did NOT re-read (reads stayed ${afterThird.reads})`);
  ok(afterThird.cacheHits === before.cacheHits + 2, `P6 the repeats were cache hits (cacheHits ${before.cacheHits} -> ${afterThird.cacheHits})`);
  ok(j(first) === j(second) && j(second) === j(third), 'P6 all three open() results are byte-identical');
  ok(artifacts.openPaths(p.panelId).length === 1, 'P6 still exactly one expanded artifact');

  // close() then open() must read again — proving close really freed memory.
  artifacts.close(p.panelId, '/src/dupe.js');
  artifacts.open(p.panelId, '/src/dupe.js');
  const afterReopen = artifacts.stats();
  console.log(`  stats after close()+open() -> ${j(afterReopen)}`);
  ok(afterReopen.reads === afterThird.reads + 1, `P6 close() dropped content, so the re-open read again (reads ${afterThird.reads} -> ${afterReopen.reads})`);
}

// ─────────────────────────────────────────────────────────────────────────────
// P7 — file on disk changed after the card was built -> stale.
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n════ P7 — hash mismatch on disk surfaces stale:true ════');
{
  const realPath = `${DISK}/config.json`;
  const original = '{\n  "retries": 3\n}\n';
  const { turnId, cards } = await runTurn('sess-p7', 'write config', [
    { name: 'edit_file', args: { path: realPath, content: original }, destructive: false, result: 'written' },
  ]);
  fs.writeFileSync(realPath, original);
  console.log(`  card artifacts -> ${j(cards[0].body.artifacts)}`);
  const p = artifacts.panel(turnId);
  console.log(`  panel entries -> ${j(p.entries)}`);

  const fresh = artifacts.open(p.panelId, realPath);
  console.log(`  open() on an unmodified file -> ${j({ ...fresh, content: fresh.content.slice(0, 24) + '…' })}`);
  ok(fresh.stale === undefined, 'P7 an unmodified file is not stale');
  ok(fresh.hash === toolcards.fingerprint(original), 'P7 recorded hash matches the file on disk');
  ok(p.entries[0].kind === 'file', `P7 a content-bearing edit is kind 'file' (got ${j(p.entries[0].kind)})`);
  artifacts.close(p.panelId, realPath);

  const modified = '{\n  "retries": 9,\n  "timeout": 5\n}\n';
  fs.writeFileSync(realPath, modified);
  const stale = artifacts.open(p.panelId, realPath);
  console.log(`  open() after the file was modified on disk -> ${j({ ...stale, content: stale.content.slice(0, 40) + '…' })}`);
  ok(stale.stale === true, `P7 open() returns stale:true (got ${j(stale.stale)})`);
  ok(stale.expected === toolcards.fingerprint(original), `P7 expected is the card's recorded hash (${stale.expected})`);
  ok(stale.actual === toolcards.fingerprint(modified), `P7 actual is the hash of what is on disk now (${stale.actual})`);
  ok(stale.expected !== stale.actual, 'P7 expected and actual differ');
  ok(stale.content === modified, 'P7 the caller still gets the current content and decides');

  const after = artifacts.panel(turnId);
  console.log(`  panel after the stale open -> ${j(after.entries)}`);
  ok(after.entries[0].stale === true, 'P7 the panel surfaces stale:true on the entry');
  ok(j(after.countsByKind) === j({ file: 1 }), `P7 countsByKind unaffected by staleness (got ${j(after.countsByKind)})`);
  ok(after.empty === false, 'P7 a stale artifact is still an artifact — the panel is not empty');
}

// ─────────────────────────────────────────────────────────────────────────────
// P8 — determinism: byte-identical panel() JSON across two runs.
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n════ P8 — determinism ════');
{
  const patchA = '@@ -1,1 +1,2 @@\n-a\n+b\n+c';
  const patchB = '@@ -5,1 +5,2 @@\n-x\n+y\n+z';
  const build = () => runTurn('sess-p8', 'patch two files', [
    { name: 'bash', args: { command: 'git status' }, destructive: false, result: 'clean' },
    { name: 'edit_file', args: { path: '/src/b.js', patch: patchB }, destructive: false, result: 'patched' },
    { name: 'read_file', args: { path: '/src/b.js' }, destructive: false, result: 'b' },
    { name: 'edit_file', args: { path: '/src/a.js', patch: patchA }, destructive: false, result: 'patched' },
  ]).then((r) => artifacts.panel(r.turnId));

  const first = JSON.stringify(await build());
  const second = JSON.stringify(await build());
  console.log(`  run #1 -> ${first}`);
  console.log(`  run #2 -> ${second}`);
  ok(first === second, 'P8 panel() JSON is byte-identical across two independent runs');

  const parsed = JSON.parse(first);
  ok(parsed.entries.length === 2, `P8 both edits present (got ${parsed.entries.length})`);
  ok(j(Object.keys(parsed.countsByKind)) === j(['patch']), 'P8 countsByKind key order is stable');
  const cardIds = parsed.entries.map((e) => e.cardId);
  ok(cardIds[0] === cardIds[0] && cardIds[1] === cardIds[1], 'P8 entry order is stable');
  ok(JSON.stringify(parsed).length > 100, 'P8 the panel is a real multi-entry payload');
}

// ─────────────────────────────────────────────────────────────────────────────
// P9 — zone check: only ui/web/console/chat/** and scripts/phase16-*.mjs
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n════ P9 — zone check ════');
{
  const { execSync } = await import('node:child_process');
  const repo = new URL('..', import.meta.url).pathname;
  const run = (c) => execSync(c, { cwd: repo }).toString();

  const status = run('git status --short');
  const uncommitted = status.split('\n').map((l) => l.trim()).filter(Boolean)
    .map((l) => l.split(/\s+/).slice(1).join(' '));

  // After this scope is committed the tree is clean, so also fold in the files
  // carried by the phase-16(L) commit. Keeps P9 green pre- AND post-commit.
  let committed = [];
  try {
    const hash = run("git log --format=%H --grep='^phase-16(L):' -1").trim();
    if (hash) committed = run(`git show --name-only --format= ${hash}`).split('\n').map((x) => x.trim()).filter(Boolean);
  } catch { /* not committed yet */ }

  const changed = [...new Set([...uncommitted, ...committed])];
  console.log('  git status --short ->');
  console.log(status.split('\n').filter(Boolean).map((l) => `    ${l}`).join('\n') || '    (clean)');
  console.log(`  phase-16(L) commit files -> ${j(committed)}`);

  const allowed = (f) => /^ui\/web\/console\/chat\//.test(f) || /^scripts\/phase16-.*\.mjs$/.test(f);
  const violations = changed.filter((f) => !allowed(f));
  console.log(`  changed paths -> ${j(changed)}`);
  console.log(`  outside the zone -> ${j(violations)}`);
  ok(violations.length === 0, `P9 no file outside the scope-guard zone (violations: ${j(violations)})`);
  ok(changed.includes('ui/web/console/chat/artifacts.js'), 'P9 artifacts.js is in the changeset');
  ok(changed.includes('scripts/phase16-l-probe.mjs'), 'P9 the L probe is in the changeset');
  ok(changed.includes('scripts/phase16-l-shots.mjs'), 'P9 the L screenshot harness is in the changeset');
  ok(!changed.includes('ui/web/console/chat/toolcards.js'), 'P9 toolcards.js (K) untouched');
}

// ─────────────────────────────────────────────────────────────────────────────
// Contract-shape assertions (the four exported functions and nothing leaked).
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n════ contract shape ════');
{
  for (const fn of ['panel', 'open', 'close', 'list']) {
    ok(typeof artifacts[fn] === 'function', `contract: artifacts.${fn}() exists`);
  }
  ok(typeof taxonomy.validate === 'function', 'contract: Scope A taxonomy still importable (zone intact)');
}

console.log(`\n=== Phase 16 L: ${pass} passed, ${fail} failed ===`);
process.exit(fail === 0 ? 0 : 1);
