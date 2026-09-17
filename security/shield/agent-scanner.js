/**
 * JEXI OS — Phase 7 Scope D: AGENTSHIELD — agent-scanner.
 *
 * Scans a directory of agent files (markdown) for prompt-defense hygiene:
 *   - Missing Prompt Defense Baseline (canonical block from rules.js)
 *   - Baseline present but NOT verbatim / duplicated
 *   - Instructions contradicting safety ("ignore all rules", "do not refuse")
 *   - Descriptions leaking system context
 *   - Embedded URLs to untrusted sources
 *
 * This is the scanner behind the Prompt Defense Baseline lint (P7/P9).
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, extname, basename } from 'node:path';
import {
  baselineCheck, AGENT_CONTRADICTION_RULES, AGENT_LEAK_RULES,
  TRUSTED_URL_HOSTS, finding, clip, lineOf,
} from './rules.js';

const SKIP_DIRS = new Set(['node_modules', '.git', 'state']);
const URL_RE = /\bhttps?:\/\/[^\s"'<>)\]]+/g;

function listMarkdown(dir) {
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
      if (SKIP_DIRS.has(e.name)) continue;
      out.push(...listMarkdown(p));
    } else if (e.isFile() && extname(e.name).toLowerCase() === '.md' && !/^readme\.md$/i.test(e.name)) {
      out.push(p);
    }
  }
  return out;
}

function hostTrusted(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return TRUSTED_URL_HOSTS.some((t) => host === t || host.endsWith('.' + t));
  } catch {
    return false;
  }
}

function scanAgentFile(file) {
  const out = [];
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return [finding({
      severity: 'error', category: 'injection', file, line: null,
      message: 'agent file unreadable', evidence: '',
    })];
  }
  const rel = relative(process.cwd(), file) || file;

  // 1) Prompt Defense Baseline presence + verbatim match.
  const b = baselineCheck(text);
  if (!b.present) {
    out.push(finding({
      severity: 'error', category: 'injection', file: rel, line: null,
      message: 'Prompt Defense Baseline missing',
      evidence: `no '## Prompt Defense Baseline' block in ${basename(rel)}`,
    }));
  } else if (!b.exact) {
    out.push(finding({
      severity: 'error', category: 'injection', file: rel, line: b.at[0],
      message: 'Prompt Defense Baseline does not match canonical text verbatim',
      evidence: `baseline block at line ${b.at[0]} differs from canonical wording/order`,
    }));
  }
  if (b.count > 1) {
    out.push(finding({
      severity: 'error', category: 'injection', file: rel, line: b.at[1],
      message: `Prompt Defense Baseline duplicated (${b.count} copies — keep exactly one)`,
      evidence: `baseline headers at lines ${b.at.join(', ')}`,
    }));
  }

  // 2) Contradicts safety.
  for (const rule of AGENT_CONTRADICTION_RULES) {
    const m = rule.re.exec(text);
    if (m) {
      out.push(finding({
        severity: rule.severity, category: 'injection', file: rel, line: lineOf(text, rule.re),
        message: rule.message,
        evidence: clip(m[0]),
      }));
    }
  }

  // 3) Leaks system context.
  for (const rule of AGENT_LEAK_RULES) {
    const m = rule.re.exec(text);
    if (m) {
      out.push(finding({
        severity: rule.severity, category: 'injection', file: rel, line: lineOf(text, rule.re),
        message: rule.message,
        evidence: clip(m[0]),
      }));
    }
  }

  // 4) Untrusted URLs.
  const urls = text.match(URL_RE) || [];
  const flagged = new Set();
  for (const u of urls) {
    if (!hostTrusted(u)) flagged.add(u);
  }
  for (const u of flagged) {
    out.push(finding({
      severity: 'info', category: 'injection', file: rel, line: lineOf(text, new RegExp(u.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))),
      message: `URL to untrusted source: ${new URL(u).hostname}`,
      evidence: clip(u, 90),
    }));
  }

  return out;
}

/** Scan a directory of agent markdown files. Returns findings[]. */
export function scanAgents(dir, opts = {}) {
  const root = String(dir ?? '');
  const files = listMarkdown(root);
  const out = [];
  if (files.length === 0 && opts.requireExists) {
    return [finding({
      severity: 'error', category: 'injection', file: root, line: null,
      message: 'agent scan target has no agent files (missing dir?)', evidence: '',
    })];
  }
  for (const f of files) out.push(...scanAgentFile(f));
  return out;
}

export default { scanAgents };
