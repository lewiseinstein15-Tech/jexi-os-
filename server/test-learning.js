/**
 * Phase 7 Scope C (continuous learning / instincts) tests — deterministic,
 * isolated tmp repoRoot + JEXI_HOME. No network, no real store pollution.
 */
import fs from 'fs';
import path from 'path';
import os from 'os';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jexi-learning-test-'));
const repoRoot = path.join(tmp, 'project');           // fake project root
fs.mkdirSync(repoRoot, { recursive: true });
process.env.JEXI_HOME = path.join(tmp, 'jexi-home');  // fake global home

const {
  createInstinct, computeConfidence, instinctId, validateInstinct, INSTINCT_TYPES,
} = await import('../mind/learning/instinct.js');
const {
  projectStorePath, globalStorePath, readRecords, foldStore, recordCandidate, listInstincts, appendRecord,
} = await import('../mind/learning/store.js');
const { observePreToolUse, observePostToolUse, readJournal, listSessions } =
  await import('../mind/learning/observer.js');
const { extractFromJournal, analyzeSession, analyzeAllSessions, wasAnalyzed, meetsPromotionCriteria } =
  await import('../mind/learning/analyzer.js');
const { promoteQualified } = await import('../mind/learning/promoter.js');
const { recallForTask, instinctsSection } = await import('../mind/learning/index.js');

let passed = 0, failed = 0;
function check(name, ok) {
  if (ok) { passed++; console.log('✅ ' + name); }
  else { failed++; console.log('❌ ' + name); }
}
function eq(name, a, b) { return check(`${name} (${JSON.stringify(a)} === ${JSON.stringify(b)})`, JSON.stringify(a) === JSON.stringify(b)); }

/* ---------------- instinct model ---------------- */
const inst = createInstinct({
  pattern: 'probe.run: recover from "ENOENT: no venv"',
  type: 'error_resolution',
  evidence: [{ turn: 1, tool: 'probe.run', result: 'error: ENOENT: no venv', sessionId: 's1' }],
  sightings: 1,
  succeeded: true,
});
check('createInstinct builds deterministic id', inst.id === instinctId('error_resolution', 'probe.run: recover from "ENOENT: no venv"'));
check('contract fields present', ['id','pattern','type','confidence','evidence','scope','createdAt','lastSeen'].every((k) => k in inst));
eq('confidence seen-1 succeeded recent', inst.confidence, 0.6);
eq('confidence seen-5 succeeded', computeConfidence({ sightings: 5, succeeded: true, recent: true }), 0.95);
eq('confidence haircut when failed before', computeConfidence({ sightings: 1, succeeded: true, recent: true, failedBefore: true }), 0.45);
eq('confidence floor with every negative factor', computeConfidence({ sightings: 1, succeeded: false, recent: false, failedBefore: true }), 0.15);
let threw = false;
try { createInstinct({ pattern: 'x', type: 'bogus_type' }); } catch { threw = true; }
check('bad type rejected', threw);
check('validateInstinct accepts snapshot', validateInstinct(inst) === true);

/* ---------------- store: append-only fold ---------------- */
const pStore = projectStorePath(repoRoot);
const first = recordCandidate(pStore, { pattern: inst.pattern, type: 'error_resolution', evidence: [{ turn: 1, tool: 'probe.run', result: 'error: ENOENT: no venv', sessionId: 's1' }], succeeded: true, sightings: 1 });
const second = recordCandidate(pStore, { pattern: inst.pattern, type: 'error_resolution', evidence: [{ turn: 4, tool: 'probe.run', result: 'error: ENOENT: no venv', sessionId: 's2' }], succeeded: true, sightings: 1 });
eq('fold keeps ONE instinct for same pattern', listInstincts(pStore).instincts.length, 1);
eq('sightings accumulate across records', second.sightings, 2);
eq('sessionIds accumulate', second.sessionIds.sort(), ['s1', 's2']);
check('append-only: 2 lines in store', readRecords(pStore).records.length === 2);
appendRecord(pStore, { garbage: true });
fs.appendFileSync(pStore, 'not-json\n', 'utf8');
eq('bad lines counted, never fatal', readRecords(pStore).badLines, 1);

/* ---------------- observer journal ---------------- */
const sid = 'obs-session-1';
observePreToolUse(repoRoot, { name: 'probe.run', arguments: { command: 'npm test' } }, { blocked: false }, { sessionId: sid, agentId: 'agent-x' });
observePostToolUse(repoRoot, { name: 'probe.run', arguments: { command: 'npm test' } }, { ok: false, durationMs: 42, error: 'ENOENT: no venv found' }, { sessionId: sid, agentId: 'agent-x' });
const entries = readJournal(repoRoot, sid);
eq('journal captured pre+post', entries.length, 2);
eq('pre entry has tool+args', [entries[0].tool, typeof entries[0].args], ['probe.run', 'string']);
eq('post entry has result+duration', [entries[1].result.ok, entries[1].result.durationMs], [false, 42]);
eq('post entry has session+agent', [entries[1].sessionId, entries[1].agentId], [sid, 'agent-x']);
eq('listSessions sees it', listSessions(repoRoot)[0].sessionId, sid);
const badSid = journalSanity();
function journalSanity() {
  observePostToolUse(repoRoot, { name: 't', arguments: {} }, { ok: true, durationMs: 1 }, { sessionId: 'a b/c?d', agentId: null });
  return fs.existsSync(path.join(repoRoot, '.jexi', 'learning', 'journal', 'a_b_c_d.jsonl'));
}
check('session id sanitized for filesystem', badSid);

/* ---------------- analyzer: five types ---------------- */
function mkEntry(turn, tool, args, ok, error, sessionId2 = 'zoo') {
  return {
    kind: 'tool_call', ts: '2026-09-17T10:00:00.000Z', phase: 'post', event: 'PostToolUse',
    turn, tool, args: JSON.stringify(args),
    result: ok ? { ok: true, durationMs: 5, error: null } : { ok: false, durationMs: 5, error },
    sessionId: sessionId2, agentId: 'zoo-agent',
  };
}
// error_resolution + debugging_techniques: read → fail → read → success
const zooEntries = [
  mkEntry(1, 'probe.read', { path: 'server/src/x.js' }, true),
  mkEntry(2, 'probe.run', { command: 'npm test' }, false, 'TypeError: undefined is not a function'),
  mkEntry(3, 'probe.read', { path: 'server/src/x.js' }, true),
  mkEntry(4, 'probe.run', { command: 'npm test' }, true),
];
const cands = extractFromJournal(zooEntries, { sessionId: 'zoo' });
const byType = Object.fromEntries(cands.map((c) => [c.type, c]));
check('error_resolution extracted', byType.error_resolution?.succeeded === true);
check('error_resolution evidence is fail→success triple', byType.error_resolution?.evidence?.length === 2 && byType.error_resolution.evidence[0].result.startsWith('error:'));
check('debugging_techniques extracted (read→hypothesis→run)', Boolean(byType.debugging_techniques));

// workarounds: same failure 2+ times, resolved by a DIFFERENT tool
const wCands = extractFromJournal([
  mkEntry(1, 'probe.run', { command: 'write /usr/lib/x' }, false, 'EACCES: permission denied'),
  mkEntry(2, 'probe.run', { command: 'write /usr/lib/x' }, false, 'EACCES: permission denied'),
  mkEntry(3, 'probe.write', { path: '/tmp/x' }, true),
], { sessionId: 'zoo' });
check('workarounds extracted (2+ fails, different tool)', wCands.some((c) => c.type === 'workarounds' && c.sightings === 2));

// project_specific: a path touched 3+ times
const pCands = extractFromJournal([
  mkEntry(1, 'probe.read', { path: 'server/src/kernel/hooks/runner.js' }, true),
  mkEntry(2, 'probe.read', { path: 'server/src/kernel/hooks/runner.js' }, true),
  mkEntry(3, 'probe.read', { path: 'server/src/kernel/hooks/runner.js' }, true),
], { sessionId: 'zoo' });
check('project_specific extracted (repeated file)', pCands.some((c) => c.type === 'project_specific'));

// user_corrections: conversation with a rephrase
const uCands = extractFromJournal([], {
  sessionId: 'zoo',
  conversation: [
    { turn: 1, role: 'user', text: 'start the dev server on port 3002' },
    { turn: 2, role: 'user', text: 'no — instead start the dev server inside tmux on port 3002' },
  ],
});
check('user_corrections extracted (rephrased request)', uCands.some((c) => c.type === 'user_corrections'));

// failed candidate recorded with outcome failed
const fCands = extractFromJournal([mkEntry(1, 'probe.run', { command: 'x' }, false, 'ECONNREFUSED: 127.0.0.1:9999')], { sessionId: 'zoo' });
check('unresolved failure recorded as failed outcome', fCands.length === 1 && fCands[0].succeeded === false);

// all five types are the contract types
check('extracted types ⊆ INSTINCT_TYPES', cands.concat(wCands, pCands, uCands, fCands).every((c) => INSTINCT_TYPES.includes(c.type)));

/* ---------------- analyzeSession: journal → store, once ---------------- */
const zsid = 'zoo-session';
for (const e of zooEntries) {
  observePostToolUse(repoRoot, { name: e.tool, arguments: JSON.parse(e.args) }, { ok: e.result.ok, durationMs: 5, error: e.result.error }, { sessionId: zsid, agentId: 'zoo-agent' });
}
const a1 = analyzeSession(repoRoot, zsid);
check('analyzeSession extracted instincts into store', a1.extracted.length >= 1 && listInstincts(pStore).instincts.some((i) => i.type === 'error_resolution'));
const a2 = analyzeSession(repoRoot, zsid);
eq('second analysis skipped (once per session)', a2.skipped, 'already analyzed');
check('wasAnalyzed reflects marker', wasAnalyzed(repoRoot, zsid) === true);

/* ---------------- promotion: project → global ---------------- */
const promoPattern = 'probe.deploy: recover from "ETIMEDOUT: registry"';
for (const s of ['promo-s1', 'promo-s2', 'promo-s3']) {
  recordCandidate(pStore, {
    pattern: promoPattern, type: 'error_resolution',
    evidence: [
      { turn: 1, tool: 'probe.deploy', result: 'error: ETIMEDOUT: registry', sessionId: s },
      { turn: 2, tool: 'probe.deploy', result: 'ok', sessionId: s },
    ],
    succeeded: true, sightings: 1,
  });
}
const { instincts: folded } = foldStore(pStore);
const promoInst = [...folded.values()].find((i) => i.pattern === promoPattern);
check('promo instinct folded from 3 sessions', promoInst && promoInst.sessionIds.length === 3);
check('promo instinct confidence ≥ 0.8', promoInst.confidence >= 0.8);
check('meetsPromotionCriteria true for it', meetsPromotionCriteria(promoInst) === true);
const gStore = globalStorePath();
const promo1 = promoteQualified(repoRoot);
eq('promotion moved exactly 1 instinct', promo1.promoted.length, 1);
eq('global snapshot has global scope', promo1.promoted[0].scope, 'global');
check('promotion event recorded in project store', readRecords(pStore).records.some((r) => r.kind === 'promotion' && r.to === 'global'));
check('global store contains the snapshot', listInstincts(gStore, { scope: 'global' }).instincts.some((i) => i.id === promoInst.id));
const promo2 = promoteQualified(repoRoot);
eq('re-promotion is a no-op (promoted flag)', promo2.promoted.length, 0);

/* ---------------- recall + INSTINCTS section ---------------- */
// NOTE: the promo instinct was promoted above, so it now recalls via the
// GLOBAL list (scope flipped) — project-side copy is flagged promoted.
const rec = recallForTask(repoRoot, 'help me recover from ETIMEDOUT registry deploy issue');
check('recall finds the instinct via global after promotion', rec.global.some((i) => i.pattern === promoPattern));
const recGlobal = recallForTask(repoRoot, 'totally unrelated cooking recipe');
check('global instincts always available in recall', recGlobal.global.length >= 1);
const section = await instinctsSection({ instruction: 'recover from ETIMEDOUT registry deploy' }, { repoRoot });
check('INSTINCTS section renders with header', section.startsWith('INSTINCTS:'));
check('section carries scoped tagged line', /\[global\|error_resolution\|/.test(section));
// empty PROJECT store (fresh root) → only the global line loads (scoped recall)
const emptySection = await instinctsSection({ instruction: 'anything' }, { repoRoot: path.join(tmp, 'empty-root') });
check('empty project store → only global instincts in section', emptySection.startsWith('INSTINCTS:') && !/\[project\|/.test(emptySection));

/* ---------------- context source registered (Phase 6C seam) ---------------- */
const { listSources } = await import('./src/context/sources/index.js');
check('context manager has instincts source', listSources().some((s) => s.name === 'instincts'));

/* ---------------- kernel seam loads the real subsystem ---------------- */
const { learningSeamStatus, runStopAnalysis } = await import('./src/kernel/hooks/learning-seam.js');
eq('seam loaded real learning/', learningSeamStatus().loaded, true);
eq('Stop analysis on unknown session skips cleanly', runStopAnalysis({ sessionId: 'no-such-journal' }).skipped, 'empty journal');

/* ---------------- summary ---------------- */
console.log(`\nlearning: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
