/**
 * JEXI OS — Plugin Registry (roadmap stage 21).
 *
 * Grok Build's extension system ships skills, plugins, hooks and MCP servers
 * as installable packages. JEXI's plugins are versioned feature bundles: each
 * one contributes a slice of the agent roster, skill registry, tool catalog
 * and hooks. Plugins can be enabled/disabled at runtime and the state
 * persists to DATA_DIR/plugins.json — the catalog screens can show what each
 * plugin contributes and toggle it without a redeploy.
 */

import fs from 'fs';
import path from 'path';
import { DATA_DIR } from '../config.js';
import { AGENT_ROSTER, SKILL_REGISTRY } from './AgentRoster.js';
import { TOOL_REGISTRY } from './ToolRegistry.js';

const STATE_FILE = path.join(DATA_DIR, 'plugins.json');

/** Built-in plugins — bundled with JEXI, each contributes real catalog entries. */
export const PLUGINS = [
  {
    id: 'core',
    name: 'JEXI Core',
    version: '1.0.0',
    desc: 'The essential operating system: planner, orchestrator, memory, conversation and identity.',
    builtin: true,
    contributes: { agents: ['planner', 'orchestrator', 'jexi', 'reasoner', 'memory', 'archivist'], tools: ['memory-recall', 'memory-write', 'profile-read', 'semantic-search'], hooks: 0 },
  },
  {
    id: 'research-pack',
    name: 'Research Pack',
    version: '1.2.0',
    desc: 'Search, deep-read, news, books and fact-checking — the research team.',
    builtin: true,
    contributes: { agents: ['searcher', 'researcher', 'extractor', 'news-scout', 'fact-checker', 'scholar'], tools: ['web-search', 'deep-read', 'news-feed', 'trusted-library', 'pdf-extract'], hooks: 0 },
  },
  {
    id: 'coding-pack',
    name: 'Coding Pack',
    version: '1.4.0',
    desc: 'Architect → Coder → QA → Reviewer → Security → Shipper with the debug loop.',
    builtin: true,
    contributes: { agents: ['architect', 'coder', 'debugger', 'qa', 'reviewer', 'security', 'shipper'], tools: ['code-run', 'code-write', 'code-fix', 'build-check', 'test-automation'], hooks: 0 },
  },
  {
    id: 'data-pack',
    name: 'Data & Quant Pack',
    version: '1.1.0',
    desc: 'Data crunching, statistics, charts and database work.',
    builtin: true,
    contributes: { agents: ['data', 'data-engineer', 'sql', 'data-scientist', 'data-viz'], tools: ['data-crunch', 'chart-builder', 'stats-compute', 'db-query'], hooks: 0 },
  },
  {
    id: 'media-pack',
    name: 'Media & Vision Pack',
    version: '1.1.0',
    desc: 'Video analysis, vision, OCR and image understanding.',
    builtin: true,
    contributes: { agents: ['video-analyst', 'vision'], tools: ['video-analyze', 'video-transcript', 'video-frames', 'vision-analyze', 'ocr-read'], hooks: 0 },
  },
  {
    id: 'life-pack',
    name: 'Life & Productivity Pack',
    version: '1.0.0',
    desc: 'Meal, fitness, study, travel and productivity specialists.',
    builtin: true,
    contributes: { agents: ['nutrition', 'fitness', 'study', 'travel', 'scheduler', 'task-manager'], tools: [], hooks: 0 },
  },
];

/* ------------------------------------------------------------------ */
/* B50 P5 — ON-DISK PLUGIN PACKAGES: server/plugins/<id>/plugin.json    */
/* ------------------------------------------------------------------ */
const __dirname = path.dirname(new URL(import.meta.url).pathname);
export const PLUGINS_DIR = path.resolve(__dirname, '../../plugins');

/** Discover installable plugin packages from server/plugins/ (plugin.json manifests). */
export function discoverPlugins() {
  if (!fs.existsSync(PLUGINS_DIR)) return [];
  const out = [];
  for (const entry of fs.readdirSync(PLUGINS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const jsonPath = path.join(PLUGINS_DIR, entry.name, 'plugin.json');
    if (!fs.existsSync(jsonPath)) continue;
    try {
      const m = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
      if (!m.id || !m.name) continue;
      out.push({
        id: m.id,
        name: m.name,
        version: m.version || '0.0.0',
        desc: m.description || m.desc || m.name,
        builtin: false,
        packageDir: path.join(PLUGINS_DIR, entry.name),
        contributes: {
          agents: m.contributes?.agents || [],
          skills: m.contributes?.skills || [],
          tools: m.contributes?.tools || [],
          skillsDir: m.contributes?.skillsDir || 'skills',
          hooks: 0,
        },
      });
    } catch (e) { /* malformed manifest — skip, log */ }
  }
  return out;
}

/** The full catalog: built-in plugins + discovered on-disk packages. */
export const ALL_PLUGINS = [...PLUGINS, ...discoverPlugins()];

const registry = new Map(AGENT_ROSTER.map((a) => [a.slug, a]));
const skillMap = new Map(SKILL_REGISTRY.map((s) => [s.slug, s]));
const toolMap = new Map(TOOL_REGISTRY.map((t) => [t.slug, t]));

let state = load();
function load() {
  try {
    if (fs.existsSync(STATE_FILE)) return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
  } catch (e) { /* fresh */ }
  // Fresh install: core + every package that declares enabledByDefault (the
  // Sept 2026 plugin pack ships ON — Lewis's call: things work directly, no switches).
  const auto = ['core'];
  try {
    for (const m of discoverPlugins()) {
      try {
        const manifest = JSON.parse(fs.readFileSync(path.join(m.packageDir, 'plugin.json'), 'utf-8'));
        if (manifest.enabledByDefault === true) auto.push(m.id);
      } catch { /* skip malformed */ }
    }
  } catch { /* plugins dir absent */ }
  return { enabled: auto };
}

function persist() {
  try {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
  } catch (e) { console.error('[Plugins] persist error:', e.message); }
}

export function isPluginEnabled(id) {
  return (state.enabled || []).includes(id);
}

export function enablePlugin(id) {
  if (!ALL_PLUGINS.some((p) => p.id === id)) throw new Error(`Unknown plugin: ${id}`);
  if (id === 'core') return { id, enabled: true }; // core cannot be disabled
  if (!state.enabled.includes(id)) state.enabled.push(id);
  persist();
  return { id, enabled: true };
}

export function disablePlugin(id) {
  if (!ALL_PLUGINS.some((p) => p.id === id)) throw new Error(`Unknown plugin: ${id}`);
  if (id === 'core') throw new Error('JEXI Core cannot be disabled');
  state.enabled = state.enabled.filter((x) => x !== id);
  persist();
  return { id, enabled: false };
}

export function togglePlugin(id) {
  return isPluginEnabled(id) ? disablePlugin(id) : enablePlugin(id);
}

/** Full plugin catalog with live contribution counts + enabled state. */
export function listPlugins() {
  return ALL_PLUGINS.map((p) => {
    const agents = (p.contributes.agents || []).filter((s) => registry.has(s));
    // Skills: declared list, plus whatever folders the package ships.
    const declaredSkills = (p.contributes.skills || []).filter((s) => skillMap.has(s));
    let packagedSkills = 0;
    if (p.packageDir && p.contributes.skillsDir) {
      const skillsBase = path.join(p.packageDir, p.contributes.skillsDir);
      if (fs.existsSync(skillsBase)) {
        packagedSkills = fs.readdirSync(skillsBase, { withFileTypes: true })
          .filter((e) => e.isDirectory() && fs.existsSync(path.join(skillsBase, e.name, 'SKILL.md'))).length;
      }
    }
    const skills = [...new Set([...declaredSkills, ...(p.contributes.agents || []).flatMap((slug) => registry.get(slug)?.skills || [])
      .filter((s) => skillMap.has(s))])];
    const tools = (p.contributes.tools || []).filter((s) => toolMap.has(s));
    return {
      ...p,
      enabled: isPluginEnabled(p.id),
      live: { agents: agents.length, skills: skills.length, tools: tools.length, packagedSkills },
    };
  });
}

/** Union of agent slugs contributed by the currently enabled plugins. */
export function enabledPluginAgents() {
  const set = new Set();
  for (const p of ALL_PLUGINS) {
    if (isPluginEnabled(p.id)) for (const a of p.contributes.agents || []) set.add(a);
  }
  return set;
}
