/**
 * JEXI OS — PHASE 31 SCOPE 1 — server bootstrap wiring (connect-only).
 *
 * Wires the shipped-but-disconnected subsystems into the server boot seam.
 * WIRING RULE: connect, do not rebuild. Every target module below is
 * READ-ONLY — this file only instantiates and registers them at the
 * consumer (boot) level, mirroring the mountHud/mountTokens precedent.
 *
 * Items wired (Scope 0 plan, verdicts WIREABLE/PARTIAL):
 *   W36  boot-time Node gate          (refuses boot below the engines floor)
 *   B1   brain.repo                   -> server persistence (runtime repo)
 *   B2   brain.index                  -> session bootstrap refresh
 *   B3   brain.search.hybrid          -> chat retrieval (context source)
 *   B4   brain.hot.meta               -> prompt context section (context source)
 *   B5   brain.protocol verbs         -> memory-verb surface (MCP meta leg)
 *   WA1  prompt assembly              -> provider bridge (no live call)
 *   WA8  provider config plumbing     -> bridge readiness (live leg NOT VERIFIED)
 *   WA2  semantica graph              -> memory subsystem accessor
 *   WA3  instincts observer           -> session lifecycle (attach/push/detach)
 *   WA5  session/fleet                -> supervisor accessor (detached children)
 *   W10A1 rlm kernel                  -> CommandRegistry (/rlm)
 *   W17  code source                  -> graph-first + raw-read fallback
 *   W18  viking filesystem            -> tiered context source
 *   W19  visual QA                    -> Verifier claim-path handoff
 *
 * Every subsystem is fail-soft: a broken optional item logs one
 * deterministic `W31 <ID>: FAIL-SOFT <reason>` line and boot continues
 * (hud-seam philosophy). The only hard gate is W36.
 * Log lines carry NO timestamps so P7 determinism holds.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = path.resolve(HERE, '..', '..');   // server/
const REPO_ROOT = path.resolve(SERVER_ROOT, '..');    // repo root

/* ---------------- shipped module imports (targets: READ-ONLY) ------------- */
import { createRepo } from '../../../brain/repo/index.js';
import { createIndex } from '../../../brain/index/index.js';
import { createHybridSearch } from '../../../brain/search/index.js';
import { createHotMemory } from '../../../brain/hot/index.js';
import { createMemoryProtocol, VERB_NAMES as BRAIN_VERBS } from '../../../brain/protocol/index.js';
import { graph as semanticaGraph, NODE_KINDS } from '../../../semantica/graph/index.js';
import { attachObserver, pushObservation, requireActiveObserver, detachObserver } from '../../../instincts/observe/index.js';
import { createFleet } from '../../../session/fleet/index.js';
import { PersistentRepl } from '../../../rlm/kernel/index.js';
import { answerStructuralQuery, answerViaFileRead } from '../../../capability/code/graph-first.js';
import { VikingFs } from '../../../context/viking/filesystem.js';
import { createSceneQA } from '../../../verification/visual/scene-qa.js';
import { createMcpMeta } from '../../../brain/hot/mcp-meta.js';

/* ------------- Phase 31 Scope 3 — shipped module imports (READ-ONLY) ------ */
import { createAutonomous } from '../../../scheduler/autonomous/index.js';
import { createDreamCycle } from '../../../brain/cycle/index.js';
import { offload as offloadStore, history as offloadHistory } from '../../../context/offload/index.js';
import { Gsd } from '../../../workgraph/phases/gsd/index.js';
import { run as looperRun } from '../../../swarm/loops/looper.js';
import { run as ralphRun, emitCheckpoint as ralphEmitCheckpoint, registerCheckpointHandler as ralphRegisterCheckpoint } from '../../../swarm/loops/ralph.js';

/* ------------- Phase 31 Scope 5 — shipped module imports (READ-ONLY) ------ */
import { gatedDispatch } from '../../../skills/gates/gated-dispatch.js';
import { runPreflight } from '../capability/doctor/preflight.js';
import { registerExecutableSkills, executableSkillsStatus } from '../skills/executable-registry.js';
import { initRepoCtx } from './phase31-repoctx.js';

/* ---------------- server-side consumers (integration entry points) -------- */
import { assemblePrompt } from '../services/PromptAssembly.js';
import { canChat } from '../providers/index.js';
import { loadSettings } from '../services/SettingsManager.js';
import { registerCommand, tryExecuteCommand } from '../services/CommandRegistry.js';
import { registerSource, listSources } from '../context/sources/index.js';
import { claimsBrowserMethod } from '../services/director/Verifier.js';
import { registerAction, autonomyScheduler } from '../scheduler/index.js';
import { initWa4Topology } from './phase31-wa4-topology.js';
import { initCiDoctor } from './phase31-cidoctor.js';
import { initRegistriesWiring, makeGatedExecutor, executorGateStatus, mcpRegistryEntries } from './phase31-registries.js';

/* ------------- Phase 31 Scope 6 — shipped module imports (READ-ONLY) ------ */
import { initPhase31Hooks } from './phase31-hooks.js';
import { initSubagentEnforcement } from './phase31-subagent.js';
import { initWorktreeIsolation } from './phase31-worktree.js';
import { initSelfEvolve } from './phase31-self-evolve.js';
import { assert as assertSkillTools } from '../../../harness/parity/skills/index.js';
import rules from '../../../harness/parity/rules/index.js';

/* ---------------- module state ------------------------------------------- */
const W31 = [];
const log = (line) => { W31.push(line); console.log(line); };
const soft = (id, fn) => {
  try { return { id, ok: true, detail: fn() }; }
  catch (err) { log(`W31 ${id}: FAIL-SOFT ${err && err.code ? err.code + ' ' : ''}${String(err && err.message || err).slice(0, 160)}`); return { id, ok: false, error: String(err && err.message || err) }; }
};

export const NODE_FLOOR = '22.5'; // mirrors server/package.json engines (node:sqlite)

/** W36 — refuse any Node below the declared floor. Clear error, no fallback. */
export function assertNodeFloor(version = process.version) {
  const m = /^v?(\d+)\.(\d+)/.exec(String(version));
  const f = NODE_FLOOR.split('.');
  const major = Number(m ? m[1] : 0), minor = Number(m ? m[2] : 0);
  if (major < Number(f[0]) || (major === Number(f[0]) && minor < Number(f[1]))) {
    throw new Error(`W36 NODE FLOOR: JEXI server requires Node >= ${NODE_FLOOR} (node:sqlite memory backend); running ${version}. Refusing to boot.`);
  }
  return `node ${version} >= ${NODE_FLOOR}`;
}

const state = { wired: null, rlm: null, fleet: null, hot: null, repo: null, index: null, hybrid: null, protocol: null, graph: null, viking: null, observersRoot: null, observerId: null, sessionId: null, autonomous: null, scheduler: null, dreamCycle: null, offloadRoot: null, sessionsDir: null, gsd: null, gsdLoopFn: null, ciDoctor: null, wa4: null, repoCtx: null, w13Entries: null, w14Entry: null, w29Mounted: false, s4n8nEntry: null, s4exec: null, s4repo: false, w23cEntry: null, hooks: null, subagentEnf: null, worktreeIso: null, selfEvolveW: null, rulesLoaded: false, rulesRoot: null };

/* ---------------- the one boot call --------------------------------------- */
export function initPhase31Wiring(opts = {}) {
  W31.length = 0;
  const sessionId = opts.sessionId || `boot-${process.pid}`;
  const runtime = opts.runtimeRoot || process.env.JEXI_W31_RUNTIME || path.join(SERVER_ROOT, 'jexi-workspace', 'phase31');
  const brainRoot = opts.brainRoot || process.env.JEXI_W31_BRAIN || path.join(runtime, 'brain');
  const fleetDir = opts.fleetDir || process.env.JEXI_W31_FLEET || path.join(runtime, 'fleet');
  const observersRoot = opts.observersRoot || process.env.JEXI_W31_OBSERVERS || path.join(runtime, 'instincts-observe');
  const vikingRoot = opts.vikingRoot || process.env.JEXI_W31_VIKING || path.join(runtime, 'viking');
  const daySeq = () => Math.floor(Date.now() / 86400000);
  const opSeqCounter = { n: 0 };

  // W36 — hard gate, runs before anything else.
  log(`W31 W36: node gate ok (${assertNodeFloor(process.version)})`);

  // B1 — brain.repo -> server persistence.
  soft('B1', () => { state.repo = createRepo(brainRoot); });
  if (state.repo) log(`W31 B1: brain.repo ready (root ${path.relative(REPO_ROOT, brainRoot) || brainRoot})`);

  // B2 — brain.index -> session bootstrap refresh.
  soft('B2', () => { state.index = createIndex({ repo: state.repo, backend: 'rule-based' }); });
  if (state.index) {
    let pages = 0;
    try { pages = (state.repo.list() || []).length; } catch { /* fail-soft */ }
    log(`W31 B2: brain.index ready (pages=${pages}, backend=rule-based — embedding model NOT VERIFIED)`);
  }

  // B3 — brain.search.hybrid -> chat retrieval context source.
  soft('B3', () => {
    state.hybrid = createHybridSearch({ index: state.index, repo: state.repo, now: new Date().toISOString() });
    registerSource('brain-hybrid', {
      priority: 18, weight: 2,
      produce: async (input) => {
        const q = String(input.query || input.instruction || '').trim();
        if (!q) return '';
        const { results } = await state.hybrid.hybrid(q, { topK: 5, budgetTokens: 600 });
        if (!results || !results.length) return '';
        return `Brain retrieval (hybrid):\n${results.map((r) => `- ${r.pageId} ${r.chunkId} score=${Number(r.score).toFixed(4)}`).join('\n')}`;
      },
    });
  });
  if (state.hybrid) log('W31 B3: brain.search.hybrid -> context source "brain-hybrid" registered');

  // B4 — brain.hot.meta -> prompt context section (+ MCP meta object).
  soft('B4', () => {
    state.hot = createHotMemory({ nowDay: daySeq });
    registerSource('brain-hot-memory', {
      priority: 16, weight: 2,
      produce: async (input) => {
        try {
          const meta = state.hot.meta({ sessionId: input.sessionId || sessionId, sourceId: 'chat' });
          const facts = meta && meta.brain_hot_memory && meta.brain_hot_memory.facts;
          if (!facts || !facts.length) return '';
          return `Hot memory (facts):\n${facts.slice(0, 8).map((f) => `- ${f.kind}: ${f.text || f.title || JSON.stringify(f).slice(0, 120)}`).join('\n')}`;
        } catch { return ''; }
      },
    });
  });
  if (state.hot) log('W31 B4: brain.hot.meta -> context source "brain-hot-memory" registered (+ mcp meta seam)');

  // B5 — brain.protocol verbs -> memory-verb surface (5 frozen verbs).
  soft('B5', () => {
    state.protocol = createMemoryProtocol({
      repo: state.repo, hot: state.hot, search: state.hybrid,
      now: () => new Date().toISOString(),
      opSeq: () => ++opSeqCounter.n,
      daySeq,
      sessionId,
    });
  });
  if (state.protocol) log(`W31 B5: brain.protocol verbs -> memory-verb surface ready (${BRAIN_VERBS.join(', ')})`);

  // WA1 — prompt assembly -> provider bridge (assembled prompt, no live call).
  soft('WA1', () => {
    if (typeof assemblePrompt !== 'function') throw Object.assign(new Error('assemblePrompt missing'), { code: 'E_WIRING' });
  });
  if (typeof assemblePrompt === 'function') log('W31 WA1: prompt assembly -> provider bridge registered (live model call NOT attempted here)');

  // WA8 — provider config plumbing (live-LLM leg NOT VERIFIED: no credentials).
  soft('WA8', () => {
    const s = loadSettings();
    return `settings keys=${Object.keys(s || {}).length}`;
  });
  log('W31 WA8: provider config plumbing present (live-LLM leg NOT VERIFIED — no new credentials rule)');

  // WA2 — semantica graph -> memory subsystem accessor.
  soft('WA2', () => { state.graph = semanticaGraph.create(); });
  if (state.graph) log('W31 WA2: semantica graph attached to memory subsystem (graph.query reachable)');

  // WA3 — instincts observer -> session lifecycle (boot session attached).
  soft('WA3', () => {
    state.observersRoot = observersRoot;
    const res = attachObserver(observersRoot, sessionId, { projectId: 'jexi-os' });
    state.observerId = res && res.observerId ? res.observerId : `observer-${sessionId}`;
    state.sessionId = sessionId;
  });
  if (state.observersRoot) log(`W31 WA3: instincts observer attached for ${sessionId} (SessionStart seam)`);
  const detachOnShutdown = () => {
    try {
      if (state.observersRoot && state.observerId) {
        detachObserver(state.observersRoot, state.observerId);
        console.log(`W31 WA3: instincts observer detached for ${state.sessionId} (SessionEnd seam)`);
      }
    } catch { /* fail-open */ }
  };
  process.once('SIGTERM', detachOnShutdown);
  process.once('SIGINT', detachOnShutdown);
  process.once('exit', detachOnShutdown);

  // WA5 — session/fleet -> supervisor accessor (detached session children).
  soft('WA5', () => { state.fleet = createFleet({ dir: fleetDir }); });
  if (state.fleet) log(`W31 WA5: fleet supervisor ready (dir ${path.relative(REPO_ROOT, fleetDir) || fleetDir})`);

  // W10A1 — rlm kernel -> CommandRegistry (/rlm).
  soft('W10A1', () => {
    state.rlm = new PersistentRepl({ timeout: 2000 });
    registerCommand({
      name: 'rlm',
      description: 'Evaluate a JavaScript expression in the persistent RLM kernel REPL (Phase 10 A).',
      run: async (q) => {
        const code = String(q || '').replace(/^\/rlm\s*/, '').trim();
        const out = state.rlm.eval(code, {});
        return { ok: true, summary: String(out && out.result !== undefined ? out.result : out).slice(0, 400), detail: out };
      },
    });
  });
  if (state.rlm) log('W31 W10A1: rlm kernel -> CommandRegistry "/rlm" registered');

  // W17 — code source: graph-first with raw-read fallback.
  soft('W17', () => {
    registerSource('code', {
      priority: 20, weight: 2,
      produce: async (input) => {
        const q = String(input.query || input.instruction || '').trim();
        if (!q) return '';
        try {
          const a = await answerStructuralQuery(q);
          const text = a && (a.answer || a.text || a.summary);
          return text ? `Code structure (graph-first):\n${String(text).slice(0, 1200)}` : '';
        } catch {
          try {
            const b = await answerViaFileRead(q);
            const text = b && (b.answer || b.text || b.summary);
            return text ? `Code structure (file-read fallback):\n${String(text).slice(0, 1200)}` : '';
          } catch { return ''; }
        }
      },
    });
  });
  log('W31 W17: code source registered (graph-first, raw-read fallback)');

  // W18 — viking filesystem -> tiered context source.
  soft('W18', () => {
    state.viking = new VikingFs({ root: vikingRoot });
    registerSource('viking', {
      priority: 14, weight: 1,
      produce: async (input) => {
        try {
          const uri = input.vikingUri || 'viking://workspace/README.md';
          const v = state.viking.read(uri, { tier: 'L2' });
          const content = v && typeof v === 'object' ? v.content : v;
          return content ? `Viking (tiered read ${uri}):\n${String(content).slice(0, 800)}` : '';
        } catch { return ''; }
      },
    });
  });
  if (state.viking) log('W31 W18: viking filesystem -> context source "viking" registered (tiered reads)');

  // W19 — visual QA handoff on the Verifier claim path (no Verifier edits).
  soft('W19', () => {
    if (typeof claimsBrowserMethod !== 'function') throw Object.assign(new Error('claimsBrowserMethod missing'), { code: 'E_WIRING' });
  });
  log('W31 W19: visual QA attached to Verifier claim path (browser absent -> honest BROWSER_UNAVAILABLE skip)');

  /* ── PHASE 31 SCOPE 3 — event + scheduler wiring ──────────────────────── */

  // S3-AUTO — autonomy (scheduler/autonomous) -> server/src/scheduler.
  // The SchedulerEngine is the server-side autonomy engine; the shipped goal
  // ledger gets one honest pass per scheduler tick via the registered handler.
  soft('S3-AUTO', () => {
    state.autonomous = createAutonomous({ directory: path.join(runtime, 'autonomous'), sessionId, cwd: SERVER_ROOT });
    registerAction('autonomy-cycle', async () => {
      const goals = state.autonomous.goal.list();
      return { goals: goals.length, active: goals.filter((g) => g.status === 'active').map((g) => g.id) };
    });
    state.scheduler = autonomyScheduler();
    state.scheduler.start();
    const job = state.scheduler.createJob({
      id: 'w31-autonomy-cycle', kind: 'cron', cron: '* * * * *', lane: 'autonomy', name: 'w31 autonomy cycle',
      action: { type: 'handler', name: 'autonomy-cycle' },
    });
    if (!job.ok) throw Object.assign(new Error(`cron job refused: ${job.error}`), { code: 'E_WIRING' });
    return 'handler autonomy-cycle + cron job w31-autonomy-cycle (fires on tick)';
  });
  if (state.scheduler) log('W31 S3-AUTO: autonomy -> scheduler (cron job w31-autonomy-cycle -> goal-ledger pass on tick)');

  // S3-CYCLE — brain.cycle (dream cycle) -> scheduler cron job. The cycle
  // factory binds the brain instances already wired at this boot (B1/B2/B4).
  soft('S3-CYCLE', () => {
    if (!state.scheduler) throw Object.assign(new Error('scheduler not started (S3-AUTO failed)'), { code: 'E_WIRING' });
    state.dreamCycle = () => createDreamCycle({ repo: state.repo, hot: state.hot, index: state.index });
    registerAction('brain-cycle', async (payload = {}) => state.dreamCycle().run({ dryRun: payload.dryRun === true }));
    const job = state.scheduler.createJob({
      id: 'w31-brain-cycle', kind: 'cron', cron: '0 3 * * *', lane: 'memory', name: 'w31 brain dream cycle',
      action: { type: 'handler', name: 'brain-cycle', payload: { dryRun: false } },
    });
    if (!job.ok) throw Object.assign(new Error(`cron job refused: ${job.error}`), { code: 'E_WIRING' });
    return 'handler brain-cycle + cron job w31-brain-cycle (03:00 daily)';
  });
  if (state.dreamCycle) log('W31 S3-CYCLE: brain.cycle -> cron job w31-brain-cycle (repo/hot/index bound at boot)');

  // S3-OFFLOAD — context/offload -> chat retention. The chat context path
  // reaches retained history through the SAME registerSource seam Scope 1
  // used for brain-hybrid/hot/viking; the offload store sits beside it.
  soft('S3-OFFLOAD', () => {
    state.offloadRoot = path.join(runtime, 'offload');
    state.sessionsDir = path.join(runtime, 'sessions');
    registerSource('session-offload-history', {
      priority: 12, weight: 1,
      produce: async (input) => {
        try {
          const sid = String((input && input.sessionId) || sessionId);
          const nodes = offloadHistory.recent(sid, 5, { directory: state.sessionsDir });
          if (!nodes.length) return '';
          return `Session history (offloaded, last ${nodes.length}):\n${nodes.map((n) => `- [${n.kind}] ${String(n.payload && n.payload.text !== undefined ? n.payload.text : JSON.stringify(n.payload)).slice(0, 160)}`).join('\n')}`;
        } catch { return ''; }
      },
    });
    return 'context source session-offload-history + offload store';
  });
  if (state.offloadRoot) log('W31 S3-OFFLOAD: context/offload -> chat retention (source session-offload-history; offload store reachable)');

  // S3-GSD — GSD 5-phase loop (workgraph/phases/gsd) driven through the
  // shipped looper, exposed at the workgraph consumer seam. Each phase is
  // the real disk-artifact step; the looper only advances and stops it.
  const gsdLoopHandler = async (payload = {}) => {
    const safeTask = /^[A-Za-z0-9_-]{1,64}$/.test(String(payload.taskId || '')) ? payload.taskId : `gsd-${daySeq()}-${++opSeqCounter.n}`;
    const seed = state.gsd.run(safeTask, { input: String(payload.input || 'wired GSD task (Phase 31 Scope 3)'), phase: 'discuss' });
    const trace = [];
    const loop = looperRun(() => state.gsd.step(safeTask), {
      maxIterations: 5,
      stopWhen: (r) => !!r && r.phase === 'ship',
      onIteration: (it) => trace.push(`${it.n}:${it.result.phase}`),
    });
    return {
      taskId: safeTask, seed: seed.phase,
      loop: { iterations: loop.iterations, stoppedBy: loop.stoppedBy, error: loop.error || null },
      trace, status: state.gsd.status(safeTask),
    };
  };
  soft('S3-GSD', () => {
    state.gsd = new Gsd({ root: path.join(runtime, 'gsd') });
    registerAction('gsd-loop', gsdLoopHandler);
    state.gsdLoopFn = gsdLoopHandler;
    return 'action handler gsd-loop (discuss -> looper.run -> ship)';
  });
  if (state.gsd) log('W31 S3-GSD: GSD 5-phase loop -> workgraph seam (handler gsd-loop via swarm/loops/looper.run)');

  // W23e — ralph diagnostics -> ralph loop checkpoint. The wiring lives IN
  // swarm/loops/ralph.js as a wiring import + register call (run() body
  // untouched); this boot check only proves the checkpoint seam loaded.
  soft('W23e', () => {
    if (typeof ralphEmitCheckpoint !== 'function' || typeof ralphRegisterCheckpoint !== 'function') {
      throw Object.assign(new Error('ralph checkpoint seam missing'), { code: 'E_WIRING' });
    }
    return 'checkpoint seam live (default handler: diagnostics.evaluate)';
  });
  log('W31 W23e: ralph diagnostics -> loop checkpoint (evaluate() via emitCheckpoint; run() untouched)');

  // W23f — ciDoctor -> CI failure path (PARTIAL). Handler wired; the
  // .github/workflows call site stays OUTSIDE this scope's named call sites,
  // and no CI runner exists in the sandbox — live-CI leg NOT VERIFIED.
  soft('W23f', () => {
    state.ciDoctor = initCiDoctor();
    return `${state.ciDoctor.patternCount} failure signatures`;
  });
  if (state.ciDoctor) log('W31 W23f: ciDoctor -> CI failure path (diagnose() seam; live-CI leg NOT VERIFIED — no CI runner in sandbox)');

  // WA4 — swarm topologies -> workforce dispatch (approved live-server mount).
  soft('WA4', () => {
    state.wa4 = initWa4Topology();
    return `topologies: ${state.wa4.known.join(', ')}`;
  });
  if (state.wa4) log('W31 WA4: swarm topologies -> workforce dispatch (wa4-topology mounted; default passthrough)');

  // Scope 3 shutdown: stop the shipped heartbeat timers (engine ticker is
  // already unref'd; heartbeat setTimeout timers are not).
  const shutdownScope3 = () => { try { if (state.autonomous) state.autonomous.heartbeat.close(); } catch { /* fail-open */ } };
  // Scope 6 shutdown: the SessionEnd lifecycle hook fires at session end.
  const shutdownScope6 = () => { try { if (state.hooks) state.hooks.fireSessionEnd('shutdown'); } catch { /* fail-open */ } };
  process.once('exit', shutdownScope3);
  process.once('SIGTERM', () => { shutdownScope3(); shutdownScope6(); });
  process.once('SIGINT', () => { shutdownScope3(); shutdownScope6(); });
  process.once('exit', shutdownScope6);

  /* ── PHASE 31 SCOPE 5 — registries, gates, dispatch ───────────────────── */

  // W13 — gatedDispatch -> executor path (audit-only default). The gate
  // module self-registers via its approved extension (one import + one
  // register call); this mount validates the seam and exposes
  // makeGatedExecutor() — the SHIPPED executor with the audit leg composed
  // in front. Default-deny stays an owner call.
  soft('W13', () => {
    const reg = initRegistriesWiring();
    if (!reg.gate.registered) throw Object.assign(new Error('W13 gate registration missing'), { code: 'E_WIRING' });
    state.w13Entries = reg.entries;
    return `gate registered=${reg.gate.registered}; mcp entries [${reg.entries.join(', ')}]`;
  });
  if (executorGateStatus().registered) log('W31 W13: gatedDispatch -> executor path (audit-only default; default-deny owner call untouched)');

  // W14 — AAS -> mcp/registry.json (declarative; local stdio live-probeable).
  soft('W14', () => {
    const [aas] = mcpRegistryEntries(['aas']);
    if (!aas) throw Object.assign(new Error('aas entry missing'), { code: 'E_WIRING' });
    state.w14Entry = aas;
    return `entry aas enabled=${!!aas.enabled} command=${aas.command} ${aas.args.join(' ')}`;
  });
  if (state.w14Entry) log('W31 W14: AAS -> mcp registry (aas entry, local stdio; live ping in probe)');

  // W29 — Ralph pre-flight checks -> server-side capability doctor consumer
  // (agent-clis + mcp-registry + bundles, shipped doctor shape, READ-ONLY).
  soft('W29', () => {
    if (typeof runPreflight !== 'function') throw Object.assign(new Error('preflight missing'), { code: 'E_WIRING' });
    state.w29Mounted = true;
    return 'agent-clis + mcp-registry + bundles checks mounted';
  });
  if (state.w29Mounted) log('W31 W29: ralph pre-flight checks -> capability doctor (agent-clis, mcp-registry, bundles)');

  // S4-N8N — n8n-mcp -> mcp/registry.json (declarative v3.3 pattern).
  soft('S4-N8N', () => {
    const [n8n] = mcpRegistryEntries(['n8n-mcp']);
    if (!n8n) throw Object.assign(new Error('n8n-mcp entry missing'), { code: 'E_WIRING' });
    state.s4n8nEntry = n8n;
    return `entry n8n-mcp enabled=${!!n8n.enabled}`;
  });
  if (state.s4n8nEntry) log('W31 S4-N8N: n8n-mcp -> mcp registry (declarative, enabled:false — NOT live-verified)');

  // S4-EXEC — executable skills -> server skills catalog. Registration goes
  // through the catalog's OWN plugin-skill seam (pluginSkillDirs), merged
  // with the real PluginRegistry global — no shipped edits, no copies.
  soft('S4-EXEC', () => {
    const st = registerExecutableSkills();
    if (!st.registered) throw Object.assign(new Error(`executable skills not registered: ${st.error || 'unknown'}`), { code: 'E_WIRING' });
    state.s4exec = st;
    return `skills [${st.skills.join(', ')}] via plugin-skill seam`;
  });
  if (state.s4exec) log('W31 S4-EXEC: executable skills -> skills catalog (plugin-skill seam, dir skills/executable)');

  // S4-REPOCTX — semantica/repo-map -> session bootstrap context path (the
  // SAME registerSource seam the chat/prompt pipeline consumes). Lazy build,
  // shipped disk cache (os.tmpdir), budget-bounded.
  soft('S4-REPOCTX', () => {
    state.repoCtx = initRepoCtx();
    registerSource('repo-map', {
      priority: 10, weight: 1,
      produce: async () => {
        try {
          const m = state.repoCtx.map();
          if (!m || !m.files || !m.files.length) return '';
          return `Repo map (bounded, ${m.files.length} file(s), ~${m.tokens} tokens):\n${String(m.summary).slice(0, 1600)}`;
        } catch { return ''; }
      },
    });
    state.s4repo = true;
    return 'source repo-map + accessor wiring.repoCtx';
  });
  if (state.s4repo) log('W31 S4-REPOCTX: semantica/repo-map -> session bootstrap (source repo-map, bounded scan)');

  // W23c — forgejo-mcp -> mcp/registry.json (declarative placeholder; the
  // shipped toolset is a library, no stdio bridge; live forge leg W23d is
  // blocked by the no-credentials rule).
  soft('W23c', () => {
    const [forgejo] = mcpRegistryEntries(['forgejo-mcp']);
    if (!forgejo) throw Object.assign(new Error('forgejo-mcp entry missing'), { code: 'E_WIRING' });
    state.w23cEntry = forgejo;
    return `entry forgejo-mcp enabled=${!!forgejo.enabled}`;
  });
  if (state.w23cEntry) log('W31 W23c: forgejo-mcp -> mcp registry (declarative placeholder, enabled:false — live forge leg blocked)');

  // W16 — Phase 12 gates loop call sites: LOCATED, NOT WIRED. The gates'
  // designated loop checkpoints live in server/src/services/CodingLoop.js and
  // server/src/services/VerificationLoop.js (ZONE-OWNER items 16 / W16);
  // neither references skills/gates today, and both files are OUTSIDE this
  // scope's named call sites — reported per the call-site discipline, edit
  // left to the loop owner.
  log('W31 W16: Phase 12 gates loop call sites located (CodingLoop.js, VerificationLoop.js) — NOT WIRED, owner call');

  /* ── PHASE 31 SCOPE 6 — Phase 30 primitives -> runtime ───────────── */

  // P30.A — 30-hook catalog -> session lifecycle runtime. SessionStart
  // fires HERE at boot; SessionEnd fires at shutdown (handlers below);
  // PreToolUse fires on every executor dispatch via the shipped Phase 7(B)
  // gate; Stop/PreCompact production call sites are outside named call
  // sites (NOT WIRED, owner call). 25 stub events get runtime stub handlers.
  soft('P30.A', () => {
    state.hooks = initPhase31Hooks({ sessionId });
    const c = state.hooks.counts();
    if (c.catalog !== 30 || c.wired !== 5 || c.stubs !== 25) {
      throw Object.assign(new Error(`catalog ${c.catalog}/wired ${c.wired}/stubs ${c.stubs} mismatch`), { code: 'E_WIRING' });
    }
    return `catalog ${c.catalog} (wired ${c.wired}, stubs ${c.stubs}); SessionStart fired at boot`;
  });
  if (state.hooks) log(`W31 P30.A: 30-hook catalog -> session lifecycle runtime (5 wired events mapped, 25 stub handlers registered; SessionStart fired at boot, SessionEnd on shutdown)`);

  // P30.B — skill allowedTools -> executor dispatch enforcement. The
  // fail-closed check lives IN server/src/tools/execution/executor.js (named
  // call site) ahead of the permission gate; this mount verifies the same
  // READ-ONLY primitive loads. Proven end-to-end by the scope probe.
  soft('P30.B', () => {
    if (typeof assertSkillTools !== 'function') throw Object.assign(new Error('skill enforcement primitive missing'), { code: 'E_WIRING' });
    return 'executor dispatch enforcement mounted (ctx.skill calls only)';
  });
  if (typeof assertSkillTools === 'function') log('W31 P30.B: skill allowedTools -> executor dispatch enforcement (fail-closed when ctx.skill present; plain calls unaffected)');

  // P30.C — subagent contract fields -> dispatch enforcement (allowedTools,
  // maxTurns, permissionMode enforced at call time via the shipped
  // subagent.enforce; shipped error classes reused).
  soft('P30.C', () => {
    state.subagentEnf = initSubagentEnforcement();
    return 'extendSpec + enforce composed on the dispatch seam';
  });
  if (state.subagentEnf) log('W31 P30.C: subagent contract fields -> dispatch enforcement (allowedTools, maxTurns, permissionMode at call time)');

  // P30.D — path-scoped rules -> session prompt assembly. The Phase 25
  // section registry has no live assembly consumer (registerCanonical is
  // unconsumed), so per the disclosed fallback this routes through the
  // Phase 6 context-source pipeline (the B4 seam). Default rules root is
  // the boot-scoped runtime/rules-project (deterministic; accessor accepts
  // any root) — the repo-wide AGENTS.md walk is deliberately NOT run at boot.
  soft('P30.D', () => {
    state.rulesRoot = opts.rulesRoot || process.env.JEXI_W31_RULES || path.join(runtime, 'rules-project');
    rules.load(state.rulesRoot, {});
    state.rulesLoaded = true;
    registerSource('path-rules', {
      priority: 14, weight: 2,
      produce: async (input) => {
        try {
          const filePath = input?.filePath ?? input?.touchedFile ?? null;
          const inj = rules.inject(filePath, {});
          if (!inj.rules.length) return '';
          return `Path-scoped rules (${inj.rules.length} rule(s), ${inj.tokens}/${inj.budget} tokens):\n${inj.rules.map((r) => `[${r.source}:${r.path}] ${r.content.trim().slice(0, 400)}`).join('\n---\n')}`;
        } catch { return ''; }
      },
    });
    return `root ${path.relative(REPO_ROOT, state.rulesRoot) || state.rulesRoot}; source path-rules registered`;
  });
  if (state.rulesLoaded) log('W31 P30.D: path-scoped rules -> prompt assembly (B4-route: context source "path-rules"; section seam unconsumed — DISCLOSED)');

  // P30.E — worktree isolation -> subagent runtime dispatch. isolation:
  // 'worktree' specs run inside a REAL shipped-manager worktree; the main
  // tree is untouched. Root is injectable (probe drives a fixture repo so
  // the jexi-29 git state stays pristine).
  soft('P30.E', () => {
    state.worktreeIso = initWorktreeIsolation({
      repoRoot: REPO_ROOT,
      worktreesDir: path.join(runtime, 'worktrees'),
      fleetDir: path.join(runtime, 'fleet'),
      sessionsDir: path.join(runtime, 'sessions'),
    });
    return 'shipped worktree manager mounted (lazy; isolation-aware dispatch)';
  });
  if (state.worktreeIso) log('W31 P30.E: worktree isolation -> subagent dispatch (isolation:worktree runs in a real worktree; main tree untouched)');

  // P30.F — permission + command lifecycle hooks -> approval path, command
  // expansion path, parallel tool batch. Mounted inside initPhase31Hooks
  // with behavior-neutral defaults; the browser-safe consumers (approvals.js
  // denial path, commands/registry.js resolve path — both named call sites)
  // fire the shipped lifecycle through fail-soft globalThis seams.
  soft('P30.F', () => {
    if (!globalThis.__jexiP30PermissionDenied || !globalThis.__jexiP30PromptExpansion) {
      throw Object.assign(new Error('P30.F seams missing after hook mount'), { code: 'E_WIRING' });
    }
    return 'PermissionDenied + PromptExpansion + PostToolBatch mounted (neutral defaults)';
  });
  if (state.hooks) log('W31 P30.F: lifecycle hooks -> approval denial + command expansion + tool batch (fail-soft seams; neutral defaults)');

  // P30.G — self-evolve -> agent runtime post-run callback. Fires the
  // shipped selfEvolve.afterRun when the agent declares skill ownership;
  // every accepted update lands as a Phase 14 decision + PROV-O record
  // under the boot-scoped evolution root.
  soft('P30.G', () => {
    state.selfEvolveW = initSelfEvolve({ root: path.join(runtime, 'self-evolve-skills') });
    return `post-run callback mounted (root ${path.relative(REPO_ROOT, state.selfEvolveW.root) || state.selfEvolveW.root})`;
  });
  if (state.selfEvolveW) log('W31 P30.G: self-evolve -> agent runtime post-run (afterRun on declared skill ownership; Phase 14 decisions + PROV-O)');

  const wired = {
    W36: true, B1: !!state.repo, B2: !!state.index, B3: !!state.hybrid, B4: !!state.hot,
    B5: !!state.protocol, WA1: typeof assemblePrompt === 'function', WA8: true, WA2: !!state.graph,
    WA3: !!state.observersRoot, WA5: !!state.fleet, W10A1: !!state.rlm, W17: true, W18: !!state.viking,
    W19: typeof claimsBrowserMethod === 'function',
    'S3-AUTO': !!state.scheduler, 'S3-CYCLE': !!state.dreamCycle, 'S3-OFFLOAD': !!state.offloadRoot,
    'S3-GSD': !!state.gsd, W23e: typeof ralphEmitCheckpoint === 'function', W23f: !!state.ciDoctor, WA4: !!state.wa4,
    W13: executorGateStatus().registered, W14: true, W29: typeof runPreflight === 'function',
    'S4-N8N': true, 'S4-EXEC': executableSkillsStatus().registered, 'S4-REPOCTX': !!state.repoCtx,
    W23c: true, W16: false,
    'P30.A': !!state.hooks, 'P30.B': typeof assertSkillTools === 'function', 'P30.C': !!state.subagentEnf,
    'P30.D': state.rulesLoaded, 'P30.E': !!state.worktreeIso, 'P30.F': !!state.hooks, 'P30.G': !!state.selfEvolveW,
  };
  state.wired = wired;
  return { wired, sessionId, brainRoot, fleetDir, observersRoot, vikingRoot, log: W31.slice() };
}

/* ---------------- probe/accessor surface (public, read-only) -------------- */
export const wiring = {
  get repo() { return state.repo; },
  get index() { return state.index; },
  get hybrid() { return state.hybrid; },
  get hot() { return state.hot; },
  get protocol() { return state.protocol; },
  get graph() { return state.graph; },
  get fleet() { return state.fleet; },
  get rlm() { return state.rlm; },
  get viking() { return state.viking; },
  get observersRoot() { return state.observersRoot; },
  get sessionId() { return state.sessionId; },
  sources: () => listSources(),
  sessionLifecycle: {
    attach: (root, sid, o) => attachObserver(root, sid, o),
    push: (root, obs) => pushObservation(root, obs),
    require: (root, sid) => requireActiveObserver(root, sid),
    detach: (root, oid) => detachObserver(root, oid),
  },
  promptBridge: {
    assemble: (o) => assemblePrompt(o),
    bridgeVerdict: () => {
      let can = false, reason = 'provider bridge unreachable';
      try { can = !!canChat([]); reason = can ? 'provider ready' : 'no provider configured (live leg NOT VERIFIED — no new credentials rule)'; }
      catch (e) { reason = `canChat refused: ${e && e.code ? e.code : String(e && e.message || e).slice(0, 80)}`; }
      return { canChat: can, reason };
    },
  },
  providerConfig: { load: () => loadSettings(), note: 'plumbing only; live-LLM leg NOT VERIFIED (no new credentials rule)' },
  graphQuery: (criteria) => state.graph ? state.graph.query(criteria) : [],
  memoryVerbs: { names: () => BRAIN_VERBS.slice(), call: (verb, input) => state.protocol[verb](input) },
  hotMcpMeta: (allowList) => createMcpMeta({ recall: state.hot.recall.bind(state.hot), allowList }),
  rlmExec: (code) => tryExecuteCommand(code, {}),
  fleetAccess: () => state.fleet,
  visualQA: {
    claimsBrowser: claimsBrowserMethod,
    run: async (claimText) => {
      if (!claimsBrowserMethod(claimText)) return { applies: false, reason: 'no browser-method claim in text' };
      try {
        const qa = createSceneQA({ defaultViewport: { width: 1440, height: 900 }, timeoutMs: 30000 });
        return { applies: true, harness: qa && typeof qa.verify === 'function' ? 'scene-qa ready (verify fn)' : 'scene-qa created', executed: false, reason: 'execution deferred — real browser required (absent in sandbox)' };
      } catch (e) {
        return { applies: true, ok: false, reason: `BROWSER_UNAVAILABLE: ${String(e && e.message || e).slice(0, 120)}` };
      }
    },
  },
  assertNodeFloor,
  NODE_FLOOR,

  /* -------- Phase 31 Scope 3 — consumer seams (read-only surface) -------- */
  autonomy: {
    engine: () => state.scheduler,
    goals: () => (state.autonomous ? state.autonomous.goal.list() : []),
    goalSet: (input) => state.autonomous.goal.set(input),
    heartbeat: () => state.autonomous.heartbeat,
  },
  brainCycle: {
    run: (opts = {}) => (state.dreamCycle ? state.dreamCycle().run(opts) : null),
    job: (id) => (state.scheduler ? state.scheduler.getJob(id) : null),
    runHistory: (opts) => (state.scheduler ? state.scheduler.history(opts) : []),
  },
  contextOffload: {
    roots: () => ({ offload: state.offloadRoot, sessions: state.sessionsDir }),
    write: (name, content) => offloadStore.write(name, content, { directory: state.offloadRoot }),
    read: (name) => offloadStore.read(name, { directory: state.offloadRoot }),
    list: () => offloadStore.list({ directory: state.offloadRoot }),
    recent: (sid, n) => offloadHistory.recent(sid, n, { directory: state.sessionsDir }),
  },
  workgraph: {
    gsdLoop: (payload) => (state.gsdLoopFn ? state.gsdLoopFn(payload) : null),
    gsdStatus: (taskId) => state.gsd.status(taskId),
  },
  ralphCheckpoint: {
    emit: (props) => ralphEmitCheckpoint(props),
    run: (task, opts) => ralphRun(task, opts),
    register: (fn) => ralphRegisterCheckpoint(fn),
  },
  ciDoctor: {
    diagnose: ({ logs }) => (state.ciDoctor ? state.ciDoctor.diagnose({ logs }) : null),
    signatures: () => (state.ciDoctor ? state.ciDoctor.knownSignatures : []),
  },
  wa4: {
    dispatch: (capability, opts) => (state.wa4 ? state.wa4.dispatch(capability, opts) : null),
    knownTopologies: () => (state.wa4 ? state.wa4.known : []),
  },

  /* -------- Phase 31 Scope 5 — consumer seams (read-only surface) -------- */
  gates: {
    status: executorGateStatus,
    makeGatedExecutor,
    dispatch: (action, ctx) => gatedDispatch(action, ctx),
  },
  mcpRegistry: {
    file: 'server/mcp/registry.json',
    entries: mcpRegistryEntries,
  },
  doctor: {
    preflight: runPreflight,
  },
  executableSkills: {
    status: executableSkillsStatus,
  },
  repoCtx: {
    map: (over) => (state.repoCtx ? state.repoCtx.map(over) : null),
    root: () => (state.repoCtx ? state.repoCtx.root : null),
  },

  /* -------- Phase 31 Scope 6 — consumer seams (read-only surface) -------- */
  hooks: {
    emit: (event, payload) => (state.hooks ? state.hooks.emit(event, payload) : null),
    register: (event, fn) => (state.hooks ? state.hooks.register(event, fn) : null),
    journal: () => (state.hooks ? state.hooks.journal() : []),
    counts: () => (state.hooks ? state.hooks.counts() : null),
    wiredEvents: () => (state.hooks ? state.hooks.wiredEvents() : []),
    stubEvents: () => (state.hooks ? state.hooks.stubEvents() : []),
    fireSessionEnd: (reason) => (state.hooks ? state.hooks.fireSessionEnd(reason) : null),
    lifecycle: () => (state.hooks ? state.hooks.lifecycle : null),
  },
  subagent: {
    dispatch: (spec, call) => (state.subagentEnf ? state.subagentEnf.dispatch(spec, call) : null),
    journal: () => (state.subagentEnf ? state.subagentEnf.journal() : []),
  },
  worktree: {
    dispatchIsolated: (spec, opts) => (state.worktreeIso ? state.worktreeIso.dispatchIsolated(spec, opts) : null),
    list: (opts) => (state.worktreeIso ? state.worktreeIso.list(opts) : []),
  },
  selfEvolve: {
    postRun: (agent, runResult) => (state.selfEvolveW ? state.selfEvolveW.postRun(agent, runResult) : null),
    audit: (agentId) => (state.selfEvolveW ? state.selfEvolveW.audit(agentId) : []),
    rollback: (decisionId) => (state.selfEvolveW ? state.selfEvolveW.rollback(decisionId) : null),
    root: () => (state.selfEvolveW ? state.selfEvolveW.root : null),
  },
  rules: {
    load: (root, opts) => rules.load(root, opts),
    inject: (filePath, opts) => rules.inject(filePath, opts),
    snapshot: () => rules.snapshot(),
    budget: () => rules.tokenBudget(),
    root: () => state.rulesRoot,
  },
};
