/**
 * B208 — EMPLOYEES: JEXI's team of stable AI coworkers.
 *
 * The identity inversion the Director architecture is built on:
 *
 *   WRONG (old B162 world):  model → people name ("Maya" = gemini-2.5-flash)
 *   RIGHT (this module):     person → role → capabilities → model session
 *
 * An employee is a STABLE identity (Zola stays Zola). The model that powers
 * her at any moment is a session detail, chosen by the ModelRouter and
 * swappable without changing who she is. Nothing in this module knows a
 * model id.
 *
 * The roster is data, not code: `data/employees.json` overrides the defaults
 * below (add/remove/rename employees without a redeploy). Capability tokens
 * are a controlled vocabulary (with synonyms normalized in CAP_SYNONYMS) —
 * matching is capability-driven, never task-keyword-driven: the Director's
 * interpreter decides WHAT the work needs; this module only answers WHO can
 * do it.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'node:url';
import { telemetry } from './Telemetry.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(HERE, '..', '..', '..', 'data', 'employees.json');
const HISTORY_DIR = path.join(HERE, '..', '..', '..', 'data', 'director-history');

/**
 * Capability vocabulary — synonyms collapse to canonical tokens so the
 * interpreter's free-form requirement words ("engineering", "testing")
 * normalize to matchable capabilities ("code", "verification").
 * This is a VOCABULARY, not task scripting: no request words live here.
 */
const CAP_SYNONYMS = {
  coding: 'code', engineering: 'code', programming: 'code', implementation: 'code',
  debug: 'code', debugging: 'code', build: 'code', refactoring: 'code',
  research: 'research', investigation: 'research', 'web-research': 'research',
  analysis: 'research', 'fact-checking': 'research', 'source-analysis': 'research',
  search: 'search', browsing: 'search', retrieval: 'search', 'web-search': 'search',
  synthesis: 'synthesis', summarization: 'synthesis', writing: 'synthesis',
  'technical-writing': 'synthesis', drafting: 'synthesis',
  verification: 'verification', testing: 'verification', review: 'verification',
  qa: 'verification', 'quality-assurance': 'verification', auditing: 'verification',
  security: 'security', 'security-audit': 'security', 'threat-analysis': 'security',
  hardening: 'security', 'pen-testing': 'security',
  planning: 'planning', decomposition: 'planning', architecture: 'planning',
  prioritization: 'planning', restructuring: 'planning', estimation: 'planning',
  memory: 'memory', 'knowledge-recall': 'memory', context: 'memory',
  history: 'memory', 'knowledge-management': 'memory',
  data: 'data', 'data-analysis': 'data', sql: 'data', statistics: 'data',
  visualization: 'data', 'data-engineering': 'data',
  design: 'design', ux: 'design', 'visual-design': 'design', copy: 'design',
  'product-design': 'design', 'ui-design': 'design',
  reasoning: 'reasoning', 'critical-thinking': 'reasoning', logic: 'reasoning',
  math: 'reasoning', 'mathematics': 'reasoning', calculation: 'reasoning',
};

/** Canonical capability tokens an employee profile may declare. */
const KNOWN_CAPS = new Set([
  'code', 'research', 'search', 'synthesis', 'verification', 'security',
  'planning', 'memory', 'data', 'design', 'reasoning',
]);

export function normalizeCap(token) {
  const t = String(token || '').toLowerCase().trim().replace(/\s+/g, '-');
  return CAP_SYNONYMS[t] || t;
}

/**
 * The default roster. Names/roles are the USER-FACING identity layer and are
 * deliberately distinct from any provider's model branding.
 */
const DEFAULT_EMPLOYEES = [
  {
    agentId: 'zola',
    displayName: 'Zola',
    role: 'Research Specialist',
    description: 'Investigates topics, compares sources, and delivers grounded findings.',
    personality: 'curious, precise, analytical',
    capabilities: ['research', 'search', 'synthesis', 'reasoning'],
    supportedTools: ['web-search', 'memory-recall', 'knowledge-save'],
    permissions: ['READ', 'NETWORK'],
  },
  {
    agentId: 'forge',
    displayName: 'Forge',
    role: 'Senior Engineer',
    description: 'Designs, implements, and repairs code. Owns engineering deliverables.',
    personality: 'pragmatic, thorough, no-nonsense',
    capabilities: ['code', 'reasoning', 'planning'],
    supportedTools: ['web-search', 'memory-recall', 'knowledge-save', 'file-write', 'run-command'],
    permissions: ['READ', 'WRITE', 'EXECUTE', 'NETWORK'],
  },
  {
    agentId: 'vera',
    displayName: 'Vera',
    role: 'Verification Lead',
    description: 'The skeptic. Checks every deliverable against the objective before it ships.',
    personality: 'rigorous, honest, unsentimental',
    capabilities: ['verification', 'reasoning', 'synthesis'],
    supportedTools: ['web-search', 'memory-recall'],
    permissions: ['READ', 'NETWORK'],
  },
  {
    agentId: 'nyx',
    displayName: 'Nyx',
    role: 'Security Specialist',
    description: 'Threat analysis, hardening, and adversarial review.',
    personality: 'cautious, sharp, direct',
    capabilities: ['security', 'verification', 'reasoning'],
    supportedTools: ['web-search', 'memory-recall'],
    permissions: ['READ', 'NETWORK'],
  },
  {
    agentId: 'atlas',
    displayName: 'Atlas',
    role: 'Architect',
    description: 'Decomposes large objectives, structures plans, sequences work.',
    personality: 'structured, calm, far-sighted',
    capabilities: ['planning', 'reasoning', 'synthesis'],
    supportedTools: ['memory-recall'],
    permissions: ['READ'],
  },
  {
    agentId: 'echo',
    displayName: 'Echo',
    role: 'Knowledge Curator',
    description: 'Remembers everything the team has learned and retrieves it on demand.',
    personality: 'organized, quiet, reliable',
    capabilities: ['synthesis', 'memory', 'research'],
    supportedTools: ['memory-recall', 'rolling-summary', 'episode-recall', 'semantic-search', 'knowledge-save', 'file-write'],
    permissions: ['READ', 'WRITE'],
  },
  {
    agentId: 'scout',
    displayName: 'Scout',
    role: 'Field Researcher',
    description: 'Runs the searches and pulls the raw material. Support role — feeds the leads.',
    personality: 'fast, tireless, literal',
    support: true,
    capabilities: ['search'],
    supportedTools: ['web-search'],
    permissions: ['READ', 'NETWORK'],
  },
  {
    agentId: 'kito',
    displayName: 'Kito',
    role: 'Data Specialist',
    description: 'Analyzes data, writes queries, and builds visual explanations.',
    personality: 'methodical, exact, patient',
    capabilities: ['data', 'reasoning', 'synthesis'],
    supportedTools: ['web-search', 'memory-recall'],
    permissions: ['READ', 'NETWORK'],
  },
  {
    agentId: 'ada',
    displayName: 'Ada',
    role: 'Product Designer',
    description: 'Shapes how things look, read, and feel. Support role for user-facing work.',
    support: true,
    personality: 'thoughtful, taste-driven, concise',
    capabilities: ['design', 'synthesis'],
    supportedTools: ['memory-recall'],
    permissions: ['READ'],
  },
];

let _cache = null;
let _cacheMtime = 0;

/** Load the roster: data/employees.json overrides the defaults (hot-reloaded on mtime). */
export function loadEmployees() {
  try {
    const st = fs.statSync(CONFIG_PATH);
    if (_cache && st.mtimeMs === _cacheMtime) return _cache;
    const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    if (Array.isArray(raw.employees) && raw.employees.length) {
      _cache = raw.employees.map(normalizeEmployee);
      _cacheMtime = st.mtimeMs;
      return _cache;
    }
  } catch { /* fall back to defaults */ }
  _cache = DEFAULT_EMPLOYEES.map(normalizeEmployee);
  return _cache;
}

function normalizeEmployee(e) {
  const caps = (e.capabilities || []).map(normalizeCap).filter((c) => KNOWN_CAPS.has(c));
  return {
    agentId: String(e.agentId || e.displayName || 'employee').toLowerCase().replace(/[^a-z0-9-]/g, ''),
    displayName: String(e.displayName || e.agentId || 'Employee').slice(0, 40),
    role: String(e.role || 'Specialist').slice(0, 60),
    description: String(e.description || '').slice(0, 300),
    personality: String(e.personality || '').slice(0, 200),
    capabilities: caps.length ? caps : ['reasoning'],
    supportedTools: Array.isArray(e.supportedTools) ? e.supportedTools.map(String) : [],
    permissions: Array.isArray(e.permissions) ? e.permissions.map(String) : ['READ'],
    support: Boolean(e.support),
    disabled: Boolean(e.disabled),
  };
}

export function getEmployee(agentId) {
  return loadEmployees().find((e) => e.agentId === String(agentId).toLowerCase()) || null;
}

/**
 * Capability-driven employee selection (the Director's staffing decision).
 *
 * `requirements` — capability tokens the work needs (from the interpreter,
 *   already free of task words; they are capabilities, not user keywords).
 * Scoring: for each requirement, the employee's best capability match
 * (exact 1.0 / same-token 0.8 via synonyms already collapsed / none 0),
 * weighted by reliability from telemetry (bounded ±0.15 so a hot streak
 * never outweighs a missing capability). Ties break on lower recent load.
 *
 * @returns ranked [{ employee, score, matched, missing }]
 */
export function rankEmployees(requirements, opts = {}) {
  const reqs = [...new Set((requirements || []).map(normalizeCap).filter(Boolean))];
  const out = [];
  for (const employee of loadEmployees()) {
    if (employee.disabled) continue;
    if (opts.exclude?.has(employee.agentId)) continue;
    // B210 — some subtasks NEED a real tool (execution): only employees
    // staffed for it may be selected, whoever else ranks higher on paper
    if (opts.requireTool && !(employee.supportedTools || []).includes(opts.requireTool)) continue;
    let score = 0;
    const matched = [];
    const missing = [];
    for (const req of reqs) {
      const capScore = employee.capabilities.includes(req)
        ? 1
        : (KNOWN_CAPS.has(req) ? 0 : 0.5); // unknown token: everyone is a partial fit
      if (capScore >= 1) matched.push(req);
      else missing.push(req);
      score += capScore;
    }
    const denom = Math.max(1, reqs.length);
    let fit = score / denom;
    // SPECIALIZATION: the employee whose PRIMARY capability (first declared)
    // is what the work needs outranks a generalist with the same fit.
    const primary = employee.capabilities[0];
    const primaryMatch = reqs.length === 1 && reqs[0] === primary ? 0.02 : 0;
    // SUPPORT roles (Scout, Ada) back up the leads — they never outrank a
    // specialist on a tie for the same capability set.
    const supportPenalty = employee.support ? 0.02 : 0;
    // Reliability bonus from real telemetry (adaptive orchestration — not training)
    const stats = telemetry.employeeStats(employee.agentId);
    const reliability = stats.samples >= 3 ? 0.15 * (stats.successRate - 0.5) : 0;
    // uncapped: bonuses must differentiate near-equal capability fits
    out.push({ employee, score: Math.round((fit + primaryMatch - supportPenalty + reliability) * 1000) / 1000, matched, missing });
  }
  out.sort((a, b) => b.score - a.score || (a.employee.capabilities.length - b.employee.capabilities.length) || a.employee.agentId.localeCompare(b.employee.agentId));
  return out;
}

/** Pick the best employee for a subtask; `fallback` (usually 'echo') if nothing matches. */
export function selectEmployee(requirements, opts = {}) {
  const ranked = rankEmployees(requirements, opts);
  if (!ranked.length) return getEmployee(opts.fallback || 'echo') || loadEmployees()[0];
  return ranked[0].employee;
}

/** Public snapshot for the UI / API (identity first; models are session details). */
export function rosterSummary() {
  return loadEmployees().filter((e) => !e.disabled).map((e) => ({
    agentId: e.agentId,
    displayName: e.displayName,
    role: e.role,
    capabilities: e.capabilities,
    status: 'available',
  }));
}


/* ── B209: per-employee task history (bounded JSONL, replayable) ── */
export function appendEmployeeHistory(agentId, entry) {
  try {
    fs.mkdirSync(HISTORY_DIR, { recursive: true });
    const file = path.join(HISTORY_DIR, `${String(agentId).replace(/[^a-z0-9-]/gi, '_')}.jsonl`);
    const lines = [JSON.stringify({ ts: new Date().toISOString(), ...entry })];
    fs.appendFileSync(file, lines.join('\n') + '\n');
  } catch { /* history is best-effort */ }
}

export function employeeHistory(agentId, limit = 30) {
  try {
    const file = path.join(HISTORY_DIR, `${String(agentId).replace(/[^a-z0-9-]/gi, '_')}.jsonl`);
    const raw = fs.readFileSync(file, 'utf-8').trim();
    if (!raw) return [];
    return raw.split('\n').filter(Boolean).slice(-limit).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean).reverse();
  } catch { return []; }
}

/** Full roster detail for management: profile + live stats + history depth. */
export function rosterDetail() {
  return loadEmployees().map((e) => {
    const stats = telemetry.employeeStats(e.agentId);
    return {
      agentId: e.agentId, displayName: e.displayName, role: e.role, description: e.description,
      personality: e.personality, capabilities: e.capabilities, permissions: e.permissions,
      supportedTools: e.supportedTools, support: Boolean(e.support), disabled: Boolean(e.disabled),
      stats, historyCount: employeeHistory(e.agentId, 200).length,
    };
  });
}

/** B209 — runtime roster management: persist changes to data/employees.json
 * (hot-reloaded). Deletion is modeled as disable — identities are stable. */
export function saveRosterOverride(employees) {
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify({ employees }, null, 2));
  _cache = null; // force reload
}

export function setEmployeeDisabled(agentId, disabled) {
  const roster = loadEmployees();
  const target = roster.find((e) => e.agentId === String(agentId).toLowerCase());
  if (!target) return { ok: false, error: `no employee "${agentId}"` };
  target.disabled = Boolean(disabled);
  saveRosterOverride(roster);
  return { ok: true, employee: target };
}

export function upsertEmployee(profile) {
  const roster = loadEmployees();
  const normalized = normalizeEmployee(profile || {});
  if (!normalized.agentId || normalized.agentId === 'employee') return { ok: false, error: 'agentId or displayName required' };
  const i = roster.findIndex((e) => e.agentId === normalized.agentId);
  if (i >= 0) roster[i] = { ...roster[i], ...normalized };
  else roster.push(normalized);
  saveRosterOverride(roster);
  return { ok: true, employee: normalized };
}
