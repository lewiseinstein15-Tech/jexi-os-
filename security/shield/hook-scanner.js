/**
 * JEXI OS — Phase 7 Scope D: AGENTSHIELD — hook-scanner.
 *
 * Scans hook command files (hooks/, or any directory of hook scripts) for:
 *   - Shell escapes:        eval, exec, backticks, $() with non-literal content
 *   - Network calls:        curl/wget/fetch to non-localhost
 *   - File writes outside the repo or /tmp
 *   - Destructive commands: rm -rf, chmod 777, dd, mkfs
 *   - Env var exfiltration:  AWS_* / GITHUB_TOKEN / API_KEY read into logs or network
 *
 * Read-only: this scanner never modifies hooks/ (Scope B artifacts are frozen).
 */

import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join, relative, extname } from 'node:path';
import {
  HOOK_RULES, LOCAL_HOSTS, finding, clip, redactEvidence,
} from './rules.js';

const TEXT_EXTS = new Set(['.sh', '.bash', '.zsh', '.js', '.mjs', '.cjs', '.json', '.yml', '.yaml', '.md']);
const SKIP_DIRS = new Set(['node_modules', '.git', 'state', '.jexi-secrets']);

function listFiles(dir) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out; // missing dir → no findings (caller decides if that's an error)
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      out.push(...listFiles(p));
    } else if (e.isFile()) {
      if (TEXT_EXTS.has(extname(e.name).toLowerCase())) out.push(p);
    }
  }
  return out;
}

function hostOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

function scanLine(line, relFile, lineNo, isShell) {
  const out = [];
  const add = (severity, message, category = 'dangerous', evidence = line) =>
    out.push(finding({ severity, category, file: relFile, line: lineNo, message, evidence: redactEvidence(clip(evidence)) }));

  // 1) Shell escapes / code execution.
  if (HOOK_RULES.EVAL.test(line) || HOOK_RULES.EXEC_CALL.test(line)) {
    add('error', 'eval/exec code execution in hook command');
  } else if (isShell && HOOK_RULES.SH_EVAL.test(line)) {
    add('error', 'shell eval in hook command');
  }
  if (isShell && HOOK_RULES.BACKTICKS.test(line)) {
    add('warn', 'backtick command substitution in hook (prefer explicit, literal commands)');
  }
  if (HOOK_RULES.CMD_SUBST.test(line)) {
    const subst = HOOK_RULES.CMD_SUBST.exec(line)[0];
    // Non-literal = contains a variable expansion or nested substitution.
    if (/\$\{|`|\$\(/.test(subst.slice(2, -1))) {
      add('error', '$() command substitution with non-literal content');
    } else {
      add('warn', '$() command substitution in hook (verify content is literal)');
    }
  }

  // 2) Network calls to non-localhost.
  if (HOOK_RULES.CURL_WGET.test(line) || HOOK_RULES.FETCH_CALL.test(line)) {
    const urlMatch = HOOK_RULES.URL.exec(line);
    const host = urlMatch ? hostOf(urlMatch[0]) : null;
    if (urlMatch && host && !LOCAL_HOSTS.test(host)) {
      add('error', `network call to non-localhost host '${host}' in hook`, 'dangerous');
    } else if (!urlMatch) {
      add('warn', 'network-capable command (curl/wget/fetch) in hook with non-obvious target');
    }
  }

  // 3) File writes outside repo or /tmp (absolute paths only; /dev/null is sink).
  const wm = HOOK_RULES.WRITE_REDIRECT.exec(line);
  if (wm && wm[1] && !wm[1].startsWith('/tmp') && wm[1] !== '/dev/null') {
    add('warn', `file write to absolute path outside /tmp: ${wm[1]}`);
  }
  const cm = HOOK_RULES.CP_MV_ABS.exec(line);
  if (cm && cm[1] && !cm[1].startsWith('/tmp') && /^\/(etc|root|usr|home\/[a-z0-9_-]+\/\.)/i.test(cm[1])) {
    add('warn', `copy/move targeting sensitive absolute path: ${cm[1]}`);
  }

  // 4) Destructive commands.
  if (HOOK_RULES.RM_RF.test(line)) add('error', 'destructive command: rm -rf in hook');
  if (HOOK_RULES.CHMOD_777.test(line)) add('error', 'destructive command: chmod 777 in hook');
  if (HOOK_RULES.DD.test(line)) add('error', 'destructive command: dd raw write in hook');
  if (HOOK_RULES.MKFS.test(line)) add('critical', 'destructive command: mkfs in hook');

  // 5) Env var exfiltration: credential var read into log/echo/network.
  const cred = HOOK_RULES.ENV_CRED.exec(line);
  if (cred && HOOK_RULES.LOG_OR_NET.test(line)) {
    add('error', `credential variable ${cred[1]} read into log/network in hook`, 'secret');
  }

  return out;
}

/** Scan a directory of hook files. Returns findings[]. */
export function scanHooks(dir, opts = {}) {
  const root = String(dir ?? '');
  const files = listFiles(root);
  const out = [];
  if (files.length === 0 && opts.requireExists) {
    return [finding({
      severity: 'error', category: 'dangerous', file: root, line: null,
      message: 'hook scan target has no scannable files (missing dir?)', evidence: '',
    })];
  }
  for (const f of files) {
    let text;
    try {
      text = readFileSync(f, 'utf8');
    } catch {
      continue;
    }
    const rel = relative(process.cwd(), f) || f;
    const isShell = /\.(sh|bash|zsh)$/.test(f);
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line.trim() || line.trim().startsWith('#')) continue; // skip blanks/comments
      out.push(...scanLine(line, rel, i + 1, isShell));
    }
  }
  return out;
}

export default { scanHooks };
