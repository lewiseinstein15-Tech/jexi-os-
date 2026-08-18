/**
 * B135 — HOOK BRIDGES (DeepSeek Harness `packages/hooks/hooks-codex` +
 * `hooks-claude-code` mirror).
 *
 * Bridges for unmodified Codex / Claude Code command hooks on JEXI's
 * interception points:
 *
 *   Codex        — PreToolUse, PostToolUse, SessionStart, UserPromptSubmit, Stop
 *   Claude Code  — + SubagentStart, SubagentStop
 *
 * Shared dialect behavior (dsh hook-protocol):
 *   - regex-only matchers (invalid regex rejects the whole config at load);
 *   - command hooks only — `async: true` / non-command hooks are skipped with
 *     a reason, never silently run;
 *   - snake_case payloads (Codex) / camelCase payloads (Claude Code), no
 *     trailing newline;
 *   - Codex performs no command substitution; Claude Code substitutes
 *     ${CLAUDE_PLUGIN_ROOT} and ${CLAUDE_PROJECT_DIR};
 *   - Claude Code hook processes get CLAUDE_PROJECT_DIR exported and may
 *     return `decision: block` (exit 2 is the classic block signal; other
 *     non-zero exits are recorded as hook errors);
 *   - ONLY blocking decisions are honored; everything else is recorded.
 *
 * Fail-open: a hook that errors, times out, or is misconfigured never blocks
 * JEXI — the decision is logged (hook.ran / hook.result events) and flow
 * continues.
 */

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { DATA_DIR } from '../config.js';
import { appendConversationEvent } from './SessionConversations.js';

export const CODEX_EVENTS = ['PreToolUse', 'PostToolUse', 'SessionStart', 'UserPromptSubmit', 'Stop'];
export const CLAUDE_EVENTS = [...CODEX_EVENTS, 'SubagentStart', 'SubagentStop'];

export const DEFAULT_HOOK_TIMEOUT_MS = 60_000;
const MAX_STDERR_SUMMARY = 2000;

/* ------------------------------------------------------------------ */
/* Config parsing (dialect-local, mirroring dsh config.ts)             */
/* ------------------------------------------------------------------ */

function asObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : undefined;
}

function matcherDiagnostic(matcher) {
  if (matcher === undefined) return undefined;
  if (typeof matcher !== 'string' || matcher.length === 0) return 'matcher must be a non-empty regex string';
  try { new RegExp(matcher); return undefined; } catch (e) { return `matcher is not a valid regex: ${e.message}`; }
}

/** Parse a Codex config: `{ hooks: { Event: [{ matcher?, hooks: [...] }] } }`. */
export function parseCodexConfig(raw) {
  const config = {};
  const skipped = [];
  const root = asObject(raw);
  const hooksMap = root ? (asObject(root.hooks) || root) : undefined;
  if (!hooksMap) return { config, skipped };
  for (const event of CODEX_EVENTS) {
    const rawGroups = hooksMap[event];
    if (!Array.isArray(rawGroups)) continue;
    const groups = [];
    for (const rawGroup of rawGroups) {
      const group = asObject(rawGroup);
      if (!group || !Array.isArray(group.hooks)) continue;
      const commands = [];
      for (const rawHook of group.hooks) {
        const hook = asObject(rawHook);
        if (!hook) continue;
        const type = typeof hook.type === 'string' ? hook.type : 'command';
        if (type !== 'command') { skipped.push({ event, reason: `unsupported "${type}" hook` }); continue; }
        if (hook.async === true) { skipped.push({ event, reason: 'async hook' }); continue; }
        if (typeof hook.command !== 'string') continue;
        const timeout = typeof hook.timeout === 'number' ? hook.timeout
          : typeof hook.timeoutSec === 'number' ? hook.timeoutSec : undefined;
        commands.push({ command: hook.command, ...(timeout !== undefined ? { timeoutSec: timeout } : {}) });
      }
      if (commands.length === 0) continue;
      const matcher = (event === 'UserPromptSubmit' || event === 'Stop') ? undefined
        : (typeof group.matcher === 'string' ? group.matcher : undefined);
      const diagnostic = matcherDiagnostic(matcher);
      if (diagnostic !== undefined) throw new SyntaxError(`${diagnostic} on event ${JSON.stringify(event)}`);
      groups.push({ ...(matcher !== undefined ? { matcher } : {}), hooks: commands });
    }
    if (groups.length > 0) config[event] = groups;
  }
  return { config, skipped };
}

/** Substitute ${CLAUDE_PLUGIN_ROOT} / ${CLAUDE_PROJECT_DIR} in a command. */
export function substituteCommand(command, vars = {}) {
  let out = String(command);
  if (vars.pluginRoot !== undefined) out = out.split('${CLAUDE_PLUGIN_ROOT}').join(vars.pluginRoot);
  if (vars.projectDir !== undefined) out = out.split('${CLAUDE_PROJECT_DIR}').join(vars.projectDir);
  return out;
}

/** Parse a Claude Code config: settings `hooks` value or bare event map. */
export function parseClaudeCodeConfig(raw, vars = {}) {
  const config = {};
  const skipped = [];
  const root = asObject(raw);
  const hooksMap = root ? (asObject(root.hooks) || root) : undefined;
  if (!hooksMap) return { config, skipped };
  for (const event of CLAUDE_EVENTS) {
    const rawGroups = hooksMap[event];
    if (!Array.isArray(rawGroups)) continue;
    const groups = [];
    for (const rawGroup of rawGroups) {
      const group = asObject(rawGroup);
      if (!group || !Array.isArray(group.hooks)) continue;
      const commands = [];
      for (const rawHook of group.hooks) {
        const hook = asObject(rawHook);
        if (!hook) continue;
        const type = typeof hook.type === 'string' ? hook.type : 'command';
        if (type !== 'command') { skipped.push({ event, type }); continue; }
        if (typeof hook.command !== 'string') continue;
        commands.push({
          command: substituteCommand(hook.command, vars),
          ...(typeof hook.timeout === 'number' ? { timeoutSec: hook.timeout } : {}),
        });
      }
      if (commands.length === 0) continue;
      const matcher = (event === 'UserPromptSubmit' || event === 'Stop') ? undefined
        : (typeof group.matcher === 'string' ? group.matcher : undefined);
      const diagnostic = matcherDiagnostic(matcher);
      if (diagnostic !== undefined) throw new SyntaxError(`${diagnostic} on event ${JSON.stringify(event)}`);
      groups.push({ ...(matcher !== undefined ? { matcher } : {}), hooks: commands });
    }
    if (groups.length > 0) config[event] = groups;
  }
  return { config, skipped };
}

/* ------------------------------------------------------------------ */
/* Hook execution                                                      */
/* ------------------------------------------------------------------ */

/** Run one hook command; resolves { code, stdout, stderr, timedOut }. */
function runHookCommand(command, { timeoutMs = DEFAULT_HOOK_TIMEOUT_MS, env = {}, cwd } = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, { shell: '/bin/bash', env: { ...process.env, ...env }, cwd: cwd || process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      resolve({ code: 1, stdout: '', stderr: String((e && e.message) || e), timedOut: false });
      return;
    }
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { child.kill('SIGKILL'); } catch { /* noop */ }
      resolve({ code: null, stdout, stderr: stderr + '\n[hook timed out]', timedOut: true });
    }, timeoutMs);
    child.stdout.on('data', (d) => { stdout = (stdout + d.toString('utf8')).slice(-16000); });
    child.stderr.on('data', (d) => { stderr = (stderr + d.toString('utf8')).slice(-MAX_STDERR_SUMMARY); });
    child.on('error', (e) => { if (!settled) { settled = true; clearTimeout(timer); resolve({ code: 1, stdout, stderr: String((e && e.message) || e), timedOut: false }); } });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut: false });
    });
  });
}

/** Codex hook payload (snake_case). */
function codexPayload(event, { tool, args, convId, sessionId } = {}) {
  return {
    hook_event_name: event,
    session_id: sessionId || convId || '',
    ...(tool !== undefined ? { tool_name: tool } : {}),
    ...(args !== undefined ? { tool_input: args } : {}),
  };
}

/** Claude Code hook payload (camelCase). */
function claudePayload(event, { tool, args, convId, cwd } = {}) {
  return {
    hook_event_name: event,
    session_id: convId || '',
    ...(cwd !== undefined ? { cwd } : {}),
    ...(tool !== undefined ? { tool_name: tool } : {}),
    ...(args !== undefined ? { tool_input: args } : {}),
  };
}

/** Interpret a CC hook exit: 0 allow, 2 block, JSON decision overrides. */
function claudeDecision(run) {
  let decision = run.code === 2 ? 'block' : 'allow';
  let reason = '';
  const trimmed = (run.stdout || '').trim();
  if (trimmed) {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object') {
        if (parsed.decision === 'block' || parsed.decision === 'approve' || parsed.decision === 'allow') {
          decision = parsed.decision === 'block' ? 'block' : 'allow';
        }
        if (typeof parsed.reason === 'string') reason = parsed.reason;
      }
    } catch { reason = trimmed.slice(0, 200); }
  }
  return { decision, reason };
}

/* ------------------------------------------------------------------ */
/* Bridge                                                              */
/* ------------------------------------------------------------------ */

/** One loaded bridge (dialect + parsed groups + skipped warnings). */
export class HookBridge {
  constructor({ dialect, groups, skipped, configPath, defaultTimeoutMs = DEFAULT_HOOK_TIMEOUT_MS, projectDir = null }) {
    this.dialect = dialect;
    this.groups = groups; // event → [{matcher?, hooks:[{command, timeoutSec?}]}]
    this.skipped = skipped;
    this.configPath = configPath;
    this.defaultTimeoutMs = defaultTimeoutMs;
    this.projectDir = projectDir;
  }

  /** Groups for one event (or []). */
  groupsFor(event) { return this.groups[event] || []; }

  /** Fire all matching hooks for one event. Returns { blocked, reason, ran } — fail-open. */
  async fire(event, { tool, args, convId, cwd, sessionId } = {}) {
    const groups = this.groupsFor(event);
    if (groups.length === 0) return { blocked: false, ran: 0 };
    let blocked = false;
    let reason = '';
    let ran = 0;
    const subject = tool !== undefined ? String(tool) : (args && args.prompt ? String(args.prompt) : '');
    for (const group of groups) {
      if (group.matcher !== undefined && !new RegExp(group.matcher).test(subject)) continue;
      for (const hook of group.hooks) {
        ran += 1;
        const timeoutMs = hook.timeoutSec ? Math.max(1, Math.round(hook.timeoutSec * 1000)) : this.defaultTimeoutMs;
        const env = this.dialect === 'claude-code' && this.projectDir
          ? { CLAUDE_PROJECT_DIR: this.projectDir }
          : {};
        const run = await runHookCommand(hook.command, { timeoutMs, env, cwd: cwd || undefined });
        const payload = this.dialect === 'codex'
          ? codexPayload(event, { tool, args, convId, sessionId })
          : claudePayload(event, { tool, args, convId, cwd: cwd || this.projectDir });
        const outcome = {
          event, tool: tool || null, command: hook.command.slice(0, 200), code: run.code,
          timedOut: run.timedOut, stderr: run.stderr.slice(0, 500),
          payload,
        };
        if (this.dialect === 'claude-code') {
          const dec = claudeDecision(run);
          outcome.decision = dec.decision;
          if (dec.reason) outcome.reason = dec.reason;
          if (event === 'PreToolUse' && dec.decision === 'block' && !blocked) {
            blocked = true;
            reason = dec.reason || `blocked by Claude Code hook (${hook.command.slice(0, 120)})`;
          }
        } else if (event === 'PreToolUse' && run.code === 2 && !blocked) {
          // Codex blocks via exit code 2 (its blocking decision signal).
          blocked = true;
          reason = (run.stderr || run.stdout || '').trim().slice(0, 300) || `blocked by Codex hook (${hook.command.slice(0, 120)})`;
          outcome.decision = 'block';
        }
        try {
          appendConversationEvent(convId || 'hooks', { role: 'system', kind: 'hook/result', text: `hook ${event} → ${run.timedOut ? 'timeout' : String(run.code)}`, meta: outcome });
        } catch { /* noop */ }
      }
    }
    return { blocked, reason, ran };
  }
}

/** Loaded bridge registry (all dialects). */
const bridges = []; // { dialect, bridge, configPath }

/**
 * Load a bridge from a config file. Fail-open: parse errors disable the
 * bridge with a logged warning (never crash boot).
 * @param {object} opts { dialect: 'codex'|'claude-code', configPath, projectDir? }
 */
export async function loadHookBridge({ dialect, configPath, projectDir = null } = {}) {
  try {
    if (!configPath || !fs.existsSync(configPath)) return { ok: false, reason: 'no config file' };
    const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    const parsed = dialect === 'codex' ? parseCodexConfig(raw) : parseClaudeCodeConfig(raw, { projectDir });
    const bridge = new HookBridge({ dialect, groups: parsed.config, skipped: parsed.skipped, configPath, projectDir });
    bridges.push({ dialect, bridge, configPath });
    console.log(`[hooks] ${dialect} bridge loaded from ${configPath} (${Object.keys(parsed.config).length} events, ${parsed.skipped.length} skipped)`);
    return { ok: true, events: Object.keys(parsed.config), skipped: parsed.skipped };
  } catch (e) {
    console.warn(`[hooks] ${dialect} bridge disabled: ${(e && e.message) || e}`);
    return { ok: false, reason: (e && e.message) || String(e) };
  }
}

/** Load default bridge configs from DATA_DIR if present. */
export async function loadDefaultHookBridges() {
  const out = [];
  out.push(await loadHookBridge({ dialect: 'codex', configPath: path.join(DATA_DIR, 'hooks.codex.json') }));
  out.push(await loadHookBridge({ dialect: 'claude-code', configPath: path.join(DATA_DIR, 'hooks.claude.json'), projectDir: process.env.WORKSPACE_DIR || process.cwd() }));
  return out;
}

/** Fire a bridge event across every loaded bridge (fail-open). */
export async function fireHookBridges(event, context = {}) {
  if (bridges.length === 0) return { blocked: false, reason: '', ran: 0 };
  let blocked = false;
  let reason = '';
  let ran = 0;
  for (const { bridge } of bridges) {
    try {
      const r = await bridge.fire(event, context);
      ran += r.ran;
      if (r.blocked && !blocked) { blocked = true; reason = r.reason; }
    } catch { /* a bridge must never block the harness */ }
  }
  return { blocked, reason, ran };
}

/** Tool-lifecycle wiring: PreToolUse / PostToolUse. */
export async function fireToolHooks(event, { tool, args, convId } = {}) {
  return fireHookBridges(event, { tool, args, convId });
}

/** Chat-lifecycle wiring: SessionStart / UserPromptSubmit / Stop. */
export async function fireChatHooks(event, { prompt, convId, sessionId } = {}) {
  return fireHookBridges(event, { args: { prompt }, convId, sessionId });
}

/** Status for /api/hooks/bridges. */
export function hookBridgeStatus() {
  return bridges.map(({ dialect, bridge, configPath }) => ({
    dialect,
    configPath,
    events: Object.keys(bridge.groups),
    groupCount: Object.values(bridge.groups).reduce((n, g) => n + g.length, 0),
    skipped: bridge.skipped,
  }));
}
