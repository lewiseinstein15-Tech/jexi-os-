/**
 * JEXI OS — Hook Engine (roadmap stage 22).
 *
 * Grok Build lessons (verified): hooks gate around tool execution
 * (PreToolUse → execute → PostToolUse), are fail-open by default (record,
 * don't block — only an explicit deny blocks), and hook decisions are
 * observable. This module gives JEXI the same:
 *
 *   hooks: { id, name, event, matcher, action: allow|deny|log, message, enabled }
 *
 *   events: beforeTool | afterTool | beforeTask | afterTask
 *   matcher: a plain substring/regex the hook applies to (tool slug or query)
 *   action: allow (no-op pass), deny (block the tool/task with a message),
 *           log (record a notice that streams into the pipeline)
 *
 * Fail-open: a hook that errors never blocks. Only an explicit deny blocks.
 * Hooks persist in DATA_DIR/hooks.json and stream via sendEvent as
 * hook.ran / hook.blocked events.
 */

import fs from 'fs';
import path from 'path';
import { DATA_DIR } from '../config.js';

const HOOKS_FILE = path.join(DATA_DIR, 'hooks.json');
const MAX_HOOKS = 50;

let hooks = load();

function load() {
  try {
    if (fs.existsSync(HOOKS_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(HOOKS_FILE, 'utf-8'));
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (e) { /* fresh */ }
  return [];
}

function persist() {
  try {
    fs.mkdirSync(path.dirname(HOOKS_FILE), { recursive: true });
    fs.writeFileSync(HOOKS_FILE, JSON.stringify(hooks, null, 2), 'utf-8');
  } catch (e) { console.error('[Hooks] persist error:', e.message); }
}

const EVENTS = ['beforeTool', 'afterTool', 'beforeTask', 'afterTask'];
const ACTIONS = ['allow', 'deny', 'log'];

export function listHooks() {
  return hooks.map((h) => ({ ...h }));
}

export function addHook({ name, event, matcher = '', action = 'log', message = '' }) {
  if (!EVENTS.includes(event)) throw new Error(`Unknown hook event: ${event} (use ${EVENTS.join(', ')})`);
  if (!ACTIONS.includes(action)) throw new Error(`Unknown hook action: ${action}`);
  const hook = {
    id: `hook-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`,
    name: String(name || event).slice(0, 60),
    event, matcher: String(matcher || '').slice(0, 200),
    action, message: String(message || '').slice(0, 300),
    enabled: true, createdAt: Date.now(),
  };
  hooks.push(hook);
  if (hooks.length > MAX_HOOKS) hooks = hooks.slice(-MAX_HOOKS);
  persist();
  return { ...hook };
}

export function updateHook(id, patch = {}) {
  const h = hooks.find((x) => x.id === id);
  if (!h) throw new Error(`Hook not found: ${id}`);
  if (patch.enabled !== undefined) h.enabled = !!patch.enabled;
  if (patch.action && ACTIONS.includes(patch.action)) h.action = patch.action;
  if (patch.matcher !== undefined) h.matcher = String(patch.matcher).slice(0, 200);
  if (patch.message !== undefined) h.message = String(patch.message).slice(0, 300);
  persist();
  return { ...h };
}

export function removeHook(id) {
  const before = hooks.length;
  hooks = hooks.filter((h) => h.id !== id);
  if (hooks.length === before) throw new Error(`Hook not found: ${id}`);
  persist();
  return { success: true };
}

function matches(hook, ctx) {
  if (!hook.matcher) return true;
  const haystack = `${ctx.tool || ''} ${ctx.query || ''} ${ctx.agent || ''}`.toLowerCase();
  return haystack.includes(String(hook.matcher).toLowerCase());
}

/**
 * Run the hooks for an event. Fail-open: hook errors are swallowed; only an
 * explicit deny blocks. Returns { allowed, blocked, logs }.
 */
export function runHooks(event, ctx = {}, sendEvent) {
  const logs = [];
  for (const hook of hooks) {
    if (!hook.enabled || hook.event !== event) continue;
    let matched = false;
    try { matched = matches(hook, ctx); } catch (e) { matched = false; }
    if (!matched) continue;
    logs.push(hook.name);
    try {
      if (sendEvent) sendEvent('log', { agent: `Hook: ${hook.name}`, message: `🪝 [${event}] ${hook.message || 'ran'}` });
    } catch (e) {}
    if (hook.action === 'deny') {
      return { allowed: false, blocked: hook, logs };
    }
  }
  return { allowed: true, blocked: null, logs };
}
