/**
 * JEXI OS — Phase 7 Scope D: AGENTSHIELD — permission-scanner.
 *
 * Scans an agent/config file for excessive grants:
 *   - Broad tool grants (many tools, no justification)
 *   - Runtime rings higher than the agent's declared needs
 *   - Filesystem/network grants without explicit approval
 *   - Wildcards in permissions
 *
 * Accepts JSON (parsed structurally) or Markdown/YAML (line-based).
 */

import { readFileSync } from 'node:fs';
import {
  PERMISSION_CONFIG, finding, clip, lineOf,
} from './rules.js';

// ── JSON path ─────────────────────────────────────────────────────────────
function scanNode(node, raw, file, out, path = '$') {
  if (Array.isArray(node)) {
    node.forEach((v, i) => scanNode(v, raw, file, out, `${path}[${i}]`));
    return;
  }
  if (!node || typeof node !== 'object') return;

  const tools = Array.isArray(node.tools) ? node.tools.map(String) : null;
  const perms = Array.isArray(node.permissions) ? node.permissions.map(String) : null;

  // 1) Broad tool grant without justification.
  if (tools && tools.length >= PERMISSION_CONFIG.BROAD_TOOL_COUNT) {
    const justified = node.justification || node.reason || node.description || node.mandate;
    if (!justified) {
      out.push(finding({
        severity: 'warn', category: 'permission', file, line: lineOf(raw, /"tools"\s*:/),
        message: `broad tool grant: ${tools.length} tools at ${path} without justification`,
        evidence: clip(`tools=[${tools.slice(0, 10).join(', ')}${tools.length > 10 ? ', …' : ''}]`),
      }));
    }
  }

  // 2) Wildcards in tools/permissions.
  for (const [label, arr] of [['tools', tools], ['permissions', perms]]) {
    if (!arr) continue;
    const wild = arr.filter((t) => PERMISSION_CONFIG.WILDCARD_RE.test(t));
    if (wild.length) {
      out.push(finding({
        severity: 'critical', category: 'permission', file, line: lineOf(raw, new RegExp(`"${label}"\\s*:`)),
        message: `wildcard permission '${wild.join(', ')}' at ${path}.${label}`,
        evidence: clip(`${label}=[${arr.join(', ')}]`),
      }));
    }
  }

  // 3) Filesystem/network grants without explicit approval.
  if (perms && perms.some((p) => PERMISSION_CONFIG.FS_NET_GRANT_RE.test(p))) {
    const approved = node.approval === true || node.approved === true || node.approval === 'explicit'
      || (typeof node.approval === 'string' && /approve/i.test(node.approval));
    if (!approved) {
      const hits = perms.filter((p) => PERMISSION_CONFIG.FS_NET_GRANT_RE.test(p));
      out.push(finding({
        severity: 'warn', category: 'permission', file, line: lineOf(raw, /"permissions"\s*:/),
        message: `filesystem/network grant(s) [${hits.join(', ')}] at ${path} without explicit approval flag`,
        evidence: clip(`permissions=[${perms.join(', ')}] approval=${JSON.stringify(node.approval ?? null)}`),
      }));
    }
  }

  // 4) Runtime ring exceeds declared need (lower number = more privileged).
  const ring = Number(node.ring);
  const needRing = node.needs && Number(node.needs.ring);
  if (Number.isFinite(ring) && Number.isFinite(needRing) && ring !== needRing) {
    const direction = ring < needRing ? 'more privileged than' : 'less privileged than';
    out.push(finding({
      severity: 'warn', category: 'permission', file, line: lineOf(raw, /"ring"\s*:/),
      message: `runtime ring ${ring} is ${direction} declared need ${needRing} at ${path}`,
      evidence: clip(`ring=${ring} needs.ring=${needRing}`),
    }));
  }

  for (const [k, v] of Object.entries(node)) scanNode(v, raw, file, out, `${path}.${k}`);
}

// ── Markdown/YAML line-based path ─────────────────────────────────────────
function scanTextLines(raw, file, out) {
  const lines = raw.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const toolsList = /^\s*(?:- )?tools:\s*\[([^\]]*)\]/.exec(line);
    if (toolsList) {
      const tools = toolsList[1].split(',').map((s) => s.trim().replace(/['"]/g, '')).filter(Boolean);
      if (tools.length >= PERMISSION_CONFIG.BROAD_TOOL_COUNT) {
        out.push(finding({
          severity: 'warn', category: 'permission', file, line: i + 1,
          message: `broad tool grant: ${tools.length} tools without justification`,
          evidence: clip(line),
        }));
      }
      const wild = tools.filter((t) => PERMISSION_CONFIG.WILDCARD_RE.test(t));
      if (wild.length) {
        out.push(finding({
          severity: 'critical', category: 'permission', file, line: i + 1,
          message: `wildcard permission '${wild.join(', ')}' in tools`,
          evidence: clip(line),
        }));
      }
    }

    const ringDecl = /^\s*ring:\s*(\d+)/.exec(line);
    if (ringDecl) {
      // look ahead a few lines for needs.ring
      const window = lines.slice(i, i + 8).join('\n');
      const need = /\bneeds:\s*[\s\S]{0,40}?\bring:\s*(\d+)/.exec(window);
      const ring = Number(ringDecl[1]);
      const needRing = need ? Number(need[1]) : null;
      if (needRing !== null && ring !== needRing) {
        const direction = ring < needRing ? 'more privileged than' : 'less privileged than';
        out.push(finding({
          severity: 'warn', category: 'permission', file, line: i + 1,
          message: `runtime ring ${ring} is ${direction} declared need ${needRing}`,
          evidence: clip(line),
        }));
      }
    }

    const permList = /^\s*(?:- )?permissions:\s*\[([^\]]*)\]/.exec(line);
    if (permList) {
      const perms = permList[1].split(',').map((s) => s.trim().replace(/['"]/g, '')).filter(Boolean);
      const wild = perms.filter((p) => PERMISSION_CONFIG.WILDCARD_RE.test(p));
      if (wild.length) {
        out.push(finding({
          severity: 'critical', category: 'permission', file, line: i + 1,
          message: `wildcard permission '${wild.join(', ')}' in permissions`,
          evidence: clip(line),
        }));
      }
      const fsnet = perms.filter((p) => PERMISSION_CONFIG.FS_NET_GRANT_RE.test(p));
      if (fsnet && !/approv/i.test(line)) {
        out.push(finding({
          severity: 'warn', category: 'permission', file, line: i + 1,
          message: `filesystem/network grant(s) [${fsnet.join(', ')}] without explicit approval`,
          evidence: clip(line),
        }));
      }
    }
  }
}

/** Scan a single permissions-bearing file (JSON or Markdown/YAML). */
export function scanPermissions(file) {
  let raw;
  try {
    raw = readFileSync(String(file), 'utf8');
  } catch (err) {
    return [finding({
      severity: 'error', category: 'permission', file: String(file), line: null,
      message: `permissions target unreadable: ${err.code ?? err.message}`, evidence: '',
    })];
  }
  const out = [];
  const trimmed = raw.trim();
  let json = null;
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try { json = JSON.parse(raw); } catch { json = null; }
  }
  if (json !== null) {
    scanNode(json, raw, String(file), out);
  } else {
    scanTextLines(raw, String(file), out);
  }
  return out;
}

export default { scanPermissions };
