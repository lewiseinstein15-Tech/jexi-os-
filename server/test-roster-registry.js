#!/usr/bin/env node
/**
 * PHASE-6 SCOPE E — workforce registry is the SINGLE roster API surface.
 *
 * Proves (live, not mocked):
 *   E3.1  registry re-exports the legacy catalog data verbatim
 *         (AGENT_ROSTER / SKILL_REGISTRY / counts);
 *   E3.2  getAgent resolves legacy specialists AND bridges to the
 *         AUTHORITATIVE Employees roster (source: 'employees');
 *   E3.3  composeTeam keeps the exact TEAM_PLAN delegation (legacy intents
 *         byte-identical) and composes non-TEAM_PLAN capability intents
 *         from the live Employees roster;
 *   E3.4  rosterStats reports legacy counts + live workforce stats
 *         (count / byCapability / byCoworker);
 *   E3.5  plan-UI helpers (rosterFor / skillsFor / skillsLine / rosterSummary)
 *         and skillsForTeam still work off the registry;
 *   E3.6  the legacy file is GONE — importing services/AgentRoster.js fails.
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  AGENT_ROSTER, SKILL_REGISTRY, ROSTER_COUNT, SKILL_COUNT,
  getAgent, getSkill, agentSkills,
  composeTeam, composeWorkforce, skillsForTeam,
  rosterSummary, rosterFor, skillsFor, skillsLine,
  rosterStats, listAgents, findByCapability,
} from './src/workforce/registry/index.js';
import { TEAM_PLAN } from './src/services/Planner.js';
import { loadEmployees } from './src/services/director/Employees.js';

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log('  ok  ' + name); }
  else { fail++; console.error('FAIL  ' + name); }
}

/* E3.1 — legacy catalog data re-exported verbatim */
console.log('\nE3.1 legacy catalog data via the registry');
check('AGENT_ROSTER is the full 252-entry catalog', Array.isArray(AGENT_ROSTER) && AGENT_ROSTER.length === 252);
check('SKILL_REGISTRY is the full 508-entry library', Array.isArray(SKILL_REGISTRY) && SKILL_REGISTRY.length === 508);
check('ROSTER_COUNT/SKILL_COUNT computed, never hardcoded', ROSTER_COUNT === AGENT_ROSTER.length && SKILL_COUNT === SKILL_REGISTRY.length);
check('every catalog entry has slug/name/role/skills', AGENT_ROSTER.every((a) => a.slug && a.name && a.role && Array.isArray(a.skills)));
check('getSkill resolves from the registry', getSkill('intent-detection')?.name === 'Intent Detection');
check('agentSkills returns mastered skills', agentSkills('planner').some((s) => s.slug === 'intent-detection'));

/* E3.2 — getAgent: catalog first, Employees bridge second */
console.log('\nE3.2 getAgent bridge over the authoritative Employees roster');
check('legacy specialist resolves (qa)', getAgent('qa')?.slug === 'qa' && !getAgent('qa').source);
check('legacy specialist resolves (architect)', getAgent('architect')?.slug === 'architect');
const employees = loadEmployees().filter((e) => !e.disabled);
check('Employees roster is non-empty', employees.length >= 5);
const first = employees[0];
const bridged = getAgent(first.agentId);
check(`Employees coworker '${first.agentId}' resolves through getAgent`, !!bridged && bridged.slug === first.agentId);
check('bridged record is marked source=employees', bridged?.source === 'employees');
check('bridged record mirrors displayName as name', bridged?.name === first.displayName);
check('bridged record carries capabilities', Array.isArray(bridged?.capabilities) && bridged.capabilities.length > 0);
check('unknown slug still returns null', getAgent('no-such-agent-xyz') === null);
check('null/empty slug returns null (no crash)', getAgent(null) === null && getAgent('') === null);

/* E3.3 — composeTeam: legacy delegation + Employees capability composition */
console.log('\nE3.3 composeTeam delegation + capability composition');
const codeTeam = composeTeam('code_task');
check('code_task team is byte-identical to TEAM_PLAN delegation', JSON.stringify(codeTeam.map((a) => a.slug)) === JSON.stringify([...new Set(TEAM_PLAN.code_task)]));
check('code_task team resolves every member via getAgent', codeTeam.every((a) => a.slug && a.name && a.role));
const capTeam = composeTeam('code');
check("non-TEAM_PLAN intent 'code' composes from Employees roster", capTeam.length > 0 && capTeam.every((a) => a.source === 'employees'));
check('capability composition returns real coworker ids', capTeam.every((a) => employees.some((e) => e.agentId === a.agentId)));
check('composeWorkforce matches composeTeam for capability tokens', JSON.stringify(composeWorkforce('code').map((a) => a.agentId)) === JSON.stringify(capTeam.map((a) => a.agentId)));
check('compound_task composes from extra.steps', composeTeam('compound_task', { steps: ['QA', 'architect'] }).map((a) => a.slug).join(',') === 'qa,architect');
check('gibberish intent composes empty (no crash)', Array.isArray(composeTeam('zz-no-such-intent')) && composeTeam('zz-no-such-intent').length === 0);
check('every TEAM_PLAN intent still composes its exact legacy team', Object.keys(TEAM_PLAN).every((intent) => {
  const team = composeTeam(intent);
  const expected = [...new Set(TEAM_PLAN[intent])];
  return JSON.stringify(team.map((a) => a.slug)) === JSON.stringify(expected);
}));

/* E3.4 — rosterStats: legacy shape + live workforce stats */
console.log('\nE3.4 rosterStats — both worlds in one call');
const stats = rosterStats();
check('legacy shape preserved (agents/skills)', stats.agents === 252 && stats.skills === 508);
check('count = live Employees index size', stats.count === employees.filter((e) => !e.disabled).length);
check('byCapability is a real histogram', typeof stats.byCapability === 'object' && Object.values(stats.byCapability).every((n) => Number.isInteger(n) && n > 0));
check('byCapability total equals summed capability tokens', Object.values(stats.byCapability).reduce((s, n) => s + n, 0) === listAgents().reduce((s, a) => s + a.capabilities.length, 0));
check('byCoworker lists every live coworker', Array.isArray(stats.byCoworker) && stats.byCoworker.length === stats.count);
check('byCoworker records carry agentId/role/capabilities/support', stats.byCoworker.every((c) => c.agentId && c.role && Number.isInteger(c.capabilities) && typeof c.support === 'boolean'));
check('findByCapability is deterministic lookup surface', findByCapability((stats.byCoworker[0] ? 'search' : 'search')).every((a) => a.capabilities.includes('search')));

/* E3.5 — plan-UI helpers off the registry */
console.log('\nE3.5 plan-UI helpers');
check('rosterFor returns display names', rosterFor('research').every((n) => typeof n === 'string' && n.length > 0));
check('skillsFor returns skill slugs', skillsFor('code_task').every((s) => typeof s === 'string'));
check('skillsLine is a human-readable line or empty', typeof skillsLine('research') === 'string');
check('rosterSummary format "N specialists · M skills"', /^\d+ specialists · \d+ skills$/.test(rosterSummary('code_task')));
check('skillsForTeam dedupes across the team', skillsForTeam(composeTeam('code_task')).length === new Set(composeTeam('code_task').flatMap((a) => a.skills)).size);

/* E3.6 — legacy file is gone */
console.log('\nE3.6 legacy file deleted');
const legacyPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'src/services/AgentRoster.js');
check('services/AgentRoster.js no longer exists on disk', !existsSync(legacyPath));
let importFailed = false;
try { await import('./src/services/AgentRoster.js'); } catch { importFailed = true; }
check('importing the deleted file throws', importFailed);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
