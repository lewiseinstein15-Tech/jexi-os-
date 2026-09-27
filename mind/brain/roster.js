/**
 * JEXI OS — brain.roster() — the LIVE self-knowledge surface (Phase 4).
 *
 * The lead's bug report: asked "how many agents do you have?" JEXI said
 * "I don't have any." Reality: the registries hold hundreds of agents,
 * skills, tools, MCPs, hooks and plugins. Nothing ever read them per-turn.
 *
 * This module is the ONE place that reads every real registry and answers
 * capability questions with REAL numbers — never guesses, never "I don't
 * know" while the data exists:
 *
 *   roster()                    → full live roster snapshot (all subsystems)
 *   rosterSummary()             → compact budget-capped block for prompts
 *   answerCapabilityQuestion()  → deterministic answers for the 8 capability
 *                                 question types (key or no key)
 *
 * Every accessor is wrapped fail-soft: a broken subsystem degrades its own
 * section to { error } — it can never break a chat turn or the boot.
 */

import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = path.resolve(__dirname, '../../server');
const REPO_ROOT = path.resolve(__dirname, '../..');
const require = createRequire(import.meta.url);

/** Fail-soft dynamic import of a server module. */
async function softImport(relPath) {
  try {
    const mod = await import(pathToFileUrl(path.join(SERVER_ROOT, relPath)));
    return mod;
  } catch (e) {
    return { __error: String(e && e.message || e) };
  }
}

function pathToFileUrl(p) {
  let u = p.replace(/\\/g, '/');
  if (!u.startsWith('/')) u = `/${u}`;
  return `file://${u}`;
}

/* ── per-subsystem collectors (each independent, each fail-soft) ───────── */

async function agentsSection() {
  const reg = await softImport('src/workforce/registry/index.js');
  if (reg.__error) return { error: reg.__error };
  try {
    const stats = reg.rosterStats();
    const tiers = {};
    for (const [cap, n] of Object.entries(stats.byCapability || {})) tiers[cap] = n;
    const top = Object.entries(tiers).sort((a, b) => b[1] - a[1]).slice(0, 6)
      .map(([cap, n]) => `${cap}: ${n}`).join(', ');
    return {
      total: stats.agents,
      liveCoworkers: stats.count,
      byCapability: tiers,
      breakdown: top,
      samples: (reg.listAgents ? reg.listAgents() : []).slice(0, 8).map((a) => a.slug || a.name || String(a)),
    };
  } catch (e) { return { error: String(e && e.message || e) }; }
}

async function skillsSection() {
  const reg = await softImport('src/workforce/registry/index.js');
  const exec = await softImport('src/skills/executable-registry.js');
  const out = {};
  if (!reg.__error) { try { out.registry = reg.SKILL_COUNT; } catch { /* absent */ } }
  // skills/library — real SKILL.md files on disk (the 1100+ library)
  try {
    const libDir = path.join(REPO_ROOT, 'skills', 'library');
    out.library = countFilesRecursive(libDir, (f) => f === 'SKILL.md');
  } catch (e) { out.library = 0; }
  if (!exec.__error) {
    try { out.executable = typeof exec.listExecutableSkills === 'function' ? exec.listExecutableSkills().length : undefined; } catch { /* absent */ }
  }
  out.total = out.registry || 0;
  return out;
}

async function toolsSection() {
  const reg = await softImport('src/services/ToolRegistry.js');
  if (reg.__error) return { error: reg.__error };
  try {
    const all = reg.TOOL_REGISTRY || [];
    const byType = {};
    for (const t of all) {
      const k = t.type || t.engine || 'other';
      byType[k] = (byType[k] || 0) + 1;
    }
    const byEngine = {};
    for (const t of all) {
      if (!t.engine) continue;
      byEngine[t.engine] = (byEngine[t.engine] || 0) + 1;
    }
    return {
      total: all.length,
      byType,
      byEngine,
      samples: all.slice(0, 10).map((t) => t.slug || t.name),
    };
  } catch (e) { return { error: String(e && e.message || e) }; }
}

async function mcpsSection() {
  const gw = await softImport('src/services/MCPGateway.js');
  if (gw.__error) return { error: gw.__error };
  try {
    const rows = gw.mcpServerHealth() || [];
    const connected = rows.filter((r) => r.status === 'connected');
    const ready = rows.filter((r) => r.enabled && r.status !== 'connected' && r.status !== 'disabled');
    const disabled = rows.filter((r) => !r.enabled);
    return {
      enabled: rows.filter((r) => r.enabled).length,
      connected: connected.length,
      dormant: ready.length,
      disabled: disabled.length,
      connectedNames: connected.map((r) => r.name),
      dormantNames: ready.map((r) => r.name),
    };
  } catch (e) { return { error: String(e && e.message || e) }; }
}

/**
 * Hooks — read from the Phase-30 catalog (harness/parity/hooks/catalog.js),
 * which since P5-3 declares per-event wired / intentionalNoOp + noOpReason.
 * WIRED = a real production emitter fires the event (PreToolUse/PostToolUse/
 * Stop/PreCompact/SessionStart/SessionEnd). Everything else is a DECLARED
 * intentional no-op (registered at boot, never fires logic, reason in-file).
 */
async function hooksSection() {
  const catPath = path.join(REPO_ROOT, 'harness', 'parity', 'hooks', 'catalog.js');
  try {
    const mod = await import(pathToFileUrl(catPath));
    const events = (mod.HOOK_CATALOG || []).map((h) => h.event || h.name || String(h));
    const wired = events.filter((e) => mod.WIRED_HOOKS.includes(e));
    const stubs = events.filter((e) => !mod.WIRED_HOOKS.includes(e));
    return {
      catalog: events.length,
      wired: wired.length,
      stubs: stubs.length,
      wiredEvents: wired,
      noOpReasons: Object.fromEntries(stubs.map((e) => [e, mod.NO_OP_REASONS[e]]).filter(([, v]) => Boolean(v))),
      note: `${wired.length} hooks are wired into the live lifecycle (${wired.join(', ')}); ${stubs.length} are declared intentional no-ops (reason recorded in-file).`,
    };
  } catch (e) { return { error: String(e && e.message || e) }; }
}

async function pluginsSection() {
  const reg = await softImport('src/services/PluginRegistry.js');
  if (reg.__error) return { error: reg.__error };
  try {
    const all = reg.ALL_PLUGINS || [];
    return {
      total: all.length,
      samples: all.slice(0, 8).map((p) => p.id || p.name || String(p)),
    };
  } catch (e) { return { error: String(e && e.message || e) }; }
}

async function memorySection() {
  const out = {};
  try {
    const cfg = await softImport('src/config.js');
    const dataDir = cfg.__error ? path.join(SERVER_ROOT, 'data') : cfg.DATA_DIR;
    const sessionsDir = path.join(dataDir, 'sessions');
    out.sessions = countFilesRecursive(sessionsDir, (f) => f.endsWith('.json'));
    const memPath = path.join(dataDir, 'memory.json');
    if (fs.existsSync(memPath)) {
      try {
        const mem = JSON.parse(fs.readFileSync(memPath, 'utf8'));
        out.userFacts = Array.isArray(mem.userFacts) ? mem.userFacts.length : undefined;
        out.chatHistory = Array.isArray(mem.chatHistory) ? mem.chatHistory.length : undefined;
      } catch { /* unreadable memory.json */ }
    }
    const hotPath = path.join(dataDir, 'brain-hot-chat.jsonl');
    if (fs.existsSync(hotPath)) {
      out.hotTurns = fs.readFileSync(hotPath, 'utf8').split('\n').filter((l) => l.trim()).length;
    }
    out.model = '4-source brain recall (hot, hybrid, semantica, instincts) + per-session stores + turn-end hot write';
  } catch (e) { out.error = String(e && e.message || e); }
  return out;
}

function countFilesRecursive(dir, pred) {
  let n = 0;
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return 0; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) n += countFilesRecursive(p, pred);
    else if (pred(e.name)) n++;
  }
  return n;
}

/* ── the public surface ────────────────────────────────────────────────── */

let __cache = null;
let __cacheAt = 0;
const CACHE_MS = 30_000; // roster snapshot cache — real data, 30s freshness

/**
 * brain.roster() — the full live roster snapshot.
 * @returns {Promise<{agents, skills, tools, mcps, hooks, plugins, memory, generatedAt}>}
 */
export async function roster({ refresh = false } = {}) {
  if (!refresh && __cache && Date.now() - __cacheAt < CACHE_MS) return __cache;
  const snap = {
    agents: await agentsSection(),
    skills: await skillsSection(),
    tools: await toolsSection(),
    mcps: await mcpsSection(),
    hooks: await hooksSection(),
    plugins: await pluginsSection(),
    memory: await memorySection(),
    generatedAt: new Date().toISOString(),
  };
  __cache = snap;
  __cacheAt = Date.now();
  return snap;
}

/** Compact prompt-injection block (budget-capped, ~600 chars). */
export async function rosterSummary() {
  const r = await roster();
  const a = r.agents || {}, s = r.skills || {}, t = r.tools || {}, m = r.mcps || {}, h = r.hooks || {}, p = r.plugins || {};
  const lines = [
    `ROSTER (live): ${a.total ?? '?'} specialist agents (${a.liveCoworkers ?? '?'} live coworkers; tiers: ${a.breakdown || 'n/a'}).`,
    `SKILLS: ${s.registry ?? '?'} registry skills + ${s.library ?? '?'} library SKILL.md files. TOOLS: ${t.total ?? '?'} registered. PLUGINS: ${p.total ?? '?'}.`,
    `MCPs: ${m.enabled ?? '?'} enabled — ${m.connected ?? '?'} connected, ${m.dormant ?? '?'} dormant (lazy-wake on demand). HOOKS: ${h.wired ?? '?'} wired / ${h.stubs ?? '?'} intentional stubs.`,
    `MEMORY: ${r.memory?.model || '4-source brain recall + session stores'}.`,
    `When asked about your capabilities, answer from THESE numbers — never say you have none.`,
  ];
  return lines.join('\n');
}

/**
 * Capability-question gate — deterministic, real-number answers for the
 * canonical capability question types. Returns { handled, answer } or
 * { handled: false }.
 */
export async function answerCapabilityQuestion(rawQuery) {
  const q = String(rawQuery || '').toLowerCase().trim();
  const r = await roster();

  const agentsRe = /\b(how\s+many|number\s+of|count\s+of)\b.*\bagents?\b|\bagents?\b.*\b(how\s+many|do\s+you\s+have|you\s+got)\b/i;
  const whatAgentsRe = /^(what|which|who)\s+agents?\b|\blist\s+(your\s+)?agents?\b|\bshow\s+(me\s+)?(your\s+)?agents?\b/i;
  const skillsRe = /\b(how\s+many|number\s+of)\b.*\bskills?\b|^(what|which)\s+skills?\b|\blist\s+(your\s+)?skills?\b/i;
  const toolsRe = /\b(how\s+many|number\s+of)\b.*\btools?\b|^(what|which)\s+tools?\b|\blist\s+(your\s+)?tools?\b/i;
  const mcpRe = /\bmcp(?:s)?\b/i.test(q) && /\b(what|how\s+many|which|list|connected|dormant)\b/i.test(q);
  const hooksRe = /\bhooks?\b/i.test(q) && /\b(what|how\s+many|which|wired|stub|list)\b/i.test(q);
  const pluginsRe = /\bplugins?\b/i.test(q) && /\b(what|how\s+many|which|list)\b/i.test(q);
  const canDoRe = /^(what\s+can\s+you\s+do|what\s+are\s+you\s+capable\s+of|what\s+do\s+you\s+do|what\s+are\s+your\s+(capabilit|abilit))/i;
  const memoryRe = /\bmemory\b/i.test(q) && /\b(what|how|do\s+you\s+have|much|remember)\b/i.test(q);

  const fmt = (n) => (typeof n === 'number' ? String(n) : '?');

  if (canDoRe.test(q)) {
    const a = r.agents || {}, s = r.skills || {}, t = r.tools || {}, m = r.mcps || {}, h = r.hooks || {}, p = r.plugins || {};
    return {
      handled: true,
      answer: [
        `I'm **JEXI OS** — an agentic operating system. Real, live numbers from my registries:`,
        `- **Agents**: ${fmt(a.total)} specialist agents in the roster (${fmt(a.liveCoworkers)} live coworkers${a.breakdown ? `; top tiers: ${a.breakdown}` : ''}).`,
        `- **Skills**: ${fmt(s.registry)} registry skills + ${fmt(s.library)} library SKILL.md files.`,
        `- **Tools**: ${fmt(t.total)} registered tools, dispatchable through the gated tool runtime.`,
        `- **MCPs**: ${fmt(m.enabled)} enabled — ${fmt(m.connected)} connected right now, ${fmt(m.dormant)} dormant (lazy-wake when a task needs them).`,
        `- **Hooks**: ${fmt(h.wired)} wired into the live lifecycle, ${fmt(h.stubs)} intentional no-op stubs.`,
        `- **Plugins**: ${fmt(p.total)} loaded at boot.`,
        `- **Memory**: ${r.memory?.model || 'multi-source'}.`,
        ``,
        `Tell me what you want done — I plan, staff the right specialists, run tools, and verify the result.`,
      ].join('\n'),
    };
  }

  if (agentsRe.test(q)) {
    const a = r.agents || {};
    return {
      handled: true,
      answer: `I have **${fmt(a.total)} specialist agents** in my roster (${fmt(a.liveCoworkers)} live coworkers in the active workforce). Breakdown by tier: ${a.breakdown || Object.entries(a.byCapability || {}).slice(0, 8).map(([k, v]) => `${k}: ${v}`).join(', ') || 'n/a'}. Each tier is staffed on demand — tell me the task and I'll compose the team.`,
    };
  }

  if (whatAgentsRe.test(q)) {
    const a = r.agents || {};
    const samples = (a.samples || []).slice(0, 8);
    return {
      handled: true,
      answer: `My roster holds **${fmt(a.total)} specialist agents** across tiers (${a.breakdown || 'grouped by capability'}). Examples: ${samples.length ? samples.join(', ') : 'see /api/roster for the full list'}. Say the task — I'll pick the tier.`,
    };
  }

  if (skillsRe.test(q)) {
    const s = r.skills || {};
    return {
      handled: true,
      answer: `I carry **${fmt(s.registry)} registry skills** plus **${fmt(s.library)} library SKILL.md files** on disk${s.executable ? ` (${fmt(s.executable)} machine-executable)` : ''}. Skills are indexed at boot and dispatched when a turn needs them — name a domain and I'll use what's relevant.`,
    };
  }

  if (toolsRe.test(q)) {
    const t = r.tools || {};
    const cats = Object.entries(t.byType || {}).sort((x, y) => y[1] - x[1]).slice(0, 8).map(([k, v]) => `${k}: ${v}`).join(', ');
    return {
      handled: true,
      answer: `I have **${fmt(t.total)} registered tools**${cats ? ` — by category: ${cats}` : ''}. Every tool goes through the gated runtime (intent allowlist → permissions → risk tier). Examples: ${(t.samples || []).slice(0, 6).join(', ')}.`,
    };
  }

  if (mcpRe) {
    const m = r.mcps || {};
    return {
      handled: true,
      answer: `**${fmt(m.enabled)} MCP servers** are enabled in my gateway — **${fmt(m.connected)} connected** right now${Array.isArray(m.connectedNames) && m.connectedNames.length ? ` (${m.connectedNames.slice(0, 6).join(', ')})` : ''}, **${fmt(m.dormant)} dormant** (lazy-wake on demand; I don't hold them all open). Every connected MCP tool is callable through the same gated tool runtime.`,
    };
  }

  if (hooksRe) {
    const h = r.hooks || {};
    return {
      handled: true,
      answer: h.error ? `My hook catalog state is unavailable right now (${h.error}).` : `My hook catalog has **${fmt(h.catalog)} events**: **${fmt(h.wired)} wired** into the live lifecycle (${(h.wiredEvents || []).join(', ')}) and **${fmt(h.stubs)} intentional no-op stubs** (registered for contract completeness, they exist but do nothing).`,
    };
  }

  if (pluginsRe) {
    const p = r.plugins || {};
    return {
      handled: true,
      answer: `**${fmt(p.total)} plugins** are discovered and loaded at boot${Array.isArray(p.samples) && p.samples.length ? ` (examples: ${p.samples.slice(0, 6).join(', ')})` : ''}. Plugin tools are first-class in my tool runtime — callable like any native tool.`,
    };
  }

  if (memoryRe) {
    const mem = r.memory || {};
    return {
      handled: true,
      answer: `My memory is real and multi-source: **4-source brain recall** (hot, hybrid, semantica, instincts) feeding every turn, **${fmt(mem.sessions)} session stores** on disk, **${fmt(mem.userFacts)} remembered user facts**, **${fmt(mem.hotTurns)} turns** in the durable hot ledger. Turn N+1 sees turn N; new sessions start isolated; global preferences carry across sessions.`,
    };
  }

  return { handled: false };
}

/** Boot-time load — pulls the first snapshot so it is warm in live context. */
export async function warmRoster() {
  const r = await roster({ refresh: true });
  const line = `[Roster] brain.roster() loaded: ${r.agents?.total ?? '?'} agents, ${r.skills?.registry ?? '?'} registry + ${r.skills?.library ?? '?'} library skills, ${r.tools?.total ?? '?'} tools, MCP ${r.mcps?.connected ?? '?'}/${r.mcps?.enabled ?? '?'} connected (+${r.mcps?.dormant ?? '?'} dormant), hooks ${r.hooks?.wired ?? '?'}/${r.hooks?.catalog ?? '?'} wired, ${r.plugins?.total ?? '?'} plugins.`;
  return { snapshot: r, line };
}
