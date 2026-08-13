// Regression tests: Agent Roster (60+ specialists), Skill Registry (100+ skills),
// Provider Router (health-aware fallback), and VerificationLoop (no-key safety).
import { AGENT_ROSTER, SKILL_REGISTRY, composeTeam, skillsForTeam, rosterSummary, rosterStats, rosterFor, skillsFor, skillsLine, getAgent, getSkill } from './src/services/AgentRoster.js';
import { providerOrder, recordProviderFailure, recordProviderSuccess, providerInCooldown, resetProviderHealth, providerHealthSnapshot } from './src/services/ProviderRouter.js';
import { verifyAnswer, shouldVerify } from './src/services/VerificationLoop.js';
import { TOOL_REGISTRY, toolsForIntent, toolsForTeam, getTool } from './src/services/ToolRegistry.js';
import { planner } from './src/services/Planner.js';

let failures = 0;
const check = (label, cond) => {
  if (!cond) failures++;
  console.log(`${cond ? '✅' : '❌'} ${label}`);
};

/* ---------------- Agent Roster ---------------- */

check('roster has 60+ specialists (got ' + AGENT_ROSTER.length + ')', AGENT_ROSTER.length >= 60);
check('skill registry has 100+ skills (got ' + SKILL_REGISTRY.length + ')', SKILL_REGISTRY.length >= 100);
check('rosterStats reflects real counts', rosterStats().agents === AGENT_ROSTER.length && rosterStats().skills === SKILL_REGISTRY.length);

// Every agent's listed skills must exist in the registry (no dangling refs).
const skillSlugs = new Set(SKILL_REGISTRY.map(s => s.slug));
let dangling = 0;
for (const agent of AGENT_ROSTER) {
  for (const s of agent.skills || []) if (!skillSlugs.has(s)) { dangling++; console.log(`  dangling skill "${s}" on agent ${agent.slug}`); }
}
check('no dangling skill references in roster', dangling === 0);

// composeTeam returns a focused subset (never the whole catalog).
const codeTeam = composeTeam('code_task');
check('code_task composes a small team', codeTeam.length >= 5 && codeTeam.length <= 14);
check('code_task team includes Coder', codeTeam.some(a => a.name === 'Coder'));
check('code_task team includes QA Lead', codeTeam.some(a => a.name === 'QA Lead'));
const researchTeam = composeTeam('research');
check('research composes Fact Checker (anti-hallucination)', researchTeam.some(a => a.slug === 'fact-checker'));

// skillsFor / skillsLine / rosterFor
check('rosterFor returns names', Array.isArray(rosterFor('math_solve')) && rosterFor('math_solve').includes('Math Solver'));
check('skillsFor returns slugs', Array.isArray(skillsFor('code_task')) && skillsFor('code_task').length > 0);
check('skillsLine is a non-empty string', typeof skillsLine('code_task') === 'string' && skillsLine('code_task').length > 0);
check('rosterSummary reads well', /specialists · .* skills/.test(rosterSummary('code_task')));
check('getAgent finds a specialist', getAgent('coder')?.name === 'Coder');
check('getSkill finds a skill', getSkill('verification')?.name === 'Verification');

/* ---------------- Provider Router ---------------- */

// Default order is Groq-first; gemini preference puts Gemini first.
check('default order starts with groq', providerOrder()[0] === 'groq');
check('gemini preference starts with gemini', providerOrder('gemini')[0] === 'gemini');
check('openrouter preference starts with openrouter', providerOrder('openrouter')[0] === 'openrouter');
check('extra free providers are in the order', ['cerebras', 'deepinfra', 'mistral'].every((k) => providerOrder().includes(k)));
check('huggingface stays last', providerOrder()[providerOrder().length - 1] === 'huggingface');
check('together is removed from the router', !providerOrder().includes('together'));

// Cooldown: 3 failures push a provider to the back.
resetProviderHealth('groq');
recordProviderFailure('groq');
recordProviderFailure('groq');
recordProviderFailure('groq');
check('groq enters cooldown after 3 failures', providerInCooldown('groq'));
const cooled = providerOrder();
check('cooldowned groq moves to the back', cooled[cooled.length - 1] === 'groq');

// A success resets the streak → groq returns to the front.
recordProviderSuccess('groq');
check('success clears cooldown', !providerInCooldown('groq'));
check('groq back at the front after recovery', providerOrder()[0] === 'groq');

// Snapshot shape (no secrets).
const snap = providerHealthSnapshot();
check('snapshot lists all ' + snap.length + ' providers (got ' + snap.length + ')', snap.length === 8 && snap.some((p) => p.key === 'xai'));

/* ---------------- Round 3: Tools, Critics, Memory, Guardrails ---------------- */

// New specialists added from the MetaGPT / CrewAI / DeepAgents / Mem0 research.
const ROUND3_AGENTS = ['critic', 'tool-router', 'toolsmith', 'context-manager', 'archivist', 'document-analyst', 'data-engineer', 'guardrail'];
check('round-3 specialists exist in the roster', ROUND3_AGENTS.every((s) => getAgent(s)));

// New skills they master (must all exist — no dangling refs).
const ROUND3_SKILLS = ['tool-selection', 'function-calling', 'auto-routing', 'tool-building', 'api-integration', 'orchestration', 'rolling-summary', 'context-compaction', 'continuity', 'episodic-memory', 'forgetting-curve', 'memory-consolidation', 'document-rag', 'chunking', 'retrieval', 'data-pipelines', 'etl', 'cleansing', 'critical-review', 'output-quality', 'self-consistency', 'guardrails', 'safety-checks', 'refusal'];
check('round-3 skills exist in the registry', ROUND3_SKILLS.every((s) => getSkill(s)));

// Tool Registry — first-class catalog of executable tools (smolagents/OpenAI SDK pattern).
check('tool registry has 20+ tools (got ' + TOOL_REGISTRY.length + ')', TOOL_REGISTRY.length >= 20);
check('every tool owner is a real roster agent', TOOL_REGISTRY.every((t) => t.agents.every((a) => getAgent(a))));
check('every tool has a unique slug + description', new Set(TOOL_REGISTRY.map((t) => t.slug)).size === TOOL_REGISTRY.length && TOOL_REGISTRY.every((t) => t.desc.length > 10));
check('getTool finds tools', getTool('web-search')?.name === 'Web Search' && getTool('nope') === null);

// AUTO TOOL ROUTING — every intent derives a focused tool set from its team.
const codeTools = toolsForIntent('code_task').map((t) => t.slug);
check('code_task auto-selects code tools', ['code-run', 'code-write', 'code-fix', 'code-review', 'security-scan', 'fact-check'].every((s) => codeTools.includes(s)));
check('code_task does NOT dump the whole catalog', codeTools.length <= 12);
const researchTools = toolsForIntent('research').map((t) => t.slug);
check('research auto-selects search + fact-check tools', ['web-search', 'deep-read', 'fact-check', 'memory-recall'].every((s) => researchTools.includes(s)));
const newsTools = toolsForIntent('news_latest').map((t) => t.slug);
check('news auto-selects the news-feed tool', newsTools.includes('news-feed'));
const chatTools = toolsForIntent('conversation').map((t) => t.slug);
check('conversation auto-selects memory + rolling-summary tools', ['memory-recall', 'rolling-summary', 'episode-recall'].every((s) => chatTools.includes(s)));
const dataTools = toolsForIntent('data').map((t) => t.slug);
check('data auto-selects data-crunch + chart tools', ['data-crunch', 'chart-builder'].every((s) => dataTools.includes(s)));
check('toolsForTeam is stable (no dupes)', new Set(toolsForTeam(composeTeam('code_task')).map((t) => t.slug)).size === toolsForTeam(composeTeam('code_task')).length);
check('snapshot exposes order + health fields', snap.every((p) => typeof p.order === 'number' && 'calls' in p && 'ok' in p));
check('snapshot never leaks key values', snap.every((p) => !JSON.stringify(p).includes('sk-') && !JSON.stringify(p).includes('AIza')));

/* ---------------- VerificationLoop ---------------- */

// No keys configured → skipped (hermetic: this sandbox has no keys).
check('no keys → verifyAnswer skipped safely', (async () => (await verifyAnswer({ query: 'test', draft: 'A fairly long draft answer '.repeat(20) })).verdict === 'skipped')());
check('shouldVerify false with no keys', shouldVerify('x'.repeat(500)) === false);
check('shouldVerify false for short drafts', shouldVerify('short') === false);

// The Promise-returning checks above need awaiting — run them here.
(async () => {
  const r1 = await verifyAnswer({ query: 'test', draft: 'A fairly long draft answer '.repeat(20) });
  check('no keys → verdict skipped (awaited)', r1.verdict === 'skipped');
  check('no keys → changed false', r1.changed === false);

  // The planner auto-attaches the derived tool set to every plan (auto routing).
  const plan = await planner.analyzeIntent('Build me a weather app');
  check('plan auto-assigns tools (no manual tool instruction)', Array.isArray(plan.tools) && plan.tools.length > 0);
  check('plan.toolsLine is a readable string', typeof plan.toolsLine === 'string' && plan.toolsLine.length > 0);
  check('plan.toolCount matches the tool list', plan.toolCount === plan.tools.length);
  check('plan tools all exist in the registry', plan.tools.every((s) => getTool(s)));
  const planChat = await planner.analyzeIntent('hello there');
  check('conversation plans auto-route memory tools too', Array.isArray(planChat.tools) && planChat.tools.includes('rolling-summary'));
  const planCompound = await planner.analyzeIntent('research frontend layout then build an app');
  check('compound plans union tools from both phases', Array.isArray(planCompound.tools) && planCompound.tools.includes('web-search') && planCompound.tools.includes('code-run'));

  console.log(failures === 0 ? '\nALL ROSTER/SKILLS/ROUTER/VERIFY TESTS PASSED' : `\n${failures} TEST(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
})();
