#!/usr/bin/env node
/**
 * JEXI OS — PHASE 13 SCOPE C — NEXUS STRATEGY PROJECTOR.
 *
 *   node scripts/phase13-vendor-nexus.mjs --src /path/to/agency-agents
 *   node scripts/phase13-vendor-nexus.mjs --src <dir> --check
 *
 * Projects the upstream NEXUS strategy tree into
 * workforce/nexus/vendor/agency-agents.strategies.json — one routing strategy
 * per upstream scenario, pipeline phase, and task type.
 *
 * Upstream ships the strategy layer as prose (1110-line nexus-strategy.md,
 * playbooks, runbooks) plus one machine-readable file (strategy/runbooks.json).
 * The prose is NOT vendored: the baseline lint governs workforce/**.md, and a
 * copy of upstream prose would drift from upstream. What is vendored is the
 * projection — the strategy decisions encoded as rows:
 *
 *   scenario strategies  <- strategy/runbooks.json            (4 runbooks)
 *   phase strategies     <- nexus-strategy.md "Active Agents" (7 phases)
 *   task strategies      <- nexus-strategy.md 6.2 task matrix (13 task types)
 *
 * Each row keeps upstream's agent REFERENCES verbatim (display names, and slugs
 * where upstream supplies them). Resolving a reference to a roster agent is a
 * runtime act — it consults Scope A — so the projection stays a faithful
 * reading of upstream rather than a snapshot of one roster.
 *
 * What JEXI adds: `kind` and `aliases`, the routing vocabulary an intent is
 * matched against. Upstream has no such field; it is defined here and declared
 * in the emitted rows so routing has no hidden defaults.
 *
 * Deterministic: rows sort by id; aliases sort within a row.
 * --check exits 1 when the committed projection disagrees with --src.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
const OUT = path.join(REPO, 'workforce/nexus/vendor/agency-agents.strategies.json');

const args = process.argv.slice(2);
const argVal = (flag, dflt) => {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};
const SRC = argVal('--src', process.env.AGENCY_AGENTS_SRC || '');

const UPSTREAM = 'msitarzewski/agency-agents';
const UPSTREAM_COMMIT = '87f8301cad3823a9a34d762036ae923a0eff306f';
const UPSTREAM_LICENSE = 'MIT';

/** JEXI routing vocabulary. kind is canonical; aliases are additional matches. */
const PHASE_KINDS = {
  0: { kind: 'discovery', aliases: ['research', 'intelligence', 'investigation', 'market-research'], name: 'Discovery' },
  1: { kind: 'strategy', aliases: ['architecture', 'planning', 'prioritization'], name: 'Strategy' },
  2: { kind: 'foundation', aliases: ['scaffolding', 'setup'], name: 'Foundation' },
  3: { kind: 'build', aliases: ['implementation', 'feature', 'develop', 'coding'], name: 'Build' },
  4: { kind: 'hardening', aliases: ['qa', 'quality', 'testing', 'verification'], name: 'Hardening' },
  5: { kind: 'launch', aliases: ['growth', 'go-to-market'], name: 'Launch' },
  6: { kind: 'operate', aliases: ['operations', 'sustain', 'monitoring'], name: 'Operate' },
};

/** Task-type table (6.2) rows -> JEXI kind + aliases. */
const TASK_KINDS = {
  'Frontend UI': { kind: 'frontend-ui', aliases: ['frontend', 'ui'] },
  'Backend API': { kind: 'backend-api', aliases: ['backend', 'api'] },
  Database: { kind: 'database', aliases: ['db', 'persistence'] },
  Mobile: { kind: 'mobile', aliases: [] },
  'AI/ML Feature': { kind: 'ai-ml-feature', aliases: ['ai-ml', 'ml', 'ai'] },
  Infrastructure: { kind: 'infrastructure', aliases: ['infra', 'devops'] },
  'Premium Polish': { kind: 'premium-polish', aliases: ['polish'] },
  'Rapid Prototype': { kind: 'rapid-prototype', aliases: ['prototype'] },
  'Spatial/XR': { kind: 'spatial-xr', aliases: ['xr', 'spatial'] },
  visionOS: { kind: 'visionos', aliases: [] },
  'Cockpit UI': { kind: 'cockpit-ui', aliases: [] },
  'CLI/Terminal': { kind: 'cli-terminal', aliases: ['cli', 'terminal'] },
  'Code Intelligence': { kind: 'code-intelligence', aliases: ['code-intel'] },
};

/** Runbook slugs -> JEXI kind + aliases. Roster comes from runbooks.json. */
const RUNBOOK_KINDS = {
  'startup-mvp': { kind: 'startup-mvp', aliases: ['mvp', 'startup'] },
  'enterprise-feature': { kind: 'enterprise-feature', aliases: ['enterprise', 'compliance-feature'] },
  'marketing-campaign': { kind: 'marketing-campaign', aliases: ['campaign', 'marketing'] },
  'incident-response': { kind: 'incident-response', aliases: ['incident', 'outage', 'p0'] },
};

const PHASE_SECTIONS = [
  { phase: 0, heading: '### 3.1 Active Agents', doc: 'strategy/nexus-strategy.md', playbook: 'strategy/playbooks/phase-0-discovery.md' },
  { phase: 1, heading: '### 4.1 Active Agents', doc: 'strategy/nexus-strategy.md', playbook: 'strategy/playbooks/phase-1-strategy.md' },
  { phase: 2, heading: '### 5.1 Active Agents', doc: 'strategy/nexus-strategy.md', playbook: 'strategy/playbooks/phase-2-foundation.md' },
  { phase: 4, heading: '### 7.1 Active Agents', doc: 'strategy/nexus-strategy.md', playbook: 'strategy/playbooks/phase-4-hardening.md' },
  { phase: 5, heading: '### 8.1 Active Agents', doc: 'strategy/nexus-strategy.md', playbook: 'strategy/playbooks/phase-5-launch.md' },
  { phase: 6, heading: '### 9.1 Active Agents (Ongoing)', doc: 'strategy/nexus-strategy.md', playbook: 'strategy/playbooks/phase-6-operate.md' },
];

const PHASE3 = {
  doc: 'strategy/nexus-strategy.md',
  playbook: 'strategy/playbooks/phase-3-build.md',
  taskMatrixHeading: '### 6.2 Agent Assignment by Task Type',
};

/** Split a markdown section into its table rows (arrays of trimmed cells). */
function tableRows(text, heading) {
  const start = text.indexOf(heading);
  if (start === -1) return [];
  const rest = text.slice(start + heading.length);
  const rows = [];
  for (const line of rest.split(/\r?\n/)) {
    const t = line.trim();
    if (t.startsWith('|')) {
      const cells = t.replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      if (cells.every((c) => /^:?-{2,}:?$/.test(c) || c === '')) continue;
      rows.push(cells);
    } else if (rows.length && t === '') {
      // table ended
      if (t === '' && !line.trim().startsWith('|')) break;
    }
  }
  return rows.slice(1); // drop header row
}

/** "**Frontend Developer**" -> "Frontend Developer". */
const cleanRef = (s) => String(s || '').replace(/\*\*/g, '').replace(/`/g, '').trim();

/** Parse "> **Duration**: 3-7 days | **Agents**: 6 | **Gate Keeper**: X". */
function playbookMeta(src, rel) {
  const file = path.join(src, rel);
  if (!fs.existsSync(file)) return { duration: null, agents: null, gateKeeper: null, doc: rel };
  const head = fs.readFileSync(file, 'utf8').split(/\r?\n/).slice(0, 12).join('\n');
  const grab = (label) => {
    const m = new RegExp(`\\*\\*${label}\\*\\*\\s*:\\s*([^|\\n]+)`, 'i').exec(head);
    return m ? m[1].trim() : null;
  };
  const agents = grab('Agents');
  return {
    duration: grab('Duration'),
    agents: agents === null ? null : Number.parseInt(agents, 10),
    gateKeeper: grab('Gate Keeper'),
    doc: rel,
  };
}

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function build() {
  if (!SRC || !fs.existsSync(SRC)) {
    console.error(`--src is required and must exist (got: ${SRC || '<empty>'})`);
    process.exit(2);
  }
  const nexus = fs.readFileSync(path.join(SRC, 'strategy/nexus-strategy.md'), 'utf8');
  const strategies = [];

  // 1. Phase strategies from the "Active Agents" tables.
  for (const { phase, heading, doc, playbook } of PHASE_SECTIONS) {
    const meta = PHASE_KINDS[phase];
    const rows = tableRows(nexus, heading);
    const candidates = rows.map((r) => cleanRef(r[0])).filter(Boolean);
    const roles = {};
    for (const r of rows) roles[cleanRef(r[0])] = cleanRef(r[1]);
    strategies.push({
      id: `nexus-phase-${phase}-${meta.kind}`,
      name: `NEXUS Phase ${phase} — ${meta.name}`,
      kind: meta.kind,
      aliases: meta.aliases,
      scope: 'phase',
      mode: 'NEXUS-Full',
      phase,
      candidates,
      roles,
      doc,
      playbook,
      playbookMeta: playbookMeta(SRC, playbook),
    });
  }

  // 2. Phase 3 (Build) has no "Active Agents" table; upstream defines it through
  //    the Dev<->QA loop and the task-type matrix. Candidates are the matrix's
  //    primary developers in order, then its QA agents, then the orchestrator.
  {
    const meta = PHASE_KINDS[3];
    const rows = tableRows(nexus, PHASE3.taskMatrixHeading);
    const seen = new Set();
    const candidates = [];
    const push = (n) => { const v = cleanRef(n); if (v && !seen.has(v)) { seen.add(v); candidates.push(v); } };
    for (const r of rows) push(r[1]);
    for (const r of rows) push(r[2]);
    push('Agents Orchestrator');
    strategies.push({
      id: `nexus-phase-3-${meta.kind}`,
      name: `NEXUS Phase 3 — ${meta.name}`,
      kind: meta.kind,
      aliases: meta.aliases,
      scope: 'phase',
      mode: 'NEXUS-Full',
      phase: 3,
      candidates,
      roles: {},
      doc: PHASE3.doc,
      playbook: PHASE3.playbook,
      playbookMeta: playbookMeta(SRC, PHASE3.playbook),
      note: 'Phase 3 candidates are composed from the 6.2 task-type matrix (primary developers, then QA agents) plus the Agents Orchestrator; upstream has no single Active Agents table for this phase.',
    });
  }

  // 3. Task-type strategies from the 6.2 matrix.
  {
    const rows = tableRows(nexus, PHASE3.taskMatrixHeading);
    for (const r of rows) {
      const taskType = cleanRef(r[0]);
      const meta = TASK_KINDS[taskType];
      if (!meta) continue;
      const candidates = [cleanRef(r[1]), cleanRef(r[2]), ...String(r[3] || '').split(',').map(cleanRef)].filter(Boolean);
      strategies.push({
        id: `nexus-task-${meta.kind}`,
        name: `NEXUS Task — ${taskType}`,
        kind: meta.kind,
        aliases: meta.aliases,
        scope: 'task',
        mode: 'NEXUS-Micro',
        taskType,
        primary: cleanRef(r[1]),
        qa: cleanRef(r[2]),
        candidates,
        doc: PHASE3.doc,
      });
    }
  }

  // 4. Scenario strategies from the machine-readable runbooks file.
  {
    const rbPath = path.join(SRC, 'strategy/runbooks.json');
    const rb = JSON.parse(fs.readFileSync(rbPath, 'utf8'));
    for (const r of (rb.runbooks || [])) {
      const meta = RUNBOOK_KINDS[r.slug] || { kind: r.slug, aliases: [] };
      const candidates = [];
      const groups = [];
      for (const g of (r.roster || [])) {
        groups.push({ group: g.group, activation: g.activation });
        for (const a of (g.agents || [])) if (!candidates.includes(a)) candidates.push(a);
      }
      strategies.push({
        id: `nexus-runbook-${r.slug}`,
        name: `NEXUS Runbook — ${r.title}`,
        kind: meta.kind,
        aliases: meta.aliases,
        scope: 'scenario',
        mode: r.mode,
        duration: r.duration,
        summary: r.summary,
        groups,
        candidates,
        doc: r.doc,
      });
    }
  }

  strategies.sort((a, b) => a.id.localeCompare(b.id));
  for (const s of strategies) s.aliases = [...s.aliases].sort();

  // Alias uniqueness is what makes routing deterministic; surface collisions in
  // the artifact itself rather than letting match order decide silently.
  const owner = new Map();
  const aliasCollisions = [];
  for (const s of strategies) {
    for (const key of [s.kind, ...s.aliases]) {
      if (owner.has(key) && owner.get(key) !== s.id) {
        aliasCollisions.push({ key, firstStrategy: owner.get(key), secondStrategy: s.id });
      } else if (!owner.has(key)) {
        owner.set(key, s.id);
      }
    }
  }

  return {
    kind: 'jexi.workforce.nexus-strategies',
    version: 1,
    upstream: UPSTREAM,
    upstreamCommit: UPSTREAM_COMMIT,
    license: UPSTREAM_LICENSE,
    note: 'Machine-usable projection of the upstream NEXUS strategy tree. Prose is NOT vendored; see README.md. Agent references are upstream display names/slugs, resolved against the roster at runtime.',
    count: strategies.length,
    kinds: [...owner.keys()].sort(),
    aliasCollisions,
    strategies,
  };
}

const payload = build();
const body = JSON.stringify(payload, null, 2) + '\n';

if (args.includes('--check')) {
  const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
  if (current === body) {
    console.log(`OK nexus projection matches ${SRC} (${payload.count} strategies).`);
    process.exit(0);
  }
  console.error(`DRIFT: ${path.relative(REPO, OUT)} does not match ${SRC}.`);
  process.exit(1);
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, body);
console.log(`wrote ${path.relative(REPO, OUT)}: ${payload.count} strategies`);
console.log('by scope:', JSON.stringify(payload.strategies.reduce((a, s) => { a[s.scope] = (a[s.scope] || 0) + 1; return a; }, {})));
console.log('alias collisions:', payload.aliasCollisions.length);
for (const c of payload.aliasCollisions) console.log('  ', JSON.stringify(c));