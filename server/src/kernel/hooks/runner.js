/**
 * JEXI OS — KERNEL — hooks runner (Phase 7 B).
 *
 * ECC reference pattern: hooks are external scripts registered in
 * hooks/hooks.json. The kernel calls runHook(event, ctx) at real wiring
 * points; each matching registration spawns its script with a JSON context
 * on stdin. Script stdout = hook log lines. Exit codes:
 *
 *   0            → allow / continue
 *   nonzero      → script's DECISION:
 *                    exitBehavior 'block' → the kernel blocks the call
 *                    exitBehavior 'warn'  → logged, never blocks
 *   spawn error  → infra failure → fail-open (recorded, never blocks),
 *                  matching the platform's fail-open hook philosophy
 *                  (server/src/services/HookEngine.js) so a broken hook
 *                  cannot take the brain down.
 *
 * Registrations resolve from the repo root (hooks/hooks.json). When the
 * hooks/ directory is absent (e.g. slim production image), the runner
 * no-ops with zero registrations — the seam stays wired and harmless.
 *
 * Wiring points (this module is called from):
 *   server/src/tools/execution/permission-gate.js  → PreToolUse (BEFORE the
 *     permission check; a block short-circuits the gate)
 *   server/src/tools/execution/executor.js         → PostToolUse (after the
 *     engine returns, receives the result)
 *   server/src/services/director/MissionRunner.js  → Stop (turn/mission end)
 *   server/src/services/CompactionEngine.js        → PreCompact
 *   server/index.js                                → SessionStart / SessionEnd
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url)); // server/src/kernel/hooks

/** Locate the repo-root hooks/ directory (cwd-relative first, then module-relative). */
function locateHooksRoot() {
  const candidates = [];
  const cwd = process.cwd();
  candidates.push(path.join(cwd, 'infra/hooks'));
  let parent = path.dirname(cwd);
  for (let i = 0; i < 3; i++) { candidates.push(path.join(parent, 'infra/hooks')); parent = path.dirname(parent); }
  candidates.push(path.resolve(MODULE_DIR, '..', '..', '..', '..', 'infra/hooks'));
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, 'hooks.json'))) return c;
  }
  return null;
}

const HOOKS_ROOT = locateHooksRoot();

let _cache = { mtimeMs: 0, regs: [] };

/** Load + cache registrations from hooks/hooks.json (mtime-aware). */
export function listHookRegistrations() {
  if (!HOOKS_ROOT) return [];
  const file = path.join(HOOKS_ROOT, 'hooks.json');
  try {
    const mtime = fs.statSync(file).mtimeMs;
    if (mtime !== _cache.mtimeMs) {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      const regs = Array.isArray(parsed?.hooks) ? parsed.hooks : [];
      _cache = { mtimeMs: mtime, regs };
    }
    return _cache.regs;
  } catch {
    return [];
  }
}

/** Metadata companion (hooks.metadata.json): { hooks: [{id, description, fingerprint}] }. */
export function hookMetadata() {
  if (!HOOKS_ROOT) return { hooks: [] };
  try {
    return JSON.parse(fs.readFileSync(path.join(HOOKS_ROOT, 'hooks.metadata.json'), 'utf8'));
  } catch {
    return { hooks: [] };
  }
}

/** Matcher: null/'*' = all tools; trailing '*' = prefix; otherwise exact tool name. */
function matcherMatches(reg, tool) {
  const m = reg?.matcher;
  if (!m || m === '*') return true;
  const t = String(tool ?? '');
  if (String(m).endsWith('*')) return t.startsWith(String(m).slice(0, -1));
  return t === String(m);
}

function parseCommand(command) {
  const parts = String(command || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return null;
  const bin = parts[0] === 'node' ? process.execPath : parts[0];
  // Command args are repo-root-relative (e.g. "hooks/scripts/...") — HOOKS_ROOT
  // is <repo>/hooks, so resolve against its parent (the repo root).
  const repoRoot = HOOKS_ROOT ? path.dirname(HOOKS_ROOT) : process.cwd();
  const args = parts.slice(1).map((a) => path.resolve(repoRoot, a));
  return { bin, args };
}

/**
 * Run all matching hooks for an event. Synchronous by design — the permission
 * gate is synchronous and PreToolUse must run inside it.
 *
 * @returns {{ blocked: null | { id: string, code: number, reason: string }, logs: string[] }}
 */
export function runHook(event, ctx = {}) {
  const logs = [];
  const regs = listHookRegistrations().filter(
    (r) => r && r.event === event && r.enabled !== false && matcherMatches(r, ctx.tool)
  );
  if (!regs.length) return { blocked: null, logs };

  const payload = JSON.stringify({ event, tool: ctx.tool ?? null, ...ctx, _event: undefined });
  let blocked = null;

  for (const reg of regs) {
    const cmd = parseCommand(reg.command);
    if (!cmd) { logs.push(`[hook ${reg.id}] invalid command registration — skipped (fail-open)`); continue; }
    if (!fs.existsSync(cmd.args[0])) {
      logs.push(`[hook ${reg.id}] script missing: ${reg.command} — skipped (fail-open)`);
      continue;
    }
    let res;
    try {
      res = spawnSync(cmd.bin, cmd.args, {
        input: payload,
        timeout: Number(reg.timeout) > 0 ? Number(reg.timeout) : 5000,
        encoding: 'utf8',
        cwd: HOOKS_ROOT ? path.dirname(HOOKS_ROOT) : process.cwd(),
      });
    } catch (e) {
      logs.push(`[hook ${reg.id}] infra failure: ${e.message} — fail-open`);
      continue;
    }

    if (res.error) {
      const timedOut = res.error.code === 'ETIMEDOUT' || res.signal === 'SIGTERM';
      logs.push(`[hook ${reg.id}] ${timedOut ? 'timeout' : 'spawn error'} (${res.error.code || res.error.message}) — fail-open`);
      continue;
    }
    if (res.signal) {
      logs.push(`[hook ${reg.id}] killed by signal ${res.signal} — fail-open`);
      continue;
    }

    const out = String(res.stdout || '').trim();
    const err = String(res.stderr || '').trim();
    for (const line of out.split('\n')) if (line.trim()) logs.push(line.trim());
    if (err) for (const line of err.split('\n').slice(0, 5)) if (line.trim()) logs.push(`[hook ${reg.id}][stderr] ${line.trim()}`);

    if (res.status !== 0) {
      const reason = (err || out || `exit ${res.status}`).split('\n')[0].slice(0, 400);
      logs.push(`[hook ${reg.id}] exit=${res.status} (exitBehavior=${reg.exitBehavior || 'warn'})`);
      if ((reg.exitBehavior === 'block') && !blocked) {
        blocked = { id: reg.id, code: res.status, reason };
      }
    }
  }

  return { blocked, logs };
}

/* ── Kernel seam helpers ──────────────────────────────────────────────── */

/** PreToolUse — runs BEFORE the permission check inside the gate. */
export function runPreToolUseHook(call, ctx = {}) {
  return runHook('PreToolUse', {
    tool: call?.name ?? null,
    args: call?.arguments ?? {},
    sessionId: ctx?.sessionId ?? null,
    agentId: ctx?.agentId ?? null,
  });
}

/** PostToolUse — runs AFTER execution; receives a compact result summary. */
export function runPostToolUseHook(call, result, ctx = {}) {
  return runHook('PostToolUse', {
    tool: call?.name ?? null,
    args: call?.arguments ?? {},
    result: {
      ok: result?.ok ?? null,
      name: result?.name ?? call?.name ?? null,
      durationMs: result?.meta?.durationMs ?? result?.durationMs ?? null,
      error: result?.error ? String(result.error).slice(0, 200) : null,
    },
    sessionId: ctx?.sessionId ?? null,
    agentId: ctx?.agentId ?? null,
  });
}

/** Lifecycle events: Stop | SessionStart | SessionEnd | PreCompact. */
export function runLifecycleHook(event, ctx = {}) {
  return runHook(event, { tool: null, args: {}, ...ctx });
}

export const HOOKS_DIR = HOOKS_ROOT;
