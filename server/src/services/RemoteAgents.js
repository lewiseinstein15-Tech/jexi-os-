/**
 * B138 — REMOTE AGENTS (DeepSeek Harness `packages/api/remotes` mirror:
 * agent-lookup + remote-events — JEXI-branded).
 *
 * A registry of remote JEXI agents the user has paired with (a handle like
 * `phone@server` or `office@host`), persisted in DATA_DIR/remotes.json.
 * `lookupRemoteAgent(handle)` resolves a handle to its record (agent name,
 * base URL, enabled state) or null; status surfaces reachability facts
 * WITHOUT probing the network (the probe is the caller's business).
 *
 *   GET  /api/remotes              — list registered remote agents
 *   PUT  /api/remotes              — register/update one { handle, agent, url, enabled }
 *   DELETE /api/remotes/:handle    — unregister
 */

import fs from 'fs';
import path from 'path';
import { DATA_DIR } from '../config.js';

const REMOTES_FILE = path.join(DATA_DIR, 'remotes.json');
const HANDLE_RE = /^[A-Za-z0-9._@-]{1,64}$/;
const MAX_REMOTES = 50;

function load() {
  try {
    if (fs.existsSync(REMOTES_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(REMOTES_FILE, 'utf-8'));
      if (parsed && typeof parsed === 'object') return parsed;
    }
  } catch { /* fresh */ }
  return {};
}

function persist(remotes) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(REMOTES_FILE, JSON.stringify(remotes, null, 2), 'utf-8');
  } catch { /* noop */ }
}

/** Register (or update) one remote agent. */
export function registerRemoteAgent({ handle, agent = null, url = '', enabled = true }) {
  const h = String(handle || '').trim();
  if (!HANDLE_RE.test(h)) return { ok: false, error: `handle must match ${HANDLE_RE}` };
  const remotes = load();
  if (!remotes[h] && Object.keys(remotes).length >= MAX_REMOTES) {
    return { ok: false, error: `too many remote agents (max ${MAX_REMOTES})` };
  }
  const record = {
    handle: h,
    agent: String(agent || h).slice(0, 60),
    url: String(url || '').slice(0, 500),
    enabled: enabled !== false,
    updatedAt: Date.now(),
  };
  remotes[h] = record;
  persist(remotes);
  return { ok: true, remote: record };
}

/** Resolve a handle to its record (or null). */
export function lookupRemoteAgent(handle) {
  const h = String(handle || '').trim();
  if (!HANDLE_RE.test(h)) return null;
  return load()[h] || null;
}

/** List all registered remote agents. */
export function listRemoteAgents() {
  const remotes = load();
  return Object.values(remotes).map((r) => ({
    handle: r.handle,
    agent: r.agent,
    url: r.url,
    enabled: r.enabled !== false,
    updatedAt: r.updatedAt,
  })).sort((a, b) => a.handle.localeCompare(b.handle));
}

/** Unregister one remote agent. */
export function unregisterRemoteAgent(handle) {
  const h = String(handle || '').trim();
  const remotes = load();
  if (!remotes[h]) return { ok: false, error: `no remote agent "${h}"` };
  delete remotes[h];
  persist(remotes);
  return { ok: true, handle: h };
}

/** Full status for /api/remotes. */
export function remoteAgentsStatus() {
  const remotes = listRemoteAgents();
  return {
    ok: true,
    count: remotes.length,
    enabled: remotes.filter((r) => r.enabled).length,
    remotes,
    file: REMOTES_FILE,
  };
}

/** Lookup result shaped like dsh agent-lookup (handle → { agent, url } | null). */
export function agentLookup(handle) {
  const r = lookupRemoteAgent(handle);
  if (!r || r.enabled === false) return { found: false, handle: String(handle || '') };
  return { found: true, handle: r.handle, agent: r.agent, url: r.url };
}
