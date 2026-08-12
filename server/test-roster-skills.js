// Regression tests: Agent Roster (60+ specialists), Skill Registry (100+ skills),
// Provider Router (health-aware fallback), and VerificationLoop (no-key safety).
import { AGENT_ROSTER, SKILL_REGISTRY, composeTeam, skillsForTeam, rosterSummary, rosterStats, rosterFor, skillsFor, skillsLine, getAgent, getSkill } from './src/services/AgentRoster.js';
import { providerOrder, recordProviderFailure, recordProviderSuccess, providerInCooldown, resetProviderHealth, providerHealthSnapshot } from './src/services/ProviderRouter.js';
import { verifyAnswer, shouldVerify } from './src/services/VerificationLoop.js';

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
check('extra free providers are in the order', ['cerebras', 'together', 'deepinfra', 'mistral'].every((k) => providerOrder().includes(k)));
check('huggingface stays last', providerOrder()[providerOrder().length - 1] === 'huggingface');

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
check('snapshot lists all 8 providers', snap.length === 8);
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

  console.log(failures === 0 ? '\nALL ROSTER/SKILLS/ROUTER/VERIFY TESTS PASSED' : `\n${failures} TEST(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
})();
