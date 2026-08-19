// BUILD 49 — Roster/Skills/Tools honesty + independent code gates.
// Proves every claim AGENT-CATALOG.md makes is verifiable in code:
//   - zero orphaned agents/skills/tools (every entry reachable by a real path)
//   - tier metadata is explicit and queryable
//   - code_task QA/Reviewer/Security/Critic gates are own graph nodes
//   - SkillChain security-officer alias resolves
//   - AGENT-CATALOG.md matches the live registries
import { AGENT_ROSTER, SKILL_REGISTRY, composeTeam, getAgent } from './src/services/AgentRoster.js';
import { TEAM_PLAN } from './src/services/Planner.js';
import { TOOL_REGISTRY } from './src/services/ToolRegistry.js';
import { analyze, executionModel, resolveDisplayName } from './src/services/Reachability.js';
import { resolveSkillSlug, SLUG_ALIASES, runReviewerPass, runSecurityPass, runCriticPass, runShipperPass, runReflectorPass } from './src/services/SkillChain.js';
import { Orchestrator } from './src/services/Orchestrator.js';
import { planner } from './src/services/Planner.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let failures = 0;
const check = (label, cond) => {
  if (!cond) failures++;
  console.log(`${cond ? '✅' : '❌'} ${label}`);
};

/* ---------------- P1 — zero orphans, honest counts ---------------- */
const report = analyze();
check('P1: zero orphaned agents (got ' + report.orphanAgents.length + ')', report.orphanAgents.length === 0);
check('P1: zero orphaned skills (got ' + report.orphanSkills.length + ')', report.orphanSkills.length === 0);
check('P1: zero orphaned tools (got ' + report.orphanTools.length + ')', report.orphanTools.length === 0);
check('P1: zero dangling refs in any direction', report.danglingTeamRefs.length === 0 && report.danglingSkillRefs.length === 0 && report.danglingToolRefs.length === 0 && report.danglingAgentSkills.length === 0);
check('P1: 100% of agents reachable (got ' + report.counts.reachablePct + '%)', report.counts.reachablePct === 100);
// B50 added the academic DomainRegistry: +38 domain-specialist agents,
// +13 skills (hardware/embedded/iot + 10 domain skills), +23 round-6 tools,
// +1 knowledge-load tool (B50 P2).
check('P1: 251 agents · 507 skills · 177 tools (got ' + report.counts.agents + '/' + report.counts.skills + '/' + report.counts.tools + ')', report.counts.agents === 252 && report.counts.skills === 508 && report.counts.tools === 213); // +3: goal tools (B132)

// The investigation's 32 orphaned agents must now all be reachable (wired or removed).
const orphanList = ['accessibility', 'agent-builder', 'api-docs-writer', 'brand-designer', 'coding-tutor', 'deploy-engineer', 'devrel-engineer', 'devtools-engineer', 'email-developer', 'embedded-engineer', 'forensic-analyst', 'infra-auditor', 'landing-page-builder', 'languages', 'legal-drafter', 'lifecycle-marketer', 'log-analyst', 'monitoring-engineer', 'motion-designer', 'negotiator', 'network-engineer', 'operations-manager', 'parenting', 'prompt', 'red-team', 'regex', 'security-trainer', 'sound-designer', 'technical-editor', 'tool-router', 'toolsmith', 'ui-developer', 'ux-researcher', 'ux-writer'];
const reachableSet = report.reachable;
// embedded-engineer was deliberately REMOVED (no coherent team) — verified separately below.
const unreachable = orphanList.filter((s) => s !== 'embedded-engineer' && !reachableSet.has(s));
check('P1: every investigation-orphan is now reachable (or removed) — missing: ' + (unreachable.join(', ') || 'none'), unreachable.length === 0);
check('P1: embedded-engineer removed (no coherent team)', getAgent('embedded-engineer') === null && !SKILL_REGISTRY.some((s) => s.agent === 'embedded-engineer'));
check('P1: legal_task team composed', composeTeam('legal_task').map((a) => a.slug).join(',') === 'legal-drafter,negotiator,legal,privacy-officer,compliance-officer');
check('P1: code_task team now includes wired-in UX/accessibility/UI agents', ['ux-researcher', 'accessibility', 'ui-developer', 'landing-page-builder', 'email-developer', 'frontend'].every((s) => TEAM_PLAN.code_task.includes(s)));

/* ---------------- P3 — tier metadata ---------------- */
const validTiers = new Set(['core', 'pipeline', 'team']);
check('P3: every agent has an explicit tier', AGENT_ROSTER.every((a) => validTiers.has(a.tier)));
check('P3: core tier is the 5 brain agents', AGENT_ROSTER.filter((a) => a.tier === 'core').map((a) => a.slug).sort().join(',') === 'jexi,orchestrator,planner,reasoner,reflector');
check('P3: gate agents are pipeline tier', ['qa', 'reviewer', 'security', 'critic', 'shipper', 'coder', 'debugger'].every((s) => getAgent(s)?.tier === 'pipeline') && getAgent('reflector')?.tier === 'core');
check('P3: skill owner refs all resolve', SKILL_REGISTRY.every((s) => getAgent(s.agent) !== null));

/* ---------------- P2 — independent gate nodes ---------------- */
const graph = new Orchestrator().buildGraph();
const edges = graph.edgeMap;
check('P2: codeReview node exists', edges.has('codeReview'));
check('P2: securityGate node exists', edges.has('securityGate'));
check('P2: criticGate node exists', edges.has('criticGate'));
check('P2: reflector node exists', edges.has('reflector'));
check('P2: reviewShip node removed', !edges.has('reviewShip'));
const qaPass = await edges.get('qaGate')({ context: { code: { qaVerdict: 'PASS', qaRounds: 0 } } });
check('P2: QA PASS → codeReview (own node, own verdict)', qaPass === 'codeReview');
check('P2: codeReview → securityGate', await edges.get('codeReview')({ context: { code: {} } }) === 'securityGate');
check('P2: securityGate → criticGate', await edges.get('securityGate')({ context: { code: {} } }) === 'criticGate');
check('P2: criticGate → reflector', await edges.get('criticGate')({ context: { code: {} } }) === 'reflector');
check('P2: reflector → shipper', await edges.get('reflector')({ context: { code: {} } }) === 'shipper');
check('P2: shipper → responder', await edges.get('shipper')({ context: { code: {} } }) === 'responder');

// Each gate pass function exists and is a real, separable call.
check('P2: runReviewerPass exported', typeof runReviewerPass === 'function');
check('P2: runSecurityPass exported', typeof runSecurityPass === 'function');
check('P2: runCriticPass exported', typeof runCriticPass === 'function');
check('P2: runShipperPass exported', typeof runShipperPass === 'function');
check('P2: runReflectorPass exported', typeof runReflectorPass === 'function');

// Execution model: gates are independent; composed personas are honestly bundled.
const codeModel = executionModel('code_task');
check('P2: gate agents marked independent', ['qa', 'reviewer', 'security', 'critic', 'shipper', 'reflector'].every((s) => codeModel.independent.includes(s)));
check('P2: composed personas marked bundled (not overclaimed)', ['ux-researcher', 'accessibility', 'ui-developer', 'landing-page-builder'].every((s) => codeModel.bundled.includes(s)));

/* ---------------- P2 — security-officer alias ---------------- */
check('P2: security-officer slug alias resolves to roster security agent', resolveSkillSlug('security-officer') === 'security' && SLUG_ALIASES['security-officer'] === 'security');

/* ---------------- P1 — composeTeam is the single team map ---------------- */
const teamFromCompose = composeTeam('code_task').map((a) => a.slug);
check('P1: composeTeam delegates to TEAM_PLAN (identical code_task team)', teamFromCompose.join(',') === TEAM_PLAN.code_task.join(','));
check('P1: every TEAM_PLAN slug resolves to a real agent', Object.values(TEAM_PLAN).flat().every((s) => getAgent(s) !== null));

/* ---------------- P1 — legal_task routes ---------------- */
const legalPlan = await planner.analyzeIntent('draft a non-disclosure agreement');
check('P1: legal phrasings route to legal_task (got ' + legalPlan.intent + ')', legalPlan.intent === 'legal_task');

/* ---------------- P4 — catalog matches reality ---------------- */
const catalogPath = path.resolve(__dirname, '../AGENT-CATALOG.md');
const catalog = fs.readFileSync(catalogPath, 'utf-8');
const header = `**${report.counts.agents} specialist agents · ${report.counts.skills} skills · ${report.counts.tools} tools · 1 orchestrator.`;
check('P4: AGENT-CATALOG.md header matches live counts', catalog.includes(header));
check('P4: catalog documents the independent/bundled execution model', /independent.*bundled/i.test(catalog) && catalog.includes('How execution actually works'));
check('P4: catalog contains the new legal_task team', catalog.includes('legal_task'));

/* ---------------- P3 — display-name resolution (compound phases) ---------------- */
check('P3: resolveDisplayName maps "QA Lead" → qa', resolveDisplayName('QA Lead') === 'qa');
check('P3: resolveDisplayName maps "JEXI Core" → jexi', resolveDisplayName('JEXI Core') === 'jexi');

console.log(`\nBUILD 49 — ${report.counts.agents} agents · ${report.counts.skills} skills · ${report.counts.tools} tools · ${report.counts.reachablePct}% reachable`);
if (failures === 0) console.log('BUILD 49 TESTS PASSED ✅');
else console.log(`BUILD 49 TESTS FAILED ❌ (${failures})`);
process.exit(failures === 0 ? 0 : 1);
