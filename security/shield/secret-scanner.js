/**
 * JEXI OS — Phase 7 Scope D: AGENTSHIELD — secret-scanner.
 *
 * Scans a directory tree for hardcoded credentials:
 *   - Known provider patterns: AWS, GCP, OpenAI sk-, Anthropic sk-ant-,
 *     GitHub ghp_/gho_/ghu_/ghs_, Slack, Stripe, Twilio, SendGrid
 *   - Generic high-entropy strings next to key=/token=/secret=/password=
 *   - .env files tracked in git
 *   - Private keys (RSA, EC, DSA, OpenSSH, PGP)
 *
 * Evidence is ALWAYS redacted — the scanner must never print a full secret,
 * including the fake ones used in probes.
 */

import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join, relative, extname, basename, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  SECRET_PATTERNS, GENERIC_SECRET_RE, finding, clip, redactValue, looksLikeCredential,
} from './rules.js';

const TEXT_EXTS = new Set([
  '.js', '.mjs', '.cjs', '.ts', '.jsx', '.tsx', '.json', '.md', '.yml', '.yaml',
  '.sh', '.txt', '.py', '.html', '.css', '.xml', '.sql', '.toml', '.ini',
  '.cfg', '.conf', '.properties', '.pem', '.key', '.env', '.example', '.cjs2',
]);
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'state', '.jexi-secrets', '__pycache__']);

function isEnvFile(name) {
  return name === '.env' || name.startsWith('.env.');
}

function listFiles(dir) {
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
      out.push(...listFiles(p));
    } else if (e.isFile()) {
      const ext = extname(e.name).toLowerCase();
      const envish = isEnvFile(e.name);
      if (envish || TEXT_EXTS.has(ext) || !ext) out.push(p);
    }
  }
  return out;
}

function repoRootFor(startDir) {
  let cur = String(startDir);
  for (let i = 0; i < 12; i++) {
    try {
      if (statSync(join(cur, '.git')).isDirectory()) return cur;
    } catch { /* not here */ }
    const parent = dirname(cur);
    if (parent === cur) return null;
    cur = parent;
  }
  return null;
}

/** True if the given absolute file is tracked by git (best effort). */
function gitTracked(absFile, root) {
  if (!root) return false;
  try {
    const rel = relative(root, absFile);
    const out = execFileSync('git', ['ls-files', '--', rel], { cwd: root, encoding: 'utf8' });
    return out.trim().length > 0;
  } catch {
    return false;
  }
}

function scanLineForSecrets(line, relFile, lineNo) {
  const out = [];
  const add = (severity, category, message, evidence) =>
    out.push(finding({ severity, category, file: relFile, line: lineNo, message, evidence }));

  for (const p of SECRET_PATTERNS) {
    const m = p.re.exec(line);
    if (m) {
      const val = m[0];
      add(p.severity, 'secret',
        `hardcoded secret: ${p.provider} credential pattern (${p.id})`,
        clip(line.replace(val, redactValue(val, p.redact)), 120));
    }
  }

  // Generic high-entropy assignment: key = "value" (quoted literal only)
  let g;
  const gre = new RegExp(GENERIC_SECRET_RE.source, 'gi');
  while ((g = gre.exec(line)) !== null) {
    const value = g[2];
    if (!looksLikeCredential(value)) continue;
    add('warn', 'secret',
      'generic high-entropy credential assignment (key/token/secret/password=…)',
      clip(line.replace(value, redactValue(value, 3)), 120));
  }

  return out;
}

/** Scan a directory tree for secrets. Returns findings[]. */
export function scanSecrets(dir, opts = {}) {
  const root = String(dir ?? '');
  const files = listFiles(root);
  const repoRoot = repoRootFor(root);
  const out = [];

  for (const f of files) {
    let text;
    try {
      text = readFileSync(f, 'utf8');
    } catch {
      continue; // binary/unreadable
    }
    const rel = relative(process.cwd(), f) || f;
    const name = basename(f);

    // .env tracked in git — checked per file.
    if (isEnvFile(name) && (opts.gitCheck ?? true)) {
      const tracked = gitTracked(f, repoRoot ?? repoRootFor(process.cwd()));
      if (tracked) {
        out.push(finding({
          severity: 'error', category: 'secret', file: rel, line: null,
          message: '.env file is tracked in git (accidental commit?)',
          evidence: 'git ls-files reports this .env as tracked',
        }));
      }
    }

    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line.trim()) continue;
      out.push(...scanLineForSecrets(line, rel, i + 1));
    }
  }

  // Dedupe identical (rule, file, line) hits.
  const seen = new Set();
  return out.filter((f) => {
    const key = `${f.message}|${f.file}|${f.line}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export default { scanSecrets };
