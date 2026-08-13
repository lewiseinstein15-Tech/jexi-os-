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

const registry = new Map(AGENT_ROSTER.map((a) => [a.slug, a]));
const skillMap = new Map(SKILL_REGISTRY.map((s) => [s.slug, s]));
const toolMap = new Map(TOOL_REGISTRY.map((t) => [t.slug, t]));

let state = load();
function load() {
  try {
    if (fs.existsSync(STATE_FILE)) return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
  } catch (e) { /* fresh */ }
  return { enabled: ['core'] }; // core is always on
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
  if (!PLUGINS.some((p) => p.id === id)) throw new Error(`Unknown plugin: ${id}`);
  if (id === 'core') return { id, enabled: true }; // core cannot be disabled
  if (!state.enabled.includes(id)) state.enabled.push(id);
  persist();
  return { id, enabled: true };
}

export function disablePlugin(id) {
  if (!PLUGINS.some((p) => p.id === id)) throw new Error(`Unknown plugin: ${id}`);
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
  return PLUGINS.map((p) => {
    const agents = (p.contributes.agents || []).filter((s) => registry.has(s));
    const skills = (p.contributes.agents || []).flatMap((slug) => registry.get(slug)?.skills || [])
      .filter((s, i, arr) => skillMap.has(s) && arr.indexOf(s) === i);
    const tools = (p.contributes.tools || []).filter((s) => toolMap.has(s));
    return {
      ...p,
      enabled: isPluginEnabled(p.id),
      live: { agents: agents.length, skills: skills.length, tools: tools.length },
    };
  });
}

/** Union of agent slugs contributed by the currently enabled plugins. */
export function enabledPluginAgents() {
  const set = new Set();
  for (const p of PLUGINS) {
    if (isPluginEnabled(p.id)) for (const a of p.contributes.agents || []) set.add(a);
  }
  return set;
}
