#!/usr/bin/env node
/**
 * scripts/regenerate-capabilities.mjs — Phase 31 Scope 8 (S8.5).
 *
 * Single source of truth for the README "Capabilities" table: every number is
 * DERIVED from the source tree at run time using the same derivations recorded
 * in docs/assets/screenshots/evidence/capability-counts.txt (grep / module
 * import equivalents — no hard-coded counts, no network, no credentials).
 *
 * Usage (repo root):
 *   node scripts/regenerate-capabilities.mjs            # table + README diff
 *   node scripts/regenerate-capabilities.mjs --json     # machine-readable
 *
 * Scope 8 boundary: this script does NOT edit the README. It prints the
 * derived table and flags every mismatch against the values the README
 * carries at Scope 8 time (README_STATED below) so a README-owning scope
 * can reconcile them.
 *
 * Zero dependencies. Exit 0 always (reporting tool, not a gate).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rel = (p) => path.join(ROOT, p);
const read = (p) => fs.readFileSync(rel(p), 'utf8');

/* README-stated values (README.md "Capabilities" table as of Phase 31 Scope 8,
 * commit f7090cd). The script flags drift between these and the live tree. */
const README_STATED = {
  agents: 400,
  divisions: 18,
  builtinTools: 39,
  toolDomains: 12,
  skills: 1164,
  mcpRegistered: 53,
  mcpEnabled: 29,
  mcpDirectoryTools: 538,
  webSearchEngines: 20,
  computerUseActions: 16,
  lifecycleHooks: 30,
  memoryVerbs: 5,
  dreamPhases: 13,
  consoleSurfaces: 3,
  researchFormats: 12,
  sourceConnectors: 16,
};

const derived = {};
const how = {};

/* 1. Agents in the workforce registry — import the real registry module. */
{
  const m = await import('../workforce/agents/index.js');
  await m.load?.();
  derived.agents = m.list().length;
  how.agents = "import '../workforce/agents/index.js'; await load?.(); list().length";
}

/* 2. Divisions — same module's divisions() (cross-checked against divisions.json). */
{
  const m = await import('../workforce/agents/index.js');
  derived.divisions = m.divisions().length;
  const json = JSON.parse(read('workforce/divisions.json')).divisions;
  how.divisions = `divisions().length (divisions.json ids: ${json.length}${derived.divisions === json.length ? '' : ' — MISMATCH with module'})`;
}

/* 3. Built-in tools — same derivation as the evidence file: unique
 *    `name: 'snake_case'` declarations under server/src/tools/domains. */
{
  const domainsRoot = rel('server/src/tools/domains');
  const names = new Set();
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(js|mjs)$/.test(e.name)) {
        const src = fs.readFileSync(p, 'utf8');
        for (const match of src.matchAll(/name:\s*'([a-z]+_[a-z0-9_]+)'/g)) names.add(match[1]);
      }
    }
  };
  walk(domainsRoot);
  derived.builtinTools = names.size;
  derived.toolDomains = fs.readdirSync(domainsRoot, { withFileTypes: true }).filter((e) => e.isDirectory()).length;
  how.builtinTools = "unique name: 'a_b' matches in server/src/tools/domains/**";
  how.toolDomains = 'directory count under server/src/tools/domains/';
}

/* 4. Skills — count SKILL.md files under skills/library. */
{
  let n = 0;
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name === 'SKILL.md') n += 1;
    }
  };
  walk(rel('skills/library'));
  derived.skills = n;
  how.skills = 'recursive SKILL.md count under skills/library';
}

/* 5. MCP registry — registered vs enabled-by-default (shipped defaults). */
{
  const reg = JSON.parse(read('server/mcp/registry.json')).servers;
  derived.mcpRegistered = reg.length;
  derived.mcpEnabled = reg.filter((s) => s.enabled !== false).length;
  how.mcpRegistered = "registry.json servers.length";
  how.mcpEnabled = 'registry.json servers with enabled !== false';
}

/* 6. MCP tool directory — live-verified tool records. */
{
  const dir = JSON.parse(read('server/mcp/tool-directory.json')).servers;
  derived.mcpDirectoryServers = Object.keys(dir).length;
  derived.mcpDirectoryTools = Object.values(dir).reduce((n, s) => n + (s.tools?.length || 0), 0);
  how.mcpDirectoryTools = 'sum of tools[] lengths in server/mcp/tool-directory.json';
  how.mcpDirectoryServers = 'server entry count in server/mcp/tool-directory.json';
}

/* 7. Web search engines — unique `id: 'slug'` declarations in WebSearch.js. */
{
  const ids = new Set();
  for (const match of read('server/src/services/WebSearch.js').matchAll(/id:\s*'([a-z0-9-]+)'/g)) ids.add(match[1]);
  derived.webSearchEngines = ids.size;
  how.webSearchEngines = "unique id: 'slug' matches in server/src/services/WebSearch.js";
}

/* 8. Computer-use actions — numbered {"action":...} training rows. */
{
  derived.computerUseActions = [...read('server/src/services/ComputerUseTraining.js').matchAll(/^\d+\. \{"action"/gm)].length;
  how.computerUseActions = 'lines matching /^\\d+\\. \\{"action"/ in server/src/services/ComputerUseTraining.js';
}

/* 9. Lifecycle hook events — the shipped Phase 30 catalog. */
{
  const m = await import('../harness/parity/hooks/catalog.js');
  derived.lifecycleHooks = m.HOOK_CATALOG.length;
  how.lifecycleHooks = "import '../harness/parity/hooks/catalog.js'; HOOK_CATALOG.length";
}

/* 10. Memory verbs (frozen protocol). */
{
  const m = await import('../brain/protocol/verbs.js');
  derived.memoryVerbs = m.VERB_NAMES.length;
  how.memoryVerbs = `VERB_NAMES.length (protocol ${m.PROTOCOL_VERSION}: ${m.VERB_NAMES.join(',')})`;
}

/* 11. Dream-cycle phases. */
{
  derived.dreamPhases = fs.readdirSync(rel('brain/cycle/phases')).filter((e) => !e.startsWith('.')).length;
  how.dreamPhases = 'entry count under brain/cycle/phases';
}

/* 12. Console surfaces. */
{
  const m = await import('../ui/web/console/shell/routes.js');
  derived.consoleSurfaces = m.ROUTES.length;
  how.consoleSurfaces = `ROUTES.length (${m.ROUTES.map((r) => r.label).join(' / ')})`;
}

/* 13. Research output formats. */
{
  const m = await import('../surfsense/output/formats.js');
  derived.researchFormats = m.FORMAT_NAMES.length;
  how.researchFormats = "import '../surfsense/output/formats.js'; FORMAT_NAMES.length";
}

/* 14. Source connectors. */
{
  const m = await import('../surfsense/connectors/index.js');
  derived.sourceConnectors = m.list().length;
  how.sourceConnectors = "import '../surfsense/connectors/index.js'; list().length";
}

/* 15. Retrieval benchmark metrics — declared metric keys (non-numeric row). */
{
  const src = read('brain/evals/brainbench.js');
  const p5 = /p5:\s*score\.precision/.test(src);
  const r5 = /r5:\s*score\.recall/.test(src);
  derived.benchmarkMetrics = (p5 ? 'P@5' : '') + (p5 && r5 ? ' / ' : '') + (r5 ? 'R@5' : '');
  how.benchmarkMetrics = 'p5:/r5: score keys declared in brain/evals/brainbench.js';
}

/* ---- render + compare ----------------------------------------------------- */
const rows = [
  ['Agents in the workforce registry', 'agents', README_STATED.agents],
  ['Divisions', 'divisions', README_STATED.divisions],
  ['Built-in tools (12 domains)', 'builtinTools', README_STATED.builtinTools],
  ['Tool domains', 'toolDomains', README_STATED.toolDomains],
  ['Skills (SKILL.md catalog)', 'skills', README_STATED.skills],
  ['MCP servers registered', 'mcpRegistered', README_STATED.mcpRegistered],
  ['MCP servers enabled by default', 'mcpEnabled', README_STATED.mcpEnabled],
  ['MCP directory servers (live-verified)', 'mcpDirectoryServers', null],
  ['Tools exposed by the MCP directory', 'mcpDirectoryTools', README_STATED.mcpDirectoryTools],
  ['Web search engines', 'webSearchEngines', README_STATED.webSearchEngines],
  ['Computer-use actions', 'computerUseActions', README_STATED.computerUseActions],
  ['Lifecycle hook events', 'lifecycleHooks', README_STATED.lifecycleHooks],
  ['Memory verbs (frozen protocol)', 'memoryVerbs', README_STATED.memoryVerbs],
  ['Dream-cycle phases', 'dreamPhases', README_STATED.dreamPhases],
  ['Console surfaces', 'consoleSurfaces', README_STATED.consoleSurfaces],
  ['Research output formats', 'researchFormats', README_STATED.researchFormats],
  ['Source connectors', 'sourceConnectors', README_STATED.sourceConnectors],
];

const json = process.argv.includes('--json');
const mismatches = [];
const lines = [];
lines.push('CAPABILITY          DERIVED  README   STATUS  DERIVATION');
for (const [label, key, stated] of rows) {
  const v = derived[key];
  const mismatch = stated !== null && v !== stated;
  if (mismatch) mismatches.push({ key, derived: v, stated });
  lines.push(`${label.padEnd(20).slice(0, 20)} ${String(v).padStart(7)}  ${stated === null ? '   —' : String(stated).padStart(7)}  ${(mismatch ? 'DRIFT' : 'ok').padEnd(6)}  ${how[key]}`);
}
lines.push(`Retrieval benchmark metrics ${derived.benchmarkMetrics}  (${how.benchmarkMetrics})`);
lines.push('');
lines.push(mismatches.length
  ? `MISMATCHES vs README-stated values: ${mismatches.length} — ${mismatches.map((m) => `${m.key}: derived ${m.derived} vs README ${m.stated}`).join('; ')}. README NOT edited (Scope 8 boundary); a README-owning scope reconciles these.`
  : 'All derived counts match the README-stated values.');
console.log(json ? JSON.stringify({ derived, readme: README_STATED, mismatches, how }, null, 2) : lines.join('\n'));
