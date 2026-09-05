/**
 * JEXI OS — EVALUATION TASK SUITE (AGI Phase 10, spec §46–§47).
 *
 * 6 categories × 10 tasks. Every task carries: the task, the expected
 * outcome, available tools (real registry slugs or none), constraints,
 * and success criteria as an executable deterministic check. Scores are
 * computed from REAL subsystem behavior — never fabricated. Keyless.
 *
 * Run: node evaluation/run.js   (from server/) — gates at 0.90.
 */

process.env.DATA_DIR = process.env.DATA_DIR || './data/evaluation-run';

const { structureObjective } = await import('../src/services/director/ObjectiveInterpreter.js');
const { discoverTools } = await import('../src/services/ToolDiscovery.js');
const { TOOL_REGISTRY } = await import('../src/services/ToolRegistry.js');
const { WorkGraph } = await import('../src/services/director/WorkGraph.js');
const { acceptanceGates, claimsBrowserMethod, executionEvidence } = await import('../src/services/director/Verifier.js');
const { recordLesson, retrieveLessons, formatLessonsBlock } = await import('../src/services/director/Lessons.js');
const { classifyProviderError, recordProviderCallFailure, skipForNow, providerState, __resetProviderHealth } = await import('../src/services/ProviderHealth.js');
const { TaskBudget } = await import('../src/services/RequestBudget.js');
const { cacheKey, cacheGet, cacheSet, __resetCache } = await import('../src/services/ResponseCache.js');
const { requestIdentity } = await import('../src/services/RequestDedup.js');
const { recordAction, recordReasoning, detectLoops, findCircularPlan, similarity, __resetLoops } = await import('../src/services/director/LoopDetector.js');
const { scorePlan, simulateAlternatives } = await import('../src/services/director/PlanSimulator.js');
const { validateSkill, promoteSkill, learnSkillFromLesson, usableSkills } = await import('../src/services/Skills.js');
const { entity, recordFact, entityView, __resetWorldModel } = await import('../src/services/director/WorldModel.js');
const { makeClaim, mergeClaims } = await import('../src/services/director/Epistemics.js');
const { parseModelJson } = await import('../src/services/director/JsonRepair.js');
const { parseBrowserLine } = await import('../src/services/director/ComputerOps.js');

const registrySlugs = () => new Set(TOOL_REGISTRY.map((t) => t.slug));

/* ═══ 1. SHORT TASKS — single deterministic operations ══════════════════ */

const short = [
  { id: 'S1', task: 'Repair this malformed JSON: {"a": 1, "b": [1, 2],}', expected: 'a repaired object', tools: [], constraints: 'no LLM', success: () => { const r = parseModelJson('{"a": 1, "b": [1, 2],}'); return r && typeof r === 'object' && r.a === 1; } },
  { id: 'S2', task: 'Classify a rate-limit error', expected: 'RATE_LIMITED, retryable', tools: [], constraints: 'deterministic', success: () => classifyProviderError('HTTP 429 Too Many Requests').kind === 'RATE_LIMITED' },
  { id: 'S3', task: 'Parse the browser action line "goto https://example.com"', expected: 'action=goto, target captured', tools: ['computer:goto'], constraints: 'no browser needed to parse', success: () => { const p = parseBrowserLine('goto https://example.com'); return p && p.action === 'goto'; } },
  { id: 'S4', task: 'An inference repeated 10× stays LIKELY', expected: 'never promoted to KNOWN', tools: [], constraints: 'epistemic rule', success: () => { let c = makeClaim({ key: 'k', value: 1, source: 'INFERRED' }); for (let i = 0; i < 10; i++) c = mergeClaims(c, makeClaim({ key: 'k', value: 1, source: 'INFERRED' })); return c.epistemic === 'LIKELY'; } },
  { id: 'S5', task: 'A 2-call budget refuses the 3rd call', expected: 'budget error with reason', tools: [], constraints: 'deterministic', success: () => { const b = new TaskBudget({ maxModelCalls: 2 }); b.consume(); b.consume(); return b.canSpend().ok === false && /model calls/.test(b.canSpend().why); } },
  { id: 'S6', task: 'An identical cacheable request hits the cache', expected: 'stored value returned, no new call', tools: [], constraints: 'opt-in cache', success: () => { __resetCache(); const k = cacheKey({ prompt: 'p', namespace: 'ev' }); cacheSet(k, 'v'); return cacheGet(k) && cacheGet(k).value === 'v'; } },
  { id: 'S7', task: 'Different requests get different dedup identities', expected: 'no accidental sharing', tools: [], constraints: 'deterministic', success: () => requestIdentity({ prompt: 'a', system: 's' }) !== requestIdentity({ prompt: 'b', system: 's' }) },
  { id: 'S8', task: 'A complete skill passes validation', expected: 'ok=true', tools: [], constraints: 'shape gate', success: () => validateSkill({ name: 'ev-skill', version: 1, description: 'd', procedure: ['step one happens', 'step two happens'], tools: ['native:web-search'], failureModes: ['x'], verification: 'v' }).ok },
  { id: 'S9', task: 'Record a fact about an entity in the world model', expected: 'typed entity with an observed fact', tools: [], constraints: 'epistemic stamp', success: () => { __resetWorldModel(); recordFact('api', 'weather-ev', { attribute: 'up', value: true, source: 'OBSERVED' }); return entityView('api', 'weather-ev').facts.up.epistemic === 'KNOWN'; } },
  { id: 'S10', task: 'Identical texts have similarity 1, unrelated ~0', expected: 'sane measure', tools: [], constraints: 'deterministic', success: () => similarity('same words here', 'same words here') === 1 && similarity('alpha beta gamma', 'delta epsilon zeta') === 0 },
];

/* ═══ 2. MULTI-STEP TASKS — work graph execution ════════════════════════ */

function graphTask(id, build, verify, desc) {
  return { id, task: desc, expected: 'correct dependency-ordered execution', tools: [], constraints: 'deterministic WorkGraph', success: () => { const g = new WorkGraph(`ev-${id}`); const ctx = build(g); return verify(g, ctx); } };
}
const multiStep = [
  graphTask('M1', (g) => { const a = g.addItem({ title: 'A', planIndex: 1, capability: 'research' }); const b = g.addItem({ title: 'B', planIndex: 2, capability: 'synthesis', dependsOn: [1] }); g.addRelation('BLOCKS', a.id, b.id); return { a, b }; }, (g, { a, b }) => !g.readyWork().some((i) => i.id === b.id) && g.readyWork().some((i) => i.id === a.id), 'linear chain: B waits for A'),
  graphTask('M2', (g) => { const a = g.addItem({ title: 'A', planIndex: 1, capability: 'x' }); return { a }; }, (g, { a }) => { g.claim(a.id, 'w1', 60000); return g.claim(a.id, 'w2', 60000) === null; }, 'a claimed item is exclusively leased'),
  graphTask('M3', (g) => { const a = g.addItem({ title: 'A', planIndex: 1, capability: 'x' }); const b = g.addItem({ title: 'B', planIndex: 2, capability: 'y', dependsOn: [1] }); g.addRelation('BLOCKS', a.id, b.id); return { a, b }; }, (g, { a, b }) => { g.complete(a.id, { ok: true }); return g.readyWork().some((i) => i.id === b.id); }, 'completing the blocker releases the dependent'),
  graphTask('M4', (g) => { const hi = g.addItem({ title: 'hi', planIndex: 1, capability: 'x', priority: 'high' }); const lo = g.addItem({ title: 'lo', planIndex: 2, capability: 'y', priority: 'normal' }); return { hi, lo }; }, (g, { hi, lo }) => g.readyWork().map((i) => i.id).join() === [hi.id, lo.id].join(), 'priority decides ready order'),
  graphTask('M5', (g) => { const a = g.addItem({ title: 'A', planIndex: 1, capability: 'x' }); const b = g.addItem({ title: 'B', planIndex: 2, capability: 'y' }); const c = g.addItem({ title: 'C', planIndex: 3, capability: 'z', dependsOn: [1, 2] }); g.addRelation('BLOCKS', a.id, c.id); g.addRelation('BLOCKS', b.id, c.id); return { a, b, c }; }, (g, { a, b, c }) => { g.complete(a.id, { ok: true }); if (g.readyWork().some((i) => i.id === c.id)) return false; g.complete(b.id, { ok: true }); return g.readyWork().some((i) => i.id === c.id); }, 'diamond: C waits for BOTH A and B'),
  graphTask('M6', (g) => { const a = g.addItem({ title: 'A', planIndex: 1, capability: 'x' }); return { a }; }, (g, { a }) => { g.claim(a.id, 'w', 60000); g.complete(a.id, { ok: true }); return !g.readyWork().some((i) => i.id === a.id); }, 'completed work is never re-offered'),
  graphTask('M7', (g) => { const a = g.addItem({ title: 'A', planIndex: 1, capability: 'x', priority: 'high' }); const b = g.addItem({ title: 'B', planIndex: 2, capability: 'y' }); const c = g.addItem({ title: 'C', planIndex: 3, capability: 'z' }); return { a, b, c }; }, (g, { a, b, c }) => { const order = g.readyWork().map((i) => i.id); return order[0] === a.id && order.length === 3; }, 'three independent items: priority first, all ready'),
  graphTask('M8', (g) => { const a = g.addItem({ title: 'A', planIndex: 1, capability: 'x' }); const b = g.addItem({ title: 'B', planIndex: 2, capability: 'y', dependsOn: [1] }); const c = g.addItem({ title: 'C', planIndex: 3, capability: 'z', dependsOn: [2] }); g.addRelation('BLOCKS', a.id, b.id); g.addRelation('BLOCKS', b.id, c.id); return { a, b, c }; }, (g, { a, b, c }) => { g.complete(a.id, { ok: true }); g.claim(b.id, 'w', 60000); return !g.readyWork().some((i) => i.id === c.id); }, 'a leased intermediate step still blocks the tail'),
  graphTask('M9', (g) => { const a = g.addItem({ title: 'A', planIndex: 1, capability: 'x' }); return { a }; }, (g, { a }) => { const before = g.readyWork().length; g.complete(a.id, { ok: false, summary: 'failed' }); return before === 1; }, 'a failed item leaves the graph honest about what ran'),
  graphTask('M10', (g) => { const a = g.addItem({ title: 'A', planIndex: 1, capability: 'x' }); const b = g.addItem({ title: 'B', planIndex: 2, capability: 'y', dependsOn: [1] }); g.addRelation('BLOCKS', a.id, b.id); return { a, b }; }, (g, { a, b }) => { g.complete(a.id, { ok: true }); return g.readyWork().filter((i) => i.id === b.id).length === 1; }, 'no duplicate ready entries after release'),
];

/* ═══ 3. UNFAMILIAR TASKS — invented domains, no fabrication ════════════ */

const UNSEEN_DOMAINS = [
  ['U1', 'orbital hydroponics yield scheduling for the Kericho greenhouse cluster'],
  ['U2', 'design a fungal-composite building material certification pipeline'],
  ['U3', 'plan a migrating-caribou corridor monitoring program with acoustic sensors'],
  ['U4', 'organize a deep-sea bioluminescence taxonomy expedition'],
  ['U5', 'build a tea-leaf fermentation quality prediction service'],
  ['U6', 'coordinate a solar-panel cleaning robot fleet across dusty rooftops'],
  ['U7', 'structure a community seed-bank genetic diversity registry'],
  ['U8', 'set up an ice-core sampling logistics dashboard for a glacier survey'],
  ['U9', 'create a traditional-weaving pattern digitization workflow'],
  ['U10', 'plan a mangrove restoration drone-seeding campaign'],
];
const unfamiliar = UNSEEN_DOMAINS.map(([id, domain]) => ({
  id, task: `structure and discover tools for an unseen domain: ${domain}`,
  expected: 'structured objective + honest discovery, NO invented tools',
  tools: [], constraints: 'deterministic, no LLM',
  success: () => {
    const so = structureObjective({ refinedObjective: domain, understood: domain }, domain);
    if (!so || !so.objective) return false;
    const d = discoverTools({ objective: domain, interpreted: so });
    const slugs = registrySlugs();
    return d.meta.deterministic === true && d.tools.every((t) => slugs.has(t.slug)) && Array.isArray(d.gaps);
  },
}));

/* ═══ 4. FAILURE-RECOVERY TASKS ═════════════════════════════════════════ */

const realTask = { objective: 'Write a complete deployment guide with steps, rollback, and verification for the scheduler service.' };
const realDeliverable = '## Deployment Guide\n\n### 1. Build\nRun npm ci && npm run build; expect exit 0 and a dist folder.\n\n### 2. Deploy\nPublish dist to the host; the service binds :10000.\n\n### 3. Verification\nGET /api/health must return 200 with ok:true — the actual outcome check, not the exit code.\n\n### 4. Rollback\nKeep the previous release; re-point the router and re-run the health check.\n\n### 5. Notes\nAll steps were executed in order in this guide.';
const failureRecovery = [
  { id: 'F1', task: 'an empty deliverable fails verification', expected: 'gates flag it', tools: [], constraints: 'deterministic', success: () => acceptanceGates('', realTask).length > 0 },
  { id: 'F2', task: 'a refusal fails verification', expected: 'gates flag it', tools: [], constraints: 'deterministic', success: () => acceptanceGates("I'm sorry, I cannot write that guide.", realTask).length > 0 },
  { id: 'F3', task: 'a substitute-instead deliverable fails verification', expected: 'gates flag it', tools: [], constraints: 'deterministic', success: () => acceptanceGates('Here is a draft of something else instead — ' + 'filler text here '.repeat(20), realTask).length > 0 },
  { id: 'F4', task: 'real work passes verification', expected: 'no gate problems', tools: [], constraints: 'deterministic', success: () => acceptanceGates(realDeliverable, realTask).length === 0 },
  { id: 'F5', task: 'a browser-method claim with zero browser events is detectable fabrication', expected: 'detected', tools: [], constraints: 'deterministic', success: () => claimsBrowserMethod('I verified with a headless browser') && /never invoked/.test(executionEvidence([])) },
  { id: 'F6', task: 'a bad API key is never retried forever', expected: 'sticky auth_error', tools: [], constraints: 'provider health', success: () => { __resetProviderHealth(); recordProviderCallFailure('ev-auth', '401 unauthorized: invalid api key'); return providerState('ev-auth').state === 'auth_error' && skipForNow('ev-auth', Date.now() + 86400_000) === true; } },
  { id: 'F7', task: 'a rate-limited provider cools down exactly as asked, then recovers', expected: 'cooldown respected + expiry', tools: [], constraints: 'retry-after honored', success: () => { __resetProviderHealth(); const now = Date.now(); recordProviderCallFailure('ev-429', 'HTTP 429 rate limit', { at: now, cooldownMs: 46_800 }); return skipForNow('ev-429', now + 40_000) === true && skipForNow('ev-429', now + 50_000) === false; } },
  { id: 'F8', task: 'the same failing action twice triggers loop advice', expected: 'repeated-failure loop + hypothesis advice', tools: [], constraints: 'runtime detection', success: () => { __resetLoops(); recordAction('ev-tool', { x: 1 }, { ok: false, error: '502' }); recordAction('ev-tool', { x: 1 }, { ok: false, error: '502' }); return detectLoops().some((l) => l.type === 'repeated-failure' && /hypothesis/.test(l.advice)); } },
  { id: 'F9', task: 'a circular plan is detected before execution', expected: 'cycle found', tools: [], constraints: 'deterministic', success: () => Array.isArray(findCircularPlan([{ id: 'a', dependsOn: ['b'] }, { id: 'b', dependsOn: ['a'] }])) },
  { id: 'F10', task: 'invalid skills are refused promotion with named problems', expected: 'refused + problems listed', tools: [], constraints: 'no unvalidated promotion', success: () => { const r = promoteSkill({ name: 'Bad Name!!' }); return r.ok === false && r.problems.length >= 2; } },
];

/* ═══ 5. TOOL-DISCOVERY TASKS ═══════════════════════════════════════════ */

const toolDiscovery = [
  { id: 'T1', task: 'web search request discovers the real web-search tool', expected: 'web-search among results', tools: ['web-search'], constraints: 'no hard-coded mapping', success: () => discoverTools({ objective: 'search the web for the latest news about electric cars' }).tools.some((t) => t.slug === 'web-search') },
  { id: 'T2', task: 'coding capability discovers code tools', expected: 'code-run/code-write present', tools: ['code-run'], constraints: 'capability matching', success: () => { const d = discoverTools({ objective: 'build it', interpreted: { requiredCapabilities: ['coding'] } }); return d.tools.some((t) => t.slug === 'code-run') && d.tools.some((t) => t.slug === 'code-write'); } },
  { id: 'T3', task: 'research capability discovers deep-read', expected: 'deep-read present', tools: ['deep-read'], constraints: 'capability matching', success: () => discoverTools({ objective: 'x', interpreted: { requiredCapabilities: ['research'] } }).tools.some((t) => t.slug === 'deep-read') },
  { id: 'T4', task: 'writing capability discovers writing tools', expected: 'blog-write or similar', tools: ['blog-write'], constraints: 'capability matching', success: () => discoverTools({ objective: 'x', interpreted: { requiredCapabilities: ['writing'] } }).tools.some((t) => t.slug === 'blog-write') },
  { id: 'T5', task: 'an impossible capability is a GAP, not a fake tool', expected: 'telepathy gap with reason', tools: [], constraints: 'honest gaps', success: () => { const d = discoverTools({ objective: 'x', interpreted: { requiredCapabilities: ['telepathy'] } }); return d.gaps.some((g) => g.capability === 'telepathy' && /no tool in the registry provides/.test(g.reason)) && !d.tools.some((t) => (t.matchedCapabilities || []).includes('telepathy')); } },
  { id: 'T6', task: 'every discovered tool is a real registry tool', expected: 'no invented slugs', tools: [], constraints: 'no fabrication', success: () => { const d = discoverTools({ objective: 'search the web and read pages and write a report about the findings' }); const slugs = registrySlugs(); return d.tools.length > 0 && d.tools.every((t) => slugs.has(t.slug)); } },
  { id: 'T7', task: 'discovery is deterministic (same input, same output)', expected: 'identical results twice', tools: [], constraints: 'pure function', success: () => { const a = discoverTools({ objective: 'search the web for news' }); const b = discoverTools({ objective: 'search the web for news' }); return JSON.stringify(a.tools.map((t) => t.slug)) === JSON.stringify(b.tools.map((t) => t.slug)); } },
  { id: 'T8', task: 'execution capability that no tool provides is a gap', expected: 'gap reported', tools: [], constraints: 'honest gaps', success: () => discoverTools({ objective: 'x', interpreted: { requiredCapabilities: ['execution'] } }).gaps.length >= 1 },
  { id: 'T9', task: 'a learned skill can be found for a matching task', expected: 'skill retrieval works', tools: [], constraints: 'validated skills only', success: () => usableSkills().some((s) => s.name === 'deploy-then-verify') },
  { id: 'T10', task: 'the unified catalog exposes native + computer tools in one shape', expected: 'both sources present', tools: [], constraints: 'one interface', success: async () => { const { unifiedToolCatalog } = await import('../src/services/UnifiedTools.js'); const c = unifiedToolCatalog(); return c.native.length > 20 && c.computer.length >= 8; } },
];

/* ═══ 6. MEMORY-TRANSFER TASKS ══════════════════════════════════════════ */

const TRANSFER_PAIRS = [
  ['X1', 'deploy the python flask service to production', 'deploy the node express api to staging'],
  ['X2', 'migrate the postgres database schema safely', 'migrate the mysql table structure carefully'],
  ['X3', 'publish the rust cli binary to crates.io', 'publish the go module to the package registry'],
  ['X4', 'set up ci tests for the react web app', 'set up automated checks for the vue frontend'],
  ['X5', 'configure nginx for the api gateway', 'configure the load balancer for the web tier'],
  ['X6', 'back up the mongodb cluster before maintenance', 'snapshot the redis cache before the upgrade'],
  ['X7', 'debug the memory leak in the java service', 'diagnose the memory growth in the dotnet worker'],
  ['X8', 'roll out the feature flag to production users', 'gradually enable the toggle for live customers'],
  ['X9', 'harden the ssh access on the build server', 'secure the remote access on the deploy machine'],
  ['X10', 'optimize the image loading on the marketing site', 'optimize the asset delivery on the docs page'],
];
const memoryTransfer = TRANSFER_PAIRS.map(([id, from, to]) => ({
  id, task: `a lesson learned during "${from.slice(0, 40)}" is reused for "${to.slice(0, 40)}"`,
  expected: 'cross-domain retrieval + renderable into plan context',
  tools: [], constraints: 'token relevance, not exact match',
  success: () => {
    recordLesson({ kind: 'failure', missionId: `ev-${id}`, objective: from, itemTitle: 'work', failure: 'exit code was trusted but the service was down', cause: 'exit code treated as success', strategy: 'verify the live endpoint after the change', lesson: `Exit code 0 does not mean the change worked — always verify the live result (${id}).` });
    const hits = retrieveLessons(to, 8).filter((l) => l.missionId === `ev-${id}`);
    if (!hits.length) return false;
    return /live result/.test(formatLessonsBlock(hits));
  },
}));

export const CATEGORIES = [
  { name: 'short', label: 'Short tasks', tasks: short },
  { name: 'multi-step', label: 'Multi-step tasks', tasks: multiStep },
  { name: 'unfamiliar', label: 'Unfamiliar tasks', tasks: unfamiliar },
  { name: 'failure-recovery', label: 'Failure-recovery tasks', tasks: failureRecovery },
  { name: 'tool-discovery', label: 'Tool-discovery tasks', tasks: toolDiscovery },
  { name: 'memory-transfer', label: 'Memory-transfer tasks', tasks: memoryTransfer },
];
