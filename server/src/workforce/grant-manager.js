/**
 * MCP GRANT MANAGER (Phase 3, Scope D — grant management UI surface).
 *
 * Layer: API routes + shared module (see index.js) on top of a persisted
 * `.jexi/permissions.yaml`. Chosen over a Vite panel because JEXI's only
 * stable client surface today is its Express API; the same routes are
 * callable from the CLI, curl, or the future frontend panel.
 *
 * Persistence design
 * ------------------
 *   `.jexi/permissions.yaml` holds per-agent MCP grants:
 *
 *     agents:
 *       - name: zola
 *         allowedMCP:
 *           - server: weather
 *             tools: ["*"]
 *
 *   When the file is absent the manager falls back to the shipped defaults
 *   (director/Employees.js `allowedMCP`), so a fresh checkout behaves like
 *   today. Saving a grant first loads defaults, merges the mutation, and
 *   writes the merge — grants are never silently lost.
 *
 * File location is overridable for tests/CI via JEXI_PERMISSIONS_FILE or
 * DATA_DIR (DATA_DIR/permissions.yaml).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadEmployees, setMCPGrantsProvider } from '../services/director/Employees.js';

// Register ourselves as the grants overlay so the Director's hot-path employee
// roster reflects .jexi/permissions.yaml (no circular import — Employees.js
// only ever calls the injected provider one-directionally).
setMCPGrantsProvider(() => listGrantsForOverride());

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = path.resolve(__dirname, '..');

function defaultPersistDir() {
  // Task contract: .jexi/permissions.yaml. DATA_DIR is used in tests/CI so a
  // run never touches a real repo-local .jexi dir; otherwise repo-root .jexi.
  if (process.env.DATA_DIR) return process.env.DATA_DIR;
  return path.join(SERVER_ROOT, '.jexi');
}

export function permissionsFile() {
  if (process.env.JEXI_PERMISSIONS_FILE) return process.env.JEXI_PERMISSIONS_FILE;
  return path.join(defaultPersistDir(), 'permissions.yaml');
}

export const DEFAULT_AUDIT = () => path.join(defaultPersistDir(), 'mcp-audit.jsonl');

/* ── minimal YAML (subset) serializer — no extra dependency ────────────────
 * Handles: top-level "agents:", list items "- name:", nested "allowedMCP:",
 * scalar tools lists. Keys/values are strings/arrays of strings or booleans.
 */
function yamlScalar(v) {
  if (v === true) return 'true';
  if (v === false) return 'false';
  const s = String(v);
  if (/^[-*?]|^[\s\d]|[:#]|[\s]$/.test(s)) return JSON.stringify(s);
  return s;
}

export function toYaml(agents) {
  const out = ['agents:'];
  for (const a of agents) {
    out.push(`  - name: ${yamlScalar(a.name)}`);
    const mcp = Array.isArray(a.allowedMCP) ? a.allowedMCP : [];
    if (mcp.length) out.push('    allowedMCP:');
    for (const g of mcp) {
      out.push(`      - server: ${yamlScalar(g.server)}`);
      out.push(`        tools: [${(g.tools || []).map((t) => yamlScalar(t)).join(', ')}]`);
    }
  }
  return out.join('\n') + '\n';
}

function parseYamlTools(line) {
  const m = line.trim().match(/^tools:\s*\[(.*)\]$/);
  if (!m) return [];
  return m[1].split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
}

export function fromYaml(text) {
  const agents = [];
  let cur = null;
  let inAllowed = false;
  for (const raw of text.split('\n')) {
    const line = raw.trimEnd();
    const mm = line.match(/^\x20{2}- name:\s*(.+)$/);
    if (mm) { cur = { name: mm[1].replace(/^["']|["']$/g, ''), allowedMCP: [] }; agents.push(cur); inAllowed = false; continue; }
    if (!cur) continue;
    if (/^\x20*allowedMCP:\s*$/.test(line)) { inAllowed = true; continue; }
    const gm = line.match(/^\x20{6}- server:\s*(.+)$/);
    if (gm && inAllowed) {
      cur.allowedMCP.push({ server: gm[1].replace(/^["']|["']$/g, ''), tools: [] });
      continue;
    }
    const tm = line.match(/^\x20{8}tools:\s*\[(.*)\]$/);
    if (tm && inAllowed && cur.allowedMCP.length) {
      cur.allowedMCP[cur.allowedMCP.length - 1].tools = parseYamlTools(line);
    }
  }
  return agents;
}

/* ── load / save ────────────────────────────────────────────────────────── */
function defaultsFromEmployees() {
  return loadEmployees().map((e) => ({
    name: e.agentId,
    role: e.role,
    allowedMCP: (e.allowedMCP || []).map((g) => ({ server: g.server, tools: [...g.tools] })),
  }));
}

export function listGrants() {
  const file = permissionsFile();
  if (fs.existsSync(file)) {
    try { return fromYaml(fs.readFileSync(file, 'utf8')); }
    catch { /* malformed → fall back to defaults (never fatal) */ }
  }
  return defaultsFromEmployees();
}

/** Overlay hook for Employees.js: the YAML grants when a file exists, else
 * defaults (Employees' own defaults are applied anyway, so returning [] here
 * when no YAML exists keeps the roster untouched). */
function listGrantsForOverride() {
  const file = permissionsFile();
  if (!fs.existsSync(file)) return [];
  return listGrants();
}

function normalizeName(n) {
  return String(n || '').toLowerCase().replace(/[^a-z0-9-]/g, '');
}

function saveGrants(agents) {
  const file = permissionsFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, toYaml(agents), { mode: 0o600 });
}

function findAgent(agents, name) {
  const n = normalizeName(name);
  return agents.find((a) => normalizeName(a.name) === n) || null;
}

/** Add/update a grant: default tool '*' when tool not given. Returns {ok, agent}. */
export function addGrant(agentName, server, tool) {
  const agents = listGrants();
  let agent = findAgent(agents, agentName);
  if (!agent) {
    agent = { name: normalizeName(agentName), allowedMCP: [] };
    agents.push(agent);
  }
  const srv = String(server || '').trim();
  if (!srv) return { ok: false, error: 'server is required' };
  let grant = agent.allowedMCP.find((g) => g.server === srv);
  if (!grant) {
    grant = { server: srv, tools: [] };
    agent.allowedMCP.push(grant);
  }
  const t = String(tool || '*').trim();
  if (t === '*') grant.tools.includes('*') || grant.tools.push('*');
  else grant.tools.includes(t) || grant.tools.push(t);
  saveGrants(agents);
  return { ok: true, agent };
}

/** Remove a grant. tool given → remove only that tool; no tool → remove the whole server entry. */
export function removeGrant(agentName, server, tool) {
  const agents = listGrants();
  const agent = findAgent(agents, agentName);
  if (!agent) return { ok: false, error: `no agent "${agentName}"` };
  const srv = String(server || '').trim();
  const idx = agent.allowedMCP.findIndex((g) => g.server === srv);
  if (idx < 0) return { ok: false, error: `grant for server '${srv}' not found for ${agent.name}` };
  const t = String(tool || '').trim();
  if (!t) {
    agent.allowedMCP.splice(idx, 1);
  } else {
    const grant = agent.allowedMCP[idx];
    grant.tools = grant.tools.filter((x) => x !== t);
    if (!grant.tools.length) agent.allowedMCP.splice(idx, 1);
  }
  saveGrants(agents);
  return { ok: true, agent };
}

/** Reset to shipped defaults (delete the override file). */
export function resetGrants() {
  const file = permissionsFile();
  try { fs.rmSync(file, { force: true }); } catch { /* already gone */ }
  return { ok: true, agents: defaultsFromEmployees() };
}

/* ── recent MCP_DENIED audit history ────────────────────────────────────── */
export function recentDenied(limit = 25) {
  const file = DEFAULT_AUDIT();
  if (!fs.existsSync(file)) return [];
  try {
    const lines = fs.readFileSync(file, 'utf8').trimEnd().split('\n').filter(Boolean);
    const out = [];
    for (const line of lines.slice(-limit)) {
      try {
        const e = JSON.parse(line);
        if (e.type === 'MCP_DENIED') out.push(e);
      } catch { /* skip malformed */ }
    }
    return out;
  } catch { return []; }
}