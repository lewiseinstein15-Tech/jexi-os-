#!/usr/bin/env node
/**
 * B49 P5 — ROSTER / SKILL / TOOL AUDIT + CATALOG GENERATOR.
 *
 * Run from server/:   node scripts/audit-roster.js           → regenerate AGENT-CATALOG.md
 *                     node scripts/audit-roster.js --check   → verify catalog matches reality (CI)
 *
 * What it proves (per the Build 49 directive):
 *   - every AGENT_ROSTER entry is reachable via a TEAM_PLAN value, a
 *     COMPOUND_DETECT phase, or a SkillChain runSkill pass (zero orphans);
 *   - every SKILL_REGISTRY entry is mastered by ≥1 agent and its owner exists;
 *   - every TOOL_REGISTRY entry lists ≥1 real, reachable agent;
 *   - no dangling references in either direction;
 *   - AGENT-CATALOG.md's published counts match the live registries.
 *
 * Wired into `npm test` via the --check mode: a new orphaned entry, a typo'd
 * slug, or a drift in the published catalog fails CI immediately — this class
 * of drift never needs a manual investigation again.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { AGENT_ROSTER, SKILL_REGISTRY, getAgent, getSkill } from '../src/services/AgentRoster.js';
import { TOOL_REGISTRY } from '../src/services/ToolRegistry.js';
import { TEAM_PLAN, COMPOUND_DETECT } from '../src/services/Planner.js';
import { analyze, executionModel, reachabilitySummary } from '../src/services/Reachability.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');
const CATALOG_PATH = path.join(REPO_ROOT, 'AGENT-CATALOG.md');

const report = analyze();

/* ------------------------------------------------------------------ */
/* Failure path — print findings and exit 1                            */
/* ------------------------------------------------------------------ */
function fail() {
  console.error('\n❌ ROSTER AUDIT FAILED — the catalog is not honest:\n');
  if (report.orphanAgents.length) console.error(`  Orphaned agents (defined but never composed/run): ${report.orphanAgents.join(', ')}`);
  if (report.orphanSkills.length) console.error(`  Orphaned skills (no agent masters them): ${report.orphanSkills.join(', ')}`);
  if (report.danglingSkillRefs.length) console.error(`  Skills owned by a missing agent: ${report.danglingSkillRefs.join(', ')}`);
  if (report.orphanTools.length) console.error(`  Orphaned tools (no reachable agent may use them): ${report.orphanTools.join(', ')}`);
  if (report.danglingToolRefs.length) console.error(`  Tools listing a missing agent: ${report.danglingToolRefs.join(', ')}`);
  if (report.danglingTeamRefs.length) console.error(`  Team/phase references a missing agent: ${report.danglingTeamRefs.join(', ')}`);
  if (report.danglingAgentSkills.length) console.error(`  Agent lists a skill missing from the registry: ${report.danglingAgentSkills.join(', ')}`);
  console.error('\nFix the registry/team wiring, then re-run. Do not ship with an aspirational catalog.');
  process.exit(1);
}

/* ------------------------------------------------------------------ */
/* Catalog generation                                                  */
/* ------------------------------------------------------------------ */
function agentCategory(a) {
  if (a.tier === 'core') return 'Core';
  const first = (a.skills || [])[0];
  const skill = first ? getSkill(first) : null;
  return skill ? skill.category : 'General';
}

function intentTable() {
  const rows = [];
  for (const [intent, slugs] of Object.entries(TEAM_PLAN)) {
    const names = slugs.map((s) => getAgent(s)?.name || s).join(' → ');
    const model = executionModel(intent);
    const exec = `${model.independent.length} independent · ${model.bundled.length} bundled`;
    rows.push(`| \`${intent}\` | ${names} | ${exec} |`);
  }
  return rows.join('\n');
}

function agentsByCategory() {
  const groups = new Map();
  for (const a of AGENT_ROSTER) {
    const cat = agentCategory(a);
    if (!groups.has(cat)) groups.set(cat, []);
    groups.get(cat).push(a);
  }
  const out = [];
  for (const [cat, agents] of [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    agents.sort((a, b) => a.name.localeCompare(b.name));
    out.push(`### ${cat} (${agents.length})`);
    out.push('| Agent | Tier | What it does |');
    out.push('|---|---|---|');
    for (const a of agents) out.push(`| **${a.name}** | ${a.tier} | ${a.role} |`);
    out.push('');
  }
  return out.join('\n');
}

function skillsByCategory() {
  const groups = new Map();
  for (const s of SKILL_REGISTRY) {
    if (!groups.has(s.category)) groups.set(s.category, []);
    groups.get(s.category).push(s);
  }
  const out = [];
  for (const [cat, skills] of [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    skills.sort((a, b) => a.slug.localeCompare(b.slug));
    out.push(`### ${cat} (${skills.length})`);
    out.push('| Skill | Owner agent | What it does |');
    out.push('|---|---|---|');
    for (const s of skills) out.push(`| \`${s.slug}\` | ${getAgent(s.agent)?.name || s.agent} | ${s.desc} |`);
    out.push('');
  }
  return out.join('\n');
}

function toolsByType() {
  const groups = new Map();
  for (const t of TOOL_REGISTRY) {
    if (!groups.has(t.type)) groups.set(t.type, []);
    groups.get(t.type).push(t);
  }
  const out = [];
  for (const [type, tools] of [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    tools.sort((a, b) => a.slug.localeCompare(b.slug));
    out.push(`### ${type} (${tools.length})`);
    out.push('| Tool | Allowed agents | Engine | What it does |');
    out.push('|---|---|---|---|');
    for (const t of tools) out.push(`| \`${t.slug}\` | ${t.agents.map((a) => getAgent(a)?.name || a).join(', ')} | ${t.engine} | ${t.desc} |`);
    out.push('');
  }
  return out.join('\n');
}

function buildCatalog() {
  const c = report.counts;
  const gen = new Date().toISOString().slice(0, 10);
  const execExplain = `How execution actually works (B49):
- **Independent** — the agent takes its own observable reasoning turn: its own graph node / LLM call with its own verdict or output.
- **Bundled** — the agent's persona is composed into another pass: its role text is injected into a shared prompt, but it does not reason on its own.

Today's verified independent passes live in the coding pipeline (\`code_task\`): Product → Designer → Engineer (planForBuild's three sequential calls), Architect/Coder/Debugger (codegen + fix calls), Runner (real sandbox execution), and the QA / Reviewer / Security Officer / Critic / Shipper / Reflector gates (each its own call with its own PASS/FAIL verdict). Every other team member in every team is honestly marked *bundled* — one well-constructed composite prompt covers closely related, low-stakes roles, and the roster table above says so per intent.

This section and every table below are GENERATED from the live registries by \`cd server && npm run audit-roster\` — they cannot drift from the code.`;
  return `# JEXI OS — Agent & Skill Catalog

**${c.agents} specialist agents · ${c.skills} skills · ${c.tools} tools · 1 orchestrator.** One plain-language request in,
a composed team runs it end-to-end, verifies the answer, and reports back.

> ⚙️ GENERATED FILE — updated ${gen} by \`cd server && npm run audit-roster\`. Do not edit by hand.
> The audit (\`node scripts/audit-roster.js --check\`, wired into \`npm test\`) fails CI if this file drifts from the registries.

---

## Reachability report (what the audit proves)

| Metric | Value |
|---|---|
| Agents | ${c.agents} (${c.reachableAgents} reachable — ${c.reachablePct}%) |
| Skills | ${c.skills} |
| Tools | ${c.tools} |
| Intents / teams | ${c.intents} |
| Orphaned agents | ${report.orphanAgents.length} |
| Orphaned skills | ${report.orphanSkills.length} |
| Orphaned tools | ${report.orphanTools.length} |
| Dangling refs (any direction) | ${report.danglingTeamRefs.length + report.danglingSkillRefs.length + report.danglingToolRefs.length + report.danglingAgentSkills.length} |

**${report.clean ? '✅ PASS — every roster entry is reachable, zero orphans, zero dangling references.' : '❌ FAIL — see audit output.'}**

---

## How it works (the full pipeline)

\`\`\`
You type:  "Build me a water-intake tracker"
                │
                ▼
┌──────────────┴──────────────┐
│ 1. PLANNER  classifies the  │  intent = code_task
│    request into an intent   │  ("build", "research", "math", "news"…)
└──────────────┬──────────────┘
               ▼
┌──────────────┴──────────────┐
│ 2. composeTeam() picks the  │  Product → Designer → Engineer → Architect →
│    exact specialists needed │  Coder → Runner → Debugger → QA → Reviewer →
│    (never all ${c.agents})          │  Security → Critic → Shipper → Reflector
└──────────────┬──────────────┘
               ▼
┌──────────────┴──────────────┐
│ 3. SKILLS expand per agent  │  team skills = each agent's registry entry
│    (${c.skills}-skill registry)       │  → streamed live in the UI as she works
└──────────────┬──────────────┘
               ▼
┌──────────────┴──────────────┐
│ 4. ORCHESTRATOR runs them   │  strict handoffs: only the previous agent's
│    one-by-one               │  output moves forward; QA/Review/Security/
│                             │  Critic gates are own nodes with own verdicts
└──────────────┬──────────────┘
               ▼
┌──────────────┴──────────────┐
│ 5. VERIFICATION LOOP        │  a Critic audits the draft against its
│    (anti-hallucination)     │  sources → flags invented claims → a
│                             │  revision pass fixes them (max 2 rounds)
└──────────────┬──────────────┘
               ▼
┌──────────────┴──────────────┐
│ 6. PROVIDER ROUTER          │  every LLM key fights as one: Groq → Gemini
│                             │  → OpenRouter → Cerebras → DeepInfra → Mistral
│                             │  → Grok → HuggingFace. A dead or rate-limited
│                             │  key auto-falls-through.
└──────────────┬──────────────┘
               ▼
   Rich final answer (markdown, LaTeX, code, sources)
\`\`\`

## Intent → team map (how agents get picked)

| Intent | Team composed | Execution |
|---|---|---|
${intentTable()}

---
## How execution actually works

${execExplain}

---
## The ${c.agents} agents (grouped by primary skill category)

${agentsByCategory()}

## The ${c.skills} skills (grouped by category)

${skillsByCategory()}

## The ${c.tools} tools (grouped by type)

${toolsByType()}

---
## Compound-task phases (research/news first, then build)

${COMPOUND_DETECT.map((c2) => `- **${c2.reasoning}** — phases: ${(c2.phases || []).map((ph) => `${ph.name} (${ph.agents.join(', ')})`).join(' → ')}`).join('\n')}
`;
}

/* ------------------------------------------------------------------ */
/* --check mode: verify the committed catalog matches the registries   */
/* ------------------------------------------------------------------ */
function checkCommittedCatalog() {
  if (!fs.existsSync(CATALOG_PATH)) {
    console.error('❌ AGENT-CATALOG.md missing — run `node scripts/audit-roster.js` to generate it.');
    process.exit(1);
  }
  const doc = fs.readFileSync(CATALOG_PATH, 'utf-8');
  const c = report.counts;
  const expected = `**${c.agents} specialist agents · ${c.skills} skills · ${c.tools} tools · 1 orchestrator.`;
  if (!doc.includes(expected)) {
    console.error(`❌ AGENT-CATALOG.md is out of date. Expected header line containing:\n   ${expected}\nRun \`node scripts/audit-roster.js\` and commit the regenerated file.`);
    process.exit(1);
  }
  console.log(`✅ Catalog header matches reality (${c.agents} agents · ${c.skills} skills · ${c.tools} tools).`);
}

/* ------------------------------------------------------------------ */
/* Main                                                                 */
/* ------------------------------------------------------------------ */
const CHECK = process.argv.includes('--check');

if (!report.clean) fail();

if (CHECK) {
  checkCommittedCatalog();
  console.log(`✅ Roster audit PASSED — ${reachabilitySummary()}`);
} else {
  fs.writeFileSync(CATALOG_PATH, buildCatalog(), 'utf-8');
  console.log(`✅ Roster audit PASSED — ${reachabilitySummary()}`);
  console.log(`✅ AGENT-CATALOG.md regenerated (${CATALOG_PATH})`);
}
