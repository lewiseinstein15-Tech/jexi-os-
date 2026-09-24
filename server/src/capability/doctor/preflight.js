/**
 * JEXI OS — PHASE 31 SCOPE 5 — W29: Ralph pre-flight checks, consumer-side.
 *
 * The unified doctor (capability/doctor at the repo root, Phase 11 Scope H)
 * is scoped to its own subsystems and ships no Ralph pre-flight checks; this
 * server-side consumer adds them WITHOUT touching the shipped module:
 *
 *   agent-clis     — probe PATH for the agent CLI binaries the ecosystem
 *                    documents (honest 'off' where none exist — env-dependent)
 *   mcp-registry   — parse server/mcp/registry.json (real file read: server
 *                    count, enabled count)
 *   bundles        — parse server/bundles/manifest.json (real file read:
 *                    package count by port status)
 *
 * Output shape matches the shipped doctor contract exactly:
 *   { overall, healthy, timestamp, subsystems[], warnings[], errors[] }
 *   subsystem: { name, status: ok|warn|off|error, message, detail? }
 *
 * No new error class; every check is fail-soft — a broken probe is an
 * 'error' subsystem record, never a throw to the boot path.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = path.resolve(HERE, '..', '..', '..');
const REPO_ROOT = path.resolve(SERVER_ROOT, '..');

const STATUS_RANK = { ok: 0, warn: 1, off: 2, error: 3 };
const worst = (a, b) => (STATUS_RANK[a] >= STATUS_RANK[b] ? a : b);

function subsystem(name, status, message, detail = undefined) {
  return { name, status, message, ...(detail !== undefined ? { detail } : {}) };
}

/** Agent CLI candidates documented across the repo's agent/harness surfaces. */
const AGENT_CLIS = ['claude', 'codex', 'gemini', 'opencode', 'aider'];

function checkAgentClis() {
  const found = [];
  for (const cli of AGENT_CLIS) {
    try {
      const p = execFileSync('which', [cli], { encoding: 'utf8', timeout: 5000 }).trim();
      if (p) found.push(cli);
    } catch { /* not on PATH — honest absence */ }
  }
  if (found.length === 0) {
    return subsystem('agent-clis', 'off',
      `no agent CLI on PATH (${AGENT_CLIS.join(', ')} probed) — env-dependent, not an error`,
      { probed: AGENT_CLIS, found });
  }
  return subsystem('agent-clis', 'ok', `agent CLIs on PATH: ${found.join(', ')}`, { probed: AGENT_CLIS, found });
}

function checkMcpRegistry() {
  try {
    const reg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'server', 'mcp', 'registry.json'), 'utf8'));
    const servers = reg.servers || [];
    const enabled = servers.filter((s) => s.enabled).length;
    return subsystem('mcp-registry', 'ok',
      `registry v${reg.version} parses: ${servers.length} servers, ${enabled} enabled`,
      { version: reg.version, servers: servers.length, enabled });
  } catch (e) {
    return subsystem('mcp-registry', 'error', `registry unreadable: ${String(e && e.message || e).slice(0, 120)}`);
  }
}

function checkBundles() {
  try {
    const man = JSON.parse(fs.readFileSync(path.join(SERVER_ROOT, 'bundles', 'manifest.json'), 'utf8'));
    const pkgs = man.packages || [];
    const byStatus = pkgs.reduce((acc, p) => { acc[p.status || 'unknown'] = (acc[p.status || 'unknown'] || 0) + 1; return acc; }, {});
    return subsystem('bundles', 'ok',
      `bundle manifest parses: ${pkgs.length} packages (${Object.entries(byStatus).map(([k, v]) => `${k}=${v}`).join(', ')})`,
      { packages: pkgs.length, byStatus });
  } catch (e) {
    return subsystem('bundles', 'error', `manifest unreadable: ${String(e && e.message || e).slice(0, 120)}`);
  }
}

/** Run the three Ralph pre-flight checks. Never throws. */
export async function runPreflight() {
  const subsystems = [];
  for (const check of [checkAgentClis, checkMcpRegistry, checkBundles]) {
    try { subsystems.push(await check()); }
    catch (e) { subsystems.push(subsystem(check.name, 'error', String(e && e.message || e).slice(0, 120))); }
  }
  const overall = subsystems.reduce((acc, s) => worst(acc, s.status), 'ok');
  const warnings = subsystems.filter((s) => s.status === 'warn' || s.status === 'off').map((s) => `${s.name}: ${s.message}`);
  const errors = subsystems.filter((s) => s.status === 'error').map((s) => `${s.name}: ${s.message}`);
  return { overall, healthy: overall === 'ok', timestamp: new Date().toISOString(), subsystems, warnings, errors };
}

export default runPreflight;
