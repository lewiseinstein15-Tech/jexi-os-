/**
 * JEXI OS — COMMANDS — private context helpers (Phase 7 G).
 *
 * The commands subsystem lives at the repo root (ECC layout, like learning/
 * and events/hud/). Its handlers wire to REAL modules:
 *
 *   /checkpoint   → server/src/workgraph/state/checkpoint.js + workgraph nodes
 *   /code-review  → server/src/services/SubagentRuntime.js (spawned reviewer)
 *                   + server/src/services/CodeJudge.js (deterministic checks)
 *   /cost-report  → events/hud/producer.js spend ledger (real model-call sizes)
 *   /build-fix    → server/src/services/CodeJudge.js diagnoseJsFile
 *   /learn        → learning/analyzer.js (Phase 7 C)
 *   /refine       → session trajectory (SessionTrace) + learning store evidence
 *   /handoff      → HUD payload + git + todos → STATE.md
 *   /catchup      → STATE.md reader
 *   /intel        → server/src/services/PlanStore.js plan triage
 *   /doctor       → ProviderHealth + config + storage + HUD probes
 *   /status       → events/hud/producer.js snapshot()
 *   /export       → server/src/services/SessionConversations.js + HUD snapshot
 *
 * Every import is dual-depth + fail-soft:
 *   dev        <root>/commands/*.js → ../server/src/…   ../events/hud/…
 *   container  /app/commands/*.js   → ../src/…          ../events/hud/…
 * (the docker workflow ships commands/ and events/hud into the image next to
 * the server sources — mirroring the Phase 7(F) HUD shipping).
 *
 * A missing or broken module degrades THAT command honestly ("subsystem not
 * available in this runtime") — it can never take the process down.
 */

import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

export const COMMANDS_DIR = path.dirname(fileURLToPath(import.meta.url));

/* ── dual-depth server source resolution ──────────────────────────────── */

const SERVER_ROOTS = [
  path.resolve(COMMANDS_DIR, '..', 'server'), // dev: <root>/server
  path.resolve(COMMANDS_DIR, '..'),           // container: /app (server IS /app)
];

let serverRootCache = null;

/** The server source root this runtime actually lives in (or null). */
export function serverRoot() {
  if (serverRootCache !== null) return serverRootCache;
  for (const r of SERVER_ROOTS) {
    if (fs.existsSync(path.join(r, 'src', 'services'))) { serverRootCache = r; return r; }
    // container brain image: /app/src/services with package.json at /app
    if (fs.existsSync(path.join(r, 'src', 'config.js'))) { serverRootCache = r; return r; }
  }
  serverRootCache = false;
  return null;
}

const modCache = new Map();

/** Dual-depth fail-soft dynamic import of a server module. */
export async function serverMod(relFromServerRoot) {
  const root = serverRoot();
  if (!root) return null;
  const key = `srv:${relFromServerRoot}`;
  if (modCache.has(key)) return modCache.get(key);
  let mod = null;
  try { mod = await import(pathToFileURL(path.join(root, relFromServerRoot)).href); } catch { mod = null; }
  modCache.set(key, mod);
  return mod;
}

/** Fail-soft import of a repo-root ECC subsystem (events/hud, learning). */
export async function rootMod(relFromRoot) {
  const key = `root:${relFromRoot}`;
  if (modCache.has(key)) return modCache.get(key);
  const candidates = [
    path.resolve(COMMANDS_DIR, '..', relFromRoot),          // dev + shipped image layout
    path.resolve(COMMANDS_DIR, relFromRoot),                // (defensive) sibling layout
  ];
  let mod = null;
  for (const c of candidates) {
    try { mod = await import(pathToFileURL(c).href); break; } catch { mod = null; }
  }
  modCache.set(key, mod);
  return mod;
}

/* ── frequently wired subsystems (all optional) ───────────────────────── */

export async function observerBus() {
  const m = await serverMod('src/services/Observer.js');
  return m && typeof m.emit === 'function' ? m : null;
}

export async function hudProducer() {
  return rootMod('events/hud/producer.js');
}

export async function hudSnapshot() {
  const p = await hudProducer();
  if (!p || typeof p.snapshot !== 'function') return null;
  try { return p.snapshot(); } catch { return null; }
}

export async function serverConfig() {
  return serverMod('src/config.js');
}

export async function dataDir() {
  const cfg = await serverConfig();
  if (cfg?.DATA_DIR) return cfg.DATA_DIR;
  return path.join(process.cwd(), 'data');
}

/* ── STATE.md (handoff / catchup relay) ────────────────────────────────── */

export async function stateFilePath() {
  const dir = path.join(await dataDir(), 'handoff');
  return path.join(dir, 'STATE.md');
}

/* ── command context (the spec's ctx contract) ────────────────────────── */

/**
 * Build the dispatcher ctx. Callers (chat route, CLI, probes) may pass any
 * subset; the dispatcher fills honest defaults so a command always has the
 * full shape:  { session, agent, hud, log, verify }
 */
export async function buildCtx(overrides = {}) {
  const hud = overrides.hud !== undefined ? overrides.hud : await hudSnapshot();
  const logs = Array.isArray(overrides._logs) ? overrides._logs : [];
  const ctx = {
    session: {
      id: overrides.session?.id || process.env.JEXI_SESSION_ID || null,
      missionId: overrides.session?.missionId || null,
      agentId: overrides.session?.agentId || null,
      ...(overrides.session || {}),
    },
    agent: {
      coworker: overrides.agent?.coworker ?? false,
      name: overrides.agent?.name || (overrides.agent?.coworker ? 'coworker' : 'operator'),
      grants: overrides.agent?.grants || [],
    },
    hud,
    log: (msg) => {
      const row = String(msg ?? '');
      logs.push(row);
      if (typeof overrides.log === 'function') { try { overrides.log(row); } catch { /* caller log is best-effort */ } }
      return row;
    },
    verify: typeof overrides.verify === 'function'
      ? overrides.verify
      : async (claim) => ({ ok: false, reason: 'no verifier wired into this runtime', claim: String(claim).slice(0, 200) }),
    _logs: logs,
  };
  return ctx;
}

/* ── shared small utils ────────────────────────────────────────────────── */

/** Redact obvious secrets from any text a command is about to return/log. */
export function redact(text) {
  return String(text ?? '')
    .replace(/\b(gsk|sk|sk-ant|ghp|gho|github_pat|rnd|xoxb|xoxp|rk)[-_][A-Za-z0-9_-]{8,}/g, '$1_[REDACTED]')
    .replace(/\b(AKIA|ASIA)[A-Z0-9]{12,}\b/g, '[REDACTED-AWS]')
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '[REDACTED-KEY]');
}

export function clampText(text, max = 400) {
  const s = String(text ?? '');
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

/** Best-effort current git context (branch + last commit) for a directory. */
export function gitBrief(cwd) {
  try {
    const branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd, timeout: 4000 }).toString().trim();
    const sha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd, timeout: 4000 }).toString().trim();
    const subject = execFileSync('git', ['log', '-1', '--pretty=%s'], { cwd, timeout: 4000 }).toString().trim();
    return { branch, sha, subject };
  } catch {
    return { branch: null, sha: null, subject: null };
  }
}
