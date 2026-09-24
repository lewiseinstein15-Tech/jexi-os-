/**
 * JEXI OS — PHASE 31 SCOPE 6 — live probe (P1–P6).
 *
 * P1 server boots with all 7 P30 targets initialized (Scope 1+3+5 lines intact)
 * P2 per-item end-to-end reachability with real call traces:
 *      P30.A  SessionStart fires (boot + new session); stubs vs wired count
 *      P30.B  skill allowedTools=[Read,Skill] attempts Bash -> refused at dispatch
 *      P30.C  subagent maxTurns=2 dispatches turn 3 -> refused (E_MAX_TURNS)
 *      P30.D  path-scoped rule injects on matching file; always rule at session start
 *      P30.E  isolation=worktree runs in a real worktree; main tree untouched
 *      P30.F  PermissionDenied after denial (retry once); PromptExpansion blocks
 *             command; PostToolBatch fires once per batch
 *      P30.G  selfEvolve.afterRun writes a Phase 14 decision (+ PROV-O)
 * P3 read-only proof: wired shipped modules diff EMPTY except named call sites;
 *    harness/parity/** diff EMPTY (Phase 30 primitives untouched)
 * P4 regression: Scope 1 (15) + Scope 3 (7) + Scope 5 (8) W31 lines present;
 *    /api/health 200
 * P5 zone check: git status --short only named call sites + scripts/phase31-*.mjs
 * P6 determinism: same boot twice -> identical W31 boot lines (normalized)
 */
import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'w31s6-probe-'));
const FAILS = [];
let n = 0;
function check(id, ok, detail) {
  n += 1;
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${id} — ${detail}`);
  if (!ok) FAILS.push(`${id}: ${detail}`);
}
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
async function health(port, timeoutMs = 90000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return { status: res.status, body: await res.text() };
    } catch { /* not up yet */ }
    await pause(700);
  }
  return null;
}
function bootServer(port, runtimeDir, dataDir) {
  const logFile = path.join(TMP, `boot-${port}.log`);
  const child = spawn(process.execPath, ['index.js'], {
    cwd: path.join(ROOT, 'server'),
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', JEXI_W31_RUNTIME: runtimeDir, DATA_DIR: dataDir },
    stdio: ['ignore', fs.openSync(logFile, 'a'), fs.openSync(logFile, 'a')],
  });
  return { child, logFile };
}
const w31Lines = (file) => fs.readFileSync(file, 'utf8').split('\n').filter((l) => l.startsWith('W31 '));
const normalize = (s, runtimeDir, dataDir) => s.split(runtimeDir).join('<RUNTIME>').split(dataDir).join('<DATA>').replace(/boot-\d+/g, 'boot-<pid>');
const j = (v) => JSON.stringify(v);

/* ============ in-process wiring instance for P2 (probe-owned runtime) ====== */
const { initPhase31Wiring, wiring } = await import(path.join(ROOT, 'server/src/wiring/phase31-bootstrap.js'));
const RT = path.join(TMP, 'probe-runtime');
const DT = path.join(TMP, 'probe-data');
fs.mkdirSync(RT, { recursive: true });
fs.mkdirSync(DT, { recursive: true });
const boot = initPhase31Wiring({ sessionId: `boot-${process.pid}`, runtimeRoot: RT, brainRoot: path.join(RT, 'brain'), fleetDir: path.join(RT, 'fleet'), observersRoot: path.join(RT, 'instincts-observe'), vikingRoot: path.join(RT, 'viking') });
const isS6 = (l) => /W31 P30\./.test(l);
const isS5 = (l) => /W31 (W13|W14|W29|S4-N8N|S4-EXEC|S4-REPOCTX|W23c|W16)/.test(l);
const isS3 = (l) => /W31 (S3-|W23e|W23f|WA4:)/.test(l);
const s6Lines = boot.log.filter(isS6);
const s5Lines = boot.log.filter(isS5);
const s3Lines = boot.log.filter(isS3);
const s1Lines = boot.log.filter((l) => !isS3(l) && !isS5(l) && !isS6(l));
check('P2.probe-init', s1Lines.length === 15 && s3Lines.length === 7 && s5Lines.length === 8 && s6Lines.length === 7 && !boot.log.some((l) => l.includes('FAIL-SOFT')),
  `probe boot: ${s1Lines.length} S1 + ${s3Lines.length} S3 + ${s5Lines.length} S5 + ${s6Lines.length} S6 lines, 0 FAIL-SOFT`);
console.log(s6Lines.map((l) => `  ${l}`).join('\n'));

/* ================= P1 — server boots with all 7 P30 targets ================ */
console.log('\n== P1 server boots with all 7 P30 targets initialized ==');
const PORT1 = 5300 + (process.pid % 300) * 2;
const rt1 = path.join(TMP, 'boot1-runtime');
const dt1 = path.join(TMP, 'boot1-data');
const b1 = bootServer(PORT1, rt1, dt1);
const h1 = await health(PORT1);
check('P1.server-up', !!h1 && h1.status === 200, h1 ? `GET /api/health -> ${h1.status}` : 'health never came up (see boot log)');
let p1lines = w31Lines(b1.logFile);
for (let i = 0; i < 10 && p1lines.length === 0 && !b1.child.killed; i++) { await pause(600); p1lines = w31Lines(b1.logFile); }
const p1s6 = p1lines.filter(isS6);
console.log(p1s6.map((l) => `  ${l}`).join('\n'));
check('P1.all-7-targets', p1s6.length === 7 && !p1lines.some((l) => l.includes('FAIL-SOFT')),
  `${p1s6.length}/7 P30 boot lines on the live server, 0 FAIL-SOFT across all ${p1lines.length} W31 lines`);

/* ================= P2 — per-item end-to-end reachability =================== */
console.log('\n== P2 per-item reachability (end-to-end, consumer level) ==');

/* ---- P30.A: SessionStart fires; stub handlers registered; counts ---------- */
console.log('-- P30.A --');
const counts = wiring.hooks.counts();
const bootJournal = wiring.hooks.journal();
const sessionStartAtBoot = bootJournal.find((e) => e.event === 'SessionStart');
console.log('  boot journal[0]:', j(sessionStartAtBoot && { event: sessionStartAtBoot.event, stub: sessionStartAtBoot.stub, mappedHandlerCount: sessionStartAtBoot.mappedHandlerCount, receipts: sessionStartAtBoot.receipts }));
const newSession = wiring.hooks.emit('SessionStart', { source: 'probe-new-session', sessionId: 'w31-s6-session-2' });
console.log('  emit(SessionStart, new session) ->', j({ stub: newSession.stub, mapped: newSession.mappedHandlerCount, receipts: newSession.receipts }));
const stubFire = wiring.hooks.emit('SubagentStart', { agent_type: 'probe' });
console.log('  emit(SubagentStart) [stub] ->', j({ stub: stubFire.stub, receipts: stubFire.receipts }));
check('P2.P30.A', counts.catalog === 30 && counts.wired === 5 && counts.stubs === 25
  && !!sessionStartAtBoot && sessionStartAtBoot.mappedHandlerCount === 1
  && newSession.mappedHandlerCount === 1 && newSession.receipts.some((r) => r.wired && r.phase7Handlers.includes('session-start.restore-memory'))
  && stubFire.stub === true && stubFire.receipts.every((r) => r.stub === true),
  `catalog ${counts.catalog}, wired ${counts.wired} [${wiring.hooks.wiredEvents().join(', ')}], stubs ${counts.stubs}; SessionStart fired at boot + new session (Phase 7 mapping carried); stub event fires no-op`);

/* ---- P30.B: skill allowedTools enforcement at executor dispatch ----------- */
console.log('-- P30.B --');
const { makeExecutor } = await import(path.join(ROOT, 'server/src/tools/execution/executor.js'));
const { registerTool } = await import(path.join(ROOT, 'server/src/tools/registry/ToolRegistry.js'));
registerTool({ name: 'Read', description: 'scope 6 probe read', riskLevel: 'low', runtimeRing: 0, parameters: { type: 'object', properties: {} } });
registerTool({ name: 'Bash', description: 'scope 6 probe bash', riskLevel: 'low', runtimeRing: 0, parameters: { type: 'object', properties: {} } });
const SKILL = { name: 'w31-scoped-skill', allowedTools: ['Read', 'Skill'] };
const ex = makeExecutor({ engines: { Read: async () => 'read-ok', Bash: async () => 'bash-ok' }, permissions: { allowAll: true, maxRisk: 'critical' } });
const bDenied = await ex.execute({ id: 's6-b1', name: 'Bash', arguments: {} }, { skill: SKILL });
const bAllowed = await ex.execute({ id: 's6-b2', name: 'Read', arguments: {} }, { skill: SKILL });
const bPlain = await ex.execute({ id: 's6-b3', name: 'Bash', arguments: {} }, {});
console.log('  execute(Bash, ctx.skill{allowedTools:[Read,Skill]}) ->', j({ ok: bDenied.ok, error: bDenied.error?.message, code: bDenied.error?.code }));
console.log('  execute(Read, ctx.skill)  ->', j({ ok: bAllowed.ok, result: bAllowed.result }));
console.log('  execute(Bash, no skill)   ->', j({ ok: bPlain.ok, result: bPlain.result }));
check('P2.P30.B', bDenied.ok === false && bDenied.error?.originalError?.code === 'E_TOOL_NOT_ALLOWED'
  && bAllowed.ok === true && bPlain.ok === true,
  `skill-scoped Bash refused at dispatch (E_TOOL_NOT_ALLOWED preserved on the classified error via originalError); allowed tool executes; plain (skill-less) call unaffected`);

/* ---- P30.C: subagent contract fields enforced at dispatch ----------------- */
console.log('-- P30.C --');
const SUB = { id: 'w31-sub', name: 'Scope 6 Sub', division: 'engineering', role: 'worker', capabilities: ['code'], trustLevel: 'provisional', origin: 'probe', maxTurns: 2, allowedTools: ['Read', 'Skill'], permissionMode: 'default' };
let turn3Err = null;
try { wiring.subagent.dispatch(SUB, { turn: 3, tool: 'Read' }); } catch (e) { turn3Err = e; }
const turn2 = wiring.subagent.dispatch(SUB, { turn: 2, tool: 'Read' });
let toolErr = null;
try { wiring.subagent.dispatch(SUB, { turn: 1, tool: 'Bash' }); } catch (e) { toolErr = e; }
let planErr = null;
try { wiring.subagent.dispatch({ ...SUB, permissionMode: 'plan' }, { turn: 1, tool: 'Bash' }); } catch (e) { planErr = e; }
console.log('  dispatch(turn 3)  ->', j({ code: turn3Err?.code, message: turn3Err?.message }));
console.log('  dispatch(turn 2)  ->', j({ allowed: turn2.allowed }));
console.log('  dispatch(Bash)    ->', j({ code: toolErr?.code, message: toolErr?.message }));
console.log('  dispatch(Bash, plan mode) ->', j({ code: planErr?.code, message: planErr?.message }));
console.log('  dispatch journal  ->', j(wiring.subagent.journal()));
check('P2.P30.C', turn3Err?.code === 'E_MAX_TURNS' && turn2.allowed === true
  && toolErr?.code === 'E_TOOL_NOT_ALLOWED' && planErr?.code === 'E_TOOL_NOT_ALLOWED',
  `maxTurns=2: turn 3 refused (E_MAX_TURNS), turn 2 allowed; Bash outside allowedTools refused; write tool refused in permissionMode "plan"`);

/* ---- P30.D: path-scoped rules -> prompt assembly (context-source route) --- */
console.log('-- P30.D --');
const rulesRoot = path.join(RT, 'rules-project');
fs.mkdirSync(path.join(rulesRoot, '.claude', 'rules'), { recursive: true });
fs.writeFileSync(path.join(rulesRoot, 'AGENTS.md'), '# session rules\nAlways answer with evidence first.\n');
fs.writeFileSync(path.join(rulesRoot, '.claude', 'rules', 'api-guidelines.md'), '---\nalways: false\nglobs: ["docs/api/**"]\n---\nAPI handlers must validate input before I/O.\n');
wiring.rules.load(rulesRoot, {});
const sources = wiring.sources().map((s) => s.id || s.name || s);
const injAlways = wiring.rules.inject(null, {});
const injMatch = wiring.rules.inject('docs/api/v2/endpoints.md', {});
const injMiss = wiring.rules.inject('src/util/format.md', {});
console.log('  context sources include path-rules:', j(sources.includes('path-rules')));
console.log('  inject(null) [session start, always] ->', j({ rules: injAlways.rules.map((r) => `${r.source}:${r.path}`), tokens: injAlways.tokens }));
console.log('  inject(docs/api/…)   [matching]     ->', j({ rules: injMatch.rules.map((r) => `${r.source}:${r.path}`), tokens: injMatch.tokens }));
console.log('  inject(src/util/…)   [non-matching] ->', j({ rules: injMiss.rules.map((r) => `${r.source}:${r.path}`) }));
check('P2.P30.D', sources.includes('path-rules')
  && injAlways.rules.some((r) => r.source === 'phase25-agents')
  && injMatch.rules.some((r) => r.path === '.claude/rules/api-guidelines.md')
  && !injMiss.rules.some((r) => r.path === '.claude/rules/api-guidelines.md'),
  `always rule (Phase 25 AGENTS.md) injects at session start; path-scoped rule injects only on glob match via the B4 context-source route (section seam unconsumed — DISCLOSED)`);

/* ---- P30.E: worktree isolation on a fixture repo -------------------------- */
console.log('-- P30.E --');
const { execSync: exs } = await import('node:child_process');
const fixture = path.join(TMP, 'fixture-repo');
fs.mkdirSync(fixture, { recursive: true });
exs('git init -q -b main && git config user.email p@x.io && git config user.name probe && echo base > base.txt && git add -A && git commit -qm base', { cwd: fixture, stdio: 'pipe' });
const mainStatusBefore = exs('git status --porcelain', { cwd: fixture }).toString();
let sawCwd = null;
const iso = await wiring.worktree.dispatchIsolated(
  { ...SUB, id: 'w31-iso-sub', isolation: 'worktree' },
  {
    run: async ({ cwd, branch }) => {
      sawCwd = cwd;
      fs.writeFileSync(path.join(cwd, 'scratch.txt'), 'isolated work\n');
      const mainBase = fs.readFileSync(path.join(fixture, 'base.txt'), 'utf8');
      if (mainBase.trim() !== 'base') throw new Error('main tree mutated during isolated run');
      fs.unlinkSync(path.join(cwd, 'scratch.txt')); // leave clean for shipped safe-discard
      return `ran-in:${branch}`;
    },
    baseBranch: 'main', sessionId: 'w31-s6-iso', repoRoot: fixture,
  },
);
const mainStatusAfter = exs('git status --porcelain', { cwd: fixture }).toString();
console.log('  dispatchIsolated(isolation=worktree) ->', j({ isolated: iso.isolated, result: iso.result, worktree: iso.worktree && { branch: iso.worktree.branch, underTmpdir: iso.worktree.path.startsWith(os.tmpdir()) }, removed: iso.removed, removalError: iso.removalError }));
console.log('  run cwd was worktree:', j(!!sawCwd && sawCwd !== fixture && sawCwd.startsWith(path.join(fixture, '..')) === false));
console.log('  main tree status before/after:', j({ before: mainStatusBefore, after: mainStatusAfter }), 'worktree dir gone:', !fs.existsSync(iso.worktree.path));
const passthrough = await wiring.worktree.dispatchIsolated({ ...SUB, id: 'w31-plain-sub' }, { run: async () => 'direct' });
console.log('  dispatchIsolated(no isolation) ->', j({ isolated: passthrough.isolated, result: passthrough.result }));
check('P2.P30.E', iso.isolated === true && iso.removed === true && iso.removalError === null
  && !!sawCwd && sawCwd !== fixture && !fs.existsSync(iso.worktree.path)
  && mainStatusBefore === '' && mainStatusAfter === ''
  && passthrough.isolated === false,
  `isolated spec ran inside a real shipped-manager worktree (fresh branch), scratch stayed out of the main tree, worktree + branch discarded cleanly; non-isolated spec passed through`);

/* ---- P30.F: PermissionDenied / UserPromptExpansion / PostToolBatch -------- */
console.log('-- P30.F --');
const approve = await import(path.join(ROOT, 'interfaces/ui/web/console/chat/approvals.js'));
const lifecycle = wiring.hooks.lifecycle();
lifecycle.permissionDenied.register(() => ({ retry: true }));
let denialErr = null;
try {
  const pending = approve.default.request('w31-turn-1', { action: 'run.probe' });
  approve.default.resolve(pending.approvalId, 'no');
  await pending;
} catch (e) { denialErr = e; }
console.log('  approvals denial ->', j({ code: denialErr?.code, action: denialErr?.action, approvalId: denialErr?.approvalId }));
console.log('  PermissionDenied fired after denial ->', j(denialErr?.permissionDecision && { retry: denialErr.permissionDecision.retry, retryCount: denialErr.permissionDecision.retryCount, hardDeny: denialErr.permissionDecision.hardDeny, handlerCalls: denialErr.permissionDecision.handlerCalls }));
const retryRuns = [];
const retryOnce = await lifecycle.permissionDenied.handle({ requestId: 'w31-retry-1', error: { code: 'E_APPROVAL_DENIED', approvalId: 'w31-none' } }, { retry: async () => { retryRuns.push(1); return 'retry-ran'; } });
const retryLimit = await lifecycle.permissionDenied.handle({ requestId: 'w31-retry-1', error: { code: 'E_APPROVAL_DENIED', approvalId: 'w31-none' } }, { retry: async () => 'again' });
console.log('  handle(requestId, {retry}) #1 ->', j({ retry: retryOnce.retry, retried: retryOnce.retried, retryFnCalls: retryRuns.length, retryResult: retryOnce.retryResult }));
console.log('  handle(requestId, {retry}) #2 ->', j({ retried: retryLimit.retried, hardDeny: retryLimit.hardDeny, reason: retryLimit.reason }));

const cmdreg = await import(path.join(ROOT, 'capabilities/commands/registry.js'));
cmdreg.register({ name: 'w31-probe-cmd', description: 'scope 6 expansion probe', category: 'debug', handler: async () => ({ ok: true }) });
const resolvedAllow = cmdreg.resolve('w31-probe-cmd');
lifecycle.promptExpansion.register(() => ({ block: true, reason: 'w31-probe-block' }));
const resolvedBlock = cmdreg.resolve('w31-probe-cmd');
lifecycle.promptExpansion.register(() => ({ block: false }));
console.log('  registry.resolve(allow handler)  ->', j({ resolved: !!resolvedAllow }));
console.log('  registry.resolve(block handler)  ->', j({ resolved: resolvedBlock === undefined }));
console.log('  expansion journal                ->', j(cmdreg.expansionJournal()));

const batch1 = await lifecycle.postToolBatch.run([async () => 'a', async () => 'b'], { batchId: 'w31-batch-1' });
const batch2 = await lifecycle.postToolBatch.run([async () => 'c'], { batchId: 'w31-batch-2' });
console.log('  PostToolBatch run #1 ->', j({ statuses: batch1.results.map((r) => r.status), hookResult: batch1.hookResult, eventCount: batch1.eventCount }));
console.log('  PostToolBatch run #2 ->', j({ statuses: batch2.results.map((r) => r.status), eventCount: batch2.eventCount, oncePerBatch: batch2.eventCount === batch1.eventCount + 1 }));
check('P2.P30.F', denialErr?.code === 'E_APPROVAL_DENIED' && denialErr.permissionDecision?.retry === true && denialErr.permissionDecision?.retryCount === 1
  && retryOnce.retried === true && retryRuns.length === 1
  && retryLimit.retried === false && retryLimit.hardDeny === true
  && resolvedAllow && resolvedBlock === undefined && cmdreg.expansionJournal().length === 1
  && batch1.eventCount === 1 && batch2.eventCount === 2,
  `PermissionDenied fired on the real approvals denial path (retry:true granted once, bounded retry enforced on repeat); blocking PromptExpansion verdict prevents the command via registry.resolve; PostToolBatch fired exactly once per batch`);

/* ---- P30.G: self-evolve afterRun -> Phase 14 decisions --------------------- */
console.log('-- P30.G --');
const seRoot = wiring.selfEvolve.root();
const skillDir = path.join(seRoot, 'w31-probe-skill');
fs.mkdirSync(skillDir, { recursive: true });
const v1 = '---\nname: w31-probe-skill\nowner: w31-agent\nversion: 1\nallowedTools: [Read]\n---\nprobe skill body v1\n';
const v2 = '---\nname: w31-probe-skill\nowner: w31-agent\nversion: 2\nallowedTools: [Read]\n---\nprobe skill body v2 (probe-declared evolution)\n';
fs.writeFileSync(path.join(skillDir, 'SKILL.md'), v1);
const noOwnership = wiring.selfEvolve.postRun({ id: 'w31-agent' }, { runId: 'w31-run-1', skillUpdates: [] });
const evolved = wiring.selfEvolve.postRun({ id: 'w31-agent', skills: ['w31-probe-skill'] }, { runId: 'w31-run-1', skillUpdates: [{ skillId: 'w31-probe-skill', reason: 'scope 6 probe evolution', content: v2 }] });
const auditEntries = evolved.fired ? wiring.selfEvolve.audit('w31-agent') : [];
const after = fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8');
console.log('  postRun(no ownership)     ->', j(noOwnership));
console.log('  postRun(skills declared)  ->', j({ fired: evolved.fired, decisionIds: evolved.decisionIds, refused: evolved.refused }));
console.log('  skill file after run      ->', j({ version: /version: 2/.test(after), bytesChanged: after !== v1 }));
console.log('  Phase 14 decision record  ->', j(auditEntries[0] && { subject: auditEntries[0].decision.subject, by: auditEntries[0].decision.by, hasProvenance: !!auditEntries[0].provenance, provType: auditEntries[0].provenance?.['@type'] ?? auditEntries[0].provenance?.type ?? 'present' }));
check('P2.P30.G', noOwnership.fired === false && evolved.fired === true && evolved.decisionIds.length === 1
  && /version: 2/.test(after) && auditEntries.length === 1
  && auditEntries[0].decision.subject === 'self-evolve:w31-agent:w31-probe-skill' && !!auditEntries[0].provenance,
  `post-run callback gated on declared skill ownership; afterRun evolved the owned skill v1->v2 and recorded a Phase 14 decision with PROV-O provenance under the boot-scoped root`);

/* ================= P4 — regression: scopes 1+3+5 still green =============== */
console.log('\n== P4 regression: Phase 31 scopes 1, 3, 5 still green ==');
check('P4.live-scope-lines', p1lines.filter(isS5).length === 8 && p1lines.filter(isS3).length === 7
  && p1lines.filter((l) => !isS3(l) && !isS5(l) && !isS6(l)).length === 15
  && !p1lines.some((l) => l.includes('FAIL-SOFT')),
  `live server: 15 S1 + 7 S3 + 8 S5 lines intact (${p1lines.length} W31 lines total incl. 7 new P30), 0 FAIL-SOFT`);
const h1b = await health(PORT1, 5000);
check('P4.health-200', !!h1b && h1b.status === 200, `GET /api/health -> ${h1b && h1b.status}`);

/* ================= P3 — read-only proof ==================================== */
console.log('\n== P3 read-only proof: wired shipped modules diff EMPTY except named call sites ==');
const dirty = execSync('git diff --name-only', { cwd: ROOT }).toString().split('\n').filter(Boolean).sort();
const parityDirty = execSync('git diff --name-only -- harness/parity', { cwd: ROOT }).toString().split('\n').filter(Boolean);
console.log(dirty.map((l) => `  M ${l}`).join('\n') || '  (no dirty tracked files)');
const NAMED = ['server/src/tools/execution/executor.js', 'interfaces/ui/web/console/chat/approvals.js', 'capabilities/commands/registry.js', 'server/src/wiring/phase31-bootstrap.js'];
const nonNamedDirty = dirty.filter((f) => !NAMED.includes(f));
console.log('  harness/parity diff:', parityDirty.length === 0 ? 'EMPTY' : j(parityDirty));
check('P3.parity-untouched', parityDirty.length === 0, 'harness/parity/** diff EMPTY (Phase 30 primitives READ-ONLY, zero edits)');
check('P3.named-only', nonNamedDirty.length === 0, `tracked diffs only the 4 named call sites (${j(NAMED)}); unexpected: ${j(nonNamedDirty)}`);

/* ================= P5 — zone check ========================================= */
console.log('\n== P5 zone check: git status --short ⊆ named call sites + scripts/phase31-*.mjs ==');
const statusOut = execSync('git status --short', { cwd: ROOT }).toString().split('\n').filter(Boolean).sort();
console.log(statusOut.map((l) => `  ${l}`).join('\n'));
const ALLOWED = [
  ...NAMED,
  'server/src/wiring/phase31-hooks.js',
  'server/src/wiring/phase31-subagent.js',
  'server/src/wiring/phase31-worktree.js',
  'server/src/wiring/phase31-self-evolve.js',
];
const zoneViolations = statusOut.filter((line) => {
  const file = line.slice(3).trim().replace(/^(.*) -> .*$/, '$1');
  if (ALLOWED.includes(file)) return false;
  if (/^scripts\/phase31-[\w.-]*\.mjs$/.test(file)) return false;
  return true;
});
check('P5.zone-clean', zoneViolations.length === 0, `${statusOut.length} entries, all named call sites / new wiring files / scripts/phase31-*.mjs; violations: ${j(zoneViolations)}`);

/* ================= P6 — determinism ======================================== */
console.log('\n== P6 determinism: same boot twice -> identical W31 boot lines ==');
const PORT2 = PORT1 + 1;
const rt2 = path.join(TMP, 'boot2-runtime');
const dt2 = path.join(TMP, 'boot2-data');
const b2 = bootServer(PORT2, rt2, dt2);
await health(PORT2);
let lines2 = w31Lines(b2.logFile);
for (let i = 0; i < 10 && lines2.length === 0 && !b2.child.killed; i++) { await pause(600); lines2 = w31Lines(b2.logFile); }
const norm1 = p1lines.map((l) => normalize(l, rt1, dt1));
const norm2 = lines2.map((l) => normalize(l, rt2, dt2));
console.log(`  boot1: ${norm1.length} W31 lines / boot2: ${norm2.length} W31 lines`);
let firstDiff = -1;
for (let i = 0; i < Math.max(norm1.length, norm2.length); i++) {
  if (norm1[i] !== norm2[i]) { firstDiff = i; break; }
}
check('P6.identical', norm1.length === norm2.length && firstDiff === -1,
  firstDiff === -1 ? `${norm1.length} W31 boot lines byte-identical after path/pid normalization` : `first difference at line ${firstDiff}: ${j(norm1[firstDiff])} vs ${j(norm2[firstDiff])}`);

/* ================= summary ================================================= */
console.log(`\n== SUMMARY: ${n - FAILS.length}/${n} PASS ==`);
if (FAILS.length) { console.log('FAILURES:'); for (const f of FAILS) console.log(`  - ${f}`); }
for (const [label, child] of [['boot1', b1], ['boot2', b2]]) {
  try { child.child.kill('SIGTERM'); } catch { /* already gone */ }
}
process.exit(FAILS.length ? 1 : 0);
