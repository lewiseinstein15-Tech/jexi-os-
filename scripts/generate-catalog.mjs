#!/usr/bin/env node
/**
 * AGENT-CATALOG.md generator.
 *
 * Rebuilds the enumerated sections (agents / skills / tools) of
 * AGENT-CATALOG.md from the LIVE registries, so the doc can never drift from
 * the code again. The hand-written narrative sections (How it works, Intent →
 * team map, Reliability layers) are preserved verbatim.
 *
 * Usage:
 *   node scripts/generate-catalog.mjs --write   # rewrite AGENT-CATALOG.md
 *   node scripts/generate-catalog.mjs           # print to stdout
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CATALOG = path.join(ROOT, 'AGENT-CATALOG.md');

const { AGENT_ROSTER, SKILL_REGISTRY } = await import(path.join(ROOT, 'server/src/services/AgentRoster.js'));
const { TOOL_REGISTRY } = await import(path.join(ROOT, 'server/src/services/ToolRegistry.js'));

/** Primary category of an agent = category of its first listed skill. */
function agentCategory(agent, skillBySlug) {
  for (const slug of agent.skills || []) {
    const s = skillBySlug.get(slug);
    if (s && s.category) return s.category;
  }
  return 'Uncategorized';
}

function groupBy(items, keyFn) {
  const map = new Map();
  for (const item of items) {
    const k = keyFn(item);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(item);
  }
  return [...map.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
}

function buildAgentsSection(agents, skillBySlug) {
  const out = [];
  out.push(`## The ${agents.length} agents (grouped by primary skill category)\n`);
  for (const [cat, list] of groupBy(agents, (a) => agentCategory(a, skillBySlug))) {
    out.push(`### ${cat} (${list.length})`);
    out.push('| Agent | What it does |');
    out.push('|---|---|');
    for (const a of list) out.push(`| **${a.name}** | ${a.role || ''} |`);
    out.push('');
  }
  return out.join('\n').trimEnd() + '\n';
}

function buildSkillsSection(skills) {
  const out = [];
  out.push(`## The ${skills.length} skills (by category)\n`);
  for (const [cat, list] of groupBy(skills, (s) => s.category || 'Other')) {
    const slugs = list.map((s) => s.slug).join(', ');
    out.push(`- **${cat} (${list.length}):** ${slugs}`);
  }
  return out.join('\n').trimEnd() + '\n';
}

function buildToolsSection(tools) {
  const out = [];
  out.push(`## The ${tools.length} tools (by type)\n`);
  for (const [type, list] of groupBy(tools, (t) => t.type || 'Other')) {
    out.push(`### ${type} (${list.length})`);
    out.push('| Tool | What it does |');
    out.push('|---|---|');
    for (const t of list) out.push(`| **${t.name}** | ${t.desc || ''} |`);
    out.push('');
  }
  return out.join('\n').trimEnd() + '\n';
}

const skillBySlug = new Map(SKILL_REGISTRY.map((s) => [s.slug, s]));

const generated =
  buildAgentsSection(AGENT_ROSTER, skillBySlug) +
  '\n---\n\n' +
  buildSkillsSection(SKILL_REGISTRY) +
  '\n---\n\n' +
  buildToolsSection(TOOL_REGISTRY);

const old = fs.readFileSync(CATALOG, 'utf-8');
const lines = old.split('\n');
const lineStart = (pred) => lines.findIndex((l) => pred(l));

// Boundaries are heading lines, found by pattern (not hardcoded counts):
//   agents section:  "## The N agents (grouped by ...)"
//   skills section:  "## The N skills (by category)"
//   reliability:     "## Reliability layers"
const startAgents = lineStart((l) => /^## The \d+ agents/.test(l));
const startReliability = lineStart((l) => /^## Reliability layers/.test(l));

const head = startAgents > 0 ? lines.slice(0, startAgents).join('\n') : '';
const tail = startReliability > 0 ? lines.slice(startReliability).join('\n') : '';

const next = `${head}\n${generated}\n\n---\n\n${tail}`;

if (process.argv.includes('--write')) {
  fs.writeFileSync(CATALOG, next, 'utf-8');
  console.log(`✅ AGENT-CATALOG.md regenerated: ${AGENT_ROSTER.length} agents, ${SKILL_REGISTRY.length} skills, ${TOOL_REGISTRY.length} tools`);
} else {
  process.stdout.write(next);
}
