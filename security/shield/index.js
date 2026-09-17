/**
 * JEXI OS — Phase 7 Scope D: AGENTSHIELD + PROMPT DEFENSE — facade.
 *
 *   security/shield/
 *   ├── index.js               ← this facade
 *   ├── prompt-scanner.js      prompt injection detection
 *   ├── hook-scanner.js        dangerous patterns in hooks/
 *   ├── mcp-scanner.js         MCP config + permissions + secrets
 *   ├── permission-scanner.js  excessive grants
 *   ├── secret-scanner.js      hardcoded API keys, tokens
 *   ├── agent-scanner.js       prompt defense baseline + agent hygiene
 *   └── rules.js               detection rules per scanner
 *
 * Every scanner returns findings on the shared contract:
 *   { severity, category, file, line, message, evidence }
 * The facade stamps each finding with `scanner` so `scan('all', …)` output
 * stays attributable. Evidence is always redacted — never a full secret.
 *
 * CLI:
 *   node security/shield/index.js scan prompt "<text>"
 *   node security/shield/index.js scan hooks   <dir>
 *   node security/shield/index.js scan mcp     <registryPath>
 *   node security/shield/index.js scan permissions <file>
 *   node security/shield/index.js scan secrets <dir>
 *   node security/shield/index.js scan agents  <dir>
 *   node security/shield/index.js scan all     <rootDir>
 */

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { scanPrompt } from './prompt-scanner.js';
import { scanHooks } from './hook-scanner.js';
import { scanMcp } from './mcp-scanner.js';
import { scanPermissions } from './permission-scanner.js';
import { scanSecrets } from './secret-scanner.js';
import { scanAgents } from './agent-scanner.js';
import { BASELINE_TEXT, BASELINE_LINES, baselineCheck } from './rules.js';

const SCANNERS = {
  prompt: { fn: (t) => scanPrompt(t), arg: 'text' },
  hooks: { fn: (t) => scanHooks(t), arg: 'dir' },
  mcp: { fn: (t) => scanMcp(t), arg: 'registryPath' },
  permissions: { fn: (t) => scanPermissions(t), arg: 'file' },
  secrets: { fn: (t) => scanSecrets(t), arg: 'dir' },
  agents: { fn: (t) => scanAgents(t), arg: 'dir' },
};

function stamp(findings, scannerName) {
  for (const f of findings) f.scanner = scannerName;
  return findings;
}

/** Collect markdown files under dir (recursive, shallow-skip known noise). */
function mdFilesUnder(dir, skip = new Set(['node_modules', '.git', 'state'])) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (!skip.has(e.name)) out.push(...mdFilesUnder(p, skip));
    } else if (e.isFile() && e.name.toLowerCase().endsWith('.md') && !/^readme\.md$/i.test(e.name)) {
      out.push(p);
    }
  }
  return out;
}

function facadeError(message) {
  return [{
    severity: 'error', category: 'dangerous', file: null, line: null,
    message, evidence: '', scanner: 'facade',
  }];
}

/**
 * Facade — scan(target, opts) per Phase 7 Scope D contract:
 *   scan('prompt', text)        → prompt-scanner
 *   scan('hooks', dir)          → hook-scanner
 *   scan('mcp', registryPath)   → mcp-scanner
 *   scan('permissions', file)   → permission-scanner
 *   scan('secrets', dir)        → secret-scanner
 *   scan('agents', dir)         → agent-scanner
 *   scan('all', rootDir)        → all scanners against a root directory
 *
 * (opts is an optional third bag, e.g. { requireExists: true }.)
 */
export function scan(target, arg, opts = {}) {
  const type = String(target ?? '').toLowerCase();

  if (type === 'all') {
    const rootDir = typeof arg === 'string' ? arg : (arg?.dir ?? '.');
    const out = [];
    out.push(...stamp(scanHooks(rootDir, opts), 'hooks'));
    out.push(...stamp(scanSecrets(rootDir, opts), 'secrets'));
    out.push(...stamp(scanAgents(rootDir, opts), 'agents'));
    // MCP registry: server/mcp/registry.json (post-f5659d0 layout) or mcp/registry.json.
    const registry = [join(rootDir, 'server', 'mcp', 'registry.json'), join(rootDir, 'mcp', 'registry.json')]
      .find((p) => existsSync(p));
    if (registry) out.push(...stamp(scanMcp(registry), 'mcp'));
    // Permissions: agent markdown files under jexi-agents/ (repo layout), agents/, workforce/.
    for (const dirName of ['jexi-agents', 'agents', 'workforce']) {
      const d = join(rootDir, dirName);
      if (!existsSync(d)) continue;
      for (const md of mdFilesUnder(d)) out.push(...stamp(scanPermissions(md), 'permissions'));
      break;
    }
    return out;
  }

  const scanner = SCANNERS[type];
  if (!scanner) {
    return facadeError(`unknown scan target '${target}' (use: ${Object.keys(SCANNERS).join(', ')}, all)`);
  }
  if (arg === undefined || arg === null || (typeof arg === 'string' && !arg.trim())) {
    return facadeError(`scan('${type}') requires a ${scanner.arg} argument`);
  }
  return stamp(scanner.fn(arg), type);
}

export {
  scanPrompt, scanHooks, scanMcp, scanPermissions, scanSecrets, scanAgents,
  BASELINE_TEXT, BASELINE_LINES, baselineCheck,
};

// ── CLI ───────────────────────────────────────────────────────────────────
const invokedDirectly = process.argv[1] && /shield[/\\]index\.js$/.test(process.argv[1]);
if (invokedDirectly) {
  const [, , cmd, type, ...rest] = process.argv;
  if (cmd !== 'scan') {
    console.error('usage: node security/shield/index.js scan <prompt|hooks|mcp|permissions|secrets|agents|all> <target>');
    process.exit(2);
  }
  let findings;
  if (type === 'prompt') {
    findings = scan('prompt', rest.join(' '));
  } else if (type === 'all') {
    findings = scan('all', rest[0] ?? '.');
  } else {
    findings = scan(type, rest[0]);
  }
  const counts = { critical: 0, error: 0, warn: 0, info: 0 };
  for (const f of findings) counts[f.severity] = (counts[f.severity] ?? 0) + 1;
  console.log(JSON.stringify({ target: type, total: findings.length, counts, findings }, null, 2));
  process.exit(0);
}
