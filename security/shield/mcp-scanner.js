/**
 * JEXI OS — Phase 7 Scope D: AGENTSHIELD — mcp-scanner.
 *
 * Scans an MCP registry.json for:
 *   - Community servers with NETWORK/GIT (or EXECUTION) permissions
 *   - Servers with write access to sensitive paths
 *   - Hardcoded credentials in the registry
 *   - Wildcard permissions (tools: ["*"], permissions: ["*"])
 *   - Unpinned npx/uvx invocations
 *
 * Note on enabled:false: servers Phase 1 Scope D shipped as disabled are
 * still flagged — disabled is a control, not a licence. The finding message
 * reports the enabled state honestly.
 */

import { readFileSync } from 'node:fs';
import {
  MCP_CONFIG, finding, clip, redactEvidence, lineOf,
} from './rules.js';

/** First non-flag positional arg of an npx/uvx command = the package spec. */
function packageOf(server) {
  if (server.command !== 'npx' && server.command !== 'uvx') return null;
  const args = Array.isArray(server.args) ? server.args.map(String) : [];
  const VALUE_FLAGS = new Set(['--with', '--db-path', '--repository', '--from', '--python', '--prefix']);
  let pkg = null;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('-')) {
      if (VALUE_FLAGS.has(a)) i++; // skip this flag's value
      continue;
    }
    if (/^\$\{.*\}$/.test(a)) continue; // template like ${JEXI_WORKSPACE}
    pkg = a;
    break;
  }
  return pkg;
}

function scanServer(server, raw, registryPath) {
  const out = [];
  const name = String(server.name ?? '(unnamed)');
  const perms = Array.isArray(server.permissions) ? server.permissions.map(String) : [];
  const trust = String(server.trustLevel ?? 'unknown');
  const enabled = Boolean(server.enabled);
  const line = lineOf(raw, new RegExp(`"name"\\s*:\\s*"${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`));

  // 1) Community servers with sensitive permissions.
  if (trust === 'community') {
    const hits = perms.filter((p) => MCP_CONFIG.COMMUNITY_SENSITIVE_PERMS.includes(p));
    if (hits.length) {
      out.push(finding({
        severity: 'error', category: 'permission', file: registryPath, line,
        message: `community server '${name}' with ${hits.join('+')} permission(s) (enabled: ${enabled})`,
        evidence: clip(`trustLevel=${trust} permissions=[${perms.join(', ')}] enabled=${enabled}`),
      }));
    }
  }

  // 2) Write access to sensitive paths.
  const blob = JSON.stringify(server);
  if (MCP_CONFIG.SENSITIVE_PATH_RE.test(blob) && perms.some((p) => MCP_CONFIG.WRITE_PERMS.includes(p))) {
    const pathHit = MCP_CONFIG.SENSITIVE_PATH_RE.exec(blob)[0];
    out.push(finding({
      severity: 'warn', category: 'permission', file: registryPath, line,
      message: `server '${name}' has write/execution grants touching sensitive path '${pathHit}'`,
      evidence: clip(blob.slice(Math.max(0, blob.indexOf(pathHit) - 40), blob.indexOf(pathHit) + 60)),
    }));
  }

  // 3) Hardcoded credentials anywhere in the server entry.
  for (const [k, v] of Object.entries(server)) {
    if (typeof v !== 'string' || !v) continue;
    if (MCP_CONFIG.CRED_KEY_RE.test(k) && !/^\$\{.*\}$/.test(v) && v.length >= 8) {
      out.push(finding({
        severity: 'critical', category: 'secret', file: registryPath, line,
        message: `hardcoded credential in registry: server '${name}' key '${k}'`,
        evidence: `${k}: ${redactEvidence(v)}`,
      }));
    }
  }
  // Also scan stringified args for key=value secrets (e.g. args ["--api-key","sk-..."]).
  if (/\b(?:api[_-]?key|token|secret|password)\b\s*[:=]\s*["']?[A-Za-z0-9+/_-]{16,}/i.test(JSON.stringify(server.args ?? ''))) {
    out.push(finding({
      severity: 'critical', category: 'secret', file: registryPath, line,
      message: `hardcoded credential in registry: server '${name}' args carry key= value`,
      evidence: redactEvidence(clip(JSON.stringify(server.args), 120)),
    }));
  }

  // 4) Wildcard permissions.
  if (perms.includes('*') || (Array.isArray(server.tools) && server.tools.includes('*'))) {
    out.push(finding({
      severity: 'critical', category: 'permission', file: registryPath, line,
      message: `wildcard permission on server '${name}'`,
      evidence: clip(`permissions=[${perms.join(', ')}] tools=[${(server.tools ?? []).join(', ')}]`),
    }));
  }

  // 5) Unpinned npx/uvx invocations.
  const pkg = packageOf(server);
  if (pkg) {
    if (!/@[^/]+$/.test(pkg)) {
      out.push(finding({
        severity: 'warn', category: 'permission', file: registryPath, line,
        message: `unpinned ${server.command} invocation: '${pkg}' has no version pin`,
        evidence: clip(`${server.command} ${[...(server.args ?? [])].join(' ')}`, 110),
      }));
    } else if (/@latest$/i.test(pkg)) {
      out.push(finding({
        severity: 'warn', category: 'permission', file: registryPath, line,
        message: `floating '@latest' pin on ${server.command} invocation: '${pkg}'`,
        evidence: clip(`${server.command} ${[...(server.args ?? [])].join(' ')}`, 110),
      }));
    }
  }

  return out;
}

/** Scan an MCP registry.json file. Returns findings[]. */
export function scanMcp(registryPath) {
  let raw;
  try {
    raw = readFileSync(String(registryPath), 'utf8');
  } catch (err) {
    return [finding({
      severity: 'error', category: 'permission', file: String(registryPath), line: null,
      message: `MCP registry unreadable: ${err.code ?? err.message}`, evidence: '',
    })];
  }
  let reg;
  try {
    reg = JSON.parse(raw);
  } catch (err) {
    return [finding({
      severity: 'error', category: 'permission', file: String(registryPath), line: null,
      message: `MCP registry is not valid JSON: ${err.message}`, evidence: '',
    })];
  }
  const servers = Array.isArray(reg.servers) ? reg.servers : [];
  const out = [];
  for (const s of servers) out.push(...scanServer(s, raw, String(registryPath)));
  return out;
}

export default { scanMcp };
